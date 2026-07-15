# JOBSITEOS — Claude Code Prompt 02: Módulo Mercado
## TAM Pyramid, Company Universe, Sócios/SPEs, CNO, List Importer

> Builds on the foundation from Prompt 01 (monorepo, Tool Registry, `empresas`, `empresa_eventos`, notifications, AI Bar). Read the existing codebase first and follow its established patterns. Every feature ships on **web AND mobile** unless explicitly marked `webOnly`. All UI text in pt-BR; code in English. Use the Supabase MCP for migrations (numbered SQL files in `/supabase/migrations` remain the source of truth).

---

## 1. Concept

The Mercado module manages the market pyramid: **Universo → TAM → SAM → SOM**. It answers "who exists, who fits, who can we win" before any commercial touch happens.

Two separate axes (never merge them):
- **`camada`** (pyramid layer): market classification, computed by versioned rules over data.
- **`estagio`** (existing field on `empresas`): relationship history, moved by actions in other modules.

Key design decisions:
1. The full universe (~1.5–2M CNPJs) lives in a **staging table** (`mercado_universo`), NOT in `empresas`. Companies are **promoted** to `empresas` when they reach a configurable layer threshold (default: SAM) or when a human promotes manually. On promotion they gain timeline, notes, events.
2. All layer rules are **versioned and previewable**. Every reclassification logs which rule version caused it.
3. Metrics are computable at **CNPJ level and grupo econômico level** (a large incorporadora is not 1 company — it can be hundreds of SPEs).
4. CNPJ is ALWAYS stored as normalized 14-digit text (never numeric — leading zeros).

## 2. Database (new migrations)

```sql
-- Staging: the full filtered universe from Receita Federal open data
create table mercado_universo (
  cnpj text primary key,                    -- 14-digit normalized
  cnpj_raiz text not null,                  -- first 8 digits
  razao_social text,
  nome_fantasia text,
  matriz_filial text,
  natureza_juridica text,
  situacao_cadastral text,                  -- ativa | suspensa | inapta | baixada | nula
  situacao_data date,
  situacao_motivo text,
  cnae_principal text,
  cnaes_secundarios text[],
  data_inicio_atividade date,
  capital_social numeric(16,2),
  porte_rfb text,                           -- ME | EPP | DEMAIS
  opcao_simples boolean,
  data_opcao_simples date,
  data_exclusao_simples date,
  opcao_mei boolean,
  uf text, municipio text, cep text,
  logradouro text, numero text, bairro text,
  email_rfb text, telefone1_rfb text, telefone2_rfb text,
  -- computed
  camada text not null default 'universo',  -- universo | tam | sam | som
  camada_regra_versao int,
  camada_atualizada_em timestamptz,
  grupo_id uuid,
  is_spe boolean default false,
  empresa_id uuid references empresas(id), -- set when promoted
  atualizado_em timestamptz default now()
);
create index on mercado_universo (camada);
create index on mercado_universo (cnpj_raiz);
create index on mercado_universo (uf, municipio);
create index on mercado_universo (cnae_principal);
create index on mercado_universo (grupo_id);

-- Sócios (QSA) from Receita dump, for companies in the filtered universe
create table mercado_socios (
  id uuid primary key default gen_random_uuid(),
  cnpj text not null references mercado_universo(cnpj),
  tipo_socio text,                          -- PF | PJ | estrangeiro
  cpf_cnpj_socio text,                      -- masked CPF or full CNPJ, as provided
  nome_socio text,
  qualificacao text,
  data_entrada date,
  faixa_etaria text
);
create index on mercado_socios (cnpj);
create index on mercado_socios (cpf_cnpj_socio);

-- Grupos econômicos: derived from sócio-PJ links
create table grupos_economicos (
  id uuid primary key default gen_random_uuid(),
  nome text,                                -- razão social of the head company
  cnpj_cabeca text,                         -- the controlling company
  criado_em timestamptz default now()
);
-- membership lives on mercado_universo.grupo_id / empresas via cnpj match

-- Materialized view (or table refreshed by job): group-level metrics
-- grupo_metricas: grupo_id, empresas_total, spes_total, spes_24m, spes_por_ano (jsonb),
--   ufs text[], capital_agregado, obras_ativas, m2_em_execucao

-- CNO: separate monitoring table (works/obras registry)
create table mercado_obras (
  cno text primary key,
  ni_responsavel text not null,             -- CNPJ (14) or CPF of responsible party
  tipo_responsabilidade text,               -- dono da obra | empreitada total | incorporador...
  situacao text,                            -- Ativa | Paralisada | Encerrada | Nula
  data_situacao date,
  data_inicio_obra date,
  uf text, municipio text, bairro text, cep text,
  destinacao text,                          -- residencial unifamiliar/multifamiliar, comercial...
  categoria text,                           -- obra nova, reforma...
  tipo_obra text,
  metragem_m2 numeric(12,2),
  cno_vinculado text,
  raw jsonb,                                -- full source record
  atualizado_em timestamptz default now()
);
create index on mercado_obras (ni_responsavel);
create index on mercado_obras (situacao);

-- Versioned pyramid rules
create table camada_regras (
  id uuid primary key default gen_random_uuid(),
  camada text not null,                     -- tam | sam | som
  versao int not null,
  definicao jsonb not null,                 -- rule tree (see §4)
  ativa boolean default false,
  criada_por uuid references usuarios(id),
  criada_em timestamptz default now(),
  unique (camada, versao)
);

-- Ingestion runs (Receita, CNO, list imports)
create table mercado_ingestoes (
  id uuid primary key default gen_random_uuid(),
  fonte text not null,                      -- 'receita_cnpj' | 'cno' | 'lista'
  status text not null default 'executando',-- executando | concluida | falhou
  tentativa int default 1,
  iniciado_em timestamptz default now(),
  terminado_em timestamptz,
  linhas_processadas int,
  linhas_novas int,
  linhas_atualizadas int,
  erro text,
  meta jsonb default '{}'
);

-- List imports (spreadsheets like the ERP prospecting list)
create table importacoes_listas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  arquivo_url text,                         -- Supabase Storage
  mapeamento jsonb,                         -- column mapping chosen in UI
  status text default 'mapeando',           -- mapeando | processando | revisao | concluida
  criado_por uuid references usuarios(id),
  criado_em timestamptz default now()
);
create table importacoes_linhas (
  id uuid primary key default gen_random_uuid(),
  importacao_id uuid references importacoes_listas(id) on delete cascade,
  dados jsonb not null,
  cnpj_resolvido text,
  status text default 'pendente',           -- pendente | resolvida | ambigua | ignorada
  candidatos jsonb                          -- fuzzy-match candidates for manual review
);

-- Segments: named dynamic filters (consumed later by Cadências)
create table segmentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  definicao jsonb not null,                 -- same filter-tree format as camada rules
  contagem_cache int,
  contagem_atualizada_em timestamptz,
  criado_por uuid references usuarios(id),
  criado_em timestamptz default now()
);
```

Extend `empresas` (migration): add `camada text`, `grupo_id uuid`, `is_spe boolean default false`, `churn_erp_concorrente boolean default false`, `erp_detalhes jsonb default '{}'` (ERP product data: qtd usuários, canal/representante, modalidade, usuários ativos × contratados, qtd sistemas — populated for Sienge-sourced records).

**Semantics fix from Prompt 01**: the existing `empresas.erp_mrr` column means "monthly amount the company pays for its CURRENT ERP (`erp_atual`)" — NOT Brik-specific revenue (when `erp_atual = 'brik'` it happens to be ONE OS revenue). No schema change needed, but audit the existing UI and code: anywhere the label or copy says "MRR Brik", "MRR do Brik" or similar (Company 360, empresa form, table columns, AI tool descriptions), rename it to **"MRR do ERP"** and update any tooltip/description to reflect the correct meaning.

## 3. Ingestion pipelines

### 3.1 Receita Federal CNPJ dump (monthly)
Source: monthly open-data dumps at `https://arquivos.receitafederal.gov.br/index.php/s/YggdBLfdninEJX9` (folders per month, e.g. `?dir=/2026-07`). Files: Empresas, Estabelecimentos, Sócios (each split in ~10 zipped parts), Simples, plus domain tables (CNAEs, municípios, naturezas, qualificações). CSVs are `;`-separated, latin-1.

**Architecture**: this CANNOT run on Vercel (multi-GB processing). Build a **standalone worker** in the monorepo (`apps/worker`): a Node/TypeScript Dockerized service deployable on Railway, exposing an authenticated trigger endpoint (`POST /jobs/receita`, bearer `WORKER_SECRET`). A monthly Vercel Cron (`/api/cron/mercado-receita`) calls it. The worker:
1. Downloads the month's files (streaming, resumable).
2. Filters to the construction cut: CNAE groups 41, 42, 43 + incorporação (4110-7) as principal OR secundário; **plus** every sócio-PJ linked to a company in the cut (needed for grupo/SPE detection even when the holding itself isn't construction-CNAE).
3. Normalizes CNPJs to 14-digit text; loads via Postgres COPY into staging temp tables; upserts into `mercado_universo` and `mercado_socios`.
4. Records progress in `mercado_ingestoes`.

**Retry policy (mandatory)**: the Receita server is slow and unstable. Primary source is ALWAYS Receita. Retry each failed download up to 5 times with exponential backoff (spread over hours, not seconds), incrementing `tentativa`. If all retries are exhausted: mark the run `falhou`, emit event `mercado.ingestao_falhou`, and **notify admin users** via the existing `notify()` helper with a message that includes the manual fallback instruction (mirror: `https://dados-abertos-rf-cnpj.casadosdados.com.br/`, configurable via env `RECEITA_FALLBACK_URL`). The fallback is triggered MANUALLY by an admin (button "Reexecutar com fallback" on the ingestion detail page) — never automatically.

### 3.2 Derived computations (worker jobs, run after each ingestion)
1. **SPE detection**: a company is an SPE when it has a sócio-PJ that is an incorporadora/construtora (in the cut), reinforced by natureza jurídica and razão social patterns (`SPE`, `EMPREENDIMENTO`, numbered projects). Set `is_spe`, link `grupo_id`.
2. **Grupo econômico assembly**: connected components over sócio-PJ edges; head = the top PJ (most descendants / not owned by another PJ in the cut). Populate `grupos_economicos`, assign `grupo_id` on universe rows and matching `empresas`.
3. **Grupo metrics refresh**: SPEs total / per year / last 24m, UFs, capital agregado, obras ativas, m² em execução.
4. **Layer reclassification**: apply active `camada_regras`; on change, update `camada` + `camada_regra_versao`, and log `empresa_eventos` (`camada.alterada`, payload: from, to, rule version) for promoted companies; staging-only rows keep history via `mercado_ingestoes` counters.
5. **Promotion**: rows reaching the promotion threshold (configurable per settings; default SAM) are inserted into `empresas` (tipo default 'construtora', origem 'mercado'), `empresa_id` backfilled, event `empresa.promovida` logged.

### 3.3 CNO (monthly, same worker)
Job `POST /jobs/cno`: download CNO open data (available via RFB dados abertos / Base dos Dados mirrors; make source URL env-configurable `CNO_SOURCE_URL`), filter to obras whose `ni_responsavel` matches a CNPJ raiz present in `mercado_universo` or `empresas`, upsert `mercado_obras`. Same retry + manual-fallback-alert policy. After load, refresh obra-derived metrics (obras ativas, m² em execução, obras/ano, mix de destinação) at company and grupo level.

## 4. Rule & filter engine (shared)

One JSON filter-tree format powers three things: **camada rules, explorer filters, and segments**. Structure: nested AND/OR groups of conditions `{ variavel, operador, valor }`. Implement it in `packages/core/mercado/filters.ts` with: zod schema, SQL compiler (parameterized — NEVER string interpolation), and a variable catalog.

**Variable catalog** (each with label pt-BR, type, allowed operators): situacao_cadastral, cnae_principal, cnae_qualquer (principal+secundários), natureza_juridica, porte_rfb, capital_social, idade_anos, uf, municipio, opcao_simples, saiu_simples_apos (date), qtd_filiais, is_spe, grupo_spes_24m, grupo_spes_total, grupo_ufs, obras_ativas, m2_em_execucao, obras_iniciadas_24m, erp_atual, erp_conhecido (bool), erp_mrr (monthly amount the company pays for its current ERP — single MRR field, regardless of which ERP), qtd_usuarios_erp, ratio_usuarios_ativos (ativos/contratados, from `erp_detalhes`), churn_erp_concorrente, no_grafo_sefaz (bool — column placeholder `grafo_sefaz boolean default false` on both tables; ingestion of this signal comes in a later module), tem_contato, camada, estagio, tipo.

## 5. UI

### 5.1 Pirâmide (Settings do Mercado) — `webOnly`
- Interactive SVG pyramid with 4 layers; each shows live count + share %. Click a layer → side panel with: current active rule (human-readable), rule builder (visual editor over the filter tree: add condition, group AND/OR, pick variable from catalog with proper input per type), and history of versions.
- **Preview before save**: "Salvar como nova versão" first runs a dry-run count — "Esta regra move 12.400 empresas: 9.100 sobem para SAM, 3.300 descem para TAM. Confirmar e ativar?" Activation triggers the reclassification job (worker) and logs everything.
- Promotion threshold setting: which layer auto-promotes to `empresas` (default SAM; option: manual only).
- Seed default rules (versão 1, ativa):
  - **TAM**: situacao_cadastral = ativa AND cnae_qualquer in (41*, 42*, 43*, 4110-7) AND idade_anos ≥ 3 AND capital_social ≥ 500000
  - **SAM**: TAM AND uf in (SP, SC, PR, RS, MG, RJ, GO, DF) AND (qtd_filiais ≥ 1 OR capital_social ≥ 2000000 OR grupo_spes_total ≥ 1)
  - **SOM**: SAM AND (no_grafo_sefaz = true OR erp_conhecido = true OR grupo_spes_24m ≥ 2 OR obras_ativas ≥ 1 OR churn_erp_concorrente = true)

### 5.2 Mapa do Mercado (dashboard) — web + mobile (read-only on mobile)
Per-layer indicator cards: contagem, idade média, capital social médio/mediano, % com ERP identificado, % com contato conhecido, % no grafo SEFAZ, média de SPEs por grupo, obras ativas e m² em execução (via CNO). Distribution charts: UF × camada, porte × camada, tipo. Clicking any slice opens the Explorador pre-filtered (new tab on web; push screen on mobile).

### 5.3 Explorador — web + mobile (query-only on mobile)
Filterable, sortable, paginated (server-side, the table has millions of rows) view over `mercado_universo` + promoted `empresas`. Composite filters via the shared filter engine. Columns configurable. Row click → Company 360 (promoted) or a lightweight universe-record sheet with a "Promover para Empresas" action. Bulk actions (web): promote selection, assign to segment. "Salvar como segmento" persists the current filter tree to `segmentos` with live count cache.

### 5.4 Grupo econômico view — web + mobile
On Company 360 of a promoted company that belongs to a group: a "Grupo" section listing head + SPEs (with year opened, situação, obras), the SPEs-per-year mini chart, and group metrics. Universe-side: group sheet accessible from Explorador.

### 5.5 Importador de listas — `webOnly`
Flow: upload xlsx/csv (Supabase Storage) → parse headers → column-mapping UI (map to canonical fields: cnpj, razao_social, erp_atual, erp_mrr — the single MRR field: what the company pays for its current ERP —, erp_detalhes.* — `qtd_usuarios`, `usuarios_ativos`, `qtd_sistemas`, `canal`, `modalidade` —, municipio, uf, contato.*) → dedup by normalized CNPJ → rows WITHOUT CNPJ go to a **resolution queue**: fuzzy match razão social + UF/município against `mercado_universo` (pg_trgm), reviewer picks among `candidatos` or ignores → import applies: upsert `empresas` (these lists are pre-qualified; they skip staging and land promoted, with `camada` recomputed), fill `erp_atual`/`erp_detalhes`, create `contatos` rows with `origem`, set `churn_erp_concorrente` when the source column indicates an inactive/churned status at a competitor ERP. Every import batch is an `importacoes_listas` record with full traceability. Enable `pg_trgm` extension in a migration.

### 5.6 Ingestões (admin) — `webOnly`
List of `mercado_ingestoes` runs with status, counters, durations, error detail, "Reexecutar" and "Reexecutar com fallback" buttons (the latter only enabled after a failed run).

## 6. Registry, AI tools, events, notifications

Register module `mercado` in `packages/core/registry` with tools:
- `mercado.resumo_piramide` (read): counts + indicators per layer, optional UF/tipo filter.
- `mercado.buscar_universo` (read): search staging+empresas by name/CNPJ/filters; returns compact rows.
- `mercado.detalhar_grupo` (read): group metrics + members by CNPJ or group name.
- `mercado.promover_empresa` (mutates: true): promote a universe CNPJ to empresas.
- `mercado.criar_segmento` (mutates: true): create a segment from a described filter (AI builds the filter tree via the shared zod schema).

Events emitted: `camada.alterada`, `empresa.promovida`, `mercado.ingestao_concluida`, `mercado.ingestao_falhou`, `importacao.concluida`, `importacao.revisao_pendente`. Seed `notificacao_regras`: `mercado.ingestao_falhou` → perfil Admin; `importacao.revisao_pendente` → creator.

## 7. Deliverables checklist

**Worker (`apps/worker`)**: Dockerfile, Railway-ready, jobs receita/cno/reclassificar/metricas, retry+backoff, `WORKER_SECRET` auth, writes `mercado_ingestoes`. Include a `--sample` mode that processes a small slice for local testing without downloading gigabytes.
**Web**: Pirâmide settings, Mapa do Mercado, Explorador, Grupo view, Importador, Ingestões admin.
**Mobile**: Mapa do Mercado (read-only), Explorador (query), Company/Grupo views. Pirâmide, Importador, Ingestões = `webOnly` flag.
**Core**: filter engine + variable catalog + SQL compiler with tests (unit-test the compiler against injection and operator edge cases).
**Docs**: README section — running the worker locally, triggering jobs, env vars (`WORKER_SECRET`, `RECEITA_FALLBACK_URL`, `CNO_SOURCE_URL`), and the manual fallback procedure.

Out of scope (later prompts): contact enrichment providers (Radar), sequences (Cadências), SEFAZ graph ingestion (flag column only for now).
