-- A busca do Explorador continuava estourando o statement_timeout MESMO com os
-- índices de trigrama da 0025. Motivo: a view mercado_explorador é security_invoker,
-- então roda sob a RLS (`app_tem_modulo('mercado')`) — e o operador ILIKE não é
-- leakproof. Sob RLS o planner é PROIBIDO de aplicar um qual não-leakproof antes da
-- checagem de segurança, então ele não usa o índice de trigrama e varre as 876k linhas
-- (3s+ com filtro de camada, timeout sem filtro). Browsing funciona porque não usa
-- ILIKE; só a busca quebra.
--
-- Solução: mesma da mercado_mapa/mercado_piramide — RPC SECURITY DEFINER. Dentro dela
-- a view roda como a dona (bypass RLS), o ILIKE volta a usar o trigrama, e o portão do
-- módulo é feito UMA vez no topo. Não dá pra portão na própria view: o worker a lê sem
-- JWT (app_tem_modulo = false) e ficaria com zero linhas.

-- ── Compilador da árvore de filtro (folha resolvida → SQL), whitelist de colunas ──
create or replace function public.mercado_pred(no jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare
  col text; op text; v text; arr text[]; parts text[]; child jsonb;
begin
  if no ? 'c' then
    parts := array[]::text[];
    for child in select * from jsonb_array_elements(no->'c') loop
      parts := parts || public.mercado_pred(child);
    end loop;
    if array_length(parts,1) is null then return 'true'; end if;
    return '(' || array_to_string(parts, case when no->>'op' = 'ou' then ' or ' else ' and ' end) || ')';
  end if;

  col := no->>'col';
  if col not in (
    'cnpj','razao_social','nome_fantasia','situacao_cadastral','natureza_juridica','porte_rfb',
    'cnae_principal','cnaes_todos','cnae_grupos','capital_social','data_inicio_atividade','uf',
    'municipio','opcao_simples','data_exclusao_simples','is_spe','grupo_id','grafo_sefaz','camada',
    'camada_regra_versao','empresa_id','estagio','tipo','erp_atual','erp_mrr','churn_erp_concorrente',
    'qtd_usuarios_erp','ratio_usuarios_ativos','qtd_filiais','grupo_spes_total','grupo_spes_24m',
    'grupo_ufs','obras_ativas','obras_iniciadas_24m','m2_em_execucao','tem_contato'
  ) then
    raise exception 'coluna não permitida no filtro: %', col using errcode = '42501';
  end if;

  op := no->>'op';
  v := no->>'v';
  case op
    when 'igual' then return format('%I = %L', col, v);
    when 'diferente' then return format('%I is distinct from %L', col, v);
    when 'maior_que' then return format('%I > %L', col, v);
    when 'maior_ou_igual' then return format('%I >= %L', col, v);
    when 'menor_que' then return format('%I < %L', col, v);
    when 'menor_ou_igual' then return format('%I <= %L', col, v);
    when 'contem' then return format('%I ilike %L', col, '%'||v||'%');
    when 'comeca_com' then return format('%I ilike %L', col, v||'%');
    when 'definido' then return format('%I is not null', col);
    when 'nao_definido' then return format('%I is null', col);
    when 'em' then
      select array_agg(x) into arr from jsonb_array_elements_text(no->'v') x;
      return format('%I = any(%L::text[])', col, arr);
    when 'nao_em' then
      select array_agg(x) into arr from jsonb_array_elements_text(no->'v') x;
      return format('(%I is null or %I <> all(%L::text[]))', col, col, arr);
    when 'contem_algum' then
      select array_agg(x) into arr from jsonb_array_elements_text(no->'v') x;
      return format('%I && %L::text[]', col, arr);
    when 'entre' then
      return format('%I between %L and %L', col, no->'v'->>0, no->'v'->>1);
    else
      raise exception 'operador não suportado no filtro: %', op using errcode = '42501';
  end case;
end $$;
revoke all on function public.mercado_pred(jsonb) from public, authenticated, anon;

-- ── WHERE compartilhado (termo de busca + árvore) ────────────────────────────
create or replace function public.mercado_where(p_termo text, p_arvore jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare where_sql text := 'true'; termo text; digitos text;
begin
  termo := nullif(btrim(coalesce(p_termo, '')), '');
  if termo is not null then
    digitos := regexp_replace(termo, '\D', '', 'g');
    where_sql := where_sql || ' and ('
      || format('razao_social ilike %L or nome_fantasia ilike %L', '%'||termo||'%', '%'||termo||'%')
      || case when length(digitos) >= 3 then format(' or cnpj ilike %L', '%'||digitos||'%') else '' end
      || ')';
  end if;
  if p_arvore is not null then
    where_sql := where_sql || ' and ' || public.mercado_pred(p_arvore);
  end if;
  return where_sql;
end $$;
revoke all on function public.mercado_where(text, jsonb) from public, authenticated, anon;

-- ── Página do Explorador (busca + filtro + ordenação + paginação) ────────────
create or replace function public.mercado_explorar(
  p_termo text default null, p_arvore jsonb default null,
  p_ordem text default 'cnpj', p_asc boolean default true,
  p_offset int default 0, p_limite int default 50
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare where_sql text; ordem_col text; linhas jsonb; je jsonb; total bigint;
begin
  if not public.app_tem_modulo('mercado') then
    raise exception 'Sem acesso ao módulo Mercado.' using errcode = '42501';
  end if;
  where_sql := public.mercado_where(p_termo, p_arvore);
  -- Whitelist da coluna de ordenação (vem da UI; nunca interpolar cru).
  ordem_col := case p_ordem
    when 'razao_social' then 'razao_social' when 'capital_social' then 'capital_social'
    when 'data_inicio_atividade' then 'data_inicio_atividade' when 'municipio' then 'municipio'
    when 'porte_rfb' then 'porte_rfb' when 'natureza_juridica' then 'natureza_juridica'
    when 'uf' then 'uf' when 'camada' then 'camada' when 'obras_ativas' then 'obras_ativas'
    when 'qtd_filiais' then 'qtd_filiais' when 'grupo_spes_total' then 'grupo_spes_total'
    when 'm2_em_execucao' then 'm2_em_execucao' when 'erp_mrr' then 'erp_mrr'
    else 'cnpj' end;
  -- Uma linha a mais que a página → "tem próxima" sem contar nada.
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (
       select * from public.mercado_explorador where %s
       order by %I %s nulls last, cnpj asc limit %s offset %s) t',
    where_sql, ordem_col, case when p_asc then 'asc' else 'desc' end,
    p_limite + 1, greatest(coalesce(p_offset, 0), 0)) into linhas;
  -- Total ESTIMADO pelo planner (não executa contagem) — como o count:estimated.
  execute format('explain (format json) select 1 from public.mercado_explorador where %s', where_sql) into je;
  total := (je -> 0 -> 'Plan' ->> 'Plan Rows')::bigint;
  return jsonb_build_object('linhas', coalesce(linhas, '[]'::jsonb), 'total', coalesce(total, 0));
end $$;
grant execute on function public.mercado_explorar(text, jsonb, text, boolean, int, int) to authenticated;

-- ── Contagem EXATA (a pedido do usuário), mesmo WHERE ────────────────────────
create or replace function public.mercado_contar_exato(p_termo text default null, p_arvore jsonb default null)
returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare where_sql text; total bigint;
begin
  if not public.app_tem_modulo('mercado') then
    raise exception 'Sem acesso ao módulo Mercado.' using errcode = '42501';
  end if;
  where_sql := public.mercado_where(p_termo, p_arvore);
  execute format('select count(*) from public.mercado_explorador where %s', where_sql) into total;
  return coalesce(total, 0);
end $$;
grant execute on function public.mercado_contar_exato(text, jsonb) to authenticated;
