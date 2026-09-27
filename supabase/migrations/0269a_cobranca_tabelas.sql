-- ============================================================================
-- 0269a — Cobrança extrajudicial e sinistro (Prompt 07): tabelas
--
-- ── O QUE ESTE MÓDULO É, E O QUE ELE NÃO É ──────────────────────────────────
-- Não é régua de vencidos de curto prazo: atraso de 1 a 14 dias continua na
-- plataforma de produção. É a esteira formal que começa em D+15 com a
-- notificação extrajudicial e termina em quitação, acordo, protesto/processo ou
-- sinistro pago. E é, ao mesmo tempo, o construtor do dossiê de sinistro que a
-- apólice Atradius exige (cl. 22208.00): cobrar sem registrar é perder a
-- indenização, não só o título.
--
-- ── NADA DISPARA SOZINHO ────────────────────────────────────────────────────
-- Toda criação, todo envio, todo protesto, todo sinistro é ação humana. O
-- sistema calcula, redige, alerta e cobra prazo — quem aperta o botão é gente.
-- Por isso não há trigger que envie nada, e o worker só escreve o que é dele:
-- a projeção de títulos, os PDFs e o relógio da apólice.
--
-- ── ONDE O PROMPT E O REPO DIVERGEM ─────────────────────────────────────────
--   • `processos` é chaveado por `numero_cnj`, não por uuid: a cobrança aponta
--     para ele por `processo_cnj`, e `processos.vinculo_cobranca_id` (reservado
--     na 0143) ganha aqui a FK que lá ficou prometida.
--   • não existe `processo_titulos`: o elo com o Jurídico é `processo_operacoes`.
--   • a produção não expõe a liquidação do título pelo sacado. `titulos` é uma
--     projeção de `antecipacoes` (0077), e o que falta está pedido ao time de
--     produção em docs/requisicao-titulos-plataforma-producao.md.
--
-- ── DEFAULT PRIVILEGES ──────────────────────────────────────────────────────
-- O Supabase concede ALL a anon/authenticated em toda tabela nova. A 0269b
-- revoga tudo e concede só o SELECT; toda escrita é RPC (0269d/0269e) ou worker.
-- ============================================================================

-- ─── §13 Settings ───────────────────────────────────────────────────────────

create table public.cobranca_config (
  chave text primary key,
  valor jsonb not null,
  atualizado_por uuid references public.usuarios (id) on delete set null,
  atualizado_em timestamptz not null default now()
);

comment on table public.cobranca_config is
  'Settings da Cobrança (§13): cobranca, calculo, apolice, protesto, regularizacao, credor. '
  'Mesmo desenho de juridico_config. NENHUMA credencial entra aqui — a tabela é lida por '
  'authenticated; credencial de CRA e da Non-Payments API vive no Vault/env do worker.';

-- Sequencial por ano para COB-2026-0001 e SIN-2026-0001. Uma sequence global não
-- reinicia no ano; contar linhas por ano disputaria o mesmo número em duas sessões.
-- O upsert com `returning` é atômico sob a trava da linha.
create table public.cobranca_sequencias (
  prefixo text not null,
  ano int not null,
  ultimo int not null default 0,
  primary key (prefixo, ano)
);

-- ─── §2 Fonte dos títulos ───────────────────────────────────────────────────

create table public.titulos (
  id uuid primary key default gen_random_uuid(),
  /*
   * O id do título na produção. Hoje é o `id_externo` da antecipação, em texto —
   * quando a produção expuser um endpoint de títulos próprio (a requisição está em
   * docs/), a chave continua a mesma coluna e a projeção troca de fonte sem migrar.
   */
  externo_id text not null unique,
  antecipacao_id_externo int unique references public.antecipacoes (id_externo) on delete set null,
  operacao_externo_id text,
  numero text,
  nf_chave_acesso text,

  sacado_cnpj text not null constraint titulos_sacado_cnpj_check check (sacado_cnpj ~ '^[0-9]{14}$'),
  sacado_nome text,
  /*
   * SEMPRE o cabeça do grupo (regra 04s): a holding cliente quando o sacado é uma
   * SPE dela (`app_holding_do_sacado`), a matriz pela raiz do CNPJ quando é filial,
   * e o próprio CNPJ quando nada resolve. É a coluna que decide quem recebe a
   * notificação consolidada e quem é o "Comprador" da franquia da apólice.
   */
  sacado_matriz_cnpj text not null constraint titulos_sacado_matriz_check check (sacado_matriz_cnpj ~ '^[0-9]{14}$'),
  sacado_empresa_id uuid references public.empresas (id) on delete set null,
  cedente_cnpj text not null constraint titulos_cedente_cnpj_check check (cedente_cnpj ~ '^[0-9]{14}$'),
  cedente_nome text,
  cedente_matriz_cnpj text not null constraint titulos_cedente_matriz_check check (cedente_matriz_cnpj ~ '^[0-9]{14}$'),
  cedente_empresa_id uuid references public.empresas (id) on delete set null,

  valor_face numeric(14, 2) not null,
  -- O que efetivamente pagamos ao cedente: teto da indenização (cl. 22100.20 §3).
  valor_cedido numeric(14, 2),
  emissao date,
  /*
   * VENCIMENTO ORIGINAL — nunca sobrescrever. A cl. 16900.20 diz que a prorrogação
   * não desloca a data usada para aplicar os termos da apólice. A projeção grava
   * esta coluna na primeira vez e depois nunca mais: uma data nova vinda da
   * produção vai para `vencimento_prorrogado`, que serve só para a conversa comercial.
   */
  vencimento date not null,
  vencimento_prorrogado date,
  status text not null
    constraint titulos_status_check check (status in ('aberto', 'pago', 'parcial', 'recomprado', 'cancelado')),
  -- O status cru da produção, para a tela mostrar o que a plataforma diz.
  status_producao text,
  pago_em date,
  /*
   * De onde veio a data de pagamento. `conclusao_producao` é o `completionDate` da
   * antecipação CONCLUDED — medido em 26/09/2026, ele cai no dia seguinte ao
   * vencimento em quase todas as linhas, isto é, é a liquidação pelo sacado. Não é
   * um campo de liquidação declarado pela produção, e a tela diz isso.
   */
  pago_em_origem text constraint titulos_pago_em_origem_check
    check (pago_em_origem is null or pago_em_origem in ('conclusao_producao', 'producao')),
  valor_pago numeric(14, 2),
  coberto_apolice boolean not null default true,
  limite_credito_vigente numeric(14, 2),
  sincronizado_em timestamptz not null default now()
);

create index titulos_grupo_idx on public.titulos (sacado_matriz_cnpj, status, vencimento);
create index titulos_cedente_idx on public.titulos (cedente_cnpj, status);
create index titulos_vencidos_idx on public.titulos (vencimento) where status = 'aberto';

comment on table public.titulos is
  'Projeção dos títulos cedidos, hoje materializada de antecipacoes pelo worker '
  '(app__cobranca_projetar_titulos). Escrita só pelo service role.';

-- ─── §5 Modelos (vêm antes das notificações, que apontam para eles) ─────────

create table public.cobranca_modelos (
  id uuid primary key default gen_random_uuid(),
  /*
   * Uma família é o mesmo modelo ao longo das versões. Editar grava uma LINHA
   * NOVA com `versao + 1` na mesma família: a notificação enviada em março aponta
   * para o texto de março, e reabrir o dossiê mostra o que foi de fato enviado.
   */
  familia_id uuid not null default gen_random_uuid(),
  tipo text not null constraint cobranca_modelos_tipo_check check (tipo in (
    'notificacao_sacado', 'notificacao_cedente', 'reiteracao',
    'confissao_divida_simples', 'confissao_divida_aval',
    'confissao_divida_af', 'confissao_divida_garantia_real')),
  nome text not null constraint cobranca_modelos_nome_check check (length(btrim(nome)) between 2 and 160),
  versao int not null default 1,
  ativo boolean not null default true,
  corpo_markdown text not null,
  criado_por uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now(),
  unique (familia_id, versao)
);

-- Só a última versão de cada família fica ativa.
create unique index cobranca_modelos_uma_ativa on public.cobranca_modelos (familia_id) where ativo;

-- ─── §3 A cobrança ──────────────────────────────────────────────────────────

create table public.cobrancas (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  sacado_matriz_cnpj text not null constraint cobrancas_sacado_check check (sacado_matriz_cnpj ~ '^[0-9]{14}$'),
  sacado_empresa_id uuid references public.empresas (id) on delete set null,
  escopo_notificacao text not null default 'sacado'
    constraint cobrancas_escopo_check check (escopo_notificacao in ('sacado', 'sacado_e_cedente')),
  notificar_matriz_cedente boolean not null default true,
  estagio text not null default 'rascunho' constraint cobrancas_estagio_check check (estagio in (
    'rascunho', 'notificada', 'em_negociacao', 'acordo_firmado', 'acordo_em_cumprimento',
    'quitada', 'judicializada', 'encerrada_perda', 'cancelada')),
  responsavel_id uuid references public.usuarios (id) on delete set null,
  -- parâmetros de atualização (herdam de cobranca_config.calculo, editáveis POR COBRANÇA)
  juros_mora_mes numeric(6, 4),
  multa_pct numeric(6, 4),
  honorarios_pct numeric(6, 4),
  indice_correcao text constraint cobrancas_indice_check
    check (indice_correcao is null or indice_correcao in ('igpm', 'ipca', 'inpc', 'nenhum')),
  juros_pro_rata boolean not null default true,
  data_base date,
  /*
   * O último total atualizado calculado (na geração das notificações ou de uma
   * rodada). O kanban precisa do número e o cálculo depende da tabela de índices,
   * que mora no TypeScript — recalcular por card seria um cálculo por linha da lista.
   */
  valor_atualizado numeric(14, 2),
  valor_atualizado_em timestamptz,
  -- §6.4: quem aceitou o aviso de Interrupção Automática de Cobertura, e quando.
  aceite_apolice_por uuid references public.usuarios (id) on delete set null,
  aceite_apolice_em timestamptz,
  notificada_em timestamptz,
  -- vínculo com o Jurídico (Prompt 08); `processos` é chaveado pelo CNJ
  processo_cnj text references public.processos (numero_cnj) on delete set null,
  convertida_em_processo_em timestamptz,
  observacoes text,
  criada_por uuid references public.usuarios (id) on delete set null,
  criada_em timestamptz not null default now(),
  encerrada_em timestamptz,
  motivo_encerramento text
);

create index cobrancas_estagio_idx on public.cobrancas (estagio, criada_em desc);
create index cobrancas_sacado_idx on public.cobrancas (sacado_matriz_cnpj);
create index cobrancas_responsavel_idx on public.cobrancas (responsavel_id);

-- A FK prometida na 0143, que ficou sem alvo até esta tabela existir.
alter table public.processos
  add constraint processos_vinculo_cobranca_fk
  foreign key (vinculo_cobranca_id) references public.cobrancas (id) on delete set null;

create table public.cobranca_titulos (
  id uuid primary key default gen_random_uuid(),
  cobranca_id uuid not null references public.cobrancas (id) on delete cascade,
  titulo_id uuid not null references public.titulos (id),
  -- snapshot no momento da inclusão: a produção pode mudar; o dossiê não pode
  valor_face_snapshot numeric(14, 2) not null,
  valor_cedido_snapshot numeric(14, 2),
  vencimento_snapshot date not null,
  dias_atraso_snapshot int not null,
  sacado_cnpj_snapshot text not null,
  cedente_cnpj_snapshot text not null,
  situacao text not null default 'em_cobranca' constraint cobranca_titulos_situacao_check
    check (situacao in ('em_cobranca', 'quitado', 'acordado', 'protestado', 'sinistrado', 'retirado')),
  quitado_em date,
  quitado_origem text constraint cobranca_titulos_quitado_origem_check
    check (quitado_origem is null or quitado_origem in ('producao', 'manual')),
  valor_recebido numeric(14, 2),
  unique (cobranca_id, titulo_id)
);

-- Um título só pode estar em UMA cobrança ativa.
create unique index titulo_cobranca_ativa on public.cobranca_titulos (titulo_id)
  where situacao in ('em_cobranca', 'acordado', 'protestado', 'sinistrado');

-- ─── §4 Notificações, agrupamento e entregas ────────────────────────────────

create table public.cobranca_notificacoes (
  id uuid primary key default gen_random_uuid(),
  cobranca_id uuid not null references public.cobrancas (id) on delete cascade,
  papel text not null constraint cobranca_notificacoes_papel_check
    check (papel in ('sacado_matriz', 'sacado_filial', 'cedente_matriz', 'cedente_filial')),
  destinatario_cnpj text not null constraint cobranca_notificacoes_cnpj_check check (destinatario_cnpj ~ '^[0-9]{14}$'),
  destinatario_empresa_id uuid references public.empresas (id) on delete set null,
  destinatario_razao_social text not null,
  -- cadastral da Receita, editável antes do envio (causa nº 1 de AR devolvido)
  destinatario_endereco jsonb,
  modelo_id uuid references public.cobranca_modelos (id) on delete set null,
  rodada int not null default 1,
  valor_total numeric(14, 2) not null,
  valor_total_atualizado numeric(14, 2),
  memoria_calculo jsonb,
  qtd_titulos int not null,
  prazo_pagamento_dias int not null,
  prazo_expira_em date,
  documento_path text,
  documento_hash text,
  status text not null default 'rascunho' constraint cobranca_notificacoes_status_check
    check (status in ('rascunho', 'pronta', 'enviada', 'entregue', 'falhou', 'respondida')),
  gerada_em timestamptz not null default now(),
  enviada_em timestamptz,
  unique (cobranca_id, destinatario_cnpj, rodada)
);

create index cobranca_notificacoes_cobranca_idx on public.cobranca_notificacoes (cobranca_id, rodada);

create table public.cobranca_notificacao_titulos (
  notificacao_id uuid references public.cobranca_notificacoes (id) on delete cascade,
  cobranca_titulo_id uuid references public.cobranca_titulos (id) on delete cascade,
  primary key (notificacao_id, cobranca_titulo_id)
);

create table public.cobranca_notificacao_entregas (
  id uuid primary key default gen_random_uuid(),
  notificacao_id uuid not null references public.cobranca_notificacoes (id) on delete cascade,
  canal text not null constraint cobranca_entregas_canal_check
    check (canal in ('email', 'whatsapp', 'correio_ar', 'cartorio_td', 'entrega_pessoal')),
  destino text,
  contato_id uuid references public.contatos (id) on delete set null,
  -- e-mail e WhatsApp saem pela fila do 05A; o ledger é preenchido quando ela despacha
  outbox_id uuid references public.mensagens_outbox (id) on delete set null,
  comunicacao_id uuid references public.comunicacoes (id) on delete set null,
  codigo_rastreio text,
  comprovante_path text,
  status text not null default 'pendente' constraint cobranca_entregas_status_check
    check (status in ('pendente', 'enviado', 'entregue', 'recusado', 'devolvido', 'falhou')),
  enviado_em timestamptz,
  confirmado_em timestamptz,
  observacao text,
  criado_por uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now()
);

create index cobranca_entregas_notificacao_idx on public.cobranca_notificacao_entregas (notificacao_id);
create index cobranca_entregas_outbox_idx on public.cobranca_notificacao_entregas (outbox_id) where outbox_id is not null;
create index cobranca_entregas_comunicacao_idx on public.cobranca_notificacao_entregas (comunicacao_id) where comunicacao_id is not null;

-- Registro de contato (ligação, visita, conversa): o que o celular pode fazer (§12).
create table public.cobranca_interacoes (
  id uuid primary key default gen_random_uuid(),
  cobranca_id uuid not null references public.cobrancas (id) on delete cascade,
  tipo text not null constraint cobranca_interacoes_tipo_check
    check (tipo in ('ligacao', 'whatsapp', 'email', 'reuniao', 'visita', 'nota')),
  resumo text not null constraint cobranca_interacoes_resumo_check check (length(btrim(resumo)) between 2 and 4000),
  usuario_id uuid references public.usuarios (id) on delete set null,
  ocorrida_em timestamptz not null default now(),
  criado_em timestamptz not null default now()
);

create index cobranca_interacoes_cobranca_idx on public.cobranca_interacoes (cobranca_id, ocorrida_em desc);

-- ─── §6 Apólice ─────────────────────────────────────────────────────────────

create table public.apolices (
  id uuid primary key default gen_random_uuid(),
  seguradora text not null default 'Atradius Crédito y Caución',
  numero text not null,
  segurado_cnpj text not null constraint apolices_segurado_check check (segurado_cnpj ~ '^[0-9]{14}$'),
  vigencia_inicio date not null,
  vigencia_fim date not null,
  percentagem_segurada numeric(5, 4) not null constraint apolices_pct_check check (percentagem_segurada > 0 and percentagem_segurada <= 1),
  periodo_espera_dias int not null,
  prazo_maximo_credito_dias int not null,
  periodo_max_prorrogacao_dias int not null,
  prazo_notificacao_apos_prorrogacao_dias int not null,
  prazo_envio_sinistro_meses int not null,
  prazo_documentos_complementares_dias int not null,
  franquia numeric(14, 2) not null,
  responsabilidade_maxima numeric(16, 2),
  ativa boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint apolices_vigencia_check check (vigencia_fim > vigencia_inicio),
  unique (numero, vigencia_inicio)
);

-- ─── §7 Sinistro (vem antes de apolice_prazos, que aponta para ele) ─────────

create table public.sinistros (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  apolice_id uuid not null references public.apolices (id),
  cobranca_id uuid references public.cobrancas (id) on delete set null,
  sacado_matriz_cnpj text not null constraint sinistros_sacado_check check (sacado_matriz_cnpj ~ '^[0-9]{14}$'),
  sacado_empresa_id uuid references public.empresas (id) on delete set null,
  causa text not null constraint sinistros_causa_check check (causa in ('mora_prolongada', 'insolvencia')),
  data_perda date not null,
  data_limite_envio date,
  valor_total_face numeric(14, 2) not null,
  valor_recebido_parcial numeric(14, 2) not null default 0,
  perda_segurada_estimada numeric(14, 2),
  indenizacao_estimada numeric(14, 2),
  -- a conta aberta, linha a linha (§7.3), exatamente como foi mostrada
  memoria_perda jsonb,
  indenizacao_recebida numeric(14, 2),
  estagio text not null default 'preparacao' constraint sinistros_estagio_check check (estagio in (
    'preparacao', 'notificado', 'enviado', 'em_analise', 'docs_pendentes',
    'aceito', 'recusado', 'indenizado', 'encerrado')),
  notificado_em date,
  enviado_em date,
  resposta_prevista_em date,
  respondido_em date,
  motivo_recusa text,
  modo_envio text not null default 'manual' constraint sinistros_modo_check check (modo_envio in ('manual', 'api')),
  protocolo_externo text,
  -- ausência de prova de entrega de alguma notificação, justificada para o envio (§4)
  justificativa_prova_entrega text,
  dossie_path text,
  dossie_hash text,
  dossie_gerado_em timestamptz,
  responsavel_id uuid references public.usuarios (id) on delete set null,
  criado_por uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now()
);

create index sinistros_estagio_idx on public.sinistros (estagio);
create index sinistros_sacado_idx on public.sinistros (sacado_matriz_cnpj);

create table public.sinistro_titulos (
  sinistro_id uuid references public.sinistros (id) on delete cascade,
  titulo_id uuid references public.titulos (id),
  valor_face numeric(14, 2) not null,
  valor_cedido numeric(14, 2),
  primary key (sinistro_id, titulo_id)
);

create table public.sinistro_documentos (
  id uuid primary key default gen_random_uuid(),
  sinistro_id uuid not null references public.sinistros (id) on delete cascade,
  item text not null constraint sinistro_documentos_item_check check (item ~ '^[a-p]$'),
  descricao text not null,
  obrigatorio boolean not null default true,
  -- quem produz: o sistema (auto), uma pessoa (upload) ou ninguém (n/a justificado)
  origem text not null default 'sistema'
    constraint sinistro_documentos_origem_check check (origem in ('sistema', 'upload', 'nao_aplicavel')),
  arquivo_path text,
  arquivo_hash text,
  justificativa_ausencia text,
  status text not null default 'pendente'
    constraint sinistro_documentos_status_check check (status in ('pendente', 'ok', 'nao_aplicavel')),
  anexado_por uuid references public.usuarios (id) on delete set null,
  anexado_em timestamptz,
  unique (sinistro_id, item),
  constraint sinistro_documentos_justificativa_check
    check (status <> 'nao_aplicavel' or not obrigatorio or length(btrim(coalesce(justificativa_ausencia, ''))) >= 5)
);

create table public.sinistro_solicitacoes (
  id uuid primary key default gen_random_uuid(),
  sinistro_id uuid not null references public.sinistros (id) on delete cascade,
  descricao text not null,
  solicitada_em date not null,
  prazo_em date not null,
  respondida_em date,
  status text not null default 'aberta'
    constraint sinistro_solicitacoes_status_check check (status in ('aberta', 'respondida', 'vencida'))
);

create table public.sinistro_custos (
  id uuid primary key default gen_random_uuid(),
  sinistro_id uuid references public.sinistros (id) on delete cascade,
  cobranca_id uuid references public.cobrancas (id) on delete set null,
  descricao text not null,
  valor numeric(14, 2) not null constraint sinistro_custos_valor_check check (valor > 0),
  data date not null,
  /*
   * A cl. 20700.20 só reembolsa custo de cobrança incorrido COM aprovação prévia ou
   * por instrução da seguradora. Custo sem ela entra no painel em vermelho como
   * "provável não reembolsável" — para o time parar de gastar às cegas.
   */
  aprovado_pela_seguradora boolean not null default false,
  aprovacao_referencia text,
  comprovante_path text,
  criado_por uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now(),
  constraint sinistro_custos_alvo_check check (sinistro_id is not null or cobranca_id is not null)
);

-- ─── §6.2 O relógio da apólice ──────────────────────────────────────────────

create table public.apolice_prazos (
  id uuid primary key default gen_random_uuid(),
  apolice_id uuid not null references public.apolices (id),
  titulo_id uuid not null references public.titulos (id),
  cobranca_id uuid references public.cobrancas (id) on delete set null,
  causa text not null default 'mora_prolongada'
    constraint apolice_prazos_causa_check check (causa in ('mora_prolongada', 'insolvencia')),
  vencimento_original date not null,
  data_parada_cobertura date not null,      -- D+60
  data_limite_notificacao date not null,    -- D+90
  data_perda date not null,                 -- D+180, ou a data da decisão na insolvência
  data_limite_sinistro date not null,       -- Data da Perda + 6 meses
  notificado_seguradora_em date,
  sinistro_id uuid references public.sinistros (id) on delete set null,
  status text not null default 'ativo'
    constraint apolice_prazos_status_check check (status in ('ativo', 'cumprido', 'perdido', 'encerrado_pagamento')),
  /*
   * §6.3 item 2 — é dinheiro. Pago até 30 dias depois de D+60, a cobertura volta
   * COM EFEITO RETROATIVO (cl. 17700.20 a); depois disso, volta só para recebíveis
   * cedidos APÓS a data do pagamento. `cobertura_volta_em` é a data que a tela mostra.
   */
  pago_em date,
  restabelecimento_retroativo boolean,
  cobertura_volta_em date,
  calculado_em timestamptz not null default now(),
  unique (titulo_id, apolice_id)
);

create index apolice_prazos_ativos_idx on public.apolice_prazos (status, data_limite_notificacao);
create index apolice_prazos_cobranca_idx on public.apolice_prazos (cobranca_id) where cobranca_id is not null;

/*
 * Insolvência (cl. 00300.00): a Data da Perda é a da decisão judicial, e o prazo de 6
 * meses corre dela. `fonte = 'juridico'` é a detecção automática por classe processual
 * (falência/recuperação) — ela usa a data de distribuição, que é ANTERIOR à decisão e
 * portanto encurta o prazo: errar para o lado seguro. `confirmada` pede à pessoa que
 * troque pela data da decisão.
 */
create table public.cobranca_insolvencias (
  id uuid primary key default gen_random_uuid(),
  sacado_matriz_cnpj text not null constraint cobranca_insolvencias_cnpj_check check (sacado_matriz_cnpj ~ '^[0-9]{14}$'),
  tipo text not null constraint cobranca_insolvencias_tipo_check
    check (tipo in ('recuperacao_judicial', 'falencia', 'outro')),
  data_decisao date not null,
  fonte text not null default 'manual' constraint cobranca_insolvencias_fonte_check check (fonte in ('manual', 'juridico')),
  numero_cnj text references public.processos (numero_cnj) on delete set null,
  confirmada boolean not null default false,
  observacao text,
  criado_por uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now(),
  unique (sacado_matriz_cnpj)
);

-- ─── §8 Protesto ────────────────────────────────────────────────────────────

create table public.protesto_remessas (
  id uuid primary key default gen_random_uuid(),
  cobranca_id uuid references public.cobrancas (id) on delete set null,
  tipo text not null default 'apresentacao'
    constraint protesto_remessas_tipo_check check (tipo in ('apresentacao', 'desistencia', 'cancelamento')),
  uf text not null constraint protesto_remessas_uf_check check (uf ~ '^[A-Z]{2}$'),
  cra text not null,
  modo text not null default 'portal_manual' constraint protesto_remessas_modo_check check (modo in ('portal_manual', 'api')),
  arquivo_path text,
  protocolo text,
  enviada_em timestamptz,
  status text not null default 'rascunho'
    constraint protesto_remessas_status_check check (status in ('rascunho', 'enviada', 'confirmada', 'rejeitada')),
  retorno_path text,
  retorno_processado_em timestamptz,
  criado_por uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now()
);

create index protesto_remessas_cobranca_idx on public.protesto_remessas (cobranca_id);

create table public.protesto_titulos (
  id uuid primary key default gen_random_uuid(),
  remessa_id uuid references public.protesto_remessas (id) on delete cascade,
  cobranca_titulo_id uuid references public.cobranca_titulos (id),
  cartorio text,
  protocolo_cartorio text,
  situacao text not null default 'enviado' constraint protesto_titulos_situacao_check check (situacao in (
    'enviado', 'apontado', 'protestado', 'pago_em_cartorio', 'retirado', 'sustado', 'rejeitado')),
  data_protesto date,
  certidao_path text,
  custas numeric(12, 2),
  motivo_rejeicao text,
  /*
   * §11 item 3: protesto não retirado depois de pago vira dano moral contra nós. A
   * regularização do sacado fica bloqueada até cada protesto ter a instrução de
   * cancelamento enviada — ou um motivo para não se aplicar.
   */
  instrucao_cancelamento_em timestamptz,
  instrucao_nao_aplicavel_motivo text,
  atualizado_em timestamptz not null default now()
);

create index protesto_titulos_remessa_idx on public.protesto_titulos (remessa_id);
create index protesto_titulos_cobranca_titulo_idx on public.protesto_titulos (cobranca_titulo_id);

-- ─── §9 Acordo ──────────────────────────────────────────────────────────────

create table public.acordos (
  id uuid primary key default gen_random_uuid(),
  cobranca_id uuid not null references public.cobrancas (id) on delete cascade,
  valor_atualizado numeric(14, 2) not null,
  memoria_calculo jsonb not null,
  entrada numeric(14, 2) not null default 0,
  qtd_parcelas int not null default 1 constraint acordos_parcelas_check check (qtd_parcelas between 1 and 360),
  periodicidade text not null default 'mensal'
    constraint acordos_periodicidade_check check (periodicidade in ('mensal', 'quinzenal', 'semanal')),
  juros_parcelamento_mes numeric(6, 4) not null default 0,
  sistema text not null default 'price' constraint acordos_sistema_check check (sistema in ('price', 'sac')),
  primeira_parcela date,
  valor_total_projetado numeric(14, 2),
  parcelas jsonb not null,
  modelo_minuta_id uuid references public.cobranca_modelos (id) on delete set null,
  -- blocos da minuta: avalistas, bem em garantia, foro e testemunhas (§9.3)
  dados_minuta jsonb not null default '{}'::jsonb,
  minuta_path text,
  minuta_hash text,
  documento_assinado_path text,
  status text not null default 'simulado'
    constraint acordos_status_check check (status in ('simulado', 'minuta_gerada', 'assinado', 'cancelado')),
  criado_por uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now()
);

create index acordos_cobranca_idx on public.acordos (cobranca_id, criado_em desc);

-- ─── §11 Bloqueio e regularização do sacado ─────────────────────────────────

alter table public.empresas add column bloqueio_cobranca boolean not null default false;
alter table public.empresas add column bloqueio_cobranca_motivo text;
alter table public.empresas add column bloqueio_cobranca_em timestamptz;
alter table public.empresas add column bloqueio_cobranca_cobranca_id uuid references public.cobrancas (id) on delete set null;
/*
 * §11 item 5: depois da regularização o limite NÃO volta sozinho. O limite
 * operacional mora na plataforma de produção; o que este lado guarda é a marca de
 * que a próxima decisão de crédito do grupo é uma revisão pós-inadimplência. Ela
 * cai quando uma análise nova é decidida (trigger na 0269f).
 */
alter table public.empresas add column credito_revisao_pos_inadimplencia boolean not null default false;
alter table public.empresas add column credito_revisao_desde timestamptz;

create index empresas_bloqueio_cobranca_idx on public.empresas (id) where bloqueio_cobranca;
