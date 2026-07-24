-- =============================================================================
-- 0027 — Radar (Prompt 03): schema
--
-- Enriquecimento com controle de custo. O módulo inteiro gira em torno de três
-- garantias: (1) nunca enriquecer sem aprovação humana com custo na tela;
-- (2) nunca pagar duas vezes pelo mesmo dado — TTL por tipo + cache negativo
-- (registrar também quando a fonte não retornou nada); (3) esgotar as fontes
-- gratuitas antes das pagas.
--
-- Este migration cria só as TABELAS. RLS + views ficam em 0028; write-helpers em
-- 0029; seeds em 0030. Segue as convenções: uuid pk, criado_em/atualizado_em,
-- text+check (sem enums), _check nomeados, _idx, set_atualizado_em() por trigger.
-- =============================================================================

-- ─── Domínio (resolvido em cascata, ver Prompt §3) ──────────────────────────
-- Guardado em empresas E mercado_universo: o Explorador precisa filtrar por
-- domínio antes de a empresa ser promovida.
alter table empresas add column dominio text;
alter table empresas add column dominio_origem text
  constraint empresas_dominio_origem_check
  check (dominio_origem is null or dominio_origem in
    ('rfb', 'contato', 'lista', 'heuristica', 'claude_busca', 'manual'));
alter table empresas add column dominio_confianca text
  constraint empresas_dominio_confianca_check
  check (dominio_confianca is null or dominio_confianca in ('alta', 'media', 'baixa'));
alter table empresas add column dominio_validado_em timestamptz;
alter table empresas add column dominio_evidencia text;                 -- URL/prova de onde veio
alter table empresas add column dados_apollo jsonb;                     -- firmográficos do Apollo (§4)
create index empresas_dominio_idx on empresas (dominio);

comment on column empresas.dominio is 'Domínio web da empresa, resolvido em cascata (Radar §3). Unidade de cobrança do enriquecimento de contatos.';
comment on column empresas.dominio_origem is 'rfb | contato | lista | heuristica | claude_busca | manual — de onde o domínio veio.';
comment on column empresas.dominio_confianca is 'alta (CNPJ achado na página) | media (DNS+MX+nome) | baixa (só DNS).';

alter table mercado_universo add column dominio text;
alter table mercado_universo add column dominio_origem text
  constraint mercado_universo_dominio_origem_check
  check (dominio_origem is null or dominio_origem in
    ('rfb', 'contato', 'lista', 'heuristica', 'claude_busca', 'manual'));
alter table mercado_universo add column dominio_confianca text
  constraint mercado_universo_dominio_confianca_check
  check (dominio_confianca is null or dominio_confianca in ('alta', 'media', 'baixa'));

-- ─── Contatos (estende a tabela do Prompt 01) ───────────────────────────────
alter table contatos add column apollo_person_id text unique;   -- dedup por pessoa
alter table contatos add column email_status text
  constraint contatos_email_status_check
  check (email_status is null or email_status in ('verified', 'guessed', 'unavailable'));
alter table contatos add column linkedin_url text;
alter table contatos add column departamento text;
alter table contatos add column senioridade text;
alter table contatos add column enriquecido_em timestamptz;
alter table contatos add column telefone_status text
  constraint contatos_telefone_status_check
  check (telefone_status is null or telefone_status in ('pendente', 'recebido', 'indisponivel'));

comment on column contatos.email_status is 'verified | guessed | unavailable — ARMAZENADO, não usado como filtro nesta fase.';

-- ─── Log unitário de enriquecimento (fonte da verdade de custo e TTL) ───────
create table enriquecimentos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null
    constraint enriquecimentos_tipo_check check (tipo in ('dominio', 'contatos', 'protestos')),
  fonte text not null
    constraint enriquecimentos_fonte_check check (fonte in
      ('rfb', 'contato', 'lista', 'heuristica', 'claude_busca', 'apollo', 'directd_sp', 'directd_nacional')),
  -- alvo: empresa OU domínio (contatos são deduplicados por domínio, §4)
  empresa_id uuid references empresas (id) on delete set null,
  cnpj text
    constraint enriquecimentos_cnpj_check check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  dominio text,
  lote_id uuid,                    -- FK adicionada após lotes_enriquecimento existir (abaixo)
  status text not null
    constraint enriquecimentos_status_check
    check (status in ('sucesso', 'sem_dados', 'erro', 'aguardando_webhook')),
  custo_estimado numeric(10, 4),
  custo_real numeric(10, 4),
  unidades_retornadas int,         -- ex.: nº de contatos revelados
  payload jsonb,                   -- resposta bruta da fonte
  erro text,
  executado_em timestamptz not null default now()
);
create index enriquecimentos_tipo_cnpj_idx on enriquecimentos (tipo, cnpj, executado_em desc);
create index enriquecimentos_tipo_dominio_idx on enriquecimentos (tipo, dominio, executado_em desc);
create index enriquecimentos_lote_idx on enriquecimentos (lote_id);

comment on table enriquecimentos is 'Log unitário de cada tentativa de enriquecimento — a fonte da verdade de custo e de TTL. Registra também sem_dados (cache negativo) para não pagar de novo.';

-- ─── Lotes ──────────────────────────────────────────────────────────────────
create table lotes_enriquecimento (
  id uuid primary key default gen_random_uuid(),
  tipo text not null
    constraint lotes_tipo_check check (tipo in ('dominio', 'contatos', 'protestos')),
  nome text,
  definicao_filtro jsonb not null,   -- filter tree (mesmo formato do Mercado)
  parametros jsonb not null default '{}'::jsonb,  -- ex.: { incluir_fora_sp: true, revelar_telefone: false }
  total_itens int,
  custo_estimado_min numeric(12, 2),
  custo_estimado_esperado numeric(12, 2),
  custo_real numeric(12, 2) not null default 0,
  status text not null default 'rascunho'
    constraint lotes_status_check check (status in
      ('rascunho', 'aguardando_aprovacao', 'aprovado', 'executando', 'concluido', 'cancelado', 'falhou')),
  aprovado_por uuid references usuarios (id) on delete set null,
  aprovado_em timestamptz,
  criado_por uuid references usuarios (id) on delete set null,   -- null = lote automático (política, ex. cron mensal)
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  concluido_em timestamptz
);

create table lote_itens (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references lotes_enriquecimento (id) on delete cascade,
  cnpj text
    constraint lote_itens_cnpj_check check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  dominio text,
  empresa_id uuid references empresas (id) on delete set null,
  status text not null default 'pendente'
    constraint lote_itens_status_check check (status in
      ('pendente', 'processando', 'aguardando_webhook', 'sucesso', 'sem_dados', 'erro', 'pulado')),
  custo_real numeric(10, 4),
  resultado jsonb,
  erro text,
  atualizado_em timestamptz not null default now()
);
create index lote_itens_lote_status_idx on lote_itens (lote_id, status);

-- Fecha o ciclo: enriquecimentos.lote_id aponta para lotes_enriquecimento.
alter table enriquecimentos
  add constraint enriquecimentos_lote_id_fkey
  foreign key (lote_id) references lotes_enriquecimento (id) on delete set null;

comment on table lotes_enriquecimento is 'Um lote de enriquecimento: seleção (filter tree) → estimativa → aprovação → execução → reconciliação. criado_por null = lote automático (política).';

-- ─── Protestos (HISTÓRICO — nunca sobrescrever) ─────────────────────────────
create table protestos_consultas (
  id uuid primary key default gen_random_uuid(),
  cnpj text not null
    constraint protestos_cnpj_check check (cnpj ~ '^[0-9]{14}$'),
  empresa_id uuid references empresas (id) on delete set null,
  fonte text not null
    constraint protestos_fonte_check check (fonte in ('directd_sp', 'directd_nacional')),
  consultado_em timestamptz not null default now(),
  tem_protesto boolean,
  qtd_protestos int,
  valor_total numeric(14, 2),
  cartorios jsonb,                 -- detalhe por cartório/UF
  payload jsonb,                   -- resposta bruta
  custo numeric(10, 4)
);
create index protestos_cnpj_idx on protestos_consultas (cnpj, consultado_em desc);

comment on table protestos_consultas is 'Histórico de consultas de protesto — append-only, nunca update. A derivada (mudou de sem->com protesto) é o que dispara evento.';

-- ─── Clientes Onepay (sync diário, §7) ──────────────────────────────────────
create table clientes_onepay (
  cnpj text primary key
    constraint clientes_onepay_cnpj_check check (cnpj ~ '^[0-9]{14}$'),
  onepay_company_id int unique not null,
  empresa_id uuid references empresas (id) on delete set null,
  nome text,
  status text,
  operation_status text,
  credit_limit numeric(14, 2),
  available_limit numeric(14, 2),
  consumed_limit numeric(14, 2),
  consumed_pct numeric(6, 4),
  consumed_pct_2m numeric(6, 4),
  last_anticipation timestamptz,
  days_without_anticipation int,
  anticipations_last_2m int,
  gross_value_last_2m numeric(16, 2),
  primeira_vez_visto timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table clientes_onepay_snapshots (
  id uuid primary key default gen_random_uuid(),
  cnpj text not null
    constraint clientes_onepay_snapshots_cnpj_check check (cnpj ~ '^[0-9]{14}$'),
  capturado_em date not null,
  dados jsonb not null,
  unique (cnpj, capturado_em)
);
create index clientes_onepay_snapshots_cnpj_idx on clientes_onepay_snapshots (cnpj, capturado_em desc);

comment on table clientes_onepay is 'Estado atual de cada cliente Onepay (sync diário). O histórico de tendência mora em clientes_onepay_snapshots.';

-- ─── Lista de supressão (consultada ANTES de qualquer toque) ────────────────
create table supressao (
  id uuid primary key default gen_random_uuid(),
  escopo text not null
    constraint supressao_escopo_check check (escopo in ('email', 'telefone', 'whatsapp', 'empresa')),
  valor text not null,             -- endereço, número ou CNPJ
  motivo text not null
    constraint supressao_motivo_check check (motivo in
      ('descadastro', 'hard_bounce', 'solicitacao_lgpd', 'nao_abordar')),
  observacao text,
  criado_por uuid references usuarios (id) on delete set null,
  criado_em timestamptz not null default now(),
  unique (escopo, valor)
);

comment on table supressao is 'Lista de supressão: consultada antes de QUALQUER toque em qualquer canal (via estaSuprimido() em packages/core).';

-- ─── Configuração do Radar (settings) ───────────────────────────────────────
create table radar_config (
  chave text primary key,
  valor jsonb not null,
  atualizado_por uuid references usuarios (id) on delete set null,
  atualizado_em timestamptz not null default now()
);

comment on table radar_config is 'Settings do Radar: custos unitários, TTLs, orçamento, cargos-alvo, parâmetros Apollo/protestos. Editável na UI (admin).';

-- ─── Triggers de atualizado_em (convenção set_atualizado_em) ─────────────────
create trigger lotes_enriquecimento_set_atualizado_em
  before update on lotes_enriquecimento
  for each row execute function set_atualizado_em();
create trigger lote_itens_set_atualizado_em
  before update on lote_itens
  for each row execute function set_atualizado_em();
create trigger clientes_onepay_set_atualizado_em
  before update on clientes_onepay
  for each row execute function set_atualizado_em();
create trigger radar_config_set_atualizado_em
  before update on radar_config
  for each row execute function set_atualizado_em();
