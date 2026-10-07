-- ─────────────────────────────────────────────────────────────────────────────
-- O Explorador filtra pelo canal do ERP
--
-- O canal (parceiro/revenda por onde a empresa comprou o ERP: GESCON, NG7, NPU…)
-- chega pelas listas importadas e mora em `empresas.erp_detalhes ->> 'canal'` —
-- ~5 mil empresas preenchidas. A coluna `empresas.erp_canal_venda` NÃO é a fonte:
-- na base só tem string vazia.
--
-- A view expunha `erp_detalhes` inteiro, mas o filtro só fala com colunas
-- (`mercado_pred` valida contra as colunas reais da view, 0083). Então o canal
-- vira coluna, `erp_canal`, no mesmo molde de `qtd_usuarios_erp`. Vazio vira nulo,
-- para "está vazio" significar o que diz.
--
-- Definição copiada da view VIVA (pg_get_viewdef), não da última migração que a
-- recriou; a coluna nova entra no FIM, que é o que `create or replace view`
-- permite. `security_invoker` reafirmado: sem ele a view ignora a RLS.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace view public.mercado_explorador
with (security_invoker = true) as
 SELECT u.cnpj,
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
    COALESCE(u.opcao_simples, false) AS opcao_simples,
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
    (e.erp_detalhes ->> 'qtd_usuarios'::text)::integer AS qtd_usuarios_erp,
    ((e.erp_detalhes ->> 'usuarios_ativos'::text)::numeric) / NULLIF((e.erp_detalhes ->> 'qtd_usuarios'::text)::numeric, 0::numeric) AS ratio_usuarios_ativos,
    COALESCE(m.qtd_filiais, 0) AS qtd_filiais,
    COALESCE(m.grupo_spes_total, 0) AS grupo_spes_total,
    COALESCE(m.grupo_spes_24m, 0) AS grupo_spes_24m,
    COALESCE(m.grupo_ufs, '{}'::text[]) AS grupo_ufs,
    COALESCE(m.obras_ativas, 0) AS obras_ativas,
    COALESCE(m.obras_iniciadas_24m, 0) AS obras_iniciadas_24m,
    COALESCE(m.m2_em_execucao, 0::numeric) AS m2_em_execucao,
    COALESCE(m.tem_contato, false) AS tem_contato,
    COALESCE(e.dominio, u.dominio) AS dominio,
    COALESCE(e.dominio_confianca, u.dominio_confianca) AS dominio_confianca,
    e.dominio_validado_em AS dominio_consultado_em,
    COALESCE(ct.qtd, 0) AS qtd_contatos,
    ct.ult AS contatos_enriquecidos_em,
    pa.tem_protesto,
    pa.consultado_em AS protestos_consultados_em,
    co.cnpj IS NOT NULL AS e_cliente_onepay,
    co.days_without_anticipation AS dias_sem_antecipar,
    co.consumed_pct,
    COALESCE(u.origem_ingestao, 'receita_dump'::text) AS origem_ingestao,
    COALESCE(u.fora_recorte_cnae, false) AS fora_recorte_cnae,
    e.faturamento_anual AS faturamento_estimado,
    e.faturamento_origem,
    e.faturamento_confianca,
    e.funcionarios,
    e.funcionarios_origem,
    e.funcionarios_crescimento_12m,
    e.regime_tributario,
    e.limite_potencial,
    e.receita_mensal_prevista,
    e.valor_esperado_mensal,
    e.score_credito,
    e.chance_concessao,
    e.score_faixa AS faixa_score,
    COALESCE(av.tem_analise_vigente, false) AS tem_analise_vigente,
    av.analise_estagio,
    COALESCE(e.estagio = 'ex_cliente'::text, false) AS e_ex_cliente,
    e.ex_cliente_desde,
        CASE
            WHEN e.ex_cliente_desde IS NULL THEN NULL::integer
            ELSE GREATEST(0, (EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, e.ex_cliente_desde::timestamp with time zone)) * 12::numeric + EXTRACT(month FROM age(CURRENT_DATE::timestamp with time zone, e.ex_cliente_desde::timestamp with time zone)))::integer)
        END AS ex_cliente_meses,
    mp.motivo AS ex_cliente_motivo,
    COALESCE(e.teve_analise_sem_cadastro, false) AS teve_analise_sem_cadastro,
    apa.credit_limit AS ultima_analise_limite,
    apa.expiration_date AS ultima_analise_expirou_em,
    COALESCE(e.tem_processo_nosso_ativo, false) AS tem_processo_nosso_ativo,
    NULLIF(btrim(e.erp_detalhes ->> 'canal'::text), ''::text) AS erp_canal
   FROM mercado_universo u
     LEFT JOIN empresas e ON e.id = u.empresa_id
     LEFT JOIN mercado_metricas m ON m.cnpj = u.cnpj
     LEFT JOIN protestos_atual pa ON pa.cnpj = u.cnpj
     LEFT JOIN clientes_onepay co ON co.cnpj = u.cnpj
     LEFT JOIN analise_vigente av ON av.cnpj = u.cnpj
     LEFT JOIN motivos_perda mp ON mp.id = e.ex_cliente_motivo
     LEFT JOIN analises_plataforma_atual apa ON apa.cnpj = u.cnpj
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS qtd,
            max(c.enriquecido_em) AS ult
           FROM contatos c
          WHERE c.empresa_id = u.empresa_id) ct ON true;

grant select on public.mercado_explorador to authenticated;

comment on column public.mercado_explorador.erp_canal is
  'Canal/revenda por onde a empresa comprou o ERP atual (erp_detalhes ->> ''canal'', vindo das listas importadas). Nulo quando vazio.';
