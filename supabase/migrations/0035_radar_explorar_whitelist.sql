-- 0035 — Radar: libera as colunas do Radar na whitelist do compilador do Explorador
-- (mercado_pred, 0026). As variáveis do Radar entraram no catálogo + na view (0031),
-- mas o RPC SECURITY DEFINER rejeitava por não estarem na lista. Recria idêntica,
-- só ampliando a whitelist.
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
    'grupo_ufs','obras_ativas','obras_iniciadas_24m','m2_em_execucao','tem_contato',
    -- Radar (0031)
    'dominio','dominio_confianca','dominio_consultado_em','qtd_contatos','contatos_enriquecidos_em',
    'tem_protesto','protestos_consultados_em','e_cliente_onepay','dias_sem_antecipar','consumed_pct'
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
