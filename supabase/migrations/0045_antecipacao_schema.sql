-- =============================================================================
-- 0045 — Antecipação (Prompt 04): schema
--
-- O funil de NFs. Duas unidades, deliberadamente separadas:
--   a NOTA é a unidade do funil   — dinâmica, perecível, classificada por regra;
--   o FORNECEDOR é a unidade de abordagem — tipagem, cooldown, agrupamento.
--
-- E, como no Mercado, duas dimensões que NÃO se misturam:
--   `faixa`         = classificação computada por regra versionada (alta|boa|media|null);
--   `estagio_funil` = movido por AÇÃO humana (a_prospectar → … → convertida|perdida|expirada).
--
-- Só TABELAS aqui. RLS + views em 0046, write-helpers em 0047, seeds em 0048.
-- Convenções do projeto: text + check (sem enums), constraints nomeadas, _idx,
-- trigger de atualizado_em.
-- =============================================================================

-- ─── set_atualizada_em: irmã de set_atualizado_em, para as tabelas femininas ──
-- O Prompt nomeia as colunas do módulo no feminino (`atualizada_em`). Um trigger
-- não pode descobrir o nome da coluna sozinho sem SQL dinâmico, então são duas
-- funções triviais em vez de uma genérica e cara.
create or replace function set_atualizada_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizada_em = now();
  return new;
end;
$$;
revoke execute on function set_atualizada_em() from public, anon, authenticated;

-- ─── Notas fiscais (accessKey = chave natural, sync idempotente) ─────────────
create table notas_fiscais (
  access_key text primary key
    constraint notas_fiscais_access_key_check check (access_key ~ '^[0-9A-Za-z._:-]{6,60}$'),
  nf_id_externo text,                    -- "id" do payload (NFe-12345)
  tipo text not null
    constraint notas_fiscais_tipo_check check (tipo in ('NFe', 'NFSe')),
  direction text not null
    constraint notas_fiscais_direction_check check (direction in ('received', 'issued')),
  numero text,
  serie text,
  valor numeric(14, 2) not null,
  emitida_em timestamptz,
  vencimento date,
  vencimento_origem text
    constraint notas_fiscais_vencimento_origem_check
    check (vencimento_origem is null or vencimento_origem in ('xml', 'endpoint', 'estimado')),
  -- Todas as duplicatas do XML (cobr/dup), não só a usada como vencimento.
  parcelas jsonb,
  status_sync text,                      -- status vindo do endpoint (inclui cancelamento)

  sacado_cnpj text not null
    constraint notas_fiscais_sacado_cnpj_check check (sacado_cnpj ~ '^[0-9]{14}$'),
  sacado_nome text,
  sacado_cadastrado boolean,
  sacado_empresa_id uuid references empresas (id) on delete set null,
  fornecedor_cnpj text not null
    constraint notas_fiscais_fornecedor_cnpj_check check (fornecedor_cnpj ~ '^[0-9]{14}$'),
  fornecedor_nome text,
  fornecedor_cadastrado boolean,
  fornecedor_empresa_id uuid references empresas (id) on delete set null,
  contato_sacado jsonb,                  -- recipient.contact

  -- ── classificação e funil ──────────────────────────────────────────────────
  faixa text
    constraint notas_fiscais_faixa_check check (faixa is null or faixa in ('alta', 'boa', 'media')),
  faixa_regra_versao int,
  faixa_motivo text,                     -- por que está/saiu: expirada | suprimido | fora_das_faixas | regra
  faixa_alterada_em timestamptz,
  estagio_funil text not null default 'a_prospectar'
    constraint notas_fiscais_estagio_funil_check check (estagio_funil in
      ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento',
       'convertida', 'perdida', 'expirada')),
  estagio_alterado_em timestamptz,
  estagio_alterado_por uuid references usuarios (id) on delete set null,
  perda_motivo text,

  -- ── economia ───────────────────────────────────────────────────────────────
  receita_esperada numeric(12, 2),
  taxa_usada numeric(6, 3),
  dias_para_vencimento int,              -- recalculado no job diário (ordenação/exibição)

  -- ── crédito (snapshot no momento do sync; histórico em credito_snapshots) ──
  credit_status text,
  credit_role text,
  credit_limite numeric(14, 2),
  credit_disponivel numeric(14, 2),

  raw_xml text,                          -- guardar SEMPRE (semente do Pricing)
  xml_parse_erro text,                   -- falha de parse não bloqueia o sync; fica registrada
  sincronizada_em timestamptz,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);

create index notas_fiscais_fornecedor_faixa_idx on notas_fiscais (fornecedor_cnpj, faixa);
create index notas_fiscais_sacado_idx on notas_fiscais (sacado_cnpj);
create index notas_fiscais_faixa_estagio_idx on notas_fiscais (faixa, estagio_funil);
create index notas_fiscais_vencimento_idx on notas_fiscais (vencimento);
create index notas_fiscais_receita_idx on notas_fiscais (receita_esperada desc nulls last);
create index notas_fiscais_fornecedor_empresa_idx on notas_fiscais (fornecedor_empresa_id);
create index notas_fiscais_sacado_empresa_idx on notas_fiscais (sacado_empresa_id);

comment on table notas_fiscais is
  'A unidade do funil de Antecipação. Idempotente por access_key: o sync faz upsert, então a janela com sobreposição é segura. `faixa` é computada por regra versionada; `estagio_funil` só muda por ação.';
comment on column notas_fiscais.vencimento_origem is
  'xml (cobr/dup/dVenc) | endpoint | estimado (emissão + 30d). A origem é sempre gravada — uma data estimada não pode se passar por uma real.';
comment on column notas_fiscais.raw_xml is
  'XML bruto, guardado SEMPRE: é a semente do módulo de Pricing e permite reprocessar itens/parcelas sem re-sincronizar.';

-- ─── Itens da NF extraídos do XML (semente do Pricing — extrair já) ──────────
create table nota_itens (
  id uuid primary key default gen_random_uuid(),
  access_key text not null references notas_fiscais (access_key) on delete cascade,
  ordem int,
  codigo text,
  descricao text,
  ncm text,
  cfop text,
  unidade text,
  quantidade numeric(14, 4),
  valor_unitario numeric(14, 4),
  valor_total numeric(14, 2),
  unique (access_key, ordem)
);
create index nota_itens_access_key_idx on nota_itens (access_key);
create index nota_itens_ncm_idx on nota_itens (ncm);

comment on table nota_itens is
  'Itens (det/prod) extraídos do XML. Ninguém consome ainda — é a base do Pricing. Falha de parse não bloqueia o sync.';

-- ─── Histórico de análise de crédito por sacado (a derivada importa) ─────────
create table credito_snapshots (
  id uuid primary key default gen_random_uuid(),
  cnpj text not null
    constraint credito_snapshots_cnpj_check check (cnpj ~ '^[0-9]{14}$'),
  capturado_em timestamptz not null default now(),
  status text,
  role text,
  via_headquarters boolean,
  credit_limit numeric(14, 2),
  available_limit numeric(14, 2),
  consumed_limit numeric(14, 2),
  expiration_date date,
  monthly_rate_d0 numeric(6, 3),
  monthly_rate_d1 numeric(6, 3),
  origem text not null default 'sync_nf'
);
create index credito_snapshots_cnpj_idx on credito_snapshots (cnpj, capturado_em desc);

comment on table credito_snapshots is
  'Append-only. Um snapshot só é gravado quando ALGO mudou em relação ao último do sacado — o valor está na derivada (downgrade de limite, status que virou), não na repetição diária.';

-- ─── Tipagem comercial do fornecedor (computada, cacheada) ───────────────────
alter table empresas add column tipagem_antecipacao text
  constraint empresas_tipagem_antecipacao_check
  check (tipagem_antecipacao is null or tipagem_antecipacao in ('aquisicao', 'ativacao', 'recorrencia'));
alter table empresas add column ultima_antecipacao date;

comment on column empresas.tipagem_antecipacao is
  'aquisicao (não cadastrado na plataforma) | ativacao (cadastrado, nunca antecipou) | recorrencia (já antecipou). Cache do que a view notas_funil calcula ao vivo — existe para a Company 360 e para o evento de mudança.';

-- ─── Regras de faixa (versionadas, mesmo padrão da pirâmide) ─────────────────
create table faixa_regras (
  id uuid primary key default gen_random_uuid(),
  faixa text not null
    constraint faixa_regras_faixa_check check (faixa in ('alta', 'boa', 'media')),
  versao int not null,
  definicao jsonb not null,              -- filter tree (catálogo de faixas, packages/core)
  ativa boolean not null default false,
  criada_por uuid references usuarios (id) on delete set null,
  criada_em timestamptz not null default now(),
  unique (faixa, versao)
);

-- No máximo uma regra ativa por faixa: duas fariam a faixa depender da ordem de
-- avaliação, que é exatamente o bug invisível até o número estar errado no board.
create unique index faixa_regras_uma_ativa_idx on faixa_regras (faixa) where ativa;

-- ─── Config de disparo por faixa (modo sombra nesta fase) ────────────────────
create table faixa_disparos (
  faixa text primary key
    constraint faixa_disparos_faixa_check check (faixa in ('alta', 'boa', 'media')),
  email_habilitado boolean not null default false,
  whatsapp_habilitado boolean not null default false,
  whatsapp_contas uuid[] not null default '{}',   -- round-robin entre as contas escolhidas
  cooldown_dias int not null default 7            -- mín. entre toques ao MESMO fornecedor
    constraint faixa_disparos_cooldown_check check (cooldown_dias between 0 and 365),
  template_email text,
  template_whatsapp text,
  assunto_email text,
  atualizado_por uuid references usuarios (id) on delete set null,
  atualizado_em timestamptz not null default now()
);

comment on table faixa_disparos is
  'Régua de disparo por faixa. Nesta fase o resultado é SOMBRA: gera mensagens_outbox com status pendente_envio e nada sai.';

-- ─── Contas de WhatsApp (cadastro apenas — integração real no Prompt 05) ─────
create table whatsapp_contas (
  id uuid primary key default gen_random_uuid(),
  apelido text not null,
  numero text not null,                  -- E.164 sem "+", só dígitos
  provedor text not null default 'wasender',
  -- O token vive no Supabase Vault (pgsodium), não nesta tabela: aqui fica só o
  -- PONTEIRO. `vault.decrypted_secrets` não é legível por `authenticated`, então
  -- nem uma consulta direta ao PostgREST devolve o segredo — a UI só sabe que
  -- existe e desde quando. Quem enviar de verdade (Prompt 05) lê com service role.
  token_secret_id uuid,
  token_definido_em timestamptz,
  usuario_responsavel uuid references usuarios (id) on delete set null,
  ativo boolean not null default true,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  constraint whatsapp_contas_numero_check check (numero ~ '^[0-9]{10,15}$'),
  unique (numero)
);

comment on column whatsapp_contas.token_secret_id is
  'Id do segredo no Supabase Vault (pgsodium). Não há RPC de leitura: a UI só sabe SE existe e QUANDO foi definido; substituir grava um novo segredo.';

-- ─── Outbox (modo sombra: registra o que SERIA enviado) ──────────────────────
create table mensagens_outbox (
  id uuid primary key default gen_random_uuid(),
  canal text not null
    constraint mensagens_outbox_canal_check check (canal in ('email', 'whatsapp')),
  fornecedor_cnpj text not null
    constraint mensagens_outbox_fornecedor_check check (fornecedor_cnpj ~ '^[0-9]{14}$'),
  fornecedor_nome text,
  fornecedor_empresa_id uuid references empresas (id) on delete set null,
  destinatario text,                     -- e-mail/telefone escolhido
  destinatario_contato_id uuid references contatos (id) on delete set null,
  destinatario_ponto_focal boolean not null default false,
  whatsapp_conta_id uuid references whatsapp_contas (id) on delete set null,
  faixa text
    constraint mensagens_outbox_faixa_check check (faixa is null or faixa in ('alta', 'boa', 'media')),
  access_keys text[] not null,           -- NFs agrupadas neste toque
  valor_total numeric(14, 2),
  assunto text,
  corpo text,
  status text not null default 'pendente_envio'
    constraint mensagens_outbox_status_check check (status in
      ('pendente_envio', 'aprovada', 'enviada', 'falhou', 'descartada')),
  motivo_descarte text,
  descartada_por uuid references usuarios (id) on delete set null,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);
create index mensagens_outbox_fornecedor_idx on mensagens_outbox (fornecedor_cnpj, criada_em desc);
create index mensagens_outbox_status_idx on mensagens_outbox (status);
create index mensagens_outbox_faixa_idx on mensagens_outbox (faixa, criada_em desc);

comment on table mensagens_outbox is
  'Modo sombra: o que SERIA enviado. Nada sai neste prompt. Também é o registro do descarte "sem_contato", que é insumo direto para um lote de contatos no Radar.';

-- ─── Supressão: validade e contexto (estende a tabela do Radar) ──────────────
alter table supressao add column expira_em date;   -- null = eterna
alter table supressao add column contexto text not null default 'geral'
  constraint supressao_contexto_check check (contexto in ('geral', 'antecipacao'));

comment on column supressao.expira_em is
  'Soft: "sem interesse agora" expira (default 90 dias) e o fornecedor volta a ser elegível. Eterna (LGPD): null. O job diário limpa as expiradas.';

-- ─── Ponto focal de contato (§3.2) ───────────────────────────────────────────
alter table contatos add column ponto_focal boolean not null default false;
-- No máximo um por empresa. A troca é feita em transação pelo RPC app_definir_ponto_focal.
create unique index contatos_ponto_focal_unico on contatos (empresa_id) where ponto_focal;

-- ─── Enriquecimento cadastral de CNPJ fora do recorte (§3.1) ─────────────────
create table cnpj_lookup_fila (
  cnpj text primary key
    constraint cnpj_lookup_fila_cnpj_check check (cnpj ~ '^[0-9]{14}$'),
  motivo text not null default 'fornecedor_nf'
    constraint cnpj_lookup_fila_motivo_check
    check (motivo in ('fornecedor_nf', 'sacado_nf', 'manual')),
  status text not null default 'pendente'
    constraint cnpj_lookup_fila_status_check
    check (status in ('pendente', 'resolvido_api', 'nao_encontrado', 'erro')),
  tentativas int not null default 0,
  ultimo_provedor text,
  ultimo_erro text,
  criado_em timestamptz not null default now(),
  resolvido_em timestamptz
);
create index cnpj_lookup_fila_status_idx on cnpj_lookup_fila (status, criado_em desc);

comment on table cnpj_lookup_fila is
  'Fila de enriquecimento cadastral por cascata de APIs públicas gratuitas (minhareceita → BrasilAPI → ReceitaWS). Fornecedores de NF quase nunca têm CNAE de construção, logo não existem em mercado_universo — sem isso as variáveis de faixa e a Company 360 ficam cegas para eles.';

alter table mercado_universo add column origem_ingestao text not null default 'receita_dump';
alter table mercado_universo add column fora_recorte_cnae boolean not null default false;

comment on column mercado_universo.fora_recorte_cnae is
  'true quando o CNPJ entrou por lookup e o CNAE não é do recorte de construção. A regra do TAM exige false, para que fornecedores de fora do setor existam no staging sem poluir a pirâmide comercial.';

-- ─── Configuração do módulo (settings) ──────────────────────────────────────
create table antecipacao_config (
  chave text primary key,
  valor jsonb not null,
  atualizado_por uuid references usuarios (id) on delete set null,
  atualizado_em timestamptz not null default now()
);

comment on table antecipacao_config is
  'Settings do módulo: minimo_operavel, taxa default, cooldown default, janela de vencimento, supressão soft em dias, lookup cadastral.';

-- ─── Triggers de atualizado_em ───────────────────────────────────────────────
create trigger faixa_disparos_set_atualizado_em
  before update on faixa_disparos
  for each row execute function set_atualizado_em();
create trigger whatsapp_contas_set_atualizada_em
  before update on whatsapp_contas
  for each row execute function set_atualizada_em();
create trigger mensagens_outbox_set_atualizada_em
  before update on mensagens_outbox
  for each row execute function set_atualizada_em();
create trigger notas_fiscais_set_atualizada_em
  before update on notas_fiscais
  for each row execute function set_atualizada_em();
create trigger antecipacao_config_set_atualizado_em
  before update on antecipacao_config
  for each row execute function set_atualizado_em();
