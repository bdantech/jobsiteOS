-- O cast capital_social::numeric (0021) impedia o índice (capital_social, cnpj) de ser
-- usado na ordenação. Recrio a view sem o cast. DROP+CREATE porque tirar o cast muda o
-- tipo declarado da coluna (create-or-replace não troca tipo).
drop view if exists mercado_explorador;
create view mercado_explorador
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
  left join mercado_metricas m on m.cnpj = u.cnpj;
grant select on mercado_explorador to authenticated;
