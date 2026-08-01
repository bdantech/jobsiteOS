-- 0074 — O Explorador passa a ordenar pela régua de R$ esperados (04d §5).
--
-- `p_ordem` é uma whitelist explícita, e não um nome de coluna interpolado: é o que
-- impede que a ordenação vire um vetor de injeção. Por isso toda coluna nova precisa
-- passar por aqui — e as do 04c (faturamento, funcionários) tinham ficado de fora, o que
-- fazia clicar no cabeçalho delas cair silenciosamente em `cnpj`.
--
-- `nulls last` já existia e é o que torna a troca de default segura: enquanto
-- valor_esperado_mensal for nulo para todo mundo, a ordem degrada exatamente para a
-- anterior (cnpj asc), em vez de embaralhar a lista.

create or replace function public.mercado_explorar(
  p_termo text default null::text,
  p_arvore jsonb default null::jsonb,
  p_ordem text default 'cnpj'::text,
  p_asc boolean default true,
  p_offset integer default 0,
  p_limite integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare where_sql text; ordem_col text; linhas jsonb; je jsonb; total bigint;
begin
  if not public.app_tem_modulo('mercado') then
    raise exception 'Sem acesso ao módulo Mercado.' using errcode = '42501';
  end if;
  where_sql := public.mercado_where(p_termo, p_arvore);
  ordem_col := case p_ordem
    when 'razao_social' then 'razao_social' when 'capital_social' then 'capital_social'
    when 'data_inicio_atividade' then 'data_inicio_atividade' when 'municipio' then 'municipio'
    when 'porte_rfb' then 'porte_rfb' when 'natureza_juridica' then 'natureza_juridica'
    when 'uf' then 'uf' when 'camada' then 'camada' when 'obras_ativas' then 'obras_ativas'
    when 'qtd_filiais' then 'qtd_filiais' when 'grupo_spes_total' then 'grupo_spes_total'
    when 'm2_em_execucao' then 'm2_em_execucao' when 'erp_mrr' then 'erp_mrr'
    when 'qtd_usuarios_erp' then 'qtd_usuarios_erp'
    when 'ratio_usuarios_ativos' then 'ratio_usuarios_ativos'
    -- 04c
    when 'faturamento_estimado' then 'faturamento_estimado'
    when 'funcionarios' then 'funcionarios'
    when 'funcionarios_crescimento_12m' then 'funcionarios_crescimento_12m'
    -- 04d
    when 'limite_potencial' then 'limite_potencial'
    when 'receita_mensal_prevista' then 'receita_mensal_prevista'
    when 'valor_esperado_mensal' then 'valor_esperado_mensal'
    when 'score_credito' then 'score_credito'
    when 'chance_concessao' then 'chance_concessao'
    else 'cnpj' end;
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (
       select * from public.mercado_explorador where %s
       order by %I %s nulls last, cnpj asc limit %s offset %s) t',
    where_sql, ordem_col, case when p_asc then 'asc' else 'desc' end,
    p_limite + 1, greatest(coalesce(p_offset, 0), 0)) into linhas;
  execute format('explain (format json) select 1 from public.mercado_explorador where %s', where_sql) into je;
  total := (je -> 0 -> 'Plan' ->> 'Plan Rows')::bigint;
  return jsonb_build_object('linhas', coalesce(linhas, '[]'::jsonb), 'total', coalesce(total, 0));
end $function$;
