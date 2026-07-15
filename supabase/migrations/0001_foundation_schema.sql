-- ============================================================================
-- 0001 — Foundation schema
-- One company (CNPJ), many lenses: `empresas` is the single source of truth.
-- Every module reads/writes state on top of it; nothing duplicates companies.
-- ============================================================================

-- ─── Companies ──────────────────────────────────────────────────────────────
create table empresas (
  id uuid primary key default gen_random_uuid(),
  cnpj text unique not null,
  razao_social text,
  nome_fantasia text,
  tipo text not null default 'construtora',
  uf text,
  municipio text,
  cnae_principal text,
  porte text,
  estagio text not null default 'mercado',
  tam_camada text,
  -- ERP intelligence (Brik)
  erp_atual text,
  erp_mrr numeric(12, 2),
  erp_canal_venda text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint empresas_tipo_check check (tipo in ('construtora', 'fornecedor')),
  constraint empresas_estagio_check check (
    estagio in ('mercado', 'lead', 'prospect', 'cliente', 'ex_cliente')
  ),
  -- CNPJ is stored normalized: digits only, exactly 14.
  constraint empresas_cnpj_check check (cnpj ~ '^[0-9]{14}$')
);

create index empresas_estagio_idx on empresas (estagio);
create index empresas_tipo_idx on empresas (tipo);
create index empresas_uf_idx on empresas (uf);
-- Powers `empresas.search` (registry tool) over razao_social / nome_fantasia.
create index empresas_busca_idx on empresas using gin (
  to_tsvector('portuguese', coalesce(razao_social, '') || ' ' || coalesce(nome_fantasia, ''))
);

-- ─── Notes ──────────────────────────────────────────────────────────────────
create table empresa_notas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id) on delete cascade,
  autor_usuario_id uuid not null,
  conteudo text not null,
  criado_em timestamptz not null default now()
);

create index empresa_notas_empresa_idx on empresa_notas (empresa_id, criado_em desc);

-- ─── Event backbone ─────────────────────────────────────────────────────────
-- Powers Company 360 timeline, AI context, notifications, audit trail.
create table empresa_eventos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas (id) on delete cascade,
  tipo text not null,
  payload jsonb not null default '{}',
  ator_usuario_id uuid,  -- null when system/cron generated
  criado_em timestamptz not null default now()
);

create index empresa_eventos_empresa_idx on empresa_eventos (empresa_id, criado_em desc);
create index empresa_eventos_tipo_idx on empresa_eventos (tipo, criado_em desc);

-- ─── Contacts ───────────────────────────────────────────────────────────────
create table contatos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id) on delete cascade,
  nome text,
  cargo text,
  email text,
  telefone text,
  whatsapp text,
  origem text,  -- enrichment source
  criado_em timestamptz not null default now()
);

create index contatos_empresa_idx on contatos (empresa_id);

-- ─── RBAC ───────────────────────────────────────────────────────────────────
create table perfis (
  id uuid primary key default gen_random_uuid(),
  nome text unique not null,
  descricao text,
  criado_em timestamptz not null default now()
);

-- modulo_id matches AppModule.id in packages/core/registry.
-- Deliberately NOT a FK: the registry lives in code, not in the database.
create table perfil_modulos (
  perfil_id uuid not null references perfis (id) on delete cascade,
  modulo_id text not null,
  primary key (perfil_id, modulo_id)
);

create table usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  email text unique not null,
  perfil_id uuid references perfis (id) on delete set null,
  ativo boolean not null default true,
  must_change_password boolean not null default true,
  web_push_subscriptions jsonb not null default '[]',  -- VAPID subscriptions
  expo_push_tokens jsonb not null default '[]',        -- Expo push tokens, per device
  prefs_notificacoes jsonb not null default '{}',
  criado_em timestamptz not null default now()
);

create index usuarios_perfil_idx on usuarios (perfil_id);

-- ─── Notifications ──────────────────────────────────────────────────────────
create table notificacoes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios (id) on delete cascade,
  titulo text not null,
  corpo text,
  url text,  -- deep link: web route; mobile resolves it via linking config
  lida boolean not null default false,
  criado_em timestamptz not null default now()
);

create index notificacoes_usuario_idx on notificacoes (usuario_id, criado_em desc);
create index notificacoes_nao_lidas_idx on notificacoes (usuario_id) where not lida;

-- Notification rules scaffold: when an empresa_eventos row of `tipo_evento` is
-- created, notify subscribers. Populated by future modules.
create table notificacao_regras (
  id uuid primary key default gen_random_uuid(),
  tipo_evento text not null,
  perfil_id uuid references perfis (id) on delete cascade,
  usuario_id uuid references usuarios (id) on delete cascade,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),

  -- Exactly one target: a profile (everyone with it) or a single user.
  constraint notificacao_regras_alvo_check check (
    (perfil_id is not null and usuario_id is null)
    or (perfil_id is null and usuario_id is not null)
  )
);

create index notificacao_regras_tipo_idx on notificacao_regras (tipo_evento) where ativo;

-- ─── Audit log ──────────────────────────────────────────────────────────────
-- Every mutation through the write helper lands here.
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid,
  acao text not null,
  entidade text,
  entidade_id text,
  payload jsonb,
  criado_em timestamptz not null default now()
);

create index audit_log_usuario_idx on audit_log (usuario_id, criado_em desc);
create index audit_log_entidade_idx on audit_log (entidade, entidade_id, criado_em desc);

-- ─── atualizado_em maintenance ──────────────────────────────────────────────
create or replace function set_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

create trigger empresas_set_atualizado_em
  before update on empresas
  for each row
  execute function set_atualizado_em();
