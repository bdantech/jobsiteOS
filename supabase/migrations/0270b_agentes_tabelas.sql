-- ============================================================================
-- 0270b — Agentes (Prompt 09): mandatos, personas, materiais, orçamento, disjuntor
--
-- ── A UNIDADE DE TRABALHO MUDA DE CONVERSA PARA MANDATO (§2) ────────────────
-- A conversa é presa a um número de telefone; o mandato não é. O caso que o agente de
-- conversa nunca resolveria — ligou, não era o decisor, buscou outro contato no Apollo,
-- ligou de novo, mandou e-mail, marcou — atravessa três conversas e um contato que não
-- existia no começo. Só existe como trabalho contínuo se houver uma entidade acima delas.
--
-- ── O CONTROLE É ESTRUTURAL (§0) ────────────────────────────────────────────
-- O agente não pede autorização mensagem a mensagem. Ele opera sob teto de orçamento
-- (global mensal + por mandato), cota de volume (por agente), escopo de população
-- (filtro + piloto) e um disjuntor que o para sozinho. Cada uma dessas cercas é uma
-- tabela ou coluna abaixo — e nenhuma delas depende de alguém estar olhando.
--
-- ── ONDE O PROMPT E O REPO DIVERGEM ─────────────────────────────────────────
--   • `notas_fiscais` é chaveada por `access_key` (text), não por uuid: o mandato
--     aponta para a nota por `nota_access_key`.
--   • `vendedores.email_remetente` já existe (0091); a 0270b só acrescenta o resto.
--   • a proposta de mandato (§2.3 "por escalonamento") ganhou tabela própria,
--     `mandato_propostas`: o estado de um mandato é sobre trabalho em curso, e uma
--     proposta ainda não é trabalho de ninguém.
--   • reunião marcada pela IA passa por `sdr_leads` (com o agente como SDR), e não por
--     um caminho paralelo: é assim que a fila de aceite do closer (0267) e a regra
--     "IA não titulariza" (comissoes-v2) valem sem uma linha de código a mais.
--
-- ── DEFAULT PRIVILEGES ──────────────────────────────────────────────────────
-- O Supabase concede ALL a anon/authenticated em tabela nova. A 0270c revoga tudo e
-- concede só SELECT, sob a régua do módulo; toda escrita é RPC (0270d) ou worker.
-- ============================================================================

-- ─── §12 Settings ───────────────────────────────────────────────────────────

create table public.agentes_config (
  chave text primary key,
  valor jsonb not null,
  atualizado_por uuid references public.usuarios (id) on delete set null,
  atualizado_em timestamptz not null default now()
);

comment on table public.agentes_config is
  'Settings dos Agentes (09 §12): geral (kill switch único, identificação, passos por ciclo, horizonte), janela, precos, disjuntor (padrão para agente novo), orcamento; voz_status é escrito pelo worker. Nenhuma credencial aqui — authenticated lê.';

-- ─── §4.2 Caixas de e-mail das personas ─────────────────────────────────────
--
-- Uma caixa REAL (recomendação do §4.2: `ana@oneos.com.br` no Google Workspace, lida pela
-- Gmail API com a mesma integração OAuth dos vendedores humanos). Os tokens vivem no
-- Vault, como os de `gmail_contas`; aqui ficam só os ids dos segredos. A caixa existe de
-- verdade: um humano pode abrir e ver, e o histórico não depende de webhook.

create table public.email_caixas (
  id uuid primary key default gen_random_uuid(),
  endereco text not null unique
    constraint email_caixas_endereco_check check (endereco = lower(btrim(endereco)) and endereco like '%@%'),
  provedor text not null
    constraint email_caixas_provedor_check check (provedor in ('google_workspace', 'resend')),
  identificador_externo text,
  ativa boolean not null default true,
  -- Gmail (provedor google_workspace), no mesmo desenho de gmail_contas:
  refresh_token_secret_id uuid,
  access_token_secret_id uuid,
  access_token_expira_em timestamptz,
  escopos text[] not null default '{}',
  history_id text,
  watch_expira_em timestamptz,
  ultimo_sync_em timestamptz,
  ultimo_erro text,
  conectada_em timestamptz,
  conectada_por uuid references public.usuarios (id) on delete set null,
  criada_em timestamptz not null default now()
);

comment on table public.email_caixas is
  'Caixas de e-mail das personas de IA (09 §4.2). google_workspace = caixa real lida e escrita pela Gmail API (tokens no Vault); resend = só saída, com remetente próprio.';

-- ─── §3 A persona: o vendedor de IA como entidade completa ──────────────────

alter table public.vendedores
  add column persona jsonb,
  add column voz_conta_id text,
  add column email_caixa_id uuid references public.email_caixas (id) on delete set null,
  add column closer_id uuid references public.vendedores (id) on delete set null,
  add column closer_substituto_id uuid references public.vendedores (id) on delete set null,
  add column escopo jsonb,
  add column limites jsonb,
  add column modo_rodagem text not null default 'piloto'
    constraint vendedores_modo_rodagem_check check (modo_rodagem in ('piloto', 'pleno')),
  add column autonomo boolean not null default false,
  add column pausado_em timestamptz,
  add column pausado_motivo text,
  -- §3.2 "marcado como ausente": férias do CLOSER. O agente usa o substituto.
  add column ausente_ate date;

-- Uma linha de WhatsApp pertence a UM agente ativo (§3.1). Duas personas no mesmo número
-- seriam o rodízio anônimo de novo, com outro nome.
create unique index vendedores_linha_da_persona
  on public.vendedores (whatsapp_conta_id)
  where is_ia and ativo and whatsapp_conta_id is not null;

comment on column public.vendedores.persona is
  '{nome_exibicao, tom, assinatura_email, bio_curta, foto_path, genero_gramatical} — só para is_ia.';
comment on column public.vendedores.escopo is
  '{modo: filtro|carteira, filtro, filtro_nf, piloto, piloto_nf} — árvores do motor de filtros (02). Ver core/agentes/escopo.ts.';
comment on column public.vendedores.limites is
  'Cotas do agente (09 §9.1): ligacoes/mensagens/emails por dia, mandatos ativos, ações por mandato por dia, tentativas por contato, cooldown mesmo contato, gasto diário.';
comment on column public.vendedores.autonomo is
  'O agente age sozinho (09 §0). Falso = cadastrado mas parado. Não liga sem linha de WhatsApp própria (RPC recusa).';

-- ─── §2.3 Regras que criam mandato ──────────────────────────────────────────

create table public.mandato_regras (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo_mandato text not null
    constraint mandato_regras_tipo_check check (tipo_mandato in
      ('originacao_nf', 'agendamento_reuniao', 'reativacao', 'qualificacao')),
  agente_id uuid references public.vendedores (id) on delete set null,
  playbook_id uuid references public.agente_playbooks (id) on delete set null,
  filtro jsonb not null,
  objetivo_template text not null,
  orcamento_centavos int not null constraint mandato_regras_orcamento_check check (orcamento_centavos >= 0),
  max_acoes int not null constraint mandato_regras_max_acoes_check check (max_acoes > 0),
  prazo_dias int not null constraint mandato_regras_prazo_check check (prazo_dias > 0),
  teto_mandatos_ativos int,
  prioridade int not null default 50,
  -- Nasce DESLIGADA (§2.3): ligar é depois de ver a prévia de impacto.
  ativa boolean not null default false,
  ultima_avaliacao_em timestamptz,
  ultima_previa jsonb,
  criada_por uuid references public.usuarios (id) on delete set null,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);

create trigger mandato_regras_set_atualizada_em
  before update on public.mandato_regras
  for each row execute function set_atualizada_em();

-- ─── §2 O mandato ───────────────────────────────────────────────────────────

-- MDT-2026-00001. Mesmo desenho da cobranca_sequencias: upsert com `returning` sob a
-- trava da linha, em vez de contar mandatos do ano (duas sessões disputariam o número).
create table public.mandato_sequencias (
  ano int primary key,
  ultimo int not null default 0
);

create table public.mandatos (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  tipo text not null
    constraint mandatos_tipo_check check (tipo in
      ('originacao_nf', 'agendamento_reuniao', 'reativacao', 'qualificacao')),
  objetivo text not null,
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  nota_access_key text references public.notas_fiscais (access_key) on delete set null,
  agente_id uuid not null references public.vendedores (id),
  playbook_id uuid references public.agente_playbooks (id) on delete set null,
  estado text not null default 'aberto'
    constraint mandatos_estado_check check (estado in
      ('aberto', 'em_andamento', 'aguardando_externo', 'pausado', 'concluido',
       'encerrado_sem_sucesso', 'escalado')),
  resultado text,
  motivo_encerramento text,
  pausado_motivo text,
  prioridade int not null default 50,
  -- limites
  orcamento_centavos int not null constraint mandatos_orcamento_check check (orcamento_centavos >= 0),
  gasto_centavos int not null default 0,
  max_acoes int not null constraint mandatos_max_acoes_check check (max_acoes > 0),
  acoes_executadas int not null default 0,
  expira_em timestamptz not null,
  -- estado de trabalho
  plano jsonb,
  plano_versao int not null default 0,
  contatos_tentados jsonb not null default '[]',
  proxima_acao_em timestamptz,
  ultima_acao_em timestamptz,
  ultimo_ciclo_em timestamptz,
  ultimo_ciclo_erro text,
  -- a reunião que o mandato marcou (§7.3)
  reuniao_id uuid references public.vendedor_eventos (id) on delete set null,
  sdr_lead_id uuid references public.sdr_leads (id) on delete set null,
  -- procedência
  origem text not null
    constraint mandatos_origem_check check (origem in ('regra', 'manual', 'escalonamento')),
  regra_id uuid references public.mandato_regras (id) on delete set null,
  proposta_id uuid,
  criado_por uuid references public.usuarios (id) on delete set null,
  assumido_por uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  encerrado_em timestamptz,
  constraint mandatos_encerramento_check check (
    (estado in ('concluido', 'encerrado_sem_sucesso', 'escalado')) = (encerrado_em is not null)
  )
);

create index mandatos_fila_idx on public.mandatos (estado, proxima_acao_em)
  where estado in ('aberto', 'em_andamento', 'aguardando_externo');
create index mandatos_agente_idx on public.mandatos (agente_id, estado);
create index mandatos_empresa_idx on public.mandatos (empresa_id);
-- Um mandato ativo por (empresa, tipo): não duas IAs perseguindo a mesma coisa.
create unique index mandato_ativo_unico on public.mandatos (empresa_id, tipo)
  where estado in ('aberto', 'em_andamento', 'aguardando_externo', 'pausado');

create trigger mandatos_set_atualizado_em
  before update on public.mandatos
  for each row execute function set_atualizado_em();

comment on table public.mandatos is
  'Objetivo comercial delegado a um agente de IA (09 §2), com escopo, prazo, orçamento e prestação de contas. Atravessa contatos, canais e dias.';
comment on column public.mandatos.plano is
  'O plano explícito (09 §2.2): objetivo_atual, hipotese, proximas_acoes[{acao, quando, contato, por_que, condicao}], bloqueios, confianca. Versionado em mandato_plano_versoes.';
comment on column public.mandatos.contatos_tentados is
  '[{contato_id, nome, canal, tentativas, ultimo_resultado, ultima_em}] — o que o agente já tentou, com o resultado.';

create table public.mandato_acoes (
  id uuid primary key default gen_random_uuid(),
  mandato_id uuid not null references public.mandatos (id) on delete cascade,
  -- desnormalizados para o feed "Agora" e para o disjuntor, que leem por agente
  agente_id uuid not null references public.vendedores (id),
  empresa_id uuid references public.empresas (id) on delete set null,
  sequencia int not null,
  ferramenta text not null,
  intencao text not null,
  argumentos jsonb,
  resultado jsonb,
  sucesso boolean,
  erro text,
  -- a leitura que o disjuntor faz desta ação (§9.2)
  sinal text not null default 'neutro'
    constraint mandato_acoes_sinal_check check (sinal in
      ('neutro', 'ok', 'supressao', 'sem_interesse', 'escalacao', 'falha_tecnica')),
  contato_id uuid references public.contatos (id) on delete set null,
  conversa_id uuid references public.conversas (id) on delete set null,
  comunicacao_id uuid references public.comunicacoes (id) on delete set null,
  voz_ligacao_id uuid references public.voz_ligacoes (id) on delete set null,
  outbox_id uuid references public.mensagens_outbox (id) on delete set null,
  custo_centavos int not null default 0,
  tokens_entrada int,
  tokens_saida int,
  duracao_ms int,
  ciclo_id uuid,
  executada_em timestamptz not null default now(),
  unique (mandato_id, sequencia)
);

create index mandato_acoes_executada_idx on public.mandato_acoes (executada_em desc);
create index mandato_acoes_agente_idx on public.mandato_acoes (agente_id, executada_em desc);

comment on column public.mandato_acoes.intencao is
  'POR QUE o agente fez isso, em português. É a linha que o feed Ao vivo mostra.';

create table public.mandato_conversas (
  mandato_id uuid not null references public.mandatos (id) on delete cascade,
  conversa_id uuid not null references public.conversas (id) on delete cascade,
  vinculada_em timestamptz not null default now(),
  primary key (mandato_id, conversa_id)
);

create index mandato_conversas_conversa_idx on public.mandato_conversas (conversa_id);

-- Ler a evolução do plano é como se audita um agente que errou (§2.2).
create table public.mandato_plano_versoes (
  id uuid primary key default gen_random_uuid(),
  mandato_id uuid not null references public.mandatos (id) on delete cascade,
  versao int not null,
  plano jsonb not null,
  motivo text not null,
  acao_id uuid references public.mandato_acoes (id) on delete set null,
  criado_em timestamptz not null default now(),
  unique (mandato_id, versao)
);

-- §2.3 "por escalonamento": o agente PROPÕE, um humano aprova. Nunca cria sozinho.
create table public.mandato_propostas (
  id uuid primary key default gen_random_uuid(),
  mandato_origem_id uuid not null references public.mandatos (id) on delete cascade,
  tipo text not null
    constraint mandato_propostas_tipo_check check (tipo in
      ('originacao_nf', 'agendamento_reuniao', 'reativacao', 'qualificacao')),
  objetivo text not null,
  justificativa text not null,
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  agente_id uuid not null references public.vendedores (id),
  estado text not null default 'pendente'
    constraint mandato_propostas_estado_check check (estado in ('pendente', 'aprovada', 'recusada')),
  decidido_por uuid references public.usuarios (id) on delete set null,
  decidido_em timestamptz,
  motivo_recusa text,
  mandato_criado_id uuid references public.mandatos (id) on delete set null,
  criado_em timestamptz not null default now()
);

create index mandato_propostas_pendentes_idx on public.mandato_propostas (criado_em) where estado = 'pendente';

alter table public.mandatos
  add constraint mandatos_proposta_fk foreign key (proposta_id)
  references public.mandato_propostas (id) on delete set null;

-- ─── §5 Biblioteca de materiais ─────────────────────────────────────────────

create table public.materiais (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text not null,
  -- O campo que faz a biblioteca ser usável por um agente: ele recebe o catálogo
  -- (nome + descrição + quando usar + canais) e escolhe. Sem isto, ou manda o errado,
  -- ou não manda nenhum.
  quando_usar text not null,
  tipo text not null
    constraint materiais_tipo_check check (tipo in ('pdf', 'link', 'imagem', 'video', 'texto')),
  arquivo_path text,
  url text,
  corpo text,
  tags text[] not null default '{}',
  canais text[] not null default '{email,whatsapp}'
    constraint materiais_canais_check check (canais <@ array['email', 'whatsapp']::text[] and cardinality(canais) > 0),
  ativo boolean not null default true,
  vezes_usado int not null default 0,
  criado_por uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create trigger materiais_set_atualizado_em
  before update on public.materiais
  for each row execute function set_atualizado_em();

-- ─── §8 Orçamento ───────────────────────────────────────────────────────────
--
-- Teto global MENSAL (a trava dura) + teto por mandato (impede que um mandato em laço
-- drene a pool no dia 4 e deixe todos os outros parados em silêncio). Reserva e consumo
-- são atômicos por RPC (0270d): dois agentes simultâneos não gastam o mesmo saldo.

create table public.agentes_orcamento (
  id uuid primary key default gen_random_uuid(),
  mes date not null unique constraint agentes_orcamento_mes_check check (mes = date_trunc('month', mes)::date),
  teto_centavos int not null constraint agentes_orcamento_teto_check check (teto_centavos >= 0),
  consumido_centavos int not null default 0,
  reservado_centavos int not null default 0,
  alertas_enviados int[] not null default '{}',
  atualizado_em timestamptz not null default now(),
  constraint agentes_orcamento_nao_negativo check (consumido_centavos >= 0 and reservado_centavos >= 0)
);

create table public.agentes_orcamento_movimentos (
  id uuid primary key default gen_random_uuid(),
  mes date not null,
  mandato_id uuid references public.mandatos (id) on delete set null,
  acao_id uuid references public.mandato_acoes (id) on delete set null,
  agente_id uuid references public.vendedores (id) on delete set null,
  -- A reserva que este consumo/estorno liquida. É o que torna o estorno exato.
  reserva_id uuid references public.agentes_orcamento_movimentos (id) on delete set null,
  ferramenta text,
  tipo text not null
    constraint agentes_orcamento_mov_tipo_check check (tipo in ('reserva', 'consumo', 'estorno')),
  valor_centavos int not null constraint agentes_orcamento_mov_valor_check check (valor_centavos >= 0),
  liquidada boolean not null default false,
  criado_em timestamptz not null default now()
);

create index agentes_orcamento_mov_mes_idx on public.agentes_orcamento_movimentos (mes, tipo);
create index agentes_orcamento_mov_agente_idx on public.agentes_orcamento_movimentos (agente_id, criado_em desc);
create index agentes_orcamento_mov_reservas_abertas_idx on public.agentes_orcamento_movimentos (criado_em)
  where tipo = 'reserva' and not liquidada;

-- ─── §9.2 Disjuntor ─────────────────────────────────────────────────────────

create table public.agentes_disjuntor (
  agente_id uuid primary key references public.vendedores (id) on delete cascade,
  -- janela móvel por CONTAGEM de ações, não por tempo: com volume baixo, taxa por hora engana
  janela_acoes int not null default 20 constraint agentes_disjuntor_janela_check check (janela_acoes between 5 and 500),
  limiar_supressao numeric(4,3) not null default 0.10,
  limiar_sem_interesse numeric(4,3) not null default 0.60,
  limiar_escalacao numeric(4,3) not null default 0.30,
  limiar_falha_tecnica numeric(4,3) not null default 0.25,
  estado text not null default 'ok'
    constraint agentes_disjuntor_estado_check check (estado in ('ok', 'alerta', 'aberto')),
  aberto_em timestamptz,
  aberto_motivo text,
  aberto_detalhe jsonb,
  reaberto_por uuid references public.usuarios (id) on delete set null,
  reaberto_em timestamptz,
  -- Ações contadas a partir daqui: reabrir zera a janela, senão ela reabriria o
  -- disjuntor no ciclo seguinte com as mesmas ações que o abriram.
  janela_desde timestamptz not null default now(),
  avaliado_em timestamptz
);

-- ─── §7.5 Reserva temporária de janela ──────────────────────────────────────
--
-- Janela oferecida a um cliente fica reservada por N minutos (config, 30): duas conversas
-- paralelas não podem receber o mesmo horário do mesmo closer. A reserva expira sozinha —
-- nenhum job precisa limpar, porque toda consulta filtra `expira_em > now()`.

create table public.agenda_reservas (
  id uuid primary key default gen_random_uuid(),
  closer_id uuid not null references public.vendedores (id) on delete cascade,
  mandato_id uuid references public.mandatos (id) on delete cascade,
  inicio timestamptz not null,
  fim timestamptz not null,
  expira_em timestamptz not null,
  confirmada_em timestamptz,
  criada_em timestamptz not null default now(),
  constraint agenda_reservas_intervalo_check check (fim > inicio)
);

create index agenda_reservas_closer_idx on public.agenda_reservas (closer_id, inicio);

-- ─── Ligações e mensagens sabem de qual mandato vieram ──────────────────────

alter table public.voz_ligacoes
  add column mandato_id uuid references public.mandatos (id) on delete set null;
create index voz_ligacoes_mandato_idx on public.voz_ligacoes (mandato_id) where mandato_id is not null;
-- §4.3: uma tentativa aberta por (mandato, contato), não por nota.
create unique index voz_ligacoes_mandato_contato_aberta
  on public.voz_ligacoes (mandato_id, contato_id)
  where mandato_id is not null and status in ('a_enviar', 'enviada');

alter table public.mensagens_outbox
  add column mandato_id uuid references public.mandatos (id) on delete set null,
  add column mandato_acao_id uuid references public.mandato_acoes (id) on delete set null;

create index mensagens_outbox_mandato_idx on public.mensagens_outbox (mandato_id) where mandato_id is not null;

-- ─── A população que o escopo e as regras filtram (§2.3, §3.3) ──────────────
--
-- Uma linha por empresa, com as colunas que o catálogo `CATALOGO_ALVOS` do core expõe
-- (core/agentes/escopo.ts). Toda coluna aqui PRECISA existir lá e vice-versa: o catálogo
-- é a whitelist que o compilador de filtros usa, e uma coluna a menos só apareceria como
-- erro na avaliação noturna das regras.
--
-- `security_invoker`: sob RLS de `empresas`, quem consulta vê só o que já veria. O
-- worker lê como service role.

create view public.agentes_empresas_alvo with (security_invoker = on) as
select
  e.id as empresa_id,
  e.cnpj,
  e.razao_social,
  e.nome_fantasia,
  e.uf,
  e.municipio,
  nullif(e.porte, '') as porte,
  e.estagio,
  e.camada,
  e.origem,
  e.cnae_principal,
  coalesce(e.is_spe, false) as is_spe,
  e.faturamento_anual,
  e.funcionarios,
  e.score_credito,
  e.score_faixa,
  e.chance_concessao,
  e.limite_potencial,
  e.tipagem_antecipacao,
  e.gestao_operacao,
  (e.ex_cliente_desde is not null) as e_ex_cliente,
  case when e.ex_cliente_desde is null then null
       else (extract(year from age(current_date, e.ex_cliente_desde)) * 12
             + extract(month from age(current_date, e.ex_cliente_desde)))::int end as meses_desde_ex_cliente,
  case when e.ultima_conversa_em is null then null
       else (current_date - (e.ultima_conversa_em at time zone 'America/Sao_Paulo')::date) end as dias_sem_conversa,
  case when e.ultima_antecipacao is null then null else (current_date - e.ultima_antecipacao) end as dias_sem_antecipar,
  (e.dominio is not null) as tem_dominio,
  (select count(*)::int from public.contatos c
    where c.empresa_id = e.id and (c.whatsapp is not null or c.telefone is not null)) as qtd_contatos_telefone,
  exists (select 1 from public.vendedor_carteira vc
           where vc.empresa_id = e.id and vc.ate is null
             and exists (select 1 from public.vendedores v where v.id = vc.vendedor_id and v.ativo and not v.is_ia)) as tem_titular,
  (select l.fit from public.sdr_leads l where l.empresa_id = e.id order by l.atualizado_em desc limit 1) as sdr_fit,
  (select l.estagio from public.sdr_leads l where l.empresa_id = e.id order by l.atualizado_em desc limit 1) as sdr_estagio,
  (coalesce(e.bloqueio_cobranca, false)
    or exists (select 1 from public.cobranca_bloqueios_cnpj b where b.cnpj = e.cnpj)) as em_cobranca,
  exists (select 1 from public.supressao s
           where s.escopo = 'empresa' and s.valor = e.cnpj
             and (s.expira_em is null or s.expira_em >= current_date)) as suprimida
from public.empresas e
where e.cnpj is not null;

comment on view public.agentes_empresas_alvo is
  'População dos agentes por empresa (09 §2.3/§3.3). Colunas = CATALOGO_ALVOS em core/agentes/escopo.ts. em_cobranca e suprimida são SEMPRE excluídas pelo criador de mandatos, não pelo filtro.';

-- ─── §1.8(b) estendido: a resposta acorda o MANDATO ─────────────────────────
--
-- A 0270a acordava a conversa. Aqui a mesma entrada acorda o mandato ativo dela — e
-- também o mandato ativo da EMPRESA, se a mensagem chegou por uma conversa nova (o
-- Carlos indicado pela Marcia responde do próprio número): a conversa nova passa a ser
-- do mandato, que é justamente o que a conversa sozinha nunca conseguiria.

create or replace function public.comunicacoes__acorda_quem_espera()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.direcao = 'entrada' then
    if new.conversa_id is not null then
      update public.conversas set proxima_acao_em = now()
       where id = new.conversa_id
         and modo_agente <> 'desligado'
         and status <> 'encerrada'
         and (proxima_acao_em is null or proxima_acao_em > now());
    end if;

    if new.empresa_id is not null and new.conversa_id is not null then
      insert into public.mandato_conversas (mandato_id, conversa_id)
      select m.id, new.conversa_id from public.mandatos m
       where m.empresa_id = new.empresa_id
         and m.estado in ('aberto', 'em_andamento', 'aguardando_externo')
      on conflict do nothing;
    end if;

    update public.mandatos m set
      proxima_acao_em = now(),
      estado = case when m.estado = 'aguardando_externo' then 'em_andamento' else m.estado end
     where m.estado in ('aberto', 'em_andamento', 'aguardando_externo')
       and (
         (new.conversa_id is not null and exists (
            select 1 from public.mandato_conversas mc
             where mc.mandato_id = m.id and mc.conversa_id = new.conversa_id))
         or (new.empresa_id is not null and m.empresa_id = new.empresa_id)
       );
  elsif new.direcao = 'saida' and new.conversa_id is not null and not coalesce(new.por_ia, false) then
    update public.conversas set status = 'aguardando_resposta'
     where id = new.conversa_id and status = 'aguardando_humano';
  end if;
  return new;
end $$;

-- ─── A mensagem enviada volta ao mandato que a pediu ────────────────────────
--
-- A fila de envio é do 05A e não sabe o que é mandato. Quando a linha que carrega
-- `mandato_id` vira `enviada`, este trigger liga a conversa ao mandato e a comunicação à
-- ação — sem o worker de envio precisar conhecer o módulo de agentes.

create or replace function public.mensagens_outbox__liga_mandato()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.mandato_id is null or new.status is not distinct from old.status then
    return new;
  end if;
  if new.status = 'enviada' then
    if new.conversa_id is not null then
      insert into public.mandato_conversas (mandato_id, conversa_id)
      values (new.mandato_id, new.conversa_id)
      on conflict do nothing;
    end if;
    -- A ação é achada pelo id dela OU pelo `outbox_id`: o executor enfileira a mensagem
    -- antes de a ação existir (a linha da ação é gravada com o resultado da ferramenta).
    update public.mandato_acoes set
      comunicacao_id = coalesce(comunicacao_id, new.comunicacao_id),
      conversa_id = coalesce(conversa_id, new.conversa_id),
      resultado = coalesce(resultado, '{}'::jsonb) || jsonb_build_object('envio', 'enviada')
     where id = new.mandato_acao_id or outbox_id = new.id;
  elsif new.status in ('falhou', 'descartada') then
    update public.mandato_acoes set
      sucesso = false,
      erro = coalesce(new.erro, new.motivo_descarte, 'mensagem não saiu'),
      sinal = case when new.motivo_descarte = 'suprimido' then 'supressao' else 'falha_tecnica' end,
      resultado = coalesce(resultado, '{}'::jsonb) || jsonb_build_object('envio', new.status)
     where id = new.mandato_acao_id or outbox_id = new.id;
    update public.mandatos set proxima_acao_em = now()
     where id = new.mandato_id and estado in ('aberto', 'em_andamento', 'aguardando_externo');
  end if;
  return new;
end $$;

create trigger mensagens_outbox_liga_mandato
  after update of status on public.mensagens_outbox
  for each row execute function public.mensagens_outbox__liga_mandato();
