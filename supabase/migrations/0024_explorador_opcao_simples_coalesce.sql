-- opcao_simples vem de um LEFT JOIN com o arquivo do Simples (por raiz do CNPJ):
-- quem não aparece no arquivo fica null. Mas null aqui NÃO é incerteza — é uma
-- empresa que nunca optou, ou seja NÃO optante. 38% do universo (336k) estava null,
-- e por isso o filtro `opcao_simples = false` nas regras da pirâmide e no Explorador
-- descartava essas empresas (ex.: segurava empresões legítimos fora do SOM).
--
-- A view passa a apresentar coalesce(u.opcao_simples, false), então "não optante"
-- passa a pegar essas empresas — sem reescrever 336k linhas na tabela base (um UPDATE
-- em massa que a instância pequena não aguenta pelo cap de tempo). O worker também já
-- grava coalesce(..., false) na ingestão (a fonte), então a coluna base e a view
-- convergem naturalmente na próxima carga da Receita.
--
-- Reproduz a definição da 0022 na íntegra; muda SÓ a coluna opcao_simples. Preserva
-- security_invoker=true (o Explorador roda no browser sob RLS e depende disso).
create or replace view public.mercado_explorador
with (security_invoker = true) as
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
    ((e.erp_detalhes ->> 'usuarios_ativos'::text)::numeric) / nullif((e.erp_detalhes ->> 'qtd_usuarios'::text)::numeric, 0::numeric) as ratio_usuarios_ativos,
    coalesce(m.qtd_filiais, 0) as qtd_filiais,
    coalesce(m.grupo_spes_total, 0) as grupo_spes_total,
    coalesce(m.grupo_spes_24m, 0) as grupo_spes_24m,
    coalesce(m.grupo_ufs, '{}'::text[]) as grupo_ufs,
    coalesce(m.obras_ativas, 0) as obras_ativas,
    coalesce(m.obras_iniciadas_24m, 0) as obras_iniciadas_24m,
    coalesce(m.m2_em_execucao, 0::numeric) as m2_em_execucao,
    coalesce(m.tem_contato, false) as tem_contato
   from mercado_universo u
     left join empresas e on e.id = u.empresa_id
     left join mercado_metricas m on m.cnpj = u.cnpj;
