-- ============================================================================
-- 0143 — Jurídico: processos judiciais contra sacados devedores (Prompt 08)
--
-- ── O RECORTE, ANTES DE QUALQUER TABELA ─────────────────────────────────────
-- Este módulo é JUDICIAL e é contra SACADO DEVEDOR. Cobrança extrajudicial vem
-- no Prompt 07 e ainda não existe — `processos.vinculo_cobranca_id` está aqui,
-- sem FK, reservado para o dia em que existir. Processo em que não somos parte é
-- dado de risco do Radar, e não entra.
--
-- ── A ENTIDADE CENTRAL É O PROCESSO, E ELE CHEGA IMPORTADO ──────────────────
-- A empresa já tem ações em andamento. O fluxo começa buscando o que existe pelo
-- NOSSO CNPJ no Escavador, e não originando uma cobrança. Isso decide o modelo:
-- a chave primária é o `numero_cnj` (que é o identificador que já existe no mundo
-- e é o que o advogado fala em voz alta), e não um uuid nosso.
--
-- ── DUAS COLUNAS DE ESTADO QUE NÃO SE CONFUNDEM ─────────────────────────────
--   `status_predito`      classificação do ESCAVADOR sobre o andamento (ATIVO/INATIVO)
--   `situacao_interna`    onde NÓS colocamos o processo (em_andamento…encerrado)
-- Elas discordam com frequência, e é aí que está a informação: INATIVO no tribunal
-- e `em_andamento` aqui é um processo que parou e ninguém viu. Uma coluna só
-- apagaria exatamente essa pergunta.
--
-- ── O QUE VEM DO ESCAVADOR NUNCA É ESCRITO POR UMA PESSOA ───────────────────
-- Capa, movimentações e envolvidos são escritos SÓ pelo service role, no worker.
-- Não há RPC para editá-los. Um atalho de tela para "corrigir a data da citação"
-- produziria um cronograma que a próxima sincronização desfaz em silêncio — e o
-- cronograma é o que dispara alerta de lentidão e notificação ao advogado.
-- O que é escrito daqui é o que é NOSSO: gestão, operações cobradas, custos,
-- recuperações, prazos e o parecer.
--
-- ── DEFAULT PRIVILEGES ──────────────────────────────────────────────────────
-- O Supabase concede ALL a anon/authenticated em toda tabela nova de `public`.
-- Cada tabela abaixo revoga tudo antes de conceder o SELECT que precisa.
-- ============================================================================

-- ─── §4 Settings do módulo ──────────────────────────────────────────────────

create table public.juridico_config (
  chave text primary key,
  valor jsonb not null,
  atualizado_por uuid references public.usuarios (id) on delete set null,
  atualizado_em timestamptz not null default now()
);

comment on table public.juridico_config is
  'Settings do Jurídico: nossos CNPJs, agenda de monitoramento, benchmarks de fase, '
  'parâmetros de cálculo e regras do classificador. Mesmo desenho de credito_config. '
  'NENHUMA credencial entra aqui — a tabela é lida por authenticated.';

/*
 * O token do Escavador NÃO mora aqui, e essa é a mesma régua da 0138: settings é
 * lida por `authenticated` para a tela de configurações, e uma credencial ali
 * seria distribuída a todo mundo que tem o módulo. `ESCAVADOR_TOKEN` e
 * `ESCAVADOR_CALLBACK_TOKEN` vivem só em env — do worker e da web, nesta ordem.
 */

-- ─── §2 Advogados ───────────────────────────────────────────────────────────

create table public.advogados (
  id uuid primary key default gen_random_uuid(),
  nome text not null constraint advogados_nome_check check (length(btrim(nome)) between 2 and 160),
  tipo text not null constraint advogados_tipo_check check (tipo in ('interno', 'externo')),
  escritorio text,
  oab_numero text, oab_uf text
    constraint advogados_oab_uf_check check (oab_uf is null or oab_uf ~ '^[A-Z]{2}$'),
  email text, telefone text,
  /*
   * O elo com a plataforma, e é ele que faz o calendário funcionar: prazo e
   * audiência do 04g aparecem na agenda de QUEM, se o responsável for só um nome
   * digitado? `usuario_id` preenchido é o que transforma um responsável em
   * destinatário de notificação e em linha de calendário.
   *
   * Nulo é o caso normal do advogado EXTERNO — o escritório contratado não tem
   * (nem deve ter) sessão na plataforma.
   */
  usuario_id uuid references public.usuarios (id) on delete set null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index advogados_ativos_idx on public.advogados (ativo, nome);
create unique index advogados_usuario_idx on public.advogados (usuario_id) where usuario_id is not null;

create trigger advogados_atualizado_em
  before update on public.advogados
  for each row execute function set_atualizado_em();

-- ─── §2 O processo ──────────────────────────────────────────────────────────

create table public.processos (
  -- COM máscara, de propósito: é a forma que o advogado lê, digita e copia para a
  -- petição. Guardar 20 dígitos crus obrigaria toda tela a remontar a máscara e
  -- todo log a ser ilegível.
  numero_cnj text primary key
    constraint processos_cnj_check check (numero_cnj ~ '^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$'),

  -- ── partes ──
  /*
   * Resolvida pelo CNPJ do polo OPOSTO ao nosso, nunca por nome. "Construtora Alfa
   * Ltda" e "CONSTRUTORA ALFA LTDA - EM RECUPERAÇÃO JUDICIAL" são a mesma empresa
   * com dois nomes, e são empresas diferentes quando a razão social se parece por
   * acaso. Casar por nome penduraria o processo na ficha de quem nada tem com ele.
   *
   * NULO é um estado legítimo e esperado: o devedor pode não estar em `empresas`
   * ainda. A UI mostra a fila de vinculação manual, e o CNPJ fica em
   * `cnpj_devedor` para o lookup cadastral resolver depois.
   */
  empresa_devedora_id uuid references public.empresas (id) on delete set null,
  cnpj_devedor text constraint processos_cnpj_devedor_check check (cnpj_devedor is null or cnpj_devedor ~ '^[0-9]{14}$'),
  nosso_cnpj text constraint processos_nosso_cnpj_check check (nosso_cnpj is null or nosso_cnpj ~ '^[0-9]{14}$'),
  polo_nosso text constraint processos_polo_check check (polo_nosso is null or polo_nosso in ('ativo', 'passivo')),
  titulo_polo_ativo text, titulo_polo_passivo text,

  -- ── capa (consolidada da fonte de MENOR grau; as demais ficam em `raw`) ──
  classe text, assunto text, area text,
  orgao_julgador text, comarca text, uf text,
  tribunal_sigla text, tribunal_nome text, grau int, sistema text,
  valor_causa numeric(16, 2),
  data_distribuicao date, data_inicio date, data_arquivamento date,
  segredo_justica boolean, arquivado boolean, fisico boolean,
  status_predito text
    constraint processos_status_predito_check check (status_predito is null or status_predito in ('ATIVO', 'INATIVO')),
  url_tribunal text,

  -- ── gestão interna ──
  situacao_interna text not null default 'em_andamento'
    constraint processos_situacao_check
    check (situacao_interna in ('em_andamento', 'suspenso', 'acordo', 'ganho', 'perdido', 'encerrado')),
  advogado_id uuid references public.advogados (id) on delete set null,
  fase_atual text
    constraint processos_fase_check check (fase_atual is null or fase_atual in (
      'distribuicao', 'citacao', 'contestacao_embargos', 'instrucao', 'sentenca', 'recurso',
      'transito_julgado', 'cumprimento_execucao', 'penhora', 'leilao_expropriacao', 'arquivamento')),
  fase_desde date,
  observacoes text,
  /*
   * Reservado para o Prompt 07. SEM foreign key, de propósito: a tabela de cobrança
   * extrajudicial ainda não existe, e uma FK para o futuro é uma migração que não
   * roda. Quando o 07 chegar, a FK entra numa migração própria — e até lá a coluna
   * documenta a intenção sem fingir que há integridade referencial aqui.
   */
  vinculo_cobranca_id uuid,

  -- ── sync ──
  data_ultima_movimentacao date,
  qtd_movimentacoes int,
  data_ultima_verificacao timestamptz,
  ultima_sincronizacao timestamptz,
  /*
   * O payload cru do Escavador, INTEIRO. Não é preguiça de modelar: as `fontes[]`
   * de grau maior trazem a capa do recurso (outro órgão julgador, às vezes outro
   * valor da causa), e a consolidação escolhe uma. Guardar só a escolhida jogaria
   * fora a única prova de que a escolha foi essa — e é ela que responde "por que a
   * comarca está diferente do que aparece no site do tribunal?".
   */
  raw jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index processos_empresa_idx on public.processos (empresa_devedora_id);
create index processos_gestao_idx on public.processos (situacao_interna, fase_atual);
create index processos_cnpj_devedor_idx on public.processos (cnpj_devedor);
create index processos_advogado_idx on public.processos (advogado_id) where advogado_id is not null;
-- O painel ordena por última movimentação e a varredura de "processo parado" filtra
-- por ela. As duas varrem a carteira inteira.
create index processos_movimentacao_idx on public.processos (data_ultima_movimentacao desc nulls last);

create trigger processos_atualizado_em
  before update on public.processos
  for each row execute function set_atualizado_em();

comment on table public.processos is
  'Processo judicial em que uma entidade nossa é parte (08). Chave é o número CNJ com '
  'máscara. Capa e sync vêm do Escavador (service role); situação interna, advogado e '
  'observações são gestão nossa, por RPC.';
comment on column public.processos.status_predito is
  'Classificação do ESCAVADOR sobre o andamento no tribunal. Não confundir com '
  'situacao_interna, que é onde NÓS colocamos o processo. Quando as duas discordam, a '
  'discordância é a informação.';
comment on column public.processos.vinculo_cobranca_id is
  'Reservado para o Prompt 07 (cobrança extrajudicial). Sem FK: a tabela alvo ainda não '
  'existe.';

-- ─── §2 Movimentações ───────────────────────────────────────────────────────

create table public.processo_movimentacoes (
  /*
   * O id do ESCAVADOR é a chave primária, e é ele que torna o sync idempotente.
   * Um uuid nosso obrigaria a deduplicar por (cnj, data, conteúdo) — e o mesmo
   * andamento chega com texto ligeiramente diferente de duas fontes (graus
   * distintos), o que multiplicaria a timeline a cada rodada.
   */
  id bigint primary key,
  numero_cnj text not null references public.processos (numero_cnj) on delete cascade,
  data date not null,
  tipo text constraint processo_mov_tipo_check check (tipo is null or tipo in ('ANDAMENTO', 'PUBLICACAO')),
  conteudo text not null,
  fonte_nome text, fonte_sigla text, grau int,
  fase_detectada text
    constraint processo_mov_fase_check check (fase_detectada is null or fase_detectada in (
      'distribuicao', 'citacao', 'contestacao_embargos', 'instrucao', 'sentenca', 'recurso',
      'transito_julgado', 'cumprimento_execucao', 'penhora', 'leilao_expropriacao', 'arquivamento')),
  /*
   * Marcada pelo classificador, não por uma pessoa. "Relevante" aqui quer dizer
   * "muda o que se pode fazer amanhã de manhã" — citação, penhora, sentença — e é
   * o gatilho da notificação ao advogado. Deixar a marcação manual faria a
   * notificação depender de alguém já ter lido o que ela existe para avisar.
   */
  relevante boolean not null default false,
  /* Qual expressão da régua casou. É o "por quê?" da tela e da correção da regra. */
  termo_detectado text,
  criado_em timestamptz not null default now()
);

create index processo_mov_timeline_idx on public.processo_movimentacoes (numero_cnj, data desc);
create index processo_mov_relevantes_idx on public.processo_movimentacoes (numero_cnj, data desc) where relevante;

-- ─── §2 Envolvidos ──────────────────────────────────────────────────────────

create table public.processo_envolvidos (
  id uuid primary key default gen_random_uuid(),
  numero_cnj text not null references public.processos (numero_cnj) on delete cascade,
  nome text not null, tipo_pessoa text, cpf_cnpj text,
  tipo text, tipo_normalizado text, polo text,
  advogados jsonb not null default '[]'::jsonb,
  atualizado_em timestamptz not null default now(),
  -- A chave natural inclui o POLO: a mesma empresa pode figurar nos dois polos em
  -- ações conexas, e colapsá-las apagaria metade da relação.
  constraint processo_envolvidos_unico unique (numero_cnj, nome, polo)
);

create index processo_envolvidos_doc_idx on public.processo_envolvidos (cpf_cnpj) where cpf_cnpj is not null;

-- ─── §2 Operações cobradas (o que estamos executando) ───────────────────────

create table public.processo_operacoes (
  id uuid primary key default gen_random_uuid(),
  numero_cnj text not null references public.processos (numero_cnj) on delete cascade,
  -- Os dois ponteiros são OPCIONAIS e não excludentes: a execução pode ser de uma
  -- antecipação (04e), da NF que a originou (04), ou de um título que não passou
  -- por nenhuma das duas. Exigir um deles deixaria de fora justamente o caso em
  -- que a dívida veio de fora da plataforma.
  antecipacao_id_externo int references public.antecipacoes (id_externo) on delete set null,
  access_key text references public.notas_fiscais (access_key) on delete set null,
  valor_original numeric(14, 2) not null constraint processo_operacoes_valor_check check (valor_original > 0),
  vencimento date not null,
  descricao text,
  criado_por uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now()
);

create index processo_operacoes_processo_idx on public.processo_operacoes (numero_cnj);

-- ─── §6 Cálculo da dívida (memória versionada, nunca sobrescrita) ───────────

create table public.processo_calculos (
  id uuid primary key default gen_random_uuid(),
  numero_cnj text not null references public.processos (numero_cnj) on delete cascade,
  data_calculo date not null default current_date,
  data_base date not null,
  /*
   * A CÓPIA dos parâmetros, e nunca uma referência à configuração vigente. A taxa
   * de juros da casa muda; o cálculo de março continua sendo o de março. Sem a
   * cópia, reabrir um cálculo antigo mostra um total que ninguém reproduz.
   */
  parametros jsonb not null,
  principal numeric(14, 2), correcao numeric(14, 2), juros numeric(14, 2),
  multa numeric(14, 2), honorarios numeric(14, 2), custas numeric(14, 2),
  total numeric(14, 2) not null,
  /* Linha a linha, por operação, COM o fator aplicado — é o que se junta aos autos. */
  memoria jsonb not null,
  gerado_por uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now()
);

-- Histórico PRESERVADO: a tela mostra o mais recente e a lista dos anteriores.
create index processo_calculos_serie_idx on public.processo_calculos (numero_cnj, criado_em desc);

comment on table public.processo_calculos is
  'Append-only. Um cálculo é a memória que sustentou uma petição numa data — '
  'sobrescrever apagaria a conta que a parte contrária está atacando.';

-- ─── §2 Custos incorridos e recuperações recebidas ──────────────────────────

create table public.processo_custos (
  id uuid primary key default gen_random_uuid(),
  numero_cnj text not null references public.processos (numero_cnj) on delete cascade,
  tipo text not null
    constraint processo_custos_tipo_check check (tipo in ('custas', 'honorarios', 'pericia', 'diligencia', 'outros')),
  descricao text,
  valor numeric(12, 2) not null constraint processo_custos_valor_check check (valor > 0),
  data date not null,
  -- CAMINHO no bucket privado `juridico-comprovantes`, nunca uma URL pública: um
  -- comprovante de custas carrega número de processo, valor e as partes.
  comprovante_url text,
  registrado_por uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now()
);

create index processo_custos_processo_idx on public.processo_custos (numero_cnj, data desc);

create table public.processo_recuperacoes (
  id uuid primary key default gen_random_uuid(),
  numero_cnj text not null references public.processos (numero_cnj) on delete cascade,
  valor numeric(14, 2) not null constraint processo_recuperacoes_valor_check check (valor > 0),
  data date not null,
  origem text not null
    constraint processo_recuperacoes_origem_check
    check (origem in ('penhora', 'acordo', 'pagamento_espontaneo', 'leilao')),
  observacao text,
  registrado_por uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now()
);

create index processo_recuperacoes_processo_idx on public.processo_recuperacoes (numero_cnj, data desc);

-- ─── §2 Prazos e audiências (alimentam o calendário do 04g) ─────────────────

create table public.processo_prazos (
  id uuid primary key default gen_random_uuid(),
  numero_cnj text not null references public.processos (numero_cnj) on delete cascade,
  tipo text not null
    constraint processo_prazos_tipo_check check (tipo in ('prazo', 'audiencia', 'pericia')),
  descricao text not null,
  -- timestamptz porque audiência tem HORA, e um prazo às 23h59 do dia é outro dia
  -- em UTC. `date` faria a agenda mostrar a audiência da manhã no dia anterior.
  data timestamptz not null,
  responsavel_id uuid references public.advogados (id) on delete set null,
  concluido boolean not null default false,
  concluido_em timestamptz,
  -- D-3 e D-1 são dois avisos, e o job precisa saber qual já saiu para não repetir
  -- o mesmo alerta todo dia até a data chegar.
  avisado_d3_em timestamptz,
  avisado_d1_em timestamptz,
  criado_por uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now()
);

create index processo_prazos_agenda_idx on public.processo_prazos (data) where not concluido;
create index processo_prazos_processo_idx on public.processo_prazos (numero_cnj, data);
create index processo_prazos_responsavel_idx on public.processo_prazos (responsavel_id, data) where not concluido;

-- ─── §7 Pareceres de IA ─────────────────────────────────────────────────────

create table public.processo_pareceres (
  id uuid primary key default gen_random_uuid(),
  numero_cnj text not null references public.processos (numero_cnj) on delete cascade,
  parecer_markdown text not null,
  proximo_passo text not null,
  risco text constraint processo_pareceres_risco_check check (risco is null or risco in ('baixo', 'medio', 'alto')),
  modelo text, tokens int,
  -- true quando a linha nasceu de uma edição humana sobre um parecer gerado. A tela
  -- precisa distinguir "o modelo disse" de "o advogado escreveu" — misturar os dois
  -- é como um texto de IA vira citação de autoridade.
  editado boolean not null default false,
  gerado_por uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now()
);

-- Versionado: a tela mostra o mais recente e a lista dos anteriores. A recomendação
-- que sustentou a decisão de continuar gastando com a ação é justamente a que
-- alguém vai querer reler quando a decisão for questionada.
create index processo_pareceres_serie_idx on public.processo_pareceres (numero_cnj, criado_em desc);

-- ─── §3 Log de sincronização e contabilização de créditos ───────────────────

create table public.juridico_sync_log (
  id uuid primary key default gen_random_uuid(),
  tipo text not null
    constraint juridico_sync_log_tipo_check
    check (tipo in ('busca_cnpj', 'atualizacao_processo', 'callback', 'monitoramento')),
  numero_cnj text, cnpj text,
  status text, creditos_utilizados int not null default 0,
  erro text,
  executado_em timestamptz not null default now()
);

create index juridico_sync_log_recente_idx on public.juridico_sync_log (executado_em desc);
create index juridico_sync_log_tipo_idx on public.juridico_sync_log (tipo, executado_em desc);

comment on table public.juridico_sync_log is
  'Uma linha por requisição ao Escavador, com o header Creditos-Utilizados. É a única '
  'fonte do gasto acumulado — a API não tem extrato consultável, e sem isto o custo do '
  'módulo só apareceria na fatura.';

/*
 * Callbacks: a idempotência é uma TABELA, não um "já vi isso?" em memória.
 *
 * O Escavador reenvia o mesmo callback até 11 vezes com backoff. Sem chave única
 * por `uuid` do payload, `novo_processo` criaria o processo, notificaria os
 * gestores e voltaria a notificar dez vezes ao longo de horas — e o segundo aviso
 * é o que ensina a ignorar o primeiro.
 */
create table public.juridico_callbacks (
  uuid text primary key,
  evento text not null,
  numero_cnj text,
  payload jsonb not null,
  recebido_em timestamptz not null default now(),
  processado_em timestamptz,
  erro text
);

create index juridico_callbacks_pendentes_idx on public.juridico_callbacks (recebido_em)
  where processado_em is null;

-- ─── §6 Tabela de índices mensais ───────────────────────────────────────────

create table public.juridico_indices (
  indice text not null
    constraint juridico_indices_indice_check check (indice in ('ipca', 'igpm', 'inpc', 'tr', 'customizado')),
  -- AAAA-MM. Texto e não `date` porque a unidade É o mês: um `date` convidaria a
  -- gravar dois dias do mesmo mês com valores diferentes, e o cálculo leria um dos
  -- dois sem dizer qual.
  competencia text not null
    constraint juridico_indices_competencia_check check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- Variação DO MÊS, em percentual (0.45 = 0,45%). Negativa é legítima (deflação).
  valor numeric(8, 4) not null,
  atualizado_por uuid references public.usuarios (id) on delete set null,
  atualizado_em timestamptz not null default now(),
  primary key (indice, competencia)
);

comment on table public.juridico_indices is
  'Variação mensal dos índices de correção, editável e importável. Não é buscada em API '
  'no meio do cálculo de propósito: uma memória juntada aos autos tem de ser reproduzível '
  'daqui a dois anos, e um índice revisado na fonte mudaria um número já protocolado.';

-- ─── RLS ────────────────────────────────────────────────────────────────────
--
-- `(select ...)` em volta das funções STABLE não é enfeite: sem ele o Postgres
-- chama `app_tem_modulo()` UMA VEZ POR LINHA VARRIDA, e a timeline de um processo
-- movimentado tem centenas. Com o select vira InitPlan — uma chamada por consulta.
-- (Mesma correção da 0131.)

alter table public.juridico_config          enable row level security;
alter table public.advogados                enable row level security;
alter table public.processos                enable row level security;
alter table public.processo_movimentacoes   enable row level security;
alter table public.processo_envolvidos      enable row level security;
alter table public.processo_operacoes       enable row level security;
alter table public.processo_calculos        enable row level security;
alter table public.processo_custos          enable row level security;
alter table public.processo_recuperacoes    enable row level security;
alter table public.processo_prazos          enable row level security;
alter table public.processo_pareceres       enable row level security;
alter table public.juridico_sync_log        enable row level security;
alter table public.juridico_callbacks       enable row level security;
alter table public.juridico_indices         enable row level security;

/*
 * `processos` é lida por quem tem `juridico` OU `empresas`, e as demais só por
 * `juridico`.
 *
 * A Company 360 mostra a seção "Jurídico" com os processos daquela empresa e o
 * valor em disputa (§8) — e ela é aberta pelo comercial, pelo crédito, por quem
 * trabalha a conta. Saber que existe ação contra o sacado é exatamente o que muda
 * a conversa que essa pessoa vai ter hoje.
 *
 * O CONTEÚDO, não. Movimentação processual é texto de tribunal sobre o mérito, e
 * parecer é análise de risco da própria casa. Nenhum dos dois é matéria de quem
 * abriu a ficha para ver o telefone do contato. A fronteira é "existe e vale
 * tanto" contra "eis o que está acontecendo lá dentro".
 */
create policy processos_select on public.processos
  for select to authenticated
  using ((select public.app_tem_modulo('juridico')) or (select public.app_tem_modulo('empresas')));

create policy juridico_config_select on public.juridico_config
  for select to authenticated using ((select public.app_tem_modulo('juridico')));

create policy advogados_select on public.advogados
  for select to authenticated using ((select public.app_tem_modulo('juridico')));

create policy processo_movimentacoes_select on public.processo_movimentacoes
  for select to authenticated using ((select public.app_tem_modulo('juridico')));

create policy processo_envolvidos_select on public.processo_envolvidos
  for select to authenticated using ((select public.app_tem_modulo('juridico')));

create policy processo_operacoes_select on public.processo_operacoes
  for select to authenticated using ((select public.app_tem_modulo('juridico')));

create policy processo_calculos_select on public.processo_calculos
  for select to authenticated using ((select public.app_tem_modulo('juridico')));

create policy processo_custos_select on public.processo_custos
  for select to authenticated using ((select public.app_tem_modulo('juridico')));

create policy processo_recuperacoes_select on public.processo_recuperacoes
  for select to authenticated using ((select public.app_tem_modulo('juridico')));

create policy processo_prazos_select on public.processo_prazos
  for select to authenticated using ((select public.app_tem_modulo('juridico')));

create policy processo_pareceres_select on public.processo_pareceres
  for select to authenticated using ((select public.app_tem_modulo('juridico')));

create policy juridico_indices_select on public.juridico_indices
  for select to authenticated using ((select public.app_tem_modulo('juridico')));

-- O log de sync é gasto de dinheiro: quem administra o módulo precisa vê-lo na
-- tela de configurações, e é ele que justifica ligar ou desligar a atualização
-- forçada no tribunal (§4).
create policy juridico_sync_log_select on public.juridico_sync_log
  for select to authenticated using ((select public.app_tem_modulo('juridico')));

/*
 * `juridico_callbacks` fica SEM POLICY NENHUMA, e com ALL revogado.
 *
 * Ela guarda o payload cru que o Escavador manda, e a chave de idempotência. Nada
 * ali é matéria de tela: o que interessa ao usuário já foi projetado em
 * `processos` e em `juridico_sync_log`. Uma tabela de fila que ninguém lê pela UI
 * não precisa de policy — precisa de ser inalcançável.
 */
revoke all on public.juridico_callbacks from anon, authenticated, public;

revoke all on
  public.juridico_config, public.advogados, public.processos,
  public.processo_movimentacoes, public.processo_envolvidos, public.processo_operacoes,
  public.processo_calculos, public.processo_custos, public.processo_recuperacoes,
  public.processo_prazos, public.processo_pareceres, public.juridico_sync_log,
  public.juridico_indices
from anon, authenticated;

grant select on
  public.juridico_config, public.advogados, public.processos,
  public.processo_movimentacoes, public.processo_envolvidos, public.processo_operacoes,
  public.processo_calculos, public.processo_custos, public.processo_recuperacoes,
  public.processo_prazos, public.processo_pareceres, public.juridico_sync_log,
  public.juridico_indices
to authenticated;

-- ─── §8 Bucket privado dos comprovantes de custas ───────────────────────────
--
-- Um comprovante de custas carrega número do processo, valor e as partes. Bucket
-- privado, 10 MB, imagem ou PDF — os limites no BUCKET, porque uma checagem em
-- JavaScript é uma sugestão (mesma régua da 0141).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('juridico-comprovantes', 'juridico-comprovantes', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

create policy juridico_comprovantes_select on storage.objects
  for select to authenticated
  using (bucket_id = 'juridico-comprovantes' and (select public.app_tem_modulo('juridico')));

create policy juridico_comprovantes_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'juridico-comprovantes' and (select public.app_tem_modulo('juridico')));

create policy juridico_comprovantes_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'juridico-comprovantes' and (select public.app_tem_modulo('juridico')));

-- ─── §8 A carteira: uma linha por processo, com o que a lista precisa ───────
--
-- `security_invoker`, como toda view de leitura do projeto: a RLS de `processos`
-- decide o que sai, e não a permissão de quem criou a view.
--
-- Os agregados vêm de LATERAIS e não de subselects correlacionados no SELECT: a
-- lista ordena por valor atualizado, e um subselect por coluna faria três
-- varreduras por linha em vez de uma.

create or replace view public.juridico_carteira
with (security_invoker = true) as
  select
    p.numero_cnj,
    p.empresa_devedora_id,
    p.cnpj_devedor,
    coalesce(e.razao_social, e.nome_fantasia, p.titulo_polo_passivo) as devedor_nome,
    p.nosso_cnpj,
    p.polo_nosso,
    p.classe,
    p.assunto,
    p.comarca,
    p.uf,
    p.tribunal_sigla,
    p.orgao_julgador,
    p.valor_causa,
    p.data_distribuicao,
    p.situacao_interna,
    p.status_predito,
    p.arquivado,
    p.fase_atual,
    p.fase_desde,
    p.advogado_id,
    a.nome as advogado_nome,
    a.usuario_id as advogado_usuario_id,
    p.data_ultima_movimentacao,
    p.qtd_movimentacoes,
    p.ultima_sincronizacao,

    -- Dias na fase e desde a última movimentação. Em DIAS e não em datas porque a
    -- pergunta da lista é "está parado há quanto tempo?", e escrever isso com uma
    -- data obriga quem lê a fazer a conta de cabeça — em toda linha.
    case when p.fase_desde is null then null
         else greatest(0, (current_date - p.fase_desde))::int end as dias_na_fase,
    case when p.data_ultima_movimentacao is null then null
         else greatest(0, (current_date - p.data_ultima_movimentacao))::int end as dias_sem_movimentacao,

    calc.total as valor_atualizado,
    calc.criado_em as calculo_em,
    coalesce(rec.total, 0) as recuperado,
    coalesce(cus.total, 0) as custo_acumulado,
    -- O SALDO LÍQUIDO (§8): recuperado − custos. É o número que responde "esta ação
    -- está pagando o próprio custo?", e ele não existe em nenhuma das duas somas
    -- isoladas — que é como uma carteira inteira de execuções deficitárias passa
    -- despercebida com um "recuperado" bonito no topo.
    coalesce(rec.total, 0) - coalesce(cus.total, 0) as saldo_liquido,
    coalesce(ops.qtd, 0) as qtd_operacoes,
    coalesce(ops.total, 0) as valor_operacoes,
    prox.data as proximo_prazo_em,
    prox.descricao as proximo_prazo
  from public.processos p
    left join public.empresas e on e.id = p.empresa_devedora_id
    left join public.advogados a on a.id = p.advogado_id
    left join lateral (
      select c.total, c.criado_em
      from public.processo_calculos c
      where c.numero_cnj = p.numero_cnj
      order by c.criado_em desc
      limit 1
    ) calc on true
    left join lateral (
      select sum(r.valor) as total from public.processo_recuperacoes r where r.numero_cnj = p.numero_cnj
    ) rec on true
    left join lateral (
      select sum(x.valor) as total from public.processo_custos x where x.numero_cnj = p.numero_cnj
    ) cus on true
    left join lateral (
      select count(*)::int as qtd, sum(o.valor_original) as total
      from public.processo_operacoes o where o.numero_cnj = p.numero_cnj
    ) ops on true
    left join lateral (
      select pr.data, pr.descricao
      from public.processo_prazos pr
      where pr.numero_cnj = p.numero_cnj and not pr.concluido and pr.data >= now()
      order by pr.data
      limit 1
    ) prox on true;

grant select on public.juridico_carteira to authenticated;

comment on view public.juridico_carteira is
  'Uma linha por processo com devedor, fase, dias parado, valor atualizado do último '
  'cálculo e o SALDO LÍQUIDO (recuperado − custos). security_invoker: a RLS de processos '
  'é quem decide o que sai.';

-- ─── §9 A agenda jurídica, no formato do calendário do 04g ──────────────────
--
-- O calendário do Comercial lê `vendedor_eventos`, que pende de `vendedores`. Um
-- prazo processual não pende de vendedor nenhum — pende de um ADVOGADO, que às
-- vezes é usuário da plataforma e às vezes é um escritório externo.
--
-- Por isso uma view própria com as MESMAS colunas de leitura que a tela do
-- calendário já consome (`inicio_em`, `titulo`, `tipo`), em vez de enfiar prazo
-- em `vendedor_eventos` com um `vendedor_id` inventado. A tela une as duas fontes;
-- o banco não finge que audiência é reunião comercial.

create or replace view public.juridico_agenda
with (security_invoker = true) as
  select
    pr.id,
    pr.numero_cnj,
    pr.tipo,
    pr.descricao as titulo,
    pr.data as inicio_em,
    pr.concluido,
    pr.responsavel_id,
    a.nome as responsavel_nome,
    a.usuario_id as responsavel_usuario_id,
    p.empresa_devedora_id,
    coalesce(e.razao_social, e.nome_fantasia, p.titulo_polo_passivo) as devedor_nome
  from public.processo_prazos pr
    join public.processos p on p.numero_cnj = pr.numero_cnj
    left join public.advogados a on a.id = pr.responsavel_id
    left join public.empresas e on e.id = p.empresa_devedora_id;

grant select on public.juridico_agenda to authenticated;

-- ─── Escrita: um RPC por operação, e nenhum grant de INSERT/UPDATE ─────────
--
-- `authenticated` recebe SELECT e nada mais em todas as tabelas acima. Não há
-- policy de escrita porque não há GRANT de escrita: toda mutação passa por uma
-- função SECURITY DEFINER que autoriza por dentro e grava o `audit_log` na MESMA
-- transação. Três inserts sequenciais do supabase-js seriam três transações, e um
-- erro no meio deixaria um custo lançado sem registro de quem lançou.

create or replace function public.app_juridico_exige_modulo()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.app_tem_modulo('juridico') then
    raise exception 'Você não tem acesso ao módulo Jurídico.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.app_juridico_salvar_advogado(p jsonb)
returns public.advogados
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_row public.advogados;
  v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  perform public.app_juridico_exige_modulo();

  if v_id is null then
    insert into public.advogados (nome, tipo, escritorio, oab_numero, oab_uf, email, telefone, usuario_id, ativo)
    values (
      btrim(p ->> 'nome'), p ->> 'tipo',
      nullif(btrim(p ->> 'escritorio'), ''), nullif(btrim(p ->> 'oab_numero'), ''),
      upper(nullif(btrim(p ->> 'oab_uf'), '')), nullif(btrim(p ->> 'email'), ''),
      nullif(btrim(p ->> 'telefone'), ''), nullif(p ->> 'usuario_id', '')::uuid,
      coalesce((p ->> 'ativo')::boolean, true))
    returning * into v_row;
  else
    update public.advogados set
      nome = btrim(p ->> 'nome'),
      tipo = p ->> 'tipo',
      escritorio = nullif(btrim(p ->> 'escritorio'), ''),
      oab_numero = nullif(btrim(p ->> 'oab_numero'), ''),
      oab_uf = upper(nullif(btrim(p ->> 'oab_uf'), '')),
      email = nullif(btrim(p ->> 'email'), ''),
      telefone = nullif(btrim(p ->> 'telefone'), ''),
      usuario_id = nullif(p ->> 'usuario_id', '')::uuid,
      ativo = coalesce((p ->> 'ativo')::boolean, true)
    where id = v_id
    returning * into v_row;

    if v_row.id is null then
      raise exception 'Advogado não encontrado.' using errcode = 'P0002';
    end if;
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, case when v_id is null then 'advogado.criado' else 'advogado.atualizado' end,
          'advogados', v_row.id::text, jsonb_build_object('nome', v_row.nome, 'tipo', v_row.tipo));

  return v_row;
end;
$$;

/*
 * Gestão do processo. NÃO toca capa nem sync — só as quatro colunas que são
 * decisão humana.
 *
 * O padrão `p ? 'chave'` distingue "não mandaram" de "mandaram vazio": a chave
 * ausente mantém o que estava; a chave com null LIMPA. Sem essa distinção não
 * haveria como desvincular um advogado posto por engano, e salvar só a situação
 * apagaria o responsável.
 */
create or replace function public.app_juridico_atualizar_processo(p jsonb)
returns public.processos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_antes public.processos;
  v_row public.processos;
  v_cnj text := p ->> 'numero_cnj';
begin
  perform public.app_juridico_exige_modulo();

  select * into v_antes from public.processos where numero_cnj = v_cnj;
  if v_antes.numero_cnj is null then
    raise exception 'Processo não encontrado.' using errcode = 'P0002';
  end if;

  update public.processos set
    situacao_interna = coalesce(nullif(btrim(p ->> 'situacao_interna'), ''), v_antes.situacao_interna),
    advogado_id = case when p ? 'advogado_id' then nullif(p ->> 'advogado_id', '')::uuid else v_antes.advogado_id end,
    observacoes = case when p ? 'observacoes' then nullif(btrim(p ->> 'observacoes'), '') else v_antes.observacoes end,
    empresa_devedora_id = case when p ? 'empresa_devedora_id'
                               then nullif(p ->> 'empresa_devedora_id', '')::uuid
                               else v_antes.empresa_devedora_id end
  where numero_cnj = v_cnj
  returning * into v_row;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'processo.atualizado', 'processos', v_cnj,
    jsonb_build_object(
      'situacao_anterior', v_antes.situacao_interna, 'situacao', v_row.situacao_interna,
      'advogado_anterior', v_antes.advogado_id, 'advogado', v_row.advogado_id,
      'empresa_anterior', v_antes.empresa_devedora_id, 'empresa', v_row.empresa_devedora_id));

  /*
   * O evento de encerramento sai daqui, e só quando a situação MUDOU para um fim
   * de linha. Emitir a cada "salvar" faria a timeline da empresa registrar dez
   * encerramentos do mesmo processo — e é a timeline que responde "o que
   * aconteceu com esta conta?".
   */
  if v_row.situacao_interna is distinct from v_antes.situacao_interna
     and v_row.situacao_interna in ('ganho', 'perdido', 'encerrado') then
    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (v_row.empresa_devedora_id, 'processo.encerrado',
      jsonb_build_object(
        'titulo', 'Processo encerrado',
        'resumo', 'Processo ' || v_cnj || ' passou para "' || v_row.situacao_interna || '".',
        'url', '/juridico/' || v_cnj,
        'numero_cnj', v_cnj, 'situacao', v_row.situacao_interna),
      v_ator);
  end if;

  return v_row;
end;
$$;

create or replace function public.app_juridico_salvar_operacao(p jsonb)
returns public.processo_operacoes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_row public.processo_operacoes;
  v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  perform public.app_juridico_exige_modulo();

  if v_id is null then
    insert into public.processo_operacoes
      (numero_cnj, antecipacao_id_externo, access_key, valor_original, vencimento, descricao, criado_por)
    values (
      p ->> 'numero_cnj', nullif(p ->> 'antecipacao_id_externo', '')::int,
      nullif(btrim(p ->> 'access_key'), ''), (p ->> 'valor_original')::numeric,
      (p ->> 'vencimento')::date, nullif(btrim(p ->> 'descricao'), ''), v_ator)
    returning * into v_row;
  else
    update public.processo_operacoes set
      antecipacao_id_externo = nullif(p ->> 'antecipacao_id_externo', '')::int,
      access_key = nullif(btrim(p ->> 'access_key'), ''),
      valor_original = (p ->> 'valor_original')::numeric,
      vencimento = (p ->> 'vencimento')::date,
      descricao = nullif(btrim(p ->> 'descricao'), '')
    where id = v_id
    returning * into v_row;

    if v_row.id is null then
      raise exception 'Operação não encontrada.' using errcode = 'P0002';
    end if;
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'processo.operacao_salva', 'processo_operacoes', v_row.id::text,
          jsonb_build_object('numero_cnj', v_row.numero_cnj, 'valor', v_row.valor_original));

  return v_row;
end;
$$;

create or replace function public.app_juridico_remover_operacao(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_row public.processo_operacoes;
begin
  perform public.app_juridico_exige_modulo();

  delete from public.processo_operacoes where id = (p ->> 'id')::uuid returning * into v_row;
  if v_row.id is null then
    raise exception 'Operação não encontrada.' using errcode = 'P0002';
  end if;

  /*
   * A operação sai da carteira do processo, mas os CÁLCULOS já gerados ficam como
   * estão — eles são memória de uma data, não uma consulta viva. Recalcular
   * retroativamente mudaria um número que já foi protocolado.
   */
  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'processo.operacao_removida', 'processo_operacoes', v_row.id::text,
          jsonb_build_object('numero_cnj', v_row.numero_cnj, 'valor', v_row.valor_original));

  return jsonb_build_object('ok', true, 'numero_cnj', v_row.numero_cnj);
end;
$$;

create or replace function public.app_juridico_registrar_custo(p jsonb)
returns public.processo_custos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_row public.processo_custos;
  v_anexo text := nullif(btrim(p ->> 'comprovante_url'), '');
begin
  perform public.app_juridico_exige_modulo();

  -- O comprovante é aceito só dentro da pasta do processo. A policy do Storage já
  -- exige o módulo no upload; repetir o formato aqui impede que alguém registre no
  -- custo o caminho de um arquivo de outro processo e ganhe uma URL assinada.
  if v_anexo is not null and v_anexo !~ ('^' || replace(p ->> 'numero_cnj', '.', '\.') || '/') then
    raise exception 'Comprovante fora da pasta deste processo.' using errcode = '42501';
  end if;

  insert into public.processo_custos (numero_cnj, tipo, descricao, valor, data, comprovante_url, registrado_por)
  values (p ->> 'numero_cnj', p ->> 'tipo', nullif(btrim(p ->> 'descricao'), ''),
          (p ->> 'valor')::numeric, (p ->> 'data')::date, v_anexo, v_ator)
  returning * into v_row;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'processo.custo_registrado', 'processo_custos', v_row.id::text,
          jsonb_build_object('numero_cnj', v_row.numero_cnj, 'tipo', v_row.tipo, 'valor', v_row.valor));

  return v_row;
end;
$$;

create or replace function public.app_juridico_registrar_recuperacao(p jsonb)
returns public.processo_recuperacoes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_row public.processo_recuperacoes;
  v_empresa uuid;
begin
  perform public.app_juridico_exige_modulo();

  insert into public.processo_recuperacoes (numero_cnj, valor, data, origem, observacao, registrado_por)
  values (p ->> 'numero_cnj', (p ->> 'valor')::numeric, (p ->> 'data')::date,
          p ->> 'origem', nullif(btrim(p ->> 'observacao'), ''), v_ator)
  returning * into v_row;

  select empresa_devedora_id into v_empresa from public.processos where numero_cnj = v_row.numero_cnj;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'recuperacao.registrada', 'processo_recuperacoes', v_row.id::text,
          jsonb_build_object('numero_cnj', v_row.numero_cnj, 'valor', v_row.valor, 'origem', v_row.origem));

  -- Dinheiro entrando é notícia da empresa inteira, não só do Jurídico: é o único
  -- evento deste módulo que muda o resultado da conta.
  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_empresa, 'recuperacao.registrada',
    jsonb_build_object(
      'titulo', 'Recuperação registrada',
      'resumo', 'R$ ' || to_char(v_row.valor, 'FM999G999G999D00') || ' por ' || v_row.origem ||
                ' no processo ' || v_row.numero_cnj || '.',
      'url', '/juridico/' || v_row.numero_cnj,
      'numero_cnj', v_row.numero_cnj, 'valor', v_row.valor, 'origem', v_row.origem),
    v_ator);

  return v_row;
end;
$$;

create or replace function public.app_juridico_salvar_prazo(p jsonb)
returns public.processo_prazos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_row public.processo_prazos;
  v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  perform public.app_juridico_exige_modulo();

  if v_id is null then
    insert into public.processo_prazos (numero_cnj, tipo, descricao, data, responsavel_id, criado_por)
    values (p ->> 'numero_cnj', p ->> 'tipo', btrim(p ->> 'descricao'),
            (p ->> 'data')::timestamptz, nullif(p ->> 'responsavel_id', '')::uuid, v_ator)
    returning * into v_row;
  else
    /*
     * Mudar a DATA zera os avisos já enviados. Uma audiência remarcada de outubro
     * para dezembro com `avisado_d3_em` preenchido nunca mais avisaria ninguém — e
     * o silêncio seria indistinguível de "ainda falta muito".
     */
    update public.processo_prazos set
      tipo = p ->> 'tipo',
      descricao = btrim(p ->> 'descricao'),
      data = (p ->> 'data')::timestamptz,
      responsavel_id = nullif(p ->> 'responsavel_id', '')::uuid,
      avisado_d3_em = case when (p ->> 'data')::timestamptz is distinct from data then null else avisado_d3_em end,
      avisado_d1_em = case when (p ->> 'data')::timestamptz is distinct from data then null else avisado_d1_em end
    where id = v_id
    returning * into v_row;

    if v_row.id is null then
      raise exception 'Prazo não encontrado.' using errcode = 'P0002';
    end if;
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, case when v_id is null then 'prazo.criado' else 'prazo.atualizado' end,
          'processo_prazos', v_row.id::text,
          jsonb_build_object('numero_cnj', v_row.numero_cnj, 'tipo', v_row.tipo, 'data', v_row.data));

  return v_row;
end;
$$;

create or replace function public.app_juridico_concluir_prazo(p jsonb)
returns public.processo_prazos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_row public.processo_prazos;
  v_concluido boolean := coalesce((p ->> 'concluido')::boolean, true);
begin
  perform public.app_juridico_exige_modulo();

  update public.processo_prazos
     set concluido = v_concluido,
         concluido_em = case when v_concluido then now() else null end
   where id = (p ->> 'id')::uuid
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Prazo não encontrado.' using errcode = 'P0002';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'prazo.concluido', 'processo_prazos', v_row.id::text,
          jsonb_build_object('numero_cnj', v_row.numero_cnj, 'concluido', v_concluido));

  return v_row;
end;
$$;

/*
 * O cálculo é GRAVADO daqui, mas não é CALCULADO aqui.
 *
 * O motor vive em packages/core (`calcularDivida`), com testes, e roda na server
 * action. Reimplementar a correção composta, a mora fracionada e a ordem das
 * incidências em plpgsql produziria duas contas — e a divergência entre elas
 * apareceria como um total que o CSV exportado não confirma, na véspera do
 * protocolo. Esta função valida a autorização, carimba o autor e grava.
 */
create or replace function public.app_juridico_registrar_calculo(p jsonb)
returns public.processo_calculos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_row public.processo_calculos;
begin
  perform public.app_juridico_exige_modulo();

  insert into public.processo_calculos
    (numero_cnj, data_base, parametros, principal, correcao, juros, multa, honorarios, custas, total, memoria, gerado_por)
  values (
    p ->> 'numero_cnj', (p ->> 'data_base')::date, p -> 'parametros',
    (p ->> 'principal')::numeric, (p ->> 'correcao')::numeric, (p ->> 'juros')::numeric,
    (p ->> 'multa')::numeric, (p ->> 'honorarios')::numeric, (p ->> 'custas')::numeric,
    (p ->> 'total')::numeric, p -> 'memoria', v_ator)
  returning * into v_row;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'calculo.gerado', 'processo_calculos', v_row.id::text,
          jsonb_build_object('numero_cnj', v_row.numero_cnj, 'total', v_row.total, 'data_base', v_row.data_base));

  return v_row;
end;
$$;

/*
 * Editar o parecer grava uma LINHA NOVA, nunca um update.
 *
 * O parecer registra o que se sabia e o que se recomendou numa data, e é essa
 * recomendação que sustenta a decisão de continuar gastando com a ação.
 * Sobrescrever apagaria justamente a versão que alguém vai querer reler quando a
 * decisão for questionada.
 */
create or replace function public.app_juridico_editar_parecer(p jsonb)
returns public.processo_pareceres
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_row public.processo_pareceres;
  v_anterior public.processo_pareceres;
begin
  perform public.app_juridico_exige_modulo();

  select * into v_anterior
  from public.processo_pareceres
  where numero_cnj = p ->> 'numero_cnj'
  order by criado_em desc
  limit 1;

  insert into public.processo_pareceres
    (numero_cnj, parecer_markdown, proximo_passo, risco, modelo, tokens, editado, gerado_por)
  values (
    p ->> 'numero_cnj', btrim(p ->> 'parecer_markdown'), btrim(p ->> 'proximo_passo'),
    nullif(btrim(p ->> 'risco'), ''),
    -- O modelo da versão anterior viaja junto: a versão editada continua descendendo
    -- de um texto de IA, e apagar a procedência a faria parecer redigida do zero.
    v_anterior.modelo, null, true, v_ator)
  returning * into v_row;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'parecer.editado', 'processo_pareceres', v_row.id::text,
          jsonb_build_object('numero_cnj', v_row.numero_cnj, 'risco', v_row.risco));

  return v_row;
end;
$$;

create or replace function public.app_juridico_definir_config(p jsonb)
returns public.juridico_config
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_row public.juridico_config;
begin
  -- Configuração do módulo é ADMIN, não "quem tem o módulo": mexer na agenda de
  -- monitoramento ou no benchmark de fase muda o comportamento de toda a carteira
  -- e o custo em créditos. Ler é de quem tem o módulo; escrever é de quem responde
  -- pela conta.
  if not public.app_is_admin() then
    raise exception 'Somente a administração altera as configurações do Jurídico.' using errcode = '42501';
  end if;

  insert into public.juridico_config (chave, valor, atualizado_por, atualizado_em)
  values (btrim(p ->> 'chave'), p -> 'valor', v_ator, now())
  on conflict (chave) do update
    set valor = excluded.valor, atualizado_por = excluded.atualizado_por, atualizado_em = now()
  returning * into v_row;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'juridico.config_alterada', 'juridico_config', v_row.chave,
          jsonb_build_object('chave', v_row.chave));

  return v_row;
end;
$$;

create or replace function public.app_juridico_salvar_indices(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_indice text := p ->> 'indice';
  v_gravadas int;
begin
  if not public.app_is_admin() then
    raise exception 'Somente a administração altera a tabela de índices.' using errcode = '42501';
  end if;

  -- Upsert em LOTE, numa transação: uma importação de doze meses que grava seis e
  -- falha no sétimo deixaria a tabela num estado que ninguém consegue nomear, e o
  -- cálculo seguinte corrigiria metade do período em silêncio.
  with linhas as (
    select
      (l ->> 'competencia') as competencia,
      (l ->> 'valor')::numeric as valor
    from jsonb_array_elements(p -> 'linhas') l
  )
  insert into public.juridico_indices (indice, competencia, valor, atualizado_por, atualizado_em)
  select v_indice, competencia, valor, v_ator, now() from linhas
  on conflict (indice, competencia) do update
    set valor = excluded.valor, atualizado_por = excluded.atualizado_por, atualizado_em = now();

  get diagnostics v_gravadas = row_count;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'juridico.indices_salvos', 'juridico_indices', v_indice,
          jsonb_build_object('indice', v_indice, 'gravadas', v_gravadas));

  return jsonb_build_object('gravadas', v_gravadas);
end;
$$;

revoke all on function
  public.app_juridico_exige_modulo(),
  public.app_juridico_salvar_advogado(jsonb),
  public.app_juridico_atualizar_processo(jsonb),
  public.app_juridico_salvar_operacao(jsonb),
  public.app_juridico_remover_operacao(jsonb),
  public.app_juridico_registrar_custo(jsonb),
  public.app_juridico_registrar_recuperacao(jsonb),
  public.app_juridico_salvar_prazo(jsonb),
  public.app_juridico_concluir_prazo(jsonb),
  public.app_juridico_registrar_calculo(jsonb),
  public.app_juridico_editar_parecer(jsonb),
  public.app_juridico_definir_config(jsonb),
  public.app_juridico_salvar_indices(jsonb)
from public;

grant execute on function
  public.app_juridico_salvar_advogado(jsonb),
  public.app_juridico_atualizar_processo(jsonb),
  public.app_juridico_salvar_operacao(jsonb),
  public.app_juridico_remover_operacao(jsonb),
  public.app_juridico_registrar_custo(jsonb),
  public.app_juridico_registrar_recuperacao(jsonb),
  public.app_juridico_salvar_prazo(jsonb),
  public.app_juridico_concluir_prazo(jsonb),
  public.app_juridico_registrar_calculo(jsonb),
  public.app_juridico_editar_parecer(jsonb),
  public.app_juridico_definir_config(jsonb),
  public.app_juridico_salvar_indices(jsonb)
to authenticated, service_role;

-- `app_juridico_exige_modulo` é chamada DE DENTRO das outras (que são DEFINER e
-- rodam como o dono). Não precisa de grant para authenticated, e dá-lo abriria uma
-- função sem utilidade nenhuma na superfície do PostgREST.
grant execute on function public.app_juridico_exige_modulo() to service_role;

-- ============================================================================
-- §9 As integrações com o resto do sistema
-- ============================================================================

-- ─── §9 Knockout de crédito: cache em `empresas` ────────────────────────────
--
-- O catálogo de filtros exige COLUNA (é o contrato do compilador), e o Explorador
-- varre o universo inteiro: um EXISTS por linha sobre `processos` seria pago em
-- toda varredura de 2M de CNPJs. O flag é cache, e um TRIGGER o mantém.
--
-- Trigger e não job: a pergunta "esta empresa tem processo nosso?" é lida no
-- momento em que alguém decide operar com ela. Uma varredura noturna deixaria
-- até 24h de janela em que o scorecard concede limite a quem estamos executando —
-- e é justamente na semana em que a ação é ajuizada que isso acontece.

alter table public.empresas
  add column tem_processo_nosso_ativo boolean not null default false;

comment on column public.empresas.tem_processo_nosso_ativo is
  'Existe processo NOSSO em situação interna ativa (em_andamento/suspenso/acordo) contra '
  'esta empresa. Cache mantido por trigger sobre `processos`. É knockout de crédito (04d) '
  'e variável do catálogo de filtros.';

create or replace function public.recalcular_processo_ativo_da_empresa(p_empresa uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.empresas e
     set tem_processo_nosso_ativo = exists (
       select 1 from public.processos p
       where p.empresa_devedora_id = e.id
         and p.situacao_interna in ('em_andamento', 'suspenso', 'acordo')
     )
   where e.id = p_empresa
     and e.tem_processo_nosso_ativo is distinct from exists (
       select 1 from public.processos p
       where p.empresa_devedora_id = e.id
         and p.situacao_interna in ('em_andamento', 'suspenso', 'acordo')
     );
$$;

create or replace function public.processos_sincroniza_flag_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- As DUAS pontas, porque a vinculação manual MOVE o processo de uma empresa para
  -- outra: recalcular só a nova deixaria a antiga marcada para sempre.
  if tg_op in ('UPDATE', 'DELETE') and old.empresa_devedora_id is not null then
    perform public.recalcular_processo_ativo_da_empresa(old.empresa_devedora_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.empresa_devedora_id is not null then
    perform public.recalcular_processo_ativo_da_empresa(new.empresa_devedora_id);
  end if;
  return null;
end;
$$;

create trigger processos_flag_empresa
  after insert or delete or update of empresa_devedora_id, situacao_interna
  on public.processos
  for each row execute function public.processos_sincroniza_flag_empresa();

/*
 * O knockout entra no CHECK de `empresa_scores.knockout`.
 *
 * A lista é recriada a partir do estado VIVO da constraint (`situacao_irregular`,
 * `negada_recente`) mais o valor novo — e não a partir do que a 0073 escreveu.
 * Reconstruir um CHECK pela migração original é como se apagam valores que
 * migrações posteriores acrescentaram, em silêncio, num `alter table` que roda sem
 * erro nenhum.
 */
alter table public.empresa_scores drop constraint empresa_scores_knockout_check;
alter table public.empresa_scores add constraint empresa_scores_knockout_check
  check (knockout is null or knockout in ('situacao_irregular', 'negada_recente', 'processo_nosso_ativo'));

-- ─── §9 A variável no Explorador ────────────────────────────────────────────
--
-- `create or replace` com a coluna NO FIM (o Postgres exige que as anteriores
-- fiquem na mesma ordem e tipo). É ela que permite o segmento "sacado com ação
-- nossa em curso", que é o corte que nenhuma outra variável escreve.

create or replace view public.mercado_explorador
with (security_invoker = true) as
 SELECT u.cnpj,
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
    COALESCE(u.opcao_simples, false) AS opcao_simples,
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
    (e.erp_detalhes ->> 'qtd_usuarios'::text)::integer AS qtd_usuarios_erp,
    ((e.erp_detalhes ->> 'usuarios_ativos'::text)::numeric) / NULLIF((e.erp_detalhes ->> 'qtd_usuarios'::text)::numeric, 0::numeric) AS ratio_usuarios_ativos,
    COALESCE(m.qtd_filiais, 0) AS qtd_filiais,
    COALESCE(m.grupo_spes_total, 0) AS grupo_spes_total,
    COALESCE(m.grupo_spes_24m, 0) AS grupo_spes_24m,
    COALESCE(m.grupo_ufs, '{}'::text[]) AS grupo_ufs,
    COALESCE(m.obras_ativas, 0) AS obras_ativas,
    COALESCE(m.obras_iniciadas_24m, 0) AS obras_iniciadas_24m,
    COALESCE(m.m2_em_execucao, 0::numeric) AS m2_em_execucao,
    COALESCE(m.tem_contato, false) AS tem_contato,
    COALESCE(e.dominio, u.dominio) AS dominio,
    COALESCE(e.dominio_confianca, u.dominio_confianca) AS dominio_confianca,
    e.dominio_validado_em AS dominio_consultado_em,
    COALESCE(ct.qtd, 0) AS qtd_contatos,
    ct.ult AS contatos_enriquecidos_em,
    pa.tem_protesto,
    pa.consultado_em AS protestos_consultados_em,
    co.cnpj IS NOT NULL AS e_cliente_onepay,
    co.days_without_anticipation AS dias_sem_antecipar,
    co.consumed_pct,
    COALESCE(u.origem_ingestao, 'receita_dump'::text) AS origem_ingestao,
    COALESCE(u.fora_recorte_cnae, false) AS fora_recorte_cnae,
    e.faturamento_anual AS faturamento_estimado,
    e.faturamento_origem,
    e.faturamento_confianca,
    e.funcionarios,
    e.funcionarios_origem,
    e.funcionarios_crescimento_12m,
    e.regime_tributario,
    e.limite_potencial,
    e.receita_mensal_prevista,
    e.valor_esperado_mensal,
    e.score_credito,
    e.chance_concessao,
    e.score_faixa AS faixa_score,
    COALESCE(av.tem_analise_vigente, false) AS tem_analise_vigente,
    av.analise_estagio,
    COALESCE(e.estagio = 'ex_cliente', false) AS e_ex_cliente,
    e.ex_cliente_desde,
    CASE
      WHEN e.ex_cliente_desde IS NULL THEN NULL::int
      ELSE GREATEST(0, (extract(year from age(current_date, e.ex_cliente_desde)) * 12
                        + extract(month from age(current_date, e.ex_cliente_desde)))::int)
    END AS ex_cliente_meses,
    mp.motivo AS ex_cliente_motivo,
    COALESCE(e.teve_analise_sem_cadastro, false) AS teve_analise_sem_cadastro,
    apa.credit_limit AS ultima_analise_limite,
    apa.expiration_date AS ultima_analise_expirou_em,
    -- 08 §9: o corte que nenhuma outra variável escreve.
    COALESCE(e.tem_processo_nosso_ativo, false) AS tem_processo_nosso_ativo
   FROM mercado_universo u
     LEFT JOIN empresas e ON e.id = u.empresa_id
     LEFT JOIN mercado_metricas m ON m.cnpj = u.cnpj
     LEFT JOIN protestos_atual pa ON pa.cnpj = u.cnpj
     LEFT JOIN clientes_onepay co ON co.cnpj = u.cnpj
     LEFT JOIN analise_vigente av ON av.cnpj = u.cnpj
     LEFT JOIN motivos_perda mp ON mp.id = e.ex_cliente_motivo
     LEFT JOIN analises_plataforma_atual apa ON apa.cnpj = u.cnpj
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS qtd,
            max(c.enriquecido_em) AS ult
           FROM contatos c
          WHERE c.empresa_id = u.empresa_id) ct ON true;

-- `create or replace view` NÃO preserva grants em toda situação (0138k): repetir.
grant select on public.mercado_explorador to authenticated;

-- ─── §9 Ex-clientes: o processo REFORÇA "Inadimplência / default" ───────────
--
-- Sugestão, nunca gravação automática (mesma régua da 0107). O que muda aqui é a
-- ORDEM DA FORÇA: uma ação NOSSA contra o ex-cliente é evidência mais forte que um
-- protesto de terceiro — nós mesmos a ajuizamos, e sabemos por quê. Ela entra
-- logo depois do encerramento de atividades e antes do protesto.
--
-- Os dois apontam para o MESMO motivo; o que difere é a evidência, e é a evidência
-- que quem confirma lê antes de clicar.
--
-- ── O CORPO SAIU DO BANCO VIVO, NÃO DA 0107 ────────────────────────────────
-- Entre a 0107 e aqui, a view ganhou `e_filial`/`e_spe`/`e_principal`/`origem_spe`
-- (0109, 0111), `oculto` e `na_lista` (0113, 0115) e a evidência `blocked` (0108).
-- Reconstruí-la a partir da migração que a criou dropa seis colunas e uma
-- evidência — e `create or replace view` recusaria a operação com um erro que não
-- diz qual coluna sumiu. O corpo abaixo é o `pg_get_viewdef` do estado atual, com
-- a lateral `jur` e as duas linhas do CASE acrescentadas.

create or replace view public.ex_clientes
with (security_invoker = true) as
 SELECT e.id AS empresa_id,
    e.cnpj,
    COALESCE(e.razao_social, e.nome_fantasia, a.company_name) AS nome,
    e.ex_cliente_desde,
        CASE
            WHEN e.ex_cliente_desde IS NULL THEN NULL::integer
            ELSE GREATEST(0, (EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, e.ex_cliente_desde::timestamp with time zone)) * 12::numeric + EXTRACT(month FROM age(CURRENT_DATE::timestamp with time zone, e.ex_cliente_desde::timestamp with time zone)))::integer)
        END AS meses_desde,
    e.ex_cliente_motivo,
    m.motivo AS ex_cliente_motivo_label,
    e.ex_cliente_motivo_obs,
    e.gestao_operacao,
    e.uf,
    e.municipio,
    a.credit_limit AS ultimo_limite,
    a.consumed_limit AS consumo_historico,
    a.monthly_rate_d0 AS ultima_taxa_d0,
    a.expiration_date AS ultima_analise_expirou_em,
    a.status AS ultima_analise_status,
    sug.motivo_id AS motivo_sugerido,
    sug.motivo AS motivo_sugerido_label,
    sug.evidencia AS motivo_sugerido_evidencia,
    SUBSTRING(e.cnpj FROM 9 FOR 4) <> '0001'::text AS e_filial,
    v.e_spe,
    NOT (SUBSTRING(e.cnpj FROM 9 FOR 4) <> '0001'::text OR v.e_spe) AS e_principal,
    v.origem_spe,
    oc.cnpj IS NOT NULL AS oculto,
    COALESCE(NOT (SUBSTRING(e.cnpj FROM 9 FOR 4) <> '0001'::text OR v.e_spe), false) AND oc.cnpj IS NULL AS na_lista
   FROM empresas e
     LEFT JOIN analises_plataforma_atual a ON a.cnpj = e.cnpj
     LEFT JOIN motivos_perda m ON m.id = e.ex_cliente_motivo
     LEFT JOIN mercado_universo mu ON mu.cnpj = e.cnpj
     LEFT JOIN ex_clientes_ocultos oc ON oc.cnpj = e.cnpj
     LEFT JOIN LATERAL ( SELECT raiz_e_spe(e.cnpj) AS raiz_spe) r ON true
     LEFT JOIN LATERAL ( SELECT COALESCE(mu.is_spe, e.is_spe, false) OR COALESCE(COALESCE(e.razao_social, e.nome_fantasia, ''::text) ~* '(^|[^A-Za-z])(SPE|SCP)([^A-Za-z]|$)'::text, false) OR COALESCE(natureza_juridica_codigo(mu.natureza_juridica) = '2127'::text, false) OR r.raiz_spe AS e_spe,
                CASE
                    WHEN COALESCE(mu.is_spe, e.is_spe, false) THEN 'flag'::text
                    WHEN COALESCE(COALESCE(e.razao_social, e.nome_fantasia, ''::text) ~* '(^|[^A-Za-z])(SPE|SCP)([^A-Za-z]|$)'::text, false) THEN 'nome'::text
                    WHEN COALESCE(natureza_juridica_codigo(mu.natureza_juridica) = '2127'::text, false) THEN 'natureza_2127'::text
                    WHEN r.raiz_spe THEN 'raiz'::text
                    ELSE NULL::text
                END AS origem_spe) v ON true
     LEFT JOIN LATERAL ( SELECT mp.id AS motivo_id,
            mp.motivo,
            s.evidencia
           FROM ( SELECT
                        CASE
                            WHEN mu2.situacao_cadastral = ANY (ARRAY['baixada'::text, 'nula'::text]) THEN 'Encerrou atividades / recuperação judicial'::text
                            WHEN jur.numero_cnj IS NOT NULL THEN 'Inadimplência / default'::text
                            WHEN COALESCE(pa.tem_protesto, false) THEN 'Inadimplência / default'::text
                            WHEN cert.cnpj IS NOT NULL AND cert.expires_at < e.ex_cliente_desde THEN 'Certificado / cadastro vencido e não renovado'::text
                            WHEN a.status = 'blocked'::text THEN 'Análise não renovada pela plataforma'::text
                            ELSE NULL::text
                        END AS alvo,
                        CASE
                            WHEN mu2.situacao_cadastral = ANY (ARRAY['baixada'::text, 'nula'::text]) THEN ('Situação cadastral na Receita: '::text || mu2.situacao_cadastral) || '.'::text
                            WHEN jur.numero_cnj IS NOT NULL THEN ('Temos ação judicial em curso contra esta empresa ('::text || jur.numero_cnj) || ').'::text
                            WHEN COALESCE(pa.tem_protesto, false) THEN ('Protesto registrado (consulta de '::text || to_char(pa.consultado_em, 'DD/MM/YYYY'::text)) || ').'::text
                            WHEN cert.cnpj IS NOT NULL AND cert.expires_at < e.ex_cliente_desde THEN ('Certificado digital venceu em '::text || to_char(cert.expires_at, 'DD/MM/YYYY'::text)) || ', antes da saída, e não foi renovado.'::text
                            WHEN a.status = 'blocked'::text THEN 'A análise na plataforma está BLOQUEADA — foi a plataforma que fechou a porta.'::text
                            ELSE NULL::text
                        END AS evidencia
                   FROM ( SELECT 1 AS "?column?") _
                     LEFT JOIN mercado_universo mu2 ON mu2.cnpj = e.cnpj
                     LEFT JOIN protestos_atual pa ON pa.cnpj = e.cnpj
                     LEFT JOIN certificados cert ON cert.cnpj = e.cnpj
                     LEFT JOIN LATERAL ( SELECT p.numero_cnj
                           FROM processos p
                          WHERE p.empresa_devedora_id = e.id
                            AND p.situacao_interna = ANY (ARRAY['em_andamento'::text, 'suspenso'::text, 'acordo'::text])
                          ORDER BY p.data_distribuicao DESC NULLS LAST
                         LIMIT 1) jur ON true) s
             JOIN motivos_perda mp ON mp.contexto = 'ex_cliente'::text AND mp.motivo = s.alvo AND mp.ativo
         LIMIT 1) sug ON true
  WHERE e.estagio = 'ex_cliente'::text;

grant select on public.ex_clientes to authenticated;
-- ============================================================================
-- Seeds: perfil, módulo, regras de notificação e a configuração de fábrica
-- ============================================================================

insert into public.perfis (nome, descricao)
select 'Jurídico', 'Processos judiciais contra sacados devedores.'
where not exists (select 1 from public.perfis where nome = 'Jurídico');

insert into public.perfil_modulos (perfil_id, modulo_id)
select p.id, 'juridico' from public.perfis p where p.nome in ('Admin', 'Jurídico')
on conflict do nothing;

/*
 * O Jurídico enxerga `empresas`: um processo sem a ficha do devedor é um número
 * de CNJ. Quem trabalha a execução precisa do cadastro, dos contatos e da timeline
 * da conta para saber com quem está lidando — a mesma razão da 0075 para o Crédito.
 */
insert into public.perfil_modulos (perfil_id, modulo_id)
select p.id, 'empresas' from public.perfis p where p.nome = 'Jurídico'
on conflict do nothing;

/*
 * As regras do SINO (fan-out da 0003) e as que saem por `notify()`, separadas.
 *
 * Aqui ficam só as que NÃO precisam de push e não têm destinatário calculado por
 * linha. `processo.movimentacao_relevante`, `processo.fase_lenta` e o aviso de
 * prazo saem de `notify()` no worker, porque o destinatário é O ADVOGADO DAQUELE
 * processo — um perfil inteiro receberia trezentos avisos que não são dele, e é
 * assim que um sino vira ruído que ninguém abre.
 *
 * (Mesmo cuidado da 0034: um evento que já sai por notify() não pode ter regra
 * aqui, senão o sino recebe a linha duas vezes.)
 */
insert into public.notificacao_regras (tipo_evento, perfil_id, ativo)
select v.tipo, p.id, true
from (values
  ('processo.novo_detectado', 'Admin'),
  ('processo.novo_detectado', 'Jurídico'),
  ('processo.importado',      'Jurídico'),
  ('processo.encerrado',      'Jurídico'),
  ('recuperacao.registrada',  'Jurídico'),
  ('recuperacao.registrada',  'Admin')
) as v(tipo, perfil)
join public.perfis p on p.nome = v.perfil
where not exists (
  select 1 from public.notificacao_regras r where r.tipo_evento = v.tipo and r.perfil_id = p.id
);

-- ─── A configuração de fábrica ──────────────────────────────────────────────
--
-- `nossos_cnpjs` nasce VAZIO, de propósito: é a única setting que não tem padrão
-- razoável. Um CNPJ semeado errado faria a descoberta varrer a base do Escavador
-- por uma empresa que não é nossa — e cada varredura custa crédito. A tela de
-- configurações mostra o estado vazio dizendo exatamente isso.

insert into public.juridico_config (chave, valor) values
  ('nossos_cnpjs', '[]'::jsonb),
  ('monitoramento', jsonb_build_object(
      'dias_semana', jsonb_build_array(1, 2, 3, 4, 5),
      'hora', 7,
      'apenas_ativos', true,
      -- DESLIGADO por padrão: ir ao tribunal custa crédito POR PROCESSO POR RODADA,
      -- e ligar isso com trezentos processos e cinco dias por semana é uma fatura
      -- que ninguém aprovou. A tela diz o custo antes de perguntar.
      'forcar_atualizacao_tribunal', false,
      'dias_sem_movimentacao', 60)),
  ('benchmark_fases', jsonb_build_object(
      'distribuicao', 30, 'citacao', 60, 'contestacao_embargos', 45, 'instrucao', 180,
      'sentenca', 180, 'recurso', 365, 'transito_julgado', 60, 'cumprimento_execucao', 120,
      'penhora', 90, 'leilao_expropriacao', 180, 'arquivamento', 3650)),
  ('calculo', jsonb_build_object(
      'indice', 'ipca', 'juros_am', 1, 'juros_compostos', false,
      'multa_pct', 2, 'honorarios_pct', 20, 'incluir_custas', true)),
  -- O classificador nasce vazio e o job cai na régua de fábrica do core
  -- (REGRAS_FASE_PADRAO). Duplicar as onze regras aqui criaria duas listas que
  -- divergem no dia em que alguém corrigir uma delas — e a divergência apareceria
  -- como um cronograma que muda sozinho depois de um deploy.
  ('classificador', '{"regras": []}'::jsonb)
on conflict (chave) do nothing;

comment on column public.juridico_config.valor is
  'jsonb por chave. `classificador.regras` vazio significa "use a régua de fábrica do '
  'core"; preenchido, SUBSTITUI a régua inteira — não a complementa.';

-- ─── Fechar a superfície das funções que NÃO checam autorização ─────────────
--
-- Os `app_juridico_*` são RPC de propósito e cada um chama
-- `app_juridico_exige_modulo()` (ou `app_is_admin()`) na primeira linha — para
-- `anon`, `auth.uid()` é nulo, o módulo não existe e a chamada morre em 42501.
-- Eles ficam na superfície do PostgREST como o resto do projeto.
--
-- Estas TRÊS não. Nenhuma delas checa nada:
--
--   `recalcular_processo_ativo_da_empresa` ESCREVE em `empresas` — é o cache do
--   knockout. É `SECURITY DEFINER` porque o trigger precisa passar por cima da
--   RLS, e o Supabase concede EXECUTE de toda função nova a `anon`/`authenticated`
--   por default privilege. Somadas, as duas coisas põem um UPDATE sem dono num
--   endpoint HTTP público. O que ele escreve é sempre o valor correto (recalcula
--   de `processos`), mas "só dá para escrever a resposta certa" não é uma defesa:
--   é o próximo `set` acrescentado por distração que vira o problema.
--
--   `processos_sincroniza_flag_empresa` é função de TRIGGER. Triggers rodam como
--   o dono da tabela e nunca consultam EXECUTE, então revogar aqui não desarma
--   nada — só tira do PostgREST uma rota que devolveria erro de qualquer jeito.
--
--   `app_juridico_exige_modulo` é chamada de dentro das outras. Como endpoint ela
--   não faria mal (levanta exceção ou não devolve nada), mas também não serve para
--   nada — e superfície inútil é superfície.
--
-- A ordem é a que a 0006 aprendeu: revogar de PUBLIC mata a herança, e revogar
-- de anon/authenticated mata o grant DIRETO do default privilege do Supabase.
-- Só o segundo silencia o linter; só o primeiro fecha os papéis futuros.
revoke execute on function
  public.recalcular_processo_ativo_da_empresa(uuid),
  public.processos_sincroniza_flag_empresa(),
  public.app_juridico_exige_modulo()
from public, anon, authenticated;

grant execute on function
  public.recalcular_processo_ativo_da_empresa(uuid),
  public.app_juridico_exige_modulo()
to service_role;

-- ─── A fila de "atualizar agora" pedida pela IA ─────────────────────────────
--
-- A tool `juridico.atualizar_processo` roda com o client do USUÁRIO e não tem o
-- token do Escavador — ela deixa a marca, e o job do worker é quem gasta o
-- crédito. Mas `juridico_sync_log` só tem GRANT de SELECT (é log, não caixa de
-- entrada), então a marca precisa de um RPC.
--
-- Ele não é um `insert` disfarçado: DEDUPLICA. A tool pode ser chamada três vezes
-- na mesma conversa, e cada linha pendente vira uma chamada PAGA ao tribunal. Já
-- havendo pedido em aberto para o mesmo CNJ, o segundo é absorvido — e a resposta
-- diz isso, para o modelo não anunciar duas solicitações que foram uma.
create or replace function public.app_juridico_solicitar_atualizacao(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_cnj text := p ->> 'numero_cnj';
  v_pendente uuid;
begin
  perform public.app_juridico_exige_modulo();

  if not exists (select 1 from public.processos where numero_cnj = v_cnj) then
    raise exception 'Processo não encontrado.' using errcode = 'P0002';
  end if;

  select id into v_pendente
  from public.juridico_sync_log
  where numero_cnj = v_cnj and status = 'solicitada_pela_ia'
  limit 1;

  if v_pendente is not null then
    return jsonb_build_object('numero_cnj', v_cnj, 'ja_solicitada', true);
  end if;

  insert into public.juridico_sync_log (tipo, numero_cnj, status, creditos_utilizados)
  values ('atualizacao_processo', v_cnj, 'solicitada_pela_ia', 0);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'processo.atualizacao_solicitada', 'processos', v_cnj,
          jsonb_build_object('numero_cnj', v_cnj));

  return jsonb_build_object('numero_cnj', v_cnj, 'ja_solicitada', false);
end;
$$;

revoke all on function public.app_juridico_solicitar_atualizacao(jsonb) from public, anon;
grant execute on function public.app_juridico_solicitar_atualizacao(jsonb) to authenticated, service_role;
