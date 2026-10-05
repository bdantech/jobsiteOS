-- ═════════════════════════════════════════════════════════════════════════════
-- 0283a — Inteligência de Conversas (05C): as tabelas
--
-- Três entregas que se sustentam uma na outra: a CAPTURA de reuniões pelo Fireflies,
-- o JULGAMENTO de toda interação contra uma rubrica versionada, e o LOOP de feedback
-- automático com contestação que volta como rótulo humano.
--
-- ─── A REUNIÃO CONTINUA SENDO UMA SÓ ────────────────────────────────────────
-- O spec propõe uma tabela `reunioes` com horário, link, título e evento do Google. Tudo
-- isso já existe em `vendedor_eventos` desde a 0201 — e a 0201 foi escrita justamente
-- contra a reunião em dois registros que discordam. Aqui `reunioes` é o ESTADO DA
-- CAPTURA de uma linha de `vendedor_eventos` (1:1 por `evento_id`): o que o Fireflies
-- fez, a transcrição, o resumo. Horário, link e convidados continuam morando num lugar.
--
-- ─── UM CAMINHO DE CRIAÇÃO, PELO BANCO ──────────────────────────────────────
-- Hoje dois caminhos criam reunião (`app_mover_lead_sdr` para o SDR humano e
-- `app__agente_agendar_reuniao` para o agente de IA), e ambos desembocam num INSERT em
-- `vendedor_eventos` com `google_pendente_em`. A linha de captura nasce por GATILHO
-- nessa tabela — o sexto caminho que alguém escrever amanhã também cai nela — e os dois
-- convidados do Fireflies entram no único lugar que escreve no Google
-- (`apps/worker/src/jobs/comercial/reunioes-google.ts`).
--
-- ─── O VÍNCULO COM O FIREFLIES NÃO É POR TÍTULO NEM POR HORÁRIO ─────────────
-- `client_reference_id` só existe para upload de áudio; reunião em que o bot entra pelo
-- calendário volta sem ele. O que volta é o `cal_id` — o id do evento que NÓS criamos no
-- Google (`vendedor_eventos.google_evento_id`). Guardamos o `client_reference_id` (= id
-- da reunião) para o dia em que ele vier, mas o casamento de verdade é pelo evento.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── §13 Settings ───────────────────────────────────────────────────────────

create table public.qualidade_config (
  chave text primary key,
  valor jsonb not null,
  atualizado_por uuid references public.usuarios (id) on delete set null,
  atualizado_em timestamptz not null default now()
);
comment on table public.qualidade_config is
  'Settings da Inteligência de Conversas (05C §13): captura, classificacao, calibracao, janela, retencao, '
  'vinculacao, precos. Só o override — chave ausente cai no padrão do core (montarConfigQualidade). '
  'Nenhuma credencial aqui: authenticated com o módulo lê.';

/* As credenciais moram no Vault; aqui só o id. Ninguém lê esta tabela além do service role. */
create table public.qualidade_segredos (
  chave text primary key
    constraint qualidade_segredos_chave_check
      check (chave in ('fireflies_api_key', 'fireflies_webhook_secret', 'jev_api_key')),
  secret_id uuid not null,
  definido_por uuid references public.usuarios (id) on delete set null,
  definido_em timestamptz not null default now()
);

/*
 * Toggles por pessoa (§12). Independentes, com uma consequência: desligar a captura
 * desliga a análise das reuniões dela (não há o que analisar), mas desligar a análise
 * mantém gravação e transcrição. Linha ausente = tudo ligado.
 */
create table public.qualidade_pessoas (
  vendedor_id uuid primary key references public.vendedores (id) on delete cascade,
  captura_ativa boolean not null default true,
  analise_ativa boolean not null default true,
  atualizado_por uuid references public.usuarios (id) on delete set null,
  atualizado_em timestamptz not null default now()
);

-- ─── §1 Captura ─────────────────────────────────────────────────────────────

create table public.reunioes (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null unique references public.vendedor_eventos (id) on delete cascade,
  -- Espelhados do evento pelo gatilho: a RLS e os agregados leem daqui sem join.
  empresa_id uuid references public.empresas (id) on delete set null,
  contato_id uuid references public.contatos (id) on delete set null,
  vendedor_id uuid references public.vendedores (id) on delete set null,   -- quem conduz
  agente_id uuid references public.vendedores (id) on delete set null,     -- quando agendada por IA (09)
  mandato_id uuid references public.mandatos (id) on delete set null,
  -- Fireflies
  fireflies_meeting_id text unique,
  fireflies_client_reference_id text unique,
  bot_entrou_em timestamptz,
  transcricao_recebida_em timestamptz,
  resumo_recebido_em timestamptz,
  captura_status text not null default 'agendada'
    constraint reunioes_captura_status_check
      check (captura_status in ('agendada', 'bot_entrou', 'transcrita', 'sem_captura', 'dispensada')),
  /* `sem_link` é automático (presencial/telefone) e volta sozinho se virar Meet; os
     outros motivos são de alguém, e só alguém desfaz. */
  dispensada_motivo text,
  dispensada_por uuid references public.usuarios (id) on delete set null,
  /* O alerta do vigia: começou há mais de N minutos e o bot não entrou. */
  alerta_sem_bot_em timestamptz,
  transcricao text,
  transcricao_segmentos jsonb,            -- [{falante, texto, inicio_s, fim_s}]
  transcricao_expurgada_em timestamptz,   -- §12: o texto sai, a análise fica
  resumo text,
  resumo_origem text constraint reunioes_resumo_origem_check check (resumo_origem in ('fireflies', 'claude')),
  proximos_passos jsonb not null default '[]'::jsonb,
  participantes_detectados jsonb,         -- quem realmente falou [{nome, email, falou}]
  duracao_s int,
  url_fireflies text,                     -- link; a mídia NÃO é copiada (§1.5)
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);
create index reunioes_empresa_idx on public.reunioes (empresa_id, criada_em desc);
create index reunioes_vendedor_idx on public.reunioes (vendedor_id, criada_em desc);
create index reunioes_vigia_idx on public.reunioes (captura_status) where captura_status in ('agendada', 'bot_entrou');

comment on table public.reunioes is
  'Estado da CAPTURA de uma reunião (05C §1), 1:1 com vendedor_eventos. Horário, link e convidados '
  'continuam no evento — aqui só o que o Fireflies fez, a transcrição e o resumo.';

/*
 * Todo webhook do Fireflies, ANTES de validar (mesmo desenho do `voz_webhooks`): o que
 * chegou, se a assinatura bateu, o que respondemos. Evento desconhecido é registrado,
 * nunca descartado com 200 silencioso. Entrega repetida bate no índice único e não
 * duplica nada.
 */
create table public.fireflies_webhooks (
  id uuid primary key default gen_random_uuid(),
  recebido_em timestamptz not null default now(),
  assinatura_ok boolean not null,
  evento text,
  meeting_id text,
  client_reference_id text,
  chave text,                             -- evento:meeting_id
  conhecido boolean not null default false,
  corpo jsonb,
  corpo_texto text,
  status_http int,
  reuniao_id uuid references public.reunioes (id) on delete set null,
  processado_em timestamptz,
  tentativas int not null default 0,
  erro text
);
create unique index fireflies_webhooks_idempotencia_idx
  on public.fireflies_webhooks (chave) where assinatura_ok and chave is not null;
create index fireflies_webhooks_pendentes_idx
  on public.fireflies_webhooks (recebido_em) where assinatura_ok and processado_em is null;

/*
 * O resgate manual (`addToLiveMeeting`). O limite do Fireflies é 3 a cada 20 minutos
 * para a conta INTEIRA — por isso o contador é uma tabela, não um estado do processo.
 */
create table public.fireflies_resgates (
  id uuid primary key default gen_random_uuid(),
  reuniao_id uuid not null references public.reunioes (id) on delete cascade,
  pedido_por uuid references public.usuarios (id) on delete set null,
  pedido_em timestamptz not null default now(),
  status text not null default 'na_fila'
    constraint fireflies_resgates_status_check check (status in ('na_fila', 'enviado', 'falhou', 'cancelado')),
  enviado_em timestamptz,
  erro text
);
create index fireflies_resgates_janela_idx on public.fireflies_resgates (enviado_em) where status = 'enviado';
create unique index fireflies_resgates_um_na_fila_idx on public.fireflies_resgates (reuniao_id) where status = 'na_fila';

-- ─── §3 Rubricas ────────────────────────────────────────────────────────────

create table public.rubricas (
  id uuid primary key default gen_random_uuid(),
  tipo_interacao text not null
    constraint rubricas_tipo_check check (tipo_interacao in ('reuniao', 'ligacao', 'conversa_texto')),
  nome text not null,
  versao int not null,
  ativa boolean not null default false,
  ativada_em timestamptz,
  /* §5 — sem isto a rubrica roda em sombra: analisa, grava, não publica. */
  calibrada_em timestamptz,
  /* Pedido de recalibração (manual, nova versão ou contestações); o worker atende e limpa. */
  recalibrar_pedido_em timestamptz,
  descricao text,
  criada_por uuid references public.usuarios (id) on delete set null,
  criada_em timestamptz not null default now(),
  unique (tipo_interacao, versao)
);
create unique index rubricas_uma_ativa_idx on public.rubricas (tipo_interacao) where ativa;

create table public.rubrica_itens (
  id uuid primary key default gen_random_uuid(),
  rubrica_id uuid not null references public.rubricas (id) on delete cascade,
  ordem int not null,
  chave text not null constraint rubrica_itens_chave_check check (chave ~ '^[a-z][a-z0-9_]*$'),
  etapa text,
  /* O nome curto do item na explicação da nota: "faltou: próximo passo com data". */
  rotulo text not null,
  pergunta text not null,
  tipo_resposta text not null constraint rubrica_itens_tipo_check check (tipo_resposta in ('sim_nao', 'escolha', 'score')),
  opcoes jsonb,
  /* Que respostas contam como atendido. Nulo numa `escolha` = item informativo (grava, não pontua). */
  atende text[],
  peso numeric(4,2) not null default 1 constraint rubrica_itens_peso_check check (peso >= 0),
  condicao_aplicabilidade text,
  /* CALIBRADO (§5), nunca chutado. Só a calibração e o override registrado escrevem. */
  limiar numeric(4,3) constraint rubrica_itens_limiar_check check (limiar is null or (limiar > 0 and limiar < 1)),
  limiar_origem text constraint rubrica_itens_limiar_origem_check check (limiar_origem in ('calibracao', 'override')),
  limiar_override_por uuid references public.usuarios (id) on delete set null,
  limiar_override_motivo text,
  limiar_override_em timestamptz,
  status_calibracao text not null default 'nao_calibrado'
    constraint rubrica_itens_status_check
      check (status_calibracao in ('nao_calibrado', 'publicado', 'sombra_f1', 'inativo_amostras')),
  f1 numeric(4,3),
  precisao numeric(4,3),
  recall numeric(4,3),
  n_amostras int,
  calibracao jsonb,                       -- {curva, motivo, n_faltas}
  calibrado_em timestamptz,
  orientacao text not null,
  gera_pendencia text
    constraint rubrica_itens_pendencia_check
      check (gera_pendencia in ('pergunta_sem_resposta', 'pendencia_nossa', 'follow_up_atrasado', 'proximo_passo')),
  /* Veredito `rubrica_ajustar` numa contestação: a pergunta está pedindo outra redação. */
  precisa_revisao boolean not null default false,
  ativo boolean not null default true,
  unique (rubrica_id, chave)
);

-- ─── §2 Análises ────────────────────────────────────────────────────────────

create table public.analises (
  id uuid primary key default gen_random_uuid(),
  escopo text not null constraint analises_escopo_check check (escopo in ('reuniao', 'ligacao', 'janela_conversa')),
  reuniao_id uuid references public.reunioes (id) on delete cascade,
  voz_ligacao_id uuid references public.voz_ligacoes (id) on delete cascade,
  conversa_id uuid references public.conversas (id) on delete cascade,
  janela_inicio timestamptz,
  janela_fim timestamptz,
  janela_mensagens int,
  empresa_id uuid references public.empresas (id) on delete set null,
  contato_id uuid references public.contatos (id) on delete set null,
  /* Quem é JULGADO. Agente de IA também é vendedor (`is_ia`) — é assim que IA e humano
     ficam na mesma régua. Nulo = ligação da Ana sem mandato: só gestores veem. */
  vendedor_id uuid references public.vendedores (id) on delete set null,
  /* A IA envolvida: quem agendou a reunião, fez a ligação ou responde a conversa. */
  agente_id uuid references public.vendedores (id) on delete set null,
  rubrica_id uuid not null references public.rubricas (id),
  rubrica_versao int not null,
  -- resultado
  score numeric(4,3),                     -- NULL em sombra ou sem item aplicável — nunca zero
  score_sombra numeric(4,3),              -- a nota "que seria", incluindo itens em sombra (só gestor)
  itens_aplicaveis int,
  itens_atendidos int,
  explicacao text,
  modo text not null default 'sombra' constraint analises_modo_check check (modo in ('sombra', 'publicado')),
  publicada_em timestamptz,
  -- custo
  provedor text not null constraint analises_provedor_check check (provedor in ('jev', 'claude')),
  custo_centavos numeric(10,4) not null default 0,
  custo_jev_centavos numeric(10,4) not null default 0,
  custo_claude_centavos numeric(10,4) not null default 0,
  tokens_entrada int,
  tokens_saida int,
  caiu_para_claude boolean not null default false,
  analisada_em timestamptz not null default now(),
  constraint analises_alvo_check check (
    (escopo = 'reuniao' and reuniao_id is not null)
    or (escopo = 'ligacao' and voz_ligacao_id is not null)
    or (escopo = 'janela_conversa' and conversa_id is not null and janela_fim is not null)
  )
);
create unique index analises_interacao_idx
  on public.analises (escopo, reuniao_id, voz_ligacao_id, conversa_id, janela_fim) nulls not distinct;
create index analises_vendedor_idx on public.analises (vendedor_id, analisada_em desc);
create index analises_empresa_idx on public.analises (empresa_id, analisada_em desc);
create index analises_conversa_idx on public.analises (conversa_id, janela_fim desc) where conversa_id is not null;

create table public.analise_itens (
  id uuid primary key default gen_random_uuid(),
  analise_id uuid not null references public.analises (id) on delete cascade,
  item_id uuid not null references public.rubrica_itens (id),
  chave text not null,
  peso numeric(4,2) not null,
  aplicavel boolean not null,
  aplicabilidade_prob numeric(4,3),
  resultado text,                         -- sim | nao | <opção> | <score>
  probabilidade numeric(4,3),             -- crua do classificador (P(sim) para sim/não)
  prob_atendido numeric(4,3),             -- o que o limiar corta e a calibração ajusta
  limiar_usado numeric(4,3),
  atendido boolean,                       -- NULL = informativo, sem resposta ou revisão pendente
  banda_cinzenta boolean not null default false,
  em_sombra boolean not null default true,
  divergente boolean not null default false,
  atendido_original boolean,              -- o que o Jev disse quando o Claude mudou
  revisao_pendente boolean not null default false,
  citacao text,                           -- trecho que justifica (Claude, só quando reprovado)
  orientacao text,                        -- o que era esperado (Claude, só quando reprovado)
  provedor text constraint analise_itens_provedor_check check (provedor in ('jev', 'claude')),
  contestado boolean not null default false,
  /* Veredito procedente mudou o item: a nota foi recalculada sobre o novo valor. */
  corrigido_em timestamptz,
  unique (analise_id, item_id)
);
create index analise_itens_item_idx on public.analise_itens (item_id, atendido);

-- ─── §9 Contestação ─────────────────────────────────────────────────────────

create table public.analise_contestacoes (
  id uuid primary key default gen_random_uuid(),
  analise_item_id uuid not null references public.analise_itens (id) on delete cascade,
  analise_id uuid not null references public.analises (id) on delete cascade,
  contestado_por uuid not null references public.usuarios (id),
  justificativa text,
  resposta_gestor text,
  veredito text constraint analise_contestacoes_veredito_check
    check (veredito in ('procedente', 'improcedente', 'rubrica_ajustar')),
  rotulo_humano text,                     -- a resposta correta, segundo o gestor: 'atendido' | 'nao_atendido' | 'nao_aplicavel'
  revisada_por uuid references public.usuarios (id),
  criada_em timestamptz not null default now(),
  revisada_em timestamptz
);
create unique index analise_contestacoes_uma_aberta_idx
  on public.analise_contestacoes (analise_item_id) where veredito is null;
create index analise_contestacoes_fila_idx on public.analise_contestacoes (criada_em) where veredito is null;

-- ─── §5 Calibração ──────────────────────────────────────────────────────────

/*
 * O RÓTULO é da interação e da CHAVE do item, não do item de uma versão: ele sobrevive à
 * troca de versão da rubrica. Quando a pergunta muda de redação, a recalibração pergunta
 * de novo ao classificador sobre as mesmas interações rotuladas — e o rótulo continua
 * valendo, porque ele diz o que aconteceu na conversa, não o que o modelo achou.
 * (Mudar o SENTIDO de um item exige chave nova. Está em docs/qualidade.md.)
 */
create table public.calibracao_rotulos (
  id uuid primary key default gen_random_uuid(),
  analise_id uuid not null references public.analises (id) on delete cascade,
  tipo_interacao text not null,
  chave text not null,
  aplicavel boolean not null,
  atendido boolean,
  resultado text,
  origem text not null constraint calibracao_rotulos_origem_check check (origem in ('manual', 'contestacao')),
  contestacao_id uuid references public.analise_contestacoes (id) on delete set null,
  rotulado_por uuid references public.usuarios (id) on delete set null,
  rotulado_em timestamptz not null default now(),
  unique (analise_id, chave)
);
create index calibracao_rotulos_tipo_idx on public.calibracao_rotulos (tipo_interacao, chave);

/* A probabilidade que o classificador deu, PARA ESTE ITEM DESTA VERSÃO, numa interação rotulada. */
create table public.calibracao_amostras (
  item_id uuid not null references public.rubrica_itens (id) on delete cascade,
  analise_id uuid not null references public.analises (id) on delete cascade,
  prob_aplicavel numeric(4,3),
  prob_atendido numeric(4,3),
  provedor text not null constraint calibracao_amostras_provedor_check check (provedor in ('jev', 'claude')),
  criada_em timestamptz not null default now(),
  primary key (item_id, analise_id)
);

create table public.calibracao_execucoes (
  id uuid primary key default gen_random_uuid(),
  rubrica_id uuid not null references public.rubricas (id) on delete cascade,
  gatilho text not null constraint calibracao_execucoes_gatilho_check
    check (gatilho in ('manual', 'versao', 'contestacoes', 'inicial')),
  resultado jsonb not null,               -- por item: {chave, status, limiar, f1, precisao, recall, n}
  saiu_de_sombra boolean not null default false,
  custo_centavos numeric(10,4) not null default 0,
  executada_por uuid references public.usuarios (id) on delete set null,
  executada_em timestamptz not null default now()
);

-- ─── §7 Pendências ──────────────────────────────────────────────────────────

create table public.qualidade_pendencias (
  id uuid primary key default gen_random_uuid(),
  analise_id uuid not null references public.analises (id) on delete cascade,
  analise_item_id uuid references public.analise_itens (id) on delete cascade,
  vendedor_id uuid not null references public.vendedores (id) on delete cascade,
  empresa_id uuid references public.empresas (id) on delete set null,
  conversa_id uuid references public.conversas (id) on delete set null,
  reuniao_id uuid references public.reunioes (id) on delete set null,
  tipo text not null constraint qualidade_pendencias_tipo_check
    check (tipo in ('pergunta_sem_resposta', 'pendencia_nossa', 'follow_up_atrasado', 'proximo_passo')),
  descricao text not null,
  citacao text,
  prazo_em timestamptz,
  status text not null default 'aberta'
    constraint qualidade_pendencias_status_check check (status in ('aberta', 'resolvida', 'descartada')),
  resolvida_em timestamptz,
  resolvida_por uuid references public.usuarios (id) on delete set null,
  criada_em timestamptz not null default now()
);
create unique index qualidade_pendencias_item_idx on public.qualidade_pendencias (analise_item_id) where analise_item_id is not null;
create index qualidade_pendencias_abertas_idx on public.qualidade_pendencias (vendedor_id, criada_em desc) where status = 'aberta';

-- ─── A fila do worker ───────────────────────────────────────────────────────

/*
 * Uma linha por interação a analisar. O webhook do Fireflies, a ligação que termina e o
 * fechamento diário de janelas enfileiram; `analise/processar` drena. É a mesma chave
 * única da análise: enfileirar duas vezes a mesma interação não faz duas análises.
 */
create table public.analise_fila (
  id uuid primary key default gen_random_uuid(),
  escopo text not null constraint analise_fila_escopo_check check (escopo in ('reuniao', 'ligacao', 'janela_conversa')),
  reuniao_id uuid references public.reunioes (id) on delete cascade,
  voz_ligacao_id uuid references public.voz_ligacoes (id) on delete cascade,
  conversa_id uuid references public.conversas (id) on delete cascade,
  janela_inicio timestamptz,
  janela_fim timestamptz,
  janela_mensagens int,
  status text not null default 'pendente'
    constraint analise_fila_status_check check (status in ('pendente', 'processando', 'concluida', 'pulada', 'falhou')),
  tentativas int not null default 0,
  tentar_apos timestamptz not null default now(),
  erro text,
  analise_id uuid references public.analises (id) on delete set null,
  criada_em timestamptz not null default now(),
  processada_em timestamptz
);
create unique index analise_fila_interacao_idx
  on public.analise_fila (escopo, reuniao_id, voz_ligacao_id, conversa_id, janela_fim) nulls not distinct;
create index analise_fila_pendentes_idx on public.analise_fila (tentar_apos) where status = 'pendente';

-- ─── §10 Vinculação ─────────────────────────────────────────────────────────

create table public.vinculacao_tentativas (
  id uuid primary key default gen_random_uuid(),
  nao_vinculada_id uuid not null references public.conversas_nao_vinculadas (id) on delete cascade,
  etapa text not null constraint vinculacao_tentativas_etapa_check
    check (etapa in ('deterministico', 'jev', 'claude', 'humano')),
  empresa_id uuid references public.empresas (id) on delete set null,
  probabilidade numeric(4,3),
  motivo text,
  candidatas jsonb not null default '[]'::jsonb,
  nao_resolvivel boolean not null default false,
  aplicada boolean not null default false,
  custo_centavos numeric(10,4) not null default 0,
  criada_em timestamptz not null default now(),
  -- auditoria mensal amostrada
  auditada_em timestamptz,
  auditada_por uuid references public.usuarios (id) on delete set null,
  auditoria_correta boolean
);
create index vinculacao_tentativas_criada_idx on public.vinculacao_tentativas (criada_em desc);
create index vinculacao_tentativas_alvo_idx on public.vinculacao_tentativas (nao_vinculada_id, criada_em desc);

-- ─── §11 Write-back cadastral ───────────────────────────────────────────────

/* A interação de onde um contato veio — rastreável até a frase. */
alter table public.contatos add column if not exists origem_interacao jsonb;
comment on column public.contatos.origem_interacao is
  'Quando origem = analise_conversa: {analise_id, reuniao_id, escopo}. O link para a interação de onde o contato veio.';

/*
 * Sobrescrita PROPÕE, nunca grava: campo já preenchido com valor diferente vira sugestão
 * na fila de revisão da empresa. Aditivo (campo vazio, contato novo) grava direto.
 */
create table public.empresa_sugestoes_cadastro (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  contato_id uuid references public.contatos (id) on delete cascade,
  campo text not null constraint empresa_sugestoes_campo_check check (campo in ('nome', 'cargo', 'email', 'telefone')),
  valor_atual text,
  valor_sugerido text not null,
  origem text not null default 'analise_conversa',
  analise_id uuid references public.analises (id) on delete set null,
  status text not null default 'pendente'
    constraint empresa_sugestoes_status_check check (status in ('pendente', 'aceita', 'recusada')),
  criada_em timestamptz not null default now(),
  decidida_por uuid references public.usuarios (id) on delete set null,
  decidida_em timestamptz
);
create unique index empresa_sugestoes_pendente_idx
  on public.empresa_sugestoes_cadastro (contato_id, campo, valor_sugerido) where status = 'pendente';
create index empresa_sugestoes_empresa_idx on public.empresa_sugestoes_cadastro (empresa_id) where status = 'pendente';
