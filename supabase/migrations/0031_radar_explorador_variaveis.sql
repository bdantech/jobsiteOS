-- =============================================================================
-- 0031 — Radar: variáveis de enriquecimento no Explorador
--
-- O construtor de lote (§6.1) reusa o filter engine do Mercado, então as variáveis
-- novas (tem_dominio, dominio_confianca, qtd_contatos, tem_protesto, e_cliente_onepay,
-- dias_sem_antecipar, consumed_pct, …) precisam ser COLUNAS reais em mercado_explorador
-- — o catálogo exige que toda variável mapeie para uma coluna da view.
--
-- Recria a view acrescentando as colunas do Radar no fim (CREATE OR REPLACE permite
-- só APPEND). Joins a tabelas pequenas/derivadas: protestos_atual (subset enriquecido),
-- clientes_onepay (poucos milhares), e um lateral de contagem de contatos.
-- =============================================================================

create or replace view mercado_explorador with (security_invoker = true) as
 select u.cnpj,
    u.razao_social,
    u.nome_fantasia,
    u.situacao_cadastral,
    u.natureza_juridica,
    u.porte_rfb,
    u.cnae_principal,
    u.cnaes_todos,
    u.cnae_grupos,
    u.capital_social,
    u.data_inicio_atividade,
    u.uf,
    u.municipio,
    coalesce(u.opcao_simples, false) as opcao_simples,
    u.data_exclusao_simples,
    u.is_spe,
    u.grupo_id,
    u.grafo_sefaz,
    u.camada,
    u.camada_regra_versao,
    u.empresa_id,
    e.estagio,
    e.tipo,
    e.erp_atual,
    e.erp_mrr,
    e.erp_detalhes,
    e.churn_erp_concorrente,
    (e.erp_detalhes ->> 'qtd_usuarios'::text)::integer as qtd_usuarios_erp,
    ((e.erp_detalhes ->> 'usuarios_ativos'::text)::numeric)
      / nullif((e.erp_detalhes ->> 'qtd_usuarios'::text)::numeric, 0::numeric) as ratio_usuarios_ativos,
    coalesce(m.qtd_filiais, 0) as qtd_filiais,
    coalesce(m.grupo_spes_total, 0) as grupo_spes_total,
    coalesce(m.grupo_spes_24m, 0) as grupo_spes_24m,
    coalesce(m.grupo_ufs, '{}'::text[]) as grupo_ufs,
    coalesce(m.obras_ativas, 0) as obras_ativas,
    coalesce(m.obras_iniciadas_24m, 0) as obras_iniciadas_24m,
    coalesce(m.m2_em_execucao, 0::numeric) as m2_em_execucao,
    coalesce(m.tem_contato, false) as tem_contato,
    -- ── Radar (enriquecimento) ──────────────────────────────────────────────
    coalesce(e.dominio, u.dominio) as dominio,
    coalesce(e.dominio_confianca, u.dominio_confianca) as dominio_confianca,
    e.dominio_validado_em as dominio_consultado_em,
    coalesce(ct.qtd, 0) as qtd_contatos,
    ct.ult as contatos_enriquecidos_em,
    pa.tem_protesto as tem_protesto,
    pa.consultado_em as protestos_consultados_em,
    (co.cnpj is not null) as e_cliente_onepay,
    co.days_without_anticipation as dias_sem_antecipar,
    co.consumed_pct as consumed_pct
   from mercado_universo u
     left join empresas e on e.id = u.empresa_id
     left join mercado_metricas m on m.cnpj = u.cnpj
     left join protestos_atual pa on pa.cnpj = u.cnpj
     left join clientes_onepay co on co.cnpj = u.cnpj
     left join lateral (
       select count(*)::int as qtd, max(c.enriquecido_em) as ult
       from contatos c where c.empresa_id = u.empresa_id
     ) ct on true;
