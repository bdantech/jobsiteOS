-- ============================================================================
-- 0011 — Módulo Mercado: staging do universo, sócios, grupos, obras, regras
--
-- Two axes that must NEVER be merged (spec §1):
--   camada  — market classification (universo|tam|sam|som), computed by versioned
--             rules over data. Says "does this company FIT".
--   estagio — relationship history (mercado|lead|…|cliente), moved by human
--             action in other modules. Says "how far have we GOT with them".
-- A company can be SOM (perfect fit) and still be estagio=mercado (never touched).
--
-- The full universe (~1.5–2M CNPJs) lives in `mercado_universo`, NOT in
-- `empresas`. Loading 2M rows into `empresas` would give every one of them a
-- timeline, notes and an event backbone they will never use, and would make
-- every existing empresas query scan a table 4 orders of magnitude too big.
-- Rows are PROMOTED into `empresas` when they cross the threshold (default SAM)
-- or when a human promotes them by hand.
--
-- CNPJ is ALWAYS 14-digit text. Never numeric: 00.000.000/0001-91 loses its
-- leading zeros the moment someone casts it, and then it silently stops joining.
-- ============================================================================

-- ─── Staging: the filtered universe from Receita Federal ────────────────────
create table mercado_universo (
  cnpj text primary key,
  cnpj_raiz text not null,                  -- first 8 digits: the "company", vs. its establishments
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
  capital_social numeric(16, 2),
  porte_rfb text,                           -- ME | EPP | DEMAIS
  opcao_simples boolean,
  data_opcao_simples date,
  data_exclusao_simples date,
  opcao_mei boolean,
  uf text,
  municipio text,
  cep text,
  logradouro text,
  numero text,
  bairro text,
  email_rfb text,
  telefone1_rfb text,
  telefone2_rfb text,

  -- computed by the worker
  camada text not null default 'universo',  -- universo | tam | sam | som
  camada_regra_versao int,
  camada_atualizada_em timestamptz,
  grupo_id uuid,
  is_spe boolean not null default false,
  grafo_sefaz boolean not null default false,  -- placeholder; ingestion lands in a later module
  empresa_id uuid references empresas (id) on delete set null,  -- set on promotion
  atualizado_em timestamptz not null default now(),

  constraint mercado_universo_cnpj_check check (cnpj ~ '^[0-9]{14}$'),
  constraint mercado_universo_camada_check check (camada in ('universo', 'tam', 'sam', 'som'))
);

-- The seed TAM rule filters on "CNAE 41/42/43 as principal OR secundário". A
-- filter over `cnae_principal` alone would miss a construtora that registered
-- construction as a secondary activity — which is common.
--
-- Two generated arrays instead of one, because PostgREST cannot prefix-match
-- inside an array. `cnae_grupos` holds the 2-digit divisions, so "any CNAE in
-- division 41/42/43" becomes a plain array-overlap on an indexed column;
-- `cnaes_todos` keeps the exact codes for rules that name one (e.g. 4110-7,
-- incorporação, stored by the RFB as '4110700').
--
-- The division list needs an aggregate over the unnested array, and a generated
-- column may not contain a subquery — but it may CALL an immutable function that
-- does. Hence the helper.
create or replace function cnae_grupos_de(p_principal text, p_secundarios text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct left(c, 2)), '{}')
  from unnest(
    array_remove(array_prepend(p_principal, coalesce(p_secundarios, '{}')), null)
  ) as c;
$$;

alter table mercado_universo
  add column cnaes_todos text[]
    generated always as (
      array_remove(array_prepend(cnae_principal, coalesce(cnaes_secundarios, '{}')), null)
    ) stored,
  add column cnae_grupos text[]
    generated always as (cnae_grupos_de(cnae_principal, cnaes_secundarios)) stored;

create index mercado_universo_camada_idx on mercado_universo (camada);
create index mercado_universo_raiz_idx on mercado_universo (cnpj_raiz);
create index mercado_universo_uf_municipio_idx on mercado_universo (uf, municipio);
create index mercado_universo_cnae_idx on mercado_universo (cnae_principal);
create index mercado_universo_grupo_idx on mercado_universo (grupo_id);
create index mercado_universo_empresa_idx on mercado_universo (empresa_id);
create index mercado_universo_situacao_idx on mercado_universo (situacao_cadastral);
create index mercado_universo_inicio_idx on mercado_universo (data_inicio_atividade);
create index mercado_universo_cnaes_todos_idx on mercado_universo using gin (cnaes_todos);
create index mercado_universo_cnae_grupos_idx on mercado_universo using gin (cnae_grupos);
-- Fuzzy matching for the list importer (§5.5): razão social + UF, no CNPJ.
create index mercado_universo_razao_trgm_idx
  on mercado_universo using gin (razao_social gin_trgm_ops);

-- ─── Sócios (QSA) ───────────────────────────────────────────────────────────
create table mercado_socios (
  id uuid primary key default gen_random_uuid(),
  cnpj text not null references mercado_universo (cnpj) on delete cascade,
  tipo_socio text,                          -- PF | PJ | estrangeiro
  cpf_cnpj_socio text,                      -- masked CPF or full CNPJ, as the RFB provides it
  nome_socio text,
  qualificacao text,
  data_entrada date,
  faixa_etaria text
);

create index mercado_socios_cnpj_idx on mercado_socios (cnpj);
create index mercado_socios_socio_idx on mercado_socios (cpf_cnpj_socio);

-- ─── Grupos econômicos ──────────────────────────────────────────────────────
-- Derived by the worker: connected components over sócio-PJ edges. A large
-- incorporadora is not one company — it is a holding plus hundreds of SPEs, and
-- counting it as "1 CNPJ" understates the account by two orders of magnitude.
create table grupos_economicos (
  id uuid primary key default gen_random_uuid(),
  nome text,                                -- razão social of the head company
  cnpj_cabeca text,                         -- the controlling company
  criado_em timestamptz not null default now()
);

create index grupos_economicos_cabeca_idx on grupos_economicos (cnpj_cabeca);

alter table mercado_universo
  add constraint mercado_universo_grupo_fk
  foreign key (grupo_id) references grupos_economicos (id) on delete set null;

-- ─── CNO: obras ─────────────────────────────────────────────────────────────
create table mercado_obras (
  cno text primary key,
  ni_responsavel text not null,             -- CNPJ (14) or CPF of the responsible party
  tipo_responsabilidade text,
  situacao text,                            -- Ativa | Paralisada | Encerrada | Nula
  data_situacao date,
  data_inicio_obra date,
  uf text,
  municipio text,
  bairro text,
  cep text,
  destinacao text,
  categoria text,
  tipo_obra text,
  metragem_m2 numeric(12, 2),
  cno_vinculado text,
  raw jsonb,                                -- the full source record, for when a field turns out to matter
  atualizado_em timestamptz not null default now()
);

create index mercado_obras_responsavel_idx on mercado_obras (ni_responsavel);
create index mercado_obras_situacao_idx on mercado_obras (situacao);
create index mercado_obras_inicio_idx on mercado_obras (data_inicio_obra);

-- ─── Métricas computadas, por CNPJ ──────────────────────────────────────────
-- One table, keyed by CNPJ, rather than columns duplicated on BOTH
-- mercado_universo and empresas. A company can live in either (or both, once
-- promoted), and duplicating the metrics would mean the worker has to keep two
-- copies in step — which it eventually would not. The explorer view joins this.
create table mercado_metricas (
  cnpj text primary key,
  qtd_filiais int not null default 0,
  grupo_spes_total int not null default 0,
  grupo_spes_24m int not null default 0,
  grupo_ufs text[] not null default '{}',
  grupo_capital_agregado numeric(18, 2),
  obras_ativas int not null default 0,
  obras_iniciadas_24m int not null default 0,
  m2_em_execucao numeric(14, 2) not null default 0,
  tem_contato boolean not null default false,
  atualizado_em timestamptz not null default now(),

  constraint mercado_metricas_cnpj_check check (cnpj ~ '^[0-9]{14}$')
);

create index mercado_metricas_obras_idx on mercado_metricas (obras_ativas);
create index mercado_metricas_spes_idx on mercado_metricas (grupo_spes_total);

-- ─── Regras de camada, versionadas ──────────────────────────────────────────
-- Every reclassification records WHICH rule version moved a company. Without
-- that, "why is this company suddenly SAM?" is unanswerable, and a bad rule
-- silently rewrites the whole pyramid with no way to see what it did.
create table camada_regras (
  id uuid primary key default gen_random_uuid(),
  camada text not null,                     -- tam | sam | som
  versao int not null,
  definicao jsonb not null,                 -- the filter tree (packages/core/src/mercado/filters.ts)
  ativa boolean not null default false,
  criada_por uuid references usuarios (id) on delete set null,
  criada_em timestamptz not null default now(),

  unique (camada, versao),
  constraint camada_regras_camada_check check (camada in ('tam', 'sam', 'som'))
);

-- At most one active rule per layer. A second active rule would make the
-- pyramid depend on evaluation order, which is exactly the kind of bug that is
-- invisible until the numbers are wrong in a board deck.
create unique index camada_regras_uma_ativa_idx
  on camada_regras (camada) where ativa;

-- ─── Ingestões ──────────────────────────────────────────────────────────────
create table mercado_ingestoes (
  id uuid primary key default gen_random_uuid(),
  fonte text not null,                      -- receita_cnpj | cno | lista
  status text not null default 'executando',-- executando | concluida | falhou
  tentativa int not null default 1,
  iniciado_em timestamptz not null default now(),
  terminado_em timestamptz,
  linhas_processadas int,
  linhas_novas int,
  linhas_atualizadas int,
  erro text,
  meta jsonb not null default '{}',

  constraint mercado_ingestoes_fonte_check check (fonte in ('receita_cnpj', 'cno', 'lista')),
  constraint mercado_ingestoes_status_check check (status in ('executando', 'concluida', 'falhou'))
);

create index mercado_ingestoes_fonte_idx on mercado_ingestoes (fonte, iniciado_em desc);

-- ─── Importação de listas ───────────────────────────────────────────────────
create table importacoes_listas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  arquivo_url text,                         -- Supabase Storage
  mapeamento jsonb,                         -- column mapping chosen in the UI
  status text not null default 'mapeando',  -- mapeando | processando | revisao | concluida
  criado_por uuid references usuarios (id) on delete set null,
  criado_em timestamptz not null default now(),

  constraint importacoes_listas_status_check
    check (status in ('mapeando', 'processando', 'revisao', 'concluida'))
);

create table importacoes_linhas (
  id uuid primary key default gen_random_uuid(),
  importacao_id uuid not null references importacoes_listas (id) on delete cascade,
  dados jsonb not null,
  cnpj_resolvido text,
  status text not null default 'pendente',  -- pendente | resolvida | ambigua | ignorada
  candidatos jsonb,                         -- fuzzy-match candidates for manual review

  constraint importacoes_linhas_status_check
    check (status in ('pendente', 'resolvida', 'ambigua', 'ignorada'))
);

create index importacoes_linhas_importacao_idx on importacoes_linhas (importacao_id, status);

-- ─── Segmentos ──────────────────────────────────────────────────────────────
-- Named dynamic filters. Same tree format as camada rules — one engine, three
-- consumers (rules, explorer, segments). Cadências will enroll from these.
create table segmentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  definicao jsonb not null,
  contagem_cache int,
  contagem_atualizada_em timestamptz,
  criado_por uuid references usuarios (id) on delete set null,
  criado_em timestamptz not null default now()
);

-- ─── empresas: as colunas que o Mercado acrescenta ──────────────────────────
alter table empresas
  add column camada text,
  add column grupo_id uuid references grupos_economicos (id) on delete set null,
  add column is_spe boolean not null default false,
  add column grafo_sefaz boolean not null default false,
  add column churn_erp_concorrente boolean not null default false,
  add column erp_detalhes jsonb not null default '{}',
  add column origem text,                   -- 'mercado' (promoted) | 'lista' (imported) | null (hand-made)
  add constraint empresas_camada_check
    check (camada is null or camada in ('universo', 'tam', 'sam', 'som'));

create index empresas_camada_idx on empresas (camada);
create index empresas_grupo_idx on empresas (grupo_id);

-- `tam_camada` (0001) was a placeholder for exactly this, defined before the
-- Mercado module existed. `camada` supersedes it. Dropping it now, while it is
-- provably empty, is cheaper than living with two columns that mean the same
-- thing and drift apart.
do $$
begin
  if exists (select 1 from empresas where tam_camada is not null) then
    raise exception 'empresas.tam_camada tem dados — migre-os para camada antes de remover.';
  end if;
end;
$$;

alter table empresas drop column tam_camada;

-- ─── atualizado_em ──────────────────────────────────────────────────────────
create trigger mercado_universo_set_atualizado_em
  before update on mercado_universo
  for each row execute function set_atualizado_em();

create trigger mercado_obras_set_atualizado_em
  before update on mercado_obras
  for each row execute function set_atualizado_em();

-- ─── Semântica do erp_mrr (correção do Prompt 01) ───────────────────────────
-- Migration 0001 labelled these columns "ERP intelligence (Brik)", and the
-- Prompt 01 spec defined erp_mrr as "MRR paid to ONE OS for Brik". That is
-- WRONG and it is load-bearing: it is what the AI, and every future agent
-- reading the schema, will believe. erp_mrr is what the company pays for
-- WHATEVER ERP it uses today — it is competitive intel, and it only coincides
-- with ONE OS revenue in the one case where erp_atual = 'brik'.
comment on column empresas.erp_atual is
  'ERP que a empresa usa hoje (inteligência competitiva). Ex: sienge, brik, mega, uau.';
comment on column empresas.erp_mrr is
  'Valor mensal, em reais, que a empresa paga pelo ERP atual (erp_atual). NÃO é receita da ONE OS — só coincide com ela quando erp_atual = ''brik''.';
comment on column empresas.erp_canal_venda is
  'Canal por onde a empresa comprou o ERP atual. Ex: inbound, outbound, parceiro, onepay-cross.';
comment on column empresas.erp_detalhes is
  'Dados do produto ERP contratado: qtd_usuarios, usuarios_ativos, qtd_sistemas, canal, modalidade. Populado por importação de listas.';
comment on column empresas.camada is
  'Camada da pirâmide de mercado (universo|tam|sam|som). Classificação por regras versionadas. NÃO confundir com estagio, que é histórico de relacionamento.';
