-- A parte 2 da view (empresas de lista) excluía apenas as JÁ VINCULADAS ao universo
-- (u.empresa_id = e.id). Mas a vinculação (job de adoção) só roda DEPOIS da
-- reclassificação — então, na primeira ingestão, uma empresa importada cujo CNPJ está
-- no universo aparecia nas duas partes, duplicando o CNPJ e quebrando o stg_reclass_pkey.
-- A exclusão passa a ser por CNPJ: o universo é sempre o dono do CNPJ, e a view nunca
-- duplica, independente do momento da vinculação.
create or replace view mercado_explorador
with (security_invoker = true) as
  select
    u.cnpj, u.razao_social, u.nome_fantasia, u.situacao_cadastral, u.natureza_juridica,
    u.porte_rfb, u.cnae_principal, u.cnaes_todos, u.cnae_grupos, u.capital_social,
    u.data_inicio_atividade, u.uf, u.municipio, u.opcao_simples, u.data_exclusao_simples,
    u.is_spe, u.grupo_id, u.grafo_sefaz, u.camada, u.camada_regra_versao, u.empresa_id,
    e.estagio, e.tipo, e.erp_atual, e.erp_mrr, e.erp_detalhes, e.churn_erp_concorrente,
    (e.erp_detalhes ->> 'qtd_usuarios')::int as qtd_usuarios_erp,
    ((e.erp_detalhes ->> 'usuarios_ativos')::numeric
      / nullif((e.erp_detalhes ->> 'qtd_usuarios')::numeric, 0)) as ratio_usuarios_ativos,
    coalesce(m.qtd_filiais, 0) as qtd_filiais,
    coalesce(m.grupo_spes_total, 0) as grupo_spes_total,
    coalesce(m.grupo_spes_24m, 0) as grupo_spes_24m,
    coalesce(m.grupo_ufs, '{}') as grupo_ufs,
    coalesce(m.obras_ativas, 0) as obras_ativas,
    coalesce(m.obras_iniciadas_24m, 0) as obras_iniciadas_24m,
    coalesce(m.m2_em_execucao, 0) as m2_em_execucao,
    coalesce(m.tem_contato, false) as tem_contato
  from mercado_universo u
  left join empresas e on e.id = u.empresa_id
  left join mercado_metricas m on m.cnpj = u.cnpj

  union all

  select
    e.cnpj, e.razao_social, e.nome_fantasia,
    null::text as situacao_cadastral, null::text as natureza_juridica,
    e.porte as porte_rfb, e.cnae_principal,
    array_remove(array[e.cnae_principal], null) as cnaes_todos,
    cnae_grupos_de(e.cnae_principal, null) as cnae_grupos,
    null::numeric as capital_social, null::date as data_inicio_atividade,
    e.uf, e.municipio, null::boolean as opcao_simples, null::date as data_exclusao_simples,
    e.is_spe, e.grupo_id, e.grafo_sefaz, e.camada, null::int as camada_regra_versao,
    e.id as empresa_id, e.estagio, e.tipo, e.erp_atual, e.erp_mrr, e.erp_detalhes,
    e.churn_erp_concorrente,
    (e.erp_detalhes ->> 'qtd_usuarios')::int,
    ((e.erp_detalhes ->> 'usuarios_ativos')::numeric
      / nullif((e.erp_detalhes ->> 'qtd_usuarios')::numeric, 0)),
    coalesce(m.qtd_filiais, 0), coalesce(m.grupo_spes_total, 0), coalesce(m.grupo_spes_24m, 0),
    coalesce(m.grupo_ufs, '{}'), coalesce(m.obras_ativas, 0), coalesce(m.obras_iniciadas_24m, 0),
    coalesce(m.m2_em_execucao, 0), coalesce(m.tem_contato, false)
  from empresas e
  left join mercado_metricas m on m.cnpj = e.cnpj
  where not exists (
    select 1 from mercado_universo u where u.cnpj = e.cnpj
  );

grant select on mercado_explorador to authenticated;
