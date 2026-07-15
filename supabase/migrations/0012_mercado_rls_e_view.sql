-- ============================================================================
-- 0012 — Mercado: RLS + a view do Explorador
--
-- RLS, as everywhere, is driven by the registry: app_tem_modulo('mercado').
--
-- The Explorador view exists because the module's data lives in two places and
-- the user must not care which. A company reaches `empresas` by two roads:
--   1. promoted from the universe  → row in mercado_universo, empresa_id set
--   2. imported from a list (§5.5) → row in empresas ONLY; it skips staging,
--      because those lists are pre-qualified
-- A view over mercado_universo alone would silently hide every imported company
-- from the Explorador — the exact companies the sales team cares most about.
--
-- security_invoker = true (NOT the 0005 mistake): the underlying policies of
-- mercado_universo and empresas decide the rows, evaluated as the CALLING user.
-- A user granted `mercado` but not `empresas` still sees the universe, and the
-- joined empresa columns simply come back null.
-- ============================================================================

alter table mercado_universo    enable row level security;
alter table mercado_socios      enable row level security;
alter table grupos_economicos   enable row level security;
alter table mercado_obras       enable row level security;
alter table mercado_metricas    enable row level security;
alter table camada_regras       enable row level security;
alter table mercado_ingestoes   enable row level security;
alter table importacoes_listas  enable row level security;
alter table importacoes_linhas  enable row level security;
alter table segmentos           enable row level security;

-- ─── Reference data: readable by the module, written by the worker ──────────
-- The worker holds the service role, which bypasses RLS entirely — so these
-- tables get NO insert/update policy for `authenticated`. Ingestion is not a
-- thing a signed-in user does by hand, and an accidental client-side write into
-- a 2M-row staging table is not a mistake worth leaving room for.
create policy mercado_universo_select on mercado_universo
  for select to authenticated using (app_tem_modulo('mercado'));

create policy mercado_socios_select on mercado_socios
  for select to authenticated using (app_tem_modulo('mercado'));

create policy grupos_economicos_select on grupos_economicos
  for select to authenticated using (app_tem_modulo('mercado'));

create policy mercado_obras_select on mercado_obras
  for select to authenticated using (app_tem_modulo('mercado'));

create policy mercado_metricas_select on mercado_metricas
  for select to authenticated using (app_tem_modulo('mercado'));

create policy mercado_ingestoes_select on mercado_ingestoes
  for select to authenticated using (app_tem_modulo('mercado'));

-- ─── Regras da pirâmide: ler com o módulo, escrever só admin ────────────────
-- A camada rule reclassifies the entire universe. That is a company-wide lever,
-- not a personal preference — and a bad one quietly rewrites every number the
-- commercial team plans against. Authoring is admin-only; everyone in the module
-- can read the rule that produced what they are looking at.
create policy camada_regras_select on camada_regras
  for select to authenticated using (app_tem_modulo('mercado'));
create policy camada_regras_admin on camada_regras
  for all to authenticated using (app_is_admin()) with check (app_is_admin());

-- ─── Segmentos: qualquer um do módulo cria ──────────────────────────────────
create policy segmentos_select on segmentos
  for select to authenticated using (app_tem_modulo('mercado'));
create policy segmentos_insert on segmentos
  for insert to authenticated
  with check (app_tem_modulo('mercado') and criado_por = auth.uid());
create policy segmentos_update on segmentos
  for update to authenticated
  using (app_tem_modulo('mercado')) with check (app_tem_modulo('mercado'));
create policy segmentos_delete on segmentos
  for delete to authenticated
  using (criado_por = auth.uid() or app_is_admin());

-- ─── Importações: webOnly, mas RLS não sabe disso ───────────────────────────
-- `webOnly` is a navigation flag, not a security boundary — the REST API does
-- not know the module is web-only. The policies must hold on their own.
create policy importacoes_listas_select on importacoes_listas
  for select to authenticated using (app_tem_modulo('mercado'));
create policy importacoes_listas_insert on importacoes_listas
  for insert to authenticated
  with check (app_tem_modulo('mercado') and criado_por = auth.uid());
create policy importacoes_listas_update on importacoes_listas
  for update to authenticated
  using (app_tem_modulo('mercado')) with check (app_tem_modulo('mercado'));

create policy importacoes_linhas_select on importacoes_linhas
  for select to authenticated using (app_tem_modulo('mercado'));
-- The reviewer resolves ambiguous rows by hand (§5.5), so update is granted.
create policy importacoes_linhas_update on importacoes_linhas
  for update to authenticated
  using (app_tem_modulo('mercado')) with check (app_tem_modulo('mercado'));

-- ─── Grants ─────────────────────────────────────────────────────────────────
grant select on mercado_universo, mercado_socios, grupos_economicos,
                mercado_obras, mercado_metricas, mercado_ingestoes to authenticated;
grant select on camada_regras to authenticated;
grant insert, update, delete on camada_regras to authenticated;  -- policy narrows to admin
grant select, insert, update, delete on segmentos to authenticated;
grant select, insert, update on importacoes_listas to authenticated;
grant select, update on importacoes_linhas to authenticated;

-- ─── A view do Explorador ───────────────────────────────────────────────────
-- Every variable in the filter catalog (packages/core/src/mercado/filters.ts)
-- must be a real, filterable column HERE. That is the contract: the PostgREST
-- compiler emits `column.operator.value`, so a variable with no column is a
-- variable that cannot be filtered.
--
-- Two exceptions, deliberately absent as columns:
--   idade_anos    — compiles to a comparison on data_inicio_atividade against a
--                   date computed at compile time. A column would need now(),
--                   which is not immutable, so it would have to be refreshed by
--                   a job forever, and would be stale between runs.
--   erp_conhecido — compiles to `erp_atual is not null`. A stored boolean would
--                   be a second source of truth for a question the data already
--                   answers.
create view mercado_explorador
with (security_invoker = true) as
  -- 1. The universe (promoted rows carry their empresa alongside)
  select
    u.cnpj,
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
    u.opcao_simples,
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
    (e.erp_detalhes ->> 'qtd_usuarios')::int as qtd_usuarios_erp,
    -- nullif guards the divide-by-zero; a company with 0 contracted seats has no
    -- ratio, which is not the same as a ratio of 0.
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

  -- 2. Companies that never passed through staging (list imports)
  select
    e.cnpj,
    e.razao_social,
    e.nome_fantasia,
    null::text  as situacao_cadastral,
    null::text  as natureza_juridica,
    e.porte     as porte_rfb,
    e.cnae_principal,
    array_remove(array[e.cnae_principal], null) as cnaes_todos,
    cnae_grupos_de(e.cnae_principal, null)      as cnae_grupos,
    null::numeric as capital_social,
    null::date  as data_inicio_atividade,
    e.uf,
    e.municipio,
    null::boolean as opcao_simples,
    null::date  as data_exclusao_simples,
    e.is_spe,
    e.grupo_id,
    e.grafo_sefaz,
    e.camada,
    null::int   as camada_regra_versao,
    e.id        as empresa_id,
    e.estagio,
    e.tipo,
    e.erp_atual,
    e.erp_mrr,
    e.erp_detalhes,
    e.churn_erp_concorrente,
    (e.erp_detalhes ->> 'qtd_usuarios')::int,
    ((e.erp_detalhes ->> 'usuarios_ativos')::numeric
      / nullif((e.erp_detalhes ->> 'qtd_usuarios')::numeric, 0)),
    coalesce(m.qtd_filiais, 0),
    coalesce(m.grupo_spes_total, 0),
    coalesce(m.grupo_spes_24m, 0),
    coalesce(m.grupo_ufs, '{}'),
    coalesce(m.obras_ativas, 0),
    coalesce(m.obras_iniciadas_24m, 0),
    coalesce(m.m2_em_execucao, 0),
    coalesce(m.tem_contato, false)
  from empresas e
  left join mercado_metricas m on m.cnpj = e.cnpj
  where not exists (
    select 1 from mercado_universo u where u.empresa_id = e.id
  );

grant select on mercado_explorador to authenticated;

comment on view mercado_explorador is
  'Universo + empresas promovidas + empresas importadas (que nunca passaram pelo staging), com as métricas computadas. É a superfície única do Explorador e o alvo do compilador PostgREST do engine de filtros. security_invoker: as policies das tabelas de base decidem as linhas.';
