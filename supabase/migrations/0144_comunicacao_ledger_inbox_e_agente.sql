-- ============================================================================
-- 0144 — Comunicação: o cano, o ledger e o agente (Prompt 05A)
--
-- ── UMA CONVERSA, UMA THREAD — POR PESSOA, NÃO POR CARD ─────────────────────
-- A mesma pessoa fala com o SDR, com o originador e com o closer. Se a thread
-- morasse no card, a segunda conversa começaria do zero e a terceira também: o
-- vendedor abriria o card de vendas sem enxergar o que o SDR combinou na semana
-- passada. A thread mora em `conversas`, chaveada por (canal, identificador), e
-- os cards dos cinco funis APONTAM para ela — `comunicacoes.funil_card_id` diz de
-- onde a mensagem partiu, e é filtro de leitura, nunca dono do histórico.
--
-- ── UM REGISTRO SÓ DE TOQUE ─────────────────────────────────────────────────
-- Antes deste arquivo, "falamos com o fornecedor" estava escrito em quatro
-- lugares: o evento `toque.manual`, a `mensagens_outbox`, o `pedidos_apresentacao`
-- e — por interpretação de quem lia — a `descoberta_execucoes`. Duas cópias
-- divergentes pagam uma coisa e mostram outra: o cooldown lê uma, a tela lê a
-- outra, e o fornecedor recebe dois toques no mesmo dia.
--
-- `comunicacoes` é o ledger CANÔNICO. A partir daqui todo módulo escreve
-- comunicação aqui e só aqui; quem precisa saber "o que foi falado" referencia
-- uma linha desta tabela, nunca copia o texto.
--
-- ── REFATORAÇÃO, NÃO BACKFILL ───────────────────────────────────────────────
-- As quatro fontes nunca produziram comunicação real — a régua sempre esteve em
-- modo sombra (§6 do 04). Não há histórico a preservar, então não há camada de
-- compatibilidade: a outbox vira fila pura, o pedido de apresentação vira estado
-- puro, o toque manual passa a gravar no ledger, e a descoberta continua sendo
-- descoberta. Os CHECKs abaixo tornam a duplicação INEXPRIMÍVEL em vez de
-- apenas desencorajada.
--
-- ── DEFAULT PRIVILEGES ──────────────────────────────────────────────────────
-- O Supabase concede ALL a anon/authenticated em toda tabela nova de `public`.
-- Cada tabela abaixo revoga tudo antes de conceder o SELECT que precisa.
-- ============================================================================

-- =============================================================================
-- §2 — O ledger e as threads
-- =============================================================================

create table public.conversas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas (id) on delete set null,
  contato_id uuid references public.contatos (id) on delete set null,
  canal text not null
    constraint conversas_canal_check check (canal in ('whatsapp', 'email')),
  /*
   * Forma CANÔNICA: telefone só dígitos (E.164 sem "+"), e-mail em minúsculas. É
   * o que faz o unique deduplicar de verdade — o mesmo número chega escrito de
   * seis jeitos por seis fontes, e três threads para a mesma pessoa é o defeito
   * que este arquivo existe para não ter.
   */
  identificador_externo text not null,

  -- ─── Estado do relacionamento (o que o agente lê, §7) ────────────────────
  objetivo text
    constraint conversas_objetivo_check check (objetivo is null or objetivo in (
      'agendar_reuniao', 'cadastrar_fornecedor', 'cobrar_documentacao',
      'renovar_analise', 'reativar', 'antecipar_nf', 'renovar_certificado', 'nenhum'
    )),
  playbook_id uuid,
  responsavel_vendedor_id uuid references public.vendedores (id) on delete set null,
  /*
   * `sugestao` é o default e é uma decisão, não um meio-termo: um agente que
   * começa autônomo numa carteira humana manda a primeira mensagem antes de
   * alguém ter lido uma única sugestão dele.
   */
  modo_agente text not null default 'sugestao'
    constraint conversas_modo_agente_check check (modo_agente in ('sugestao', 'autonomo', 'desligado')),
  status text not null default 'ativa'
    constraint conversas_status_check check (status in ('ativa', 'aguardando_resposta', 'pausada', 'encerrada')),
  ultima_mensagem_em timestamptz,
  ultima_direcao text
    constraint conversas_ultima_direcao_check check (ultima_direcao is null or ultima_direcao in ('entrada', 'saida')),
  proxima_acao_em timestamptz,
  nao_lidas int not null default 0,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  unique (canal, identificador_externo)
);

create index conversas_empresa_idx on public.conversas (empresa_id);
create index conversas_responsavel_idx on public.conversas (responsavel_vendedor_id, status);
create index conversas_contato_idx on public.conversas (contato_id);
-- A varredura do agente (`agente/executar-agendados`) só olha o que tem hora marcada.
create index conversas_proxima_acao_idx on public.conversas (proxima_acao_em)
  where proxima_acao_em is not null;
-- O inbox abre ordenado por atividade, e "não lidas" é a primeira aba.
create index conversas_recentes_idx on public.conversas (ultima_mensagem_em desc nulls last);

comment on table public.conversas is
  'Uma thread por PESSOA e canal, não por card. Os cards dos cinco funis apontam para '
  'ela e filtram a mesma conversa — histórico paralelo por card é o defeito que esta '
  'tabela existe para impedir.';

create table public.comunicacoes (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid references public.conversas (id) on delete set null,
  empresa_id uuid references public.empresas (id) on delete set null,
  contato_id uuid references public.contatos (id) on delete set null,
  canal text not null
    constraint comunicacoes_canal_check check (canal in
      ('whatsapp', 'email', 'ligacao', 'reuniao', 'interno')),
  direcao text not null
    constraint comunicacoes_direcao_check check (direcao in ('entrada', 'saida')),

  -- ─── Autoria ─────────────────────────────────────────────────────────────
  usuario_id uuid references public.usuarios (id) on delete set null,
  vendedor_id uuid references public.vendedores (id) on delete set null,
  /*
   * `por_ia` é coluna e não inferência a partir do vendedor: a persona da IA é um
   * vendedor como outro qualquer no funil (04g), e "quem falou" precisa ser
   * respondível sem consultar `vendedores.is_ia` — inclusive quando a mensagem
   * saiu por uma conta que depois trocou de dono.
   */
  por_ia boolean not null default false,

  -- ─── Conteúdo ────────────────────────────────────────────────────────────
  assunto text,
  corpo text,
  preview text,
  anexos jsonb not null default '[]'::jsonb,

  -- ─── Transporte ──────────────────────────────────────────────────────────
  provedor text
    constraint comunicacoes_provedor_check check (provedor is null or provedor in
      ('wasender', 'gmail', 'resend', 'app_link', 'manual')),
  /* Message id do provedor. É a chave de idempotência do webhook. */
  id_externo text,
  /* Message-ID / In-Reply-To do e-mail: é o que mantém a thread no Gmail do outro lado. */
  thread_externa text,
  conta_remetente text,
  status_envio text
    constraint comunicacoes_status_envio_check check (status_envio is null or status_envio in
      ('pendente', 'enviada', 'entregue', 'lida', 'falhou', 'descartada')),
  erro text,
  tentativas int not null default 0,

  -- ─── Contexto ────────────────────────────────────────────────────────────
  origem text
    constraint comunicacoes_origem_check check (origem is null or origem in
      ('compositor', 'outbox', 'agente', 'app_toque', 'inbox', 'sistema')),
  template_id uuid,
  funil text
    constraint comunicacoes_funil_check check (funil is null or funil in
      ('nfs', 'fornecedores', 'sdr', 'vendas', 'certificados')),
  funil_card_id text,
  /* Classificação da resposta (§6). Null enquanto a triagem não rodou. */
  triagem jsonb,
  criado_em timestamptz not null default now(),
  enviado_em timestamptz
);

create index comunicacoes_conversa_idx on public.comunicacoes (conversa_id, criado_em desc);
create index comunicacoes_empresa_idx on public.comunicacoes (empresa_id, criado_em desc);
create index comunicacoes_vendedor_idx on public.comunicacoes (vendedor_id, criado_em desc);
create index comunicacoes_card_idx on public.comunicacoes (funil, funil_card_id)
  where funil_card_id is not null;
-- A fila da triagem: entradas ainda não classificadas, mais antigas primeiro.
create index comunicacoes_a_triar_idx on public.comunicacoes (criado_em)
  where direcao = 'entrada' and triagem is null;
-- O cooldown do portão pergunta "quando foi o último toque neste contato".
create index comunicacoes_contato_saida_idx on public.comunicacoes (contato_id, criado_em desc)
  where direcao = 'saida';

/*
 * Idempotência do webhook. PARCIAL de propósito: em SQL dois nulos nunca são
 * iguais, então um `unique (provedor, id_externo)` de tabela cheia deixaria
 * passar qualquer duplicata cujo id ainda não chegou — que é justamente o caso do
 * `app_link` e do `manual`, onde não há id nenhum.
 */
create unique index comunicacoes_provedor_externo_idx
  on public.comunicacoes (provedor, id_externo)
  where id_externo is not null;

comment on table public.comunicacoes is
  'LEDGER CANÔNICO de toda comunicação, humana ou de IA, entrada ou saída. Todo módulo '
  'escreve aqui e só aqui; quem precisa saber "o que foi falado" REFERENCIA uma linha '
  'desta tabela — nunca copia o texto.';

comment on column public.comunicacoes.status_envio is
  'Para `origem = app_toque` (o clique em tel:/wa.me/mailto:), `enviada` significa que o '
  'app ABRIU — sabemos que a pessoa foi levada ao WhatsApp, não que a mensagem saiu. '
  'Nenhum provedor confirma isso, e fingir que confirma seria a mentira mais cara aqui.';

create table public.conversas_nao_vinculadas (
  id uuid primary key default gen_random_uuid(),
  canal text not null
    constraint conversas_nv_canal_check check (canal in ('whatsapp', 'email')),
  identificador_externo text not null,
  /* pushName do WhatsApp / display name do e-mail: pré-preenche o nome na vinculação. */
  nome_sugerido text,
  primeira_mensagem_em timestamptz not null default now(),
  ultima_mensagem_em timestamptz not null default now(),
  qtd_mensagens int not null default 1,
  conta_recebedora text,
  vendedor_sugerido_id uuid references public.vendedores (id) on delete set null,
  status text not null default 'pendente'
    constraint conversas_nv_status_check check (status in ('pendente', 'vinculada', 'ignorada')),
  vinculada_contato_id uuid references public.contatos (id) on delete set null,
  resolvida_por uuid references public.usuarios (id) on delete set null,
  resolvida_em timestamptz,
  unique (canal, identificador_externo)
);

create index conversas_nv_pendentes_idx on public.conversas_nao_vinculadas (ultima_mensagem_em desc)
  where status = 'pendente';

comment on table public.conversas_nao_vinculadas is
  'Inbox de identificação: quem falou com a gente e o sistema não soube quem era. Vira '
  'fila destacada ao logar — uma mensagem de um decisor que ninguém identificou é a '
  'forma mais barata de perder um negócio.';

-- ─── Base legal por contato ─────────────────────────────────────────────────
/*
 * Não é enfeite de compliance: é o que decide se a mensagem sai com link de
 * descadastro e se o portão (§1.4) deixa a mensagem passar. Preenchida pela
 * ORIGEM, nunca digitada: formulário → aceite, NF-e → dado público, cliente ativo
 * → relação comercial. Um campo que alguém preenche à mão vira "manual" em 100%
 * das linhas na primeira semana.
 */
alter table public.contatos add column base_legal text
  constraint contatos_base_legal_check check (base_legal is null or base_legal in
    ('formulario_aceite', 'relacao_comercial', 'dado_publico_nfe', 'indicacao', 'manual'));
alter table public.contatos add column base_legal_em timestamptz;
alter table public.contatos add column base_legal_detalhe text;

/*
 * NÃO é supressão, e a distinção é o ponto: "fala com o Marcelo do financeiro" diz
 * que esta pessoa não decide, não que ela não pode ser abordada. Suprimir aqui
 * queimaria um contato que volta a ser útil no dia em que o Marcelo sair.
 */
alter table public.contatos add column nao_e_o_decisor boolean not null default false;

comment on column public.contatos.base_legal is
  'Por que podemos falar com esta pessoa. Toda mensagem de e-mail para contato SEM '
  '`formulario_aceite` inclui link de descadastro (§2).';

-- =============================================================================
-- §3 — Transportes: contas, warmup e o plantão
-- =============================================================================

/*
 * `whatsapp_contas` já existia (0045) como cadastro. Aqui ela ganha o que faz uma
 * conta ENVIAR sem queimar: o papel, o teto e o ritmo.
 *
 * `tipo` é a coluna que impede a pior confusão possível deste módulo: o número da
 * IA nunca pode ser o de relacionamento humano (§1.3), e o plantão interno não
 * passa por warmup, supressão nem teto (§1.5). Um enum é a forma mais curta de
 * dizer isso sem depender de convenção de apelido.
 */
alter table public.whatsapp_contas add column tipo text not null default 'relacionamento'
  constraint whatsapp_contas_tipo_check check (tipo in ('relacionamento', 'ia', 'plantao'));
alter table public.whatsapp_contas add column mensagens_por_dia int not null default 200
  constraint whatsapp_contas_teto_check check (mensagens_por_dia between 0 and 2000);
/* Rampa: contas novas começam em 20/dia e sobem semanalmente até o teto. */
alter table public.whatsapp_contas add column warmup_iniciado_em date;
alter table public.whatsapp_contas add column intervalo_min_seg int not null default 25
  constraint whatsapp_contas_int_min_check check (intervalo_min_seg between 0 and 3600);
alter table public.whatsapp_contas add column intervalo_max_seg int not null default 70
  constraint whatsapp_contas_int_max_check check (intervalo_max_seg between 0 and 7200);
alter table public.whatsapp_contas add constraint whatsapp_contas_intervalo_ordem
  check (intervalo_max_seg >= intervalo_min_seg);

comment on column public.whatsapp_contas.tipo is
  'relacionamento = número de gente; ia = persona própria (Carina), NUNCA o mesmo número; '
  'plantao = alerta interno, transporte separado que não passa por warmup, supressão, '
  'janela nem teto.';

/*
 * Gmail por USUÁRIO, não por empresa: os escopos `gmail.send`/`readonly`/`modify`
 * são concedidos pela pessoa sobre a caixa dela, e é como a pessoa que a mensagem
 * sai. Os dois tokens vivem no Vault; aqui ficam só os ponteiros, como na
 * `whatsapp_contas` (mesma régua da 0052).
 */
create table public.gmail_contas (
  usuario_id uuid primary key references public.usuarios (id) on delete cascade,
  endereco text not null,
  refresh_token_secret_id uuid,
  access_token_secret_id uuid,
  access_token_expira_em timestamptz,
  escopos text[] not null default '{}',
  /* Ponto de retomada do sync incremental. Null = nunca sincronizou. */
  history_id text,
  /* Gmail Watch (Pub/Sub) expira em 7 dias e precisa ser renovado pelo job. */
  watch_expira_em timestamptz,
  ultimo_sync_em timestamptz,
  ultimo_erro text,
  ativo boolean not null default true,
  conectado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (endereco)
);

comment on table public.gmail_contas is
  'Conexão OAuth de uma pessoa com a caixa dela. O RECEBIMENTO é FILTRADO: só entra no '
  'ledger e-mail cujo remetente/destinatário case com contato conhecido ou domínio de '
  'empresa da base — ingerir a caixa pessoal inteira seria vigilância, não CRM.';

-- =============================================================================
-- §5 — Templates e configuração do módulo
-- =============================================================================

create table public.templates_mensagem (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  canal text not null
    constraint templates_canal_check check (canal in ('whatsapp', 'email')),
  funil text
    constraint templates_funil_check check (funil is null or funil in
      ('nfs', 'fornecedores', 'sdr', 'vendas', 'certificados')),
  objetivo text,
  assunto text,
  corpo text not null,
  /* As variáveis que o corpo usa, em pt-BR. Renderizadas pelo renderizarTemplate() do core. */
  variaveis text[] not null default '{}',
  ativo boolean not null default true,
  criado_por uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (nome, canal)
);

create index templates_mensagem_funil_idx on public.templates_mensagem (funil, canal) where ativo;

comment on table public.templates_mensagem is
  'Um template é config, não código. O compositor mostra o texto JÁ RENDERIZADO com as '
  'variáveis reais antes de enviar: quem aperta o botão vê o que a pessoa vai ler.';

create table public.comunicacao_config (
  chave text primary key,
  valor jsonb not null,
  atualizado_por uuid references public.usuarios (id) on delete set null,
  atualizado_em timestamptz not null default now()
);

comment on table public.comunicacao_config is
  'Settings do módulo: janela de envio, cooldown, tetos, mínimo de confiança do agente, '
  'kill switch e plantão. Mesmo desenho de radar_config/credito_config. NENHUMA '
  'credencial entra aqui — a tabela é lida por authenticated.';

-- =============================================================================
-- §7 — O agente de próximo passo
-- =============================================================================

create table public.agente_playbooks (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  funil text not null
    constraint agente_playbooks_funil_check check (funil in
      ('nfs', 'fornecedores', 'sdr', 'vendas', 'certificados')),
  objetivo text not null,
  /* Contexto e tom para o modelo. É config: mudar o playbook não é deploy. */
  instrucoes text not null,
  /*
   * Subconjunto do espaço FECHADO de ações (§7.2). O executor recusa o que não
   * estiver aqui — um playbook de cobrança de documentação não tem por que poder
   * marcar "sem interesse eterno".
   */
  acoes_permitidas text[] not null,
  templates_disponiveis uuid[] not null default '{}',
  /* { silencio_dias, max_tentativas, desistir_apos_dias } */
  prazos jsonb not null default '{}'::jsonb,
  ativo boolean not null default true,
  versao int not null default 1,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (nome, versao)
);

create index agente_playbooks_funil_idx on public.agente_playbooks (funil, objetivo) where ativo;

alter table public.conversas
  add constraint conversas_playbook_fkey
  foreign key (playbook_id) references public.agente_playbooks (id) on delete set null;

alter table public.comunicacoes
  add constraint comunicacoes_template_fkey
  foreign key (template_id) references public.templates_mensagem (id) on delete set null;

create table public.agente_decisoes (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid references public.conversas (id) on delete cascade,
  playbook_id uuid references public.agente_playbooks (id) on delete set null,
  gatilho text not null,
  contexto_resumo jsonb not null default '{}'::jsonb,
  acao text not null,
  canal text,
  quando timestamptz,
  conteudo_sugerido text,
  confianca numeric(4, 3),
  justificativa text,
  modo text not null
    constraint agente_decisoes_modo_check check (modo in ('sugestao', 'autonomo')),
  executada boolean not null default false,
  executada_em timestamptz,
  aceita_por uuid references public.usuarios (id) on delete set null,
  descartada boolean not null default false,
  /*
   * O DESFECHO é o que transforma o log num painel de eficácia por playbook, e é
   * a mesma decisão do 04f: sem ele saberíamos quantas vezes o agente decidiu, e
   * nunca quantas vezes ele acertou.
   */
  desfecho text
    constraint agente_decisoes_desfecho_check check (desfecho is null or desfecho in
      ('respondeu', 'agendou', 'converteu', 'suprimiu', 'sem_resposta', 'escalou')),
  desfecho_em timestamptz,
  modelo text,
  tokens int,
  criado_em timestamptz not null default now()
);

create index agente_decisoes_conversa_idx on public.agente_decisoes (conversa_id, criado_em desc);
create index agente_decisoes_playbook_idx on public.agente_decisoes (playbook_id, criado_em desc);
-- A fila de "próximo passo sugerido" que aparece no card e no inbox.
create index agente_decisoes_pendentes_idx on public.agente_decisoes (criado_em desc)
  where modo = 'sugestao' and not executada and not descartada;

comment on table public.agente_decisoes is
  'Toda decisão do agente, executada ou não, com justificativa e desfecho. É o log de '
  'auditoria (quem mandou o quê e por quê) e a matéria-prima da calibração futura.';

-- =============================================================================
-- §2 — A refatoração das quatro fontes de "toque"
--
-- Sem camada de compatibilidade: nenhuma delas produziu comunicação real (a régua
-- sempre esteve em sombra), então não há histórico a preservar. O que muda aqui é
-- o PAPEL de cada uma, e os CHECKs abaixo tornam o papel antigo inexprimível.
-- =============================================================================

-- ─── `mensagens_outbox`: fila de saída, e só ────────────────────────────────
/*
 * A outbox deixa de ser "o que seria enviado" e passa a ser "o que ainda não
 * saiu". Ao enviar, o worker grava a linha em `comunicacoes`, aponta
 * `comunicacao_id` e APAGA o texto daqui — o CHECK no fim desta seção garante
 * que uma linha não possa carregar o conteúdo e a referência ao mesmo tempo.
 *
 * Ela também deixa de ser exclusiva da Antecipação. O compositor manda para
 * qualquer contato de qualquer funil, e uma segunda fila para "as outras
 * mensagens" teria dois workers, dois portões e duas formas de furar a janela.
 * Por isso `fornecedor_cnpj` e `access_keys` deixam de ser obrigatórios.
 */
alter table public.mensagens_outbox add column comunicacao_id uuid
  references public.comunicacoes (id) on delete set null;
alter table public.mensagens_outbox add column conversa_id uuid
  references public.conversas (id) on delete set null;
alter table public.mensagens_outbox add column empresa_id uuid
  references public.empresas (id) on delete set null;
alter table public.mensagens_outbox add column vendedor_id uuid
  references public.vendedores (id) on delete set null;
alter table public.mensagens_outbox add column template_id uuid
  references public.templates_mensagem (id) on delete set null;
alter table public.mensagens_outbox add column por_ia boolean not null default false;
alter table public.mensagens_outbox add column criada_por uuid
  references public.usuarios (id) on delete set null;
alter table public.mensagens_outbox add column origem text not null default 'outbox'
  constraint mensagens_outbox_origem_check check (origem in ('compositor', 'outbox', 'agente'));
alter table public.mensagens_outbox add column funil text
  constraint mensagens_outbox_funil_check check (funil is null or funil in
    ('nfs', 'fornecedores', 'sdr', 'vendas', 'certificados'));
alter table public.mensagens_outbox add column funil_card_id text;

/*
 * A JANELA NÃO DESCARTA, AGENDA (§5).
 *
 * Uma mensagem gerada às 22h não é uma mensagem errada: é uma mensagem cedo
 * demais. Descartá-la perderia o toque; enviá-la mandaria WhatsApp de madrugada
 * para um fornecedor. `agendada_para` é a terceira saída, e evita bifurcar a
 * máquina de status — a linha continua `aprovada`, o worker é que não a pega
 * ainda.
 */
alter table public.mensagens_outbox add column agendada_para timestamptz;
alter table public.mensagens_outbox add column tentativas int not null default 0;
alter table public.mensagens_outbox add column ultima_tentativa_em timestamptz;
alter table public.mensagens_outbox add column erro text;

alter table public.mensagens_outbox alter column fornecedor_cnpj drop not null;
alter table public.mensagens_outbox drop constraint mensagens_outbox_fornecedor_check;
alter table public.mensagens_outbox add constraint mensagens_outbox_fornecedor_check
  check (fornecedor_cnpj is null or fornecedor_cnpj ~ '^[0-9]{14}$');
alter table public.mensagens_outbox alter column access_keys set default '{}';

/*
 * A regra permanente, escrita como constraint: uma vez que a linha aponta para o
 * ledger, ela não pode mais carregar a própria cópia do texto. É isto que impede
 * a outbox de voltar a ser histórico na primeira tela que alguém escrever com
 * pressa.
 */
alter table public.mensagens_outbox add constraint mensagens_outbox_sem_copia_do_ledger
  check (comunicacao_id is null or (corpo is null and assunto is null));

-- A fila do worker: aprovadas, na ordem em que puderem sair.
create index mensagens_outbox_fila_idx
  on public.mensagens_outbox (coalesce(agendada_para, criada_em))
  where status = 'aprovada';

comment on table public.mensagens_outbox is
  'FILA DE SAÍDA, exclusivamente: o que ainda não foi enviado. Ao enviar, a linha vira '
  'registro em `comunicacoes` e guarda apenas a referência. Histórico se lê no ledger.';

-- ─── `pedidos_apresentacao`: estado do pedido, e só ─────────────────────────
/*
 * `mensagem` continua existindo enquanto o pedido é RASCUNHO — um rascunho não é
 * histórico. Ao enviar, o texto vai para o ledger e é apagado daqui, pela mesma
 * constraint de não-duplicação da outbox.
 */
alter table public.pedidos_apresentacao add column comunicacao_id uuid
  references public.comunicacoes (id) on delete set null;
alter table public.pedidos_apresentacao add constraint pedidos_apresentacao_sem_copia_do_ledger
  check (comunicacao_id is null or mensagem is null);

comment on column public.pedidos_apresentacao.mensagem is
  'RASCUNHO. Vira null no envio, quando o texto passa a viver em `comunicacoes` — ver '
  'a constraint pedidos_apresentacao_sem_copia_do_ledger.';

/*
 * `descoberta_execucoes` (04l) NÃO muda. Ela registra DESCOBERTA DE CONTATO, que
 * é o que ela sempre foi; ler "toque" ali foi interpretação de quem consultava,
 * não semântica da tabela. Se uma descoberta terminar em mensagem, o vínculo é
 * pelo ledger — e é por isso que não há coluna nova aqui.
 */

-- =============================================================================
-- Triggers de atualizado_em (convenção set_atualizado_em)
-- =============================================================================

-- `conversas` é feminina: set_atualizadA_em (0045), não a irmã masculina.
create trigger conversas_set_atualizada_em
  before update on public.conversas
  for each row execute function set_atualizada_em();
create trigger gmail_contas_set_atualizado_em
  before update on public.gmail_contas
  for each row execute function set_atualizado_em();
create trigger templates_mensagem_set_atualizado_em
  before update on public.templates_mensagem
  for each row execute function set_atualizado_em();
create trigger comunicacao_config_set_atualizado_em
  before update on public.comunicacao_config
  for each row execute function set_atualizado_em();
create trigger agente_playbooks_set_atualizado_em
  before update on public.agente_playbooks
  for each row execute function set_atualizado_em();

-- =============================================================================
-- RLS
--
-- `(select ...)` em volta das funções STABLE não é enfeite: sem ele o Postgres
-- chama `app_tem_modulo()` UMA VEZ POR LINHA VARRIDA, e uma thread de seis meses
-- tem centenas. Com o select vira InitPlan — uma chamada por consulta. (0131.)
--
-- ── O CONTEÚDO É MAIS SENSÍVEL QUE A EXISTÊNCIA ─────────────────────────────
-- `conversas` diz QUE existe conversa com aquela empresa: isso é matéria de quem
-- abre a Company 360, porque muda a conversa que a pessoa vai ter hoje. O CORPO
-- das mensagens, não — é negociação de alguém com alguém. Por isso `comunicacoes`
-- exige o módulo `comunicacao`, e `conversas` aceita também `empresas`.
-- =============================================================================

alter table public.conversas               enable row level security;
alter table public.comunicacoes            enable row level security;
alter table public.conversas_nao_vinculadas enable row level security;
alter table public.templates_mensagem      enable row level security;
alter table public.comunicacao_config      enable row level security;
alter table public.agente_playbooks        enable row level security;
alter table public.agente_decisoes         enable row level security;
alter table public.gmail_contas            enable row level security;

create policy conversas_select on public.conversas
  for select to authenticated
  using ((select public.app_tem_modulo('comunicacao')) or (select public.app_tem_modulo('empresas')));

create policy comunicacoes_select on public.comunicacoes
  for select to authenticated
  using ((select public.app_tem_modulo('comunicacao')));

create policy conversas_nv_select on public.conversas_nao_vinculadas
  for select to authenticated
  using ((select public.app_tem_modulo('comunicacao')));

create policy templates_mensagem_select on public.templates_mensagem
  for select to authenticated
  using ((select public.app_tem_modulo('comunicacao')));

create policy comunicacao_config_select on public.comunicacao_config
  for select to authenticated
  using ((select public.app_tem_modulo('comunicacao')));

create policy agente_playbooks_select on public.agente_playbooks
  for select to authenticated
  using ((select public.app_tem_modulo('comunicacao')));

create policy agente_decisoes_select on public.agente_decisoes
  for select to authenticated
  using ((select public.app_tem_modulo('comunicacao')));

/*
 * `gmail_contas` é a SUA conexão, e só. Um gestor não tem por que saber quando o
 * refresh token do colega expira, e a lista de endereços conectados não é dado de
 * equipe. O admin gerencia pelo service role, do lado do servidor.
 *
 * Os dois ponteiros de segredo saem do grant coluna a coluna (mesma correção da
 * 0052: revogar SELECT de coluna depois de um grant de TABELA não corta nada).
 */
create policy gmail_contas_propria on public.gmail_contas
  for select to authenticated
  using (usuario_id = (select auth.uid()));

revoke all on public.gmail_contas from anon, authenticated;
grant select (
  usuario_id, endereco, access_token_expira_em, escopos, history_id,
  watch_expira_em, ultimo_sync_em, ultimo_erro, ativo, conectado_em, atualizado_em
) on public.gmail_contas to authenticated;

revoke all on
  public.conversas, public.comunicacoes, public.conversas_nao_vinculadas,
  public.templates_mensagem, public.comunicacao_config,
  public.agente_playbooks, public.agente_decisoes
from anon, authenticated;

grant select on
  public.conversas, public.comunicacoes, public.conversas_nao_vinculadas,
  public.templates_mensagem, public.comunicacao_config,
  public.agente_playbooks, public.agente_decisoes
to authenticated;

/*
 * Nenhuma destas tabelas ganha INSERT/UPDATE/DELETE para `authenticated`. O único
 * caminho de escrita são os RPCs do §"Escritas" abaixo (e o service role, no
 * worker) — o que torna "gravar uma mensagem sem passar pelo portão"
 * inexprimível em vez de apenas desencorajado. É a mesma régua da 0047.
 */

-- =============================================================================
-- §4/§8/§9 — Views de leitura
-- =============================================================================

/*
 * A thread como a tela lê: a linha do ledger já com o nome de quem falou. Sem
 * isto, cada bolha da conversa custaria três joins no cliente, e o inbox faria
 * isso cinquenta vezes por tela.
 */
create view public.comunicacoes_thread
with (security_invoker = true) as
select
  c.id,
  c.conversa_id,
  c.empresa_id,
  c.contato_id,
  c.canal,
  c.direcao,
  c.por_ia,
  c.assunto,
  c.corpo,
  c.preview,
  c.anexos,
  c.provedor,
  c.conta_remetente,
  c.status_envio,
  c.erro,
  c.origem,
  c.funil,
  c.funil_card_id,
  c.triagem,
  c.criado_em,
  c.enviado_em,
  e.cnpj          as empresa_cnpj,
  coalesce(e.razao_social, e.nome_fantasia) as empresa_nome,
  ct.nome         as contato_nome,
  ct.cargo        as contato_cargo,
  u.nome          as usuario_nome,
  v.nome          as vendedor_nome,
  v.is_ia         as vendedor_is_ia
from public.comunicacoes c
left join public.empresas  e  on e.id  = c.empresa_id
left join public.contatos  ct on ct.id = c.contato_id
left join public.usuarios  u  on u.id  = c.usuario_id
left join public.vendedores v on v.id  = c.vendedor_id;

/*
 * O inbox: uma linha por thread, com o que a lista precisa mostrar sem abrir.
 *
 * `preview` e `nao_lidas` vêm da própria `conversas` (mantidas pelo ledger, não
 * recalculadas aqui): uma contagem por linha varrida transformaria a abertura do
 * inbox numa varredura do ledger inteiro.
 */
create view public.inbox_conversas
with (security_invoker = true) as
select
  cv.id,
  cv.canal,
  cv.identificador_externo,
  cv.empresa_id,
  cv.contato_id,
  cv.objetivo,
  cv.playbook_id,
  cv.responsavel_vendedor_id,
  cv.modo_agente,
  cv.status,
  cv.ultima_mensagem_em,
  cv.ultima_direcao,
  cv.proxima_acao_em,
  cv.nao_lidas,
  e.cnpj          as empresa_cnpj,
  coalesce(e.razao_social, e.nome_fantasia) as empresa_nome,
  ct.nome         as contato_nome,
  ct.cargo        as contato_cargo,
  ct.base_legal   as contato_base_legal,
  ct.nao_e_o_decisor as contato_nao_e_o_decisor,
  v.nome          as responsavel_nome,
  v.is_ia         as responsavel_is_ia,
  ult.preview     as ultima_preview,
  ult.por_ia      as ultima_por_ia,
  ult.triagem     as ultima_triagem,
  sug.id          as sugestao_id,
  sug.acao        as sugestao_acao,
  sug.conteudo_sugerido as sugestao_conteudo,
  sug.justificativa as sugestao_justificativa,
  sug.confianca   as sugestao_confianca
from public.conversas cv
left join public.empresas   e  on e.id  = cv.empresa_id
left join public.contatos   ct on ct.id = cv.contato_id
left join public.vendedores v  on v.id  = cv.responsavel_vendedor_id
left join lateral (
  select m.preview, m.por_ia, m.triagem
  from public.comunicacoes m
  where m.conversa_id = cv.id
  order by m.criado_em desc
  limit 1
) ult on true
-- O "próximo passo sugerido" que o card e o inbox mostram: a decisão viva mais
-- recente, nunca as descartadas.
left join lateral (
  select d.id, d.acao, d.conteudo_sugerido, d.justificativa, d.confianca
  from public.agente_decisoes d
  where d.conversa_id = cv.id and d.modo = 'sugestao'
    and not d.executada and not d.descartada
  order by d.criado_em desc
  limit 1
) sug on true;

/*
 * §8 — Painel de atividade. Uma linha por vendedor e por dia.
 *
 * A view NÃO tem policy própria (views herdam a RLS das tabelas por
 * security_invoker); o recorte de QUEM PODE VER está no RPC que a lê, porque a
 * regra do §8 não é sobre linhas — é sobre a pessoa que pergunta: o vendedor não
 * vê o próprio painel, de propósito.
 *
 * Volume vem SEMPRE ao lado de resultado. Uma tela que só conta mensagens
 * enviadas ensina a mandar mensagem, não a vender.
 */
create view public.atividade_comunicacao
with (security_invoker = true) as
select
  c.vendedor_id,
  v.nome as vendedor_nome,
  v.is_ia,
  (c.criado_em at time zone 'America/Sao_Paulo')::date as dia,
  c.canal,
  count(*) filter (where c.direcao = 'saida')                          as enviadas,
  count(*) filter (where c.direcao = 'entrada')                        as recebidas,
  count(distinct c.contato_id) filter (where c.direcao = 'saida')      as contatos_distintos,
  count(distinct c.empresa_id) filter (where c.direcao = 'saida')      as empresas_tocadas,
  count(*) filter (where c.direcao = 'saida' and c.por_ia)             as enviadas_por_ia
from public.comunicacoes c
join public.vendedores v on v.id = c.vendedor_id
where c.canal in ('whatsapp', 'email', 'ligacao', 'reuniao')
group by c.vendedor_id, v.nome, v.is_ia,
         (c.criado_em at time zone 'America/Sao_Paulo')::date, c.canal;

revoke all on public.comunicacoes_thread, public.inbox_conversas, public.atividade_comunicacao
  from anon, authenticated;
grant select on public.comunicacoes_thread, public.inbox_conversas
  to authenticated;
/*
 * `atividade_comunicacao` NÃO tem grant para `authenticated`, e é a única view
 * deste arquivo sem ele. O §8 é explícito: o painel é de gestor e de quem tem
 * `vendedor_acessos` — e nunca do próprio vendedor sobre si. Uma view legível por
 * todos deixaria essa regra na tela, onde ela é uma sugestão.
 */

-- =============================================================================
-- Escritas. Todas por RPC (convenção 0008/0047/0138): entidade + evento +
-- audit_log em UMA transação, search_path vazio, refs schema-qualificadas.
-- =============================================================================

-- ─── Normalização: a forma canônica do identificador ────────────────────────
/*
 * Uma função e não uma convenção em três lugares. O mesmo número chega como
 * "+55 (11) 99999-8888", "5511999998888" e "011999998888"; o mesmo e-mail chega
 * com maiúsculas. Se o webhook normalizasse de um jeito e o compositor de outro,
 * a mesma pessoa teria duas threads e o cooldown não veria nenhuma das duas.
 */
create or replace function public.app__identificador_canonico(p_canal text, p_valor text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_valor is null or btrim(p_valor) = '' then null
    when p_canal = 'email' then lower(btrim(p_valor))
    else nullif(regexp_replace(p_valor, '\D', '', 'g'), '')
  end;
$$;

revoke execute on function public.app__identificador_canonico(text, text) from public, anon;
grant execute on function public.app__identificador_canonico(text, text) to authenticated, service_role;

-- ─── A thread: acha ou cria, sempre pela forma canônica ─────────────────────
create or replace function public.app__conversa_para(
  p_canal text, p_identificador text, p_empresa uuid, p_contato uuid, p_vendedor uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_ident text := public.app__identificador_canonico(p_canal, p_identificador);
  v_id uuid;
begin
  if v_ident is null or p_canal not in ('whatsapp', 'email') then
    return null;
  end if;

  -- O alias `cv` não é estilo: na cláusula DO UPDATE a tabela-alvo se referencia
  -- pelo alias, e `public.conversas.coluna` ali dentro é a forma que confunde o
  -- parser com a referência de FROM.
  insert into public.conversas as cv (canal, identificador_externo, empresa_id, contato_id, responsavel_vendedor_id)
  values (p_canal, v_ident, p_empresa, p_contato, p_vendedor)
  on conflict (canal, identificador_externo) do update set
    -- Nunca APAGA um vínculo já resolvido: coalesce com o que já está lá. Uma
    -- mensagem que chega sem empresa não pode desidentificar uma thread que
    -- alguém já vinculou à mão no inbox.
    empresa_id = coalesce(cv.empresa_id, excluded.empresa_id),
    contato_id = coalesce(cv.contato_id, excluded.contato_id),
    responsavel_vendedor_id =
      coalesce(cv.responsavel_vendedor_id, excluded.responsavel_vendedor_id)
  returning cv.id into v_id;

  return v_id;
end $$;

revoke execute on function public.app__conversa_para(text, text, uuid, uuid, uuid) from public, anon, authenticated;
-- O worker CHAMA esta função nos webhooks: reimplementar o upsert em TypeScript
-- daria uma segunda definição de "a mesma thread", e a divergência apareceria
-- como duas conversas com a mesma pessoa.
grant execute on function public.app__conversa_para(text, text, uuid, uuid, uuid) to service_role;

-- ─── O toque manual passa a GRAVAR NO LEDGER ────────────────────────────────
/*
 * Esta função é o único ponto por onde o clique em `tel:`, `wa.me` e `mailto:`
 * entra no sistema — `app_registrar_toque_manual` (Antecipação) e
 * `app_fornecedor_toque` (Comercial) as duas chamam aqui. Reescrevê-la é o que
 * migra as duas telas de uma vez.
 *
 * O EVENTO CONTINUA SENDO EMITIDO, e agora é DERIVADO do ledger: ele carrega
 * `comunicacao_id` e existe para a timeline da Company 360 e para o sino. O que
 * ele deixou de ser é FONTE — quem pergunta "quando falamos com essa pessoa"
 * pergunta ao ledger.
 *
 * `status_envio = 'enviada'` aqui significa que o app ABRIU. É o máximo que um
 * link `wa.me` permite saber, e está documentado na coluna.
 */
create or replace function public.app__registrar_toque(
  p_cnpj text, p_canal text, p_contato text, p_extra jsonb, p_ator uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_empresa uuid;
  v_nome text;
  v_contato_id uuid;
  v_ident text;
  v_canal_thread text;
  v_conversa uuid;
  v_vendedor uuid;
  v_comunicacao uuid;
begin
  if p_canal not in ('ligacao', 'whatsapp', 'email') then
    raise exception 'Canal inválido: %.', p_canal using errcode = '22023';
  end if;
  if p_cnpj !~ '^[0-9]{14}$' then
    raise exception 'CNPJ inválido.' using errcode = '22023';
  end if;

  select id, coalesce(razao_social, nome_fantasia) into v_empresa, v_nome
    from public.empresas where cnpj = p_cnpj;

  /*
   * Uma LIGAÇÃO não abre thread própria — não há canal de texto para responder.
   * Ela entra na thread de WhatsApp daquele número quando existe, porque é a
   * mesma relação com a mesma pessoa, e é isso que o cooldown precisa enxergar.
   */
  v_canal_thread := case when p_canal = 'ligacao' then 'whatsapp' else p_canal end;
  v_ident := public.app__identificador_canonico(v_canal_thread, p_contato);

  if v_empresa is not null and v_ident is not null then
    select id into v_contato_id from public.contatos
      where empresa_id = v_empresa
        and public.app__identificador_canonico(v_canal_thread,
              case when v_canal_thread = 'email' then email else coalesce(whatsapp, telefone) end) = v_ident
      limit 1;
  end if;

  select vc.vendedor_id into v_vendedor
    from public.vendedor_carteira vc
    where vc.empresa_id = v_empresa and vc.ate is null
    order by case vc.papel when 'originacao' then 1 when 'sdr' then 2 else 3 end
    limit 1;

  v_conversa := public.app__conversa_para(v_canal_thread, v_ident, v_empresa, v_contato_id, v_vendedor);

  insert into public.comunicacoes (
    conversa_id, empresa_id, contato_id, canal, direcao,
    usuario_id, vendedor_id, por_ia,
    corpo, preview, provedor, conta_remetente, status_envio,
    origem, funil, funil_card_id, enviado_em
  ) values (
    v_conversa, v_empresa, v_contato_id, p_canal, 'saida',
    p_ator,
    (select v.id from public.vendedores v where v.usuario_id = p_ator limit 1),
    false,
    null,
    'Abriu ' || p_canal || ' com ' || coalesce(p_contato, coalesce(v_nome, p_cnpj)) || '.',
    'app_link', p_contato, 'enviada',
    'app_toque',
    nullif(p_extra ->> 'funil', ''), nullif(p_extra ->> 'funil_card_id', ''),
    now()
  ) returning id into v_comunicacao;

  if v_conversa is not null then
    update public.conversas
      set ultima_mensagem_em = now(), ultima_direcao = 'saida', status = 'ativa'
      where id = v_conversa;
  end if;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_empresa, 'toque.manual',
    jsonb_build_object(
      'titulo', 'Toque manual',
      'resumo', 'Contato por ' || p_canal || ' com ' || coalesce(v_nome, p_cnpj) || '.',
      'cnpj', p_cnpj,
      'canal', p_canal,
      'contato', p_contato,
      -- O evento é DERIVADO: aponta para a linha do ledger que é a verdade.
      'comunicacao_id', v_comunicacao,
      'conversa_id', v_conversa
    ) || coalesce(p_extra, '{}'::jsonb),
    p_ator
  );
end $$;

revoke execute on function public.app__registrar_toque(text, text, text, jsonb, uuid)
  from public, anon, authenticated;

-- ─── Compositor: enfileirar uma mensagem ────────────────────────────────────
/*
 * O PORTÃO tem duas metades, e a divisão não é arbitrária.
 *
 * O que é FATO DO BANCO (supressão, base legal, ponto focal, cooldown) é checado
 * AQUI, na transação que enfileira: recusar na hora é a única forma de a pessoa
 * ver o motivo. O que é FATO DO RELÓGIO E DA CONTA (janela, teto do número,
 * intervalo entre envios) é do worker, porque só ele sabe quantas mensagens
 * aquele número já mandou hoje e que horas são quando a fila for consumida.
 *
 * Um envio manual pode FURAR A JANELA com confirmação explícita (`forcar_janela`)
 * — mas nunca a supressão. Supressão é um pedido da pessoa; janela é etiqueta.
 */
create or replace function public.app_comunicacao_enfileirar(p jsonb)
returns public.mensagens_outbox language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_canal text := p ->> 'canal';
  v_contato public.contatos;
  v_destino text;
  v_ident text;
  v_empresa public.empresas;
  v_msg public.mensagens_outbox;
  v_conversa uuid;
  v_vendedor uuid;
  v_cooldown int;
  v_ultimo timestamptz;
begin
  if not public.app_tem_modulo('comunicacao') then
    raise exception 'Sem acesso ao módulo Comunicação.' using errcode = '42501';
  end if;
  if v_canal not in ('whatsapp', 'email') then
    raise exception 'Canal inválido: %.', v_canal using errcode = '22023';
  end if;
  if nullif(p ->> 'corpo', '') is null then
    raise exception 'A mensagem está vazia.' using errcode = '23514';
  end if;

  select * into v_contato from public.contatos where id = (p ->> 'contato_id')::uuid;
  if v_contato.id is null then
    raise exception 'Contato não encontrado.' using errcode = 'no_data_found';
  end if;
  select * into v_empresa from public.empresas where id = v_contato.empresa_id;

  v_destino := case when v_canal = 'email' then v_contato.email
                    else coalesce(v_contato.whatsapp, v_contato.telefone) end;
  v_ident := public.app__identificador_canonico(v_canal, v_destino);
  if v_ident is null then
    raise exception 'Este contato não tem % cadastrado.', v_canal using errcode = '23514';
  end if;

  -- ── Portão, metade do banco ──────────────────────────────────────────────
  if exists (
    select 1 from public.supressao s
    where s.valor = v_ident
      and s.escopo = case when v_canal = 'email' then 'email' else 'whatsapp' end
      and (s.expira_em is null or s.expira_em >= current_date)
  ) or exists (
    select 1 from public.supressao s
    where s.escopo = 'empresa' and s.valor = v_empresa.cnpj
      and (s.expira_em is null or s.expira_em >= current_date)
  ) then
    raise exception 'Este destinatário está na lista de supressão.' using errcode = '42501';
  end if;

  if v_contato.base_legal is null then
    raise exception 'Contato sem base legal registrada — não é possível abordá-lo.'
      using errcode = '42501';
  end if;

  -- Cooldown por CONTATO, e conta o toque manual do vendedor junto: a régua não
  -- pode atropelar quem acabou de falar com a pessoa.
  v_cooldown := coalesce((select (valor #>> '{}')::int from public.comunicacao_config
                          where chave = 'cooldown_dias'), 3);
  if v_cooldown > 0 and coalesce((p ->> 'ignorar_cooldown')::boolean, false) is not true then
    select max(criado_em) into v_ultimo from public.comunicacoes
      where contato_id = v_contato.id and direcao = 'saida';
    if v_ultimo is not null and v_ultimo > now() - make_interval(days => v_cooldown) then
      raise exception 'Falamos com este contato há menos de % dia(s).', v_cooldown
        using errcode = '23514';
    end if;
  end if;

  select vc.vendedor_id into v_vendedor
    from public.vendedor_carteira vc
    where vc.empresa_id = v_empresa.id and vc.ate is null
    order by case vc.papel when 'originacao' then 1 when 'sdr' then 2 else 3 end
    limit 1;
  v_vendedor := coalesce(
    (select v.id from public.vendedores v where v.usuario_id = v_ator limit 1),
    v_vendedor
  );

  v_conversa := public.app__conversa_para(v_canal, v_ident, v_empresa.id, v_contato.id, v_vendedor);

  insert into public.mensagens_outbox (
    canal, fornecedor_cnpj, fornecedor_nome, fornecedor_empresa_id,
    destinatario, destinatario_contato_id, destinatario_ponto_focal,
    whatsapp_conta_id, access_keys, assunto, corpo, status,
    conversa_id, empresa_id, vendedor_id, template_id, criada_por, origem,
    funil, funil_card_id, agendada_para
  ) values (
    v_canal, v_empresa.cnpj, coalesce(v_empresa.razao_social, v_empresa.nome_fantasia), v_empresa.id,
    v_ident, v_contato.id, coalesce(v_contato.ponto_focal, false),
    nullif(p ->> 'whatsapp_conta_id', '')::uuid, '{}',
    nullif(p ->> 'assunto', ''), p ->> 'corpo',
    -- O compositor é uma pessoa apertando enviar: já sai aprovada. A fila de
    -- aprovação existe para o que a MÁQUINA gerou, não para o que alguém escreveu.
    'aprovada',
    v_conversa, v_empresa.id, v_vendedor, nullif(p ->> 'template_id', '')::uuid, v_ator, 'compositor',
    nullif(p ->> 'funil', ''), nullif(p ->> 'funil_card_id', ''),
    -- `forcar_janela` = agora; senão o worker decide a próxima abertura.
    case when coalesce((p ->> 'forcar_janela')::boolean, false) then now() else null end
  ) returning * into v_msg;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comunicacao.enfileirada', 'mensagens_outbox', v_msg.id::text,
          p - 'corpo');   -- o corpo não vai para o audit: ele vive no ledger

  return v_msg;
end $$;

-- ─── §4 Vincular uma conversa não identificada ──────────────────────────────
/*
 * Uma tela, um clique, e três coisas acontecem juntas ou nenhuma: o contato
 * OFICIAL é criado na empresa, as mensagens já recebidas migram para a thread
 * dele, e a fila perde a linha. Meia vinculação seria um contato criado com a
 * conversa ainda órfã — a pessoa vincularia de novo e teria dois contatos.
 *
 * A BASE LEGAL é derivada, não perguntada: se a empresa já opera conosco, é
 * relação comercial; senão, é `manual` e a tela mostra isso como tag.
 */
create or replace function public.app_conversa_vincular(p jsonb)
returns public.conversas language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_nv public.conversas_nao_vinculadas;
  v_empresa public.empresas;
  v_contato public.contatos;
  v_conversa public.conversas;
  v_base text;
  v_vendedor uuid;
begin
  if not public.app_tem_modulo('comunicacao') then
    raise exception 'Sem acesso ao módulo Comunicação.' using errcode = '42501';
  end if;

  select * into v_nv from public.conversas_nao_vinculadas where id = (p ->> 'id')::uuid;
  if v_nv.id is null then
    raise exception 'Conversa não encontrada na fila.' using errcode = 'no_data_found';
  end if;
  if v_nv.status <> 'pendente' then
    raise exception 'Esta conversa já foi resolvida.' using errcode = '23505';
  end if;

  select * into v_empresa from public.empresas where id = (p ->> 'empresa_id')::uuid;
  if v_empresa.id is null then
    raise exception 'Empresa não encontrada.' using errcode = 'no_data_found';
  end if;
  if nullif(p ->> 'nome', '') is null then
    raise exception 'Informe o nome do contato.' using errcode = '23514';
  end if;

  v_base := case when v_empresa.estagio in ('cliente', 'ex_cliente') then 'relacao_comercial'
                 else 'manual' end;

  insert into public.contatos (
    empresa_id, nome, cargo, email, telefone, whatsapp, origem,
    base_legal, base_legal_em, base_legal_detalhe
  ) values (
    v_empresa.id, p ->> 'nome', nullif(p ->> 'cargo', ''),
    case when v_nv.canal = 'email'    then v_nv.identificador_externo end,
    case when v_nv.canal = 'whatsapp' then v_nv.identificador_externo end,
    case when v_nv.canal = 'whatsapp' then v_nv.identificador_externo end,
    'vinculado_inbox', v_base, now(),
    'Vinculado no inbox a partir de ' || v_nv.canal || ' ' || v_nv.identificador_externo
  ) returning * into v_contato;

  select vc.vendedor_id into v_vendedor
    from public.vendedor_carteira vc
    where vc.empresa_id = v_empresa.id and vc.ate is null
    order by case vc.papel when 'originacao' then 1 when 'sdr' then 2 else 3 end
    limit 1;

  insert into public.conversas as cv (canal, identificador_externo, empresa_id, contato_id, responsavel_vendedor_id)
  values (v_nv.canal, v_nv.identificador_externo, v_empresa.id, v_contato.id,
          coalesce(v_vendedor, v_nv.vendedor_sugerido_id))
  on conflict (canal, identificador_externo) do update set
    empresa_id = excluded.empresa_id,
    contato_id = excluded.contato_id,
    responsavel_vendedor_id = coalesce(cv.responsavel_vendedor_id, excluded.responsavel_vendedor_id)
  returning cv.* into v_conversa;

  /*
   * As mensagens que chegaram antes da identificação passam a ter dono.
   *
   * O recorte é a THREAD, e só ela. A primeira versão disto também varria as
   * mensagens órfãs da mesma conta recebedora — e isso puxaria para dentro desta
   * empresa as conversas de todo mundo que escreveu para o mesmo número e ainda
   * não foi identificado. O webhook já cria a thread antes de gravar a mensagem,
   * então `conversa_id` está preenchido desde a primeira linha.
   */
  update public.comunicacoes
    set empresa_id = v_empresa.id, contato_id = v_contato.id
    where conversa_id = v_conversa.id;

  update public.conversas_nao_vinculadas
    set status = 'vinculada', vinculada_contato_id = v_contato.id,
        resolvida_por = v_ator, resolvida_em = now()
    where id = v_nv.id;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_empresa.id, 'conversa.vinculada',
    jsonb_build_object(
      'titulo', 'Conversa identificada',
      'resumo', coalesce(p ->> 'nome', 'Contato') || ' (' || v_nv.canal || ') vinculado a '
                || coalesce(v_empresa.razao_social, v_empresa.nome_fantasia, v_empresa.cnpj) || '.',
      -- CAMINHO, não query string: `moduleForRoute` do core casa por rota exata
      -- ou por prefixo "<route>/", e uma URL com "?" não bate em nenhum dos dois
      -- — a validação de push do celular a deixaria passar como "rota fora de
      -- módulo". O caminho é também a rota real do app no celular.
      'url', '/comunicacao/' || v_conversa.id,
      'conversa_id', v_conversa.id,
      'contato_id', v_contato.id,
      'base_legal', v_base),
    v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comunicacao.conversa_vinculada', 'conversas', v_conversa.id::text, p);

  return v_conversa;
end $$;

create or replace function public.app_conversa_ignorar(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ator uuid := auth.uid();
begin
  if not public.app_tem_modulo('comunicacao') then
    raise exception 'Sem acesso ao módulo Comunicação.' using errcode = '42501';
  end if;
  update public.conversas_nao_vinculadas
    set status = 'ignorada', resolvida_por = v_ator, resolvida_em = now()
    where id = (p ->> 'id')::uuid and status = 'pendente';
  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comunicacao.conversa_ignorada', 'conversas_nao_vinculadas', p ->> 'id', p);
end $$;

-- ─── Inbox: marcar lida ─────────────────────────────────────────────────────
create or replace function public.app_conversa_marcar_lida(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.app_tem_modulo('comunicacao') then
    raise exception 'Sem acesso ao módulo Comunicação.' using errcode = '42501';
  end if;
  update public.conversas set nao_lidas = 0 where id = (p ->> 'id')::uuid;
end $$;

-- ─── §7 Modo do agente por conversa ─────────────────────────────────────────
create or replace function public.app_conversa_definir_modo(p jsonb)
returns public.conversas language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_modo text := p ->> 'modo_agente';
  v_conversa public.conversas;
begin
  if not public.app_tem_modulo('comunicacao') then
    raise exception 'Sem acesso ao módulo Comunicação.' using errcode = '42501';
  end if;
  if v_modo not in ('sugestao', 'autonomo', 'desligado') then
    raise exception 'Modo inválido: %.', v_modo using errcode = '22023';
  end if;

  update public.conversas set
    modo_agente = v_modo,
    objetivo = coalesce(nullif(p ->> 'objetivo', ''), objetivo),
    playbook_id = coalesce(nullif(p ->> 'playbook_id', '')::uuid, playbook_id)
  where id = (p ->> 'id')::uuid
  returning * into v_conversa;

  if v_conversa.id is null then
    raise exception 'Conversa não encontrada.' using errcode = 'no_data_found';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comunicacao.modo_agente_alterado', 'conversas', v_conversa.id::text, p);

  return v_conversa;
end $$;

-- ─── §7 Aceitar / descartar o próximo passo sugerido ────────────────────────
/*
 * Aceitar uma sugestão de mensagem NÃO envia direto: enfileira, e a fila passa
 * pelo mesmo portão do §5. Um caminho de envio que pula o portão porque "o
 * humano aprovou" é exatamente como se manda mensagem para quem pediu para não
 * receber — o humano aprovou o TEXTO, não a legalidade do disparo.
 */
create or replace function public.app_agente_aceitar(p jsonb)
returns public.mensagens_outbox language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_dec public.agente_decisoes;
  v_conversa public.conversas;
  v_msg public.mensagens_outbox;
begin
  if not public.app_tem_modulo('comunicacao') then
    raise exception 'Sem acesso ao módulo Comunicação.' using errcode = '42501';
  end if;

  select * into v_dec from public.agente_decisoes where id = (p ->> 'id')::uuid;
  if v_dec.id is null then
    raise exception 'Sugestão não encontrada.' using errcode = 'no_data_found';
  end if;
  if v_dec.executada or v_dec.descartada then
    raise exception 'Esta sugestão já foi resolvida.' using errcode = '23505';
  end if;

  select * into v_conversa from public.conversas where id = v_dec.conversa_id;

  if v_dec.acao in ('responder_agora', 'enviar_link_agendamento') and v_conversa.contato_id is not null then
    v_msg := public.app_comunicacao_enfileirar(jsonb_build_object(
      'canal', coalesce(v_dec.canal, v_conversa.canal),
      'contato_id', v_conversa.contato_id,
      'corpo', coalesce(nullif(p ->> 'corpo', ''), v_dec.conteudo_sugerido),
      'assunto', nullif(p ->> 'assunto', ''),
      -- Aceitar uma sugestão é um ato humano sobre uma conversa viva: o cooldown
      -- da régua automática não se aplica ao que a pessoa acabou de ler e aprovar.
      'ignorar_cooldown', true
    ));
  end if;

  update public.agente_decisoes
    set executada = true, executada_em = now(), aceita_por = v_ator
    where id = v_dec.id;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comunicacao.agente_aceito', 'agente_decisoes', v_dec.id::text, p - 'corpo');

  return v_msg;
end $$;

create or replace function public.app_agente_descartar(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ator uuid := auth.uid();
begin
  if not public.app_tem_modulo('comunicacao') then
    raise exception 'Sem acesso ao módulo Comunicação.' using errcode = '42501';
  end if;
  update public.agente_decisoes
    set descartada = true, desfecho = coalesce(desfecho, 'sem_resposta'), desfecho_em = now()
    where id = (p ->> 'id')::uuid and not executada;
  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comunicacao.agente_descartado', 'agente_decisoes', p ->> 'id', p);
end $$;

-- ─── Templates, config e playbooks ──────────────────────────────────────────
create or replace function public.app_salvar_template_mensagem(p jsonb)
returns public.templates_mensagem language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_t public.templates_mensagem;
  v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  if not public.app_tem_modulo('comunicacao') then
    raise exception 'Sem acesso ao módulo Comunicação.' using errcode = '42501';
  end if;

  if v_id is null then
    insert into public.templates_mensagem (nome, canal, funil, objetivo, assunto, corpo, variaveis, ativo, criado_por)
    values (p ->> 'nome', p ->> 'canal', nullif(p ->> 'funil', ''), nullif(p ->> 'objetivo', ''),
            nullif(p ->> 'assunto', ''), p ->> 'corpo',
            coalesce((select array_agg(value #>> '{}') from jsonb_array_elements(coalesce(p -> 'variaveis', '[]'::jsonb))), '{}'),
            coalesce((p ->> 'ativo')::boolean, true), v_ator)
    returning * into v_t;
  else
    update public.templates_mensagem set
      nome = coalesce(p ->> 'nome', nome),
      canal = coalesce(p ->> 'canal', canal),
      funil = coalesce(nullif(p ->> 'funil', ''), funil),
      objetivo = coalesce(nullif(p ->> 'objetivo', ''), objetivo),
      assunto = coalesce(nullif(p ->> 'assunto', ''), assunto),
      corpo = coalesce(p ->> 'corpo', corpo),
      variaveis = coalesce(
        (select array_agg(value #>> '{}') from jsonb_array_elements(p -> 'variaveis')), variaveis),
      ativo = coalesce((p ->> 'ativo')::boolean, ativo)
    where id = v_id returning * into v_t;
    if v_t.id is null then
      raise exception 'Template não encontrado.' using errcode = 'no_data_found';
    end if;
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comunicacao.template_salvo', 'templates_mensagem', v_t.id::text, p);
  return v_t;
end $$;

create or replace function public.app_salvar_comunicacao_config(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_chave text;
begin
  -- Settings do módulo são de ADMIN: a janela de envio, o teto por número e o
  -- kill switch valem para a casa inteira, não para quem abriu a tela.
  if not public.app_is_admin() then
    raise exception 'Somente administradores alteram as configurações de Comunicação.'
      using errcode = '42501';
  end if;

  for v_chave in select jsonb_object_keys(p) loop
    insert into public.comunicacao_config (chave, valor, atualizado_por)
    values (v_chave, p -> v_chave, v_ator)
    on conflict (chave) do update
      set valor = excluded.valor, atualizado_por = excluded.atualizado_por, atualizado_em = now();
  end loop;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comunicacao.config_salva', 'comunicacao_config', null, p);
end $$;

/*
 * Um playbook editado nunca é sobrescrito: `versao` sobe e a linha antiga fica
 * inativa. As decisões já tomadas apontam para a versão que as produziu — sem
 * isso, o painel de eficácia compararia resultados de instruções diferentes sob
 * o mesmo nome, que é a forma mais silenciosa de aprender errado.
 */
create or replace function public.app_salvar_playbook(p jsonb)
returns public.agente_playbooks language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_pb public.agente_playbooks;
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_versao int := 1;
begin
  if not public.app_is_admin() then
    raise exception 'Somente administradores editam playbooks do agente.' using errcode = '42501';
  end if;

  if v_id is not null then
    select * into v_pb from public.agente_playbooks where id = v_id;
    if v_pb.id is null then
      raise exception 'Playbook não encontrado.' using errcode = 'no_data_found';
    end if;
    update public.agente_playbooks set ativo = false where id = v_id;
    v_versao := v_pb.versao + 1;
  end if;

  insert into public.agente_playbooks (
    nome, funil, objetivo, instrucoes, acoes_permitidas, templates_disponiveis, prazos, ativo, versao
  ) values (
    coalesce(p ->> 'nome', v_pb.nome),
    coalesce(p ->> 'funil', v_pb.funil),
    coalesce(p ->> 'objetivo', v_pb.objetivo),
    coalesce(p ->> 'instrucoes', v_pb.instrucoes),
    coalesce((select array_agg(value #>> '{}') from jsonb_array_elements(p -> 'acoes_permitidas')),
             v_pb.acoes_permitidas),
    coalesce((select array_agg((value #>> '{}')::uuid) from jsonb_array_elements(p -> 'templates_disponiveis')),
             coalesce(v_pb.templates_disponiveis, '{}')),
    coalesce(p -> 'prazos', coalesce(v_pb.prazos, '{}'::jsonb)),
    coalesce((p ->> 'ativo')::boolean, true),
    v_versao
  ) returning * into v_pb;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comunicacao.playbook_salvo', 'agente_playbooks', v_pb.id::text, p);
  return v_pb;
end $$;

-- ─── §8 Painel de atividade (restrito por PESSOA, não por linha) ────────────
/*
 * A regra do §8 não cabe numa policy, e por isso a view não tem grant: ela não
 * diz quais LINHAS alguém vê, diz QUEM pode perguntar. Um gestor vê todos; quem
 * tem `vendedor_acessos` vê os que lhe foram liberados; e o vendedor NÃO vê o
 * próprio painel.
 *
 * Essa última é a decisão de desenho, e é deliberada: um painel de volume que a
 * pessoa vê sobre si mesma vira meta, e a meta mais fácil de bater aqui é mandar
 * mais mensagem. Por isso, também, volume nunca vem sozinho — taxa de resposta,
 * reuniões agendadas e NFs convertidas vêm na mesma linha.
 */
create or replace function public.app_comunicacao_atividade(p jsonb)
returns jsonb language plpgsql security definer stable set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_eu uuid := public.app_vendedor_atual();
  v_gestor boolean := public.app_gestor_comercial();
  v_de date := coalesce(nullif(p ->> 'de', '')::date, current_date - 29);
  v_ate date := coalesce(nullif(p ->> 'ate', '')::date, current_date);
  v_visiveis uuid[];
  v_linhas jsonb;
begin
  if not public.app_tem_modulo('comunicacao') then
    raise exception 'Sem acesso ao módulo Comunicação.' using errcode = '42501';
  end if;

  if v_gestor then
    select coalesce(array_agg(id), '{}') into v_visiveis from public.vendedores where ativo;
  else
    select coalesce(array_agg(a.pode_ver_vendedor_id), '{}') into v_visiveis
      from public.vendedor_acessos a where a.vendedor_id = v_eu;
  end if;

  -- O próprio nunca entra, nem para o gestor que também é vendedor.
  -- (Guardado contra null: quem não é vendedor não tem o que remover, e
  -- `array_remove(arr, null)` não é a mesma pergunta.)
  if v_eu is not null then
    v_visiveis := array_remove(v_visiveis, v_eu);
  end if;

  if coalesce(array_length(v_visiveis, 1), 0) = 0 then
    return jsonb_build_object('tem_acesso', false, 'linhas', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(l order by l ->> 'vendedor_nome'), '[]'::jsonb) into v_linhas
  from (
    select jsonb_build_object(
      'vendedor_id', a.vendedor_id,
      'vendedor_nome', a.vendedor_nome,
      'is_ia', a.is_ia,
      'canal', a.canal,
      'enviadas', sum(a.enviadas),
      'recebidas', sum(a.recebidas),
      'contatos_distintos_dia', round(avg(a.contatos_distintos), 1),
      'empresas_tocadas', sum(a.empresas_tocadas),
      'taxa_resposta', case when sum(a.enviadas) > 0
                            then round(100.0 * sum(a.recebidas) / sum(a.enviadas), 1) else 0 end,
      'reunioes_agendadas', (
        select count(*) from public.vendedor_eventos ve
        where ve.vendedor_id = a.vendedor_id and ve.cancelado_em is null
          and ve.criado_em::date between v_de and v_ate),
      'nfs_convertidas', (
        select count(*) from public.notas_fiscais nf
        where nf.vendedor_id = a.vendedor_id and nf.estagio_funil = 'convertida'
          and nf.estagio_alterado_em::date between v_de and v_ate)
    ) as l
    from public.atividade_comunicacao a
    where a.vendedor_id = any (v_visiveis)
      and a.dia between v_de and v_ate
      and (nullif(p ->> 'canal', '') is null or a.canal = p ->> 'canal')
    group by a.vendedor_id, a.vendedor_nome, a.is_ia, a.canal
  ) s;

  return jsonb_build_object('tem_acesso', true, 'de', v_de, 'ate', v_ate, 'linhas', v_linhas);
end $$;

-- ─── Segredos: o worker lê do Vault, e ninguém mais ─────────────────────────
/*
 * `vault.decrypted_secrets` não é legível por `authenticated`, e esta função não
 * muda isso: ela é DEFINER e o EXECUTE é concedido SÓ a `service_role`. É o
 * caminho pelo qual o worker pega o token do Wasender e o refresh token do
 * Gmail — os dois lugares onde a credencial precisa sair do banco para ir à rede.
 */
create or replace function public.app__segredo_vault(p_id uuid)
returns text language sql security definer stable set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_id;
$$;

revoke execute on function public.app__segredo_vault(uuid) from public, anon, authenticated;
grant execute on function public.app__segredo_vault(uuid) to service_role;

/*
 * A conexão do Gmail é gravada pelo CALLBACK OAuth, que roda no servidor da web
 * com service role — nunca pelo browser. Os dois tokens vão para o Vault e o que
 * fica na tabela são ponteiros, como na `whatsapp_contas`.
 */
create or replace function public.app_salvar_gmail_conta(p jsonb)
returns public.gmail_contas language plpgsql security definer set search_path = '' as $$
declare
  v_c public.gmail_contas;
  v_refresh uuid;
  v_access uuid;
  v_usuario uuid := (p ->> 'usuario_id')::uuid;
begin
  if nullif(p ->> 'refresh_token', '') is not null then
    v_refresh := vault.create_secret(
      p ->> 'refresh_token',
      'gmail_refresh_' || v_usuario::text || '_' || extract(epoch from now())::bigint::text,
      'Refresh token do Gmail (' || (p ->> 'endereco') || ').');
  end if;
  if nullif(p ->> 'access_token', '') is not null then
    v_access := vault.create_secret(
      p ->> 'access_token',
      'gmail_access_' || v_usuario::text || '_' || extract(epoch from now())::bigint::text,
      'Access token do Gmail (' || (p ->> 'endereco') || ').');
  end if;

  insert into public.gmail_contas as gc (
    usuario_id, endereco, refresh_token_secret_id, access_token_secret_id,
    access_token_expira_em, escopos, ativo, ultimo_erro
  ) values (
    v_usuario, lower(p ->> 'endereco'), v_refresh, v_access,
    nullif(p ->> 'access_token_expira_em', '')::timestamptz,
    coalesce((select array_agg(value #>> '{}') from jsonb_array_elements(coalesce(p -> 'escopos', '[]'::jsonb))), '{}'),
    true, null)
  on conflict (usuario_id) do update set
    endereco = excluded.endereco,
    -- Um refresh ausente na renovação NÃO apaga o que já está guardado: o Google
    -- só devolve o refresh token no primeiro consentimento.
    refresh_token_secret_id = coalesce(excluded.refresh_token_secret_id, gc.refresh_token_secret_id),
    access_token_secret_id = coalesce(excluded.access_token_secret_id, gc.access_token_secret_id),
    access_token_expira_em = excluded.access_token_expira_em,
    escopos = excluded.escopos,
    ativo = true,
    ultimo_erro = null
  returning gc.* into v_c;

  return v_c;
end $$;

revoke execute on function public.app_salvar_gmail_conta(jsonb) from public, anon, authenticated;
grant execute on function public.app_salvar_gmail_conta(jsonb) to service_role;

create or replace function public.app_desconectar_gmail(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ator uuid := auth.uid();
begin
  -- Desconectar é sempre sobre a PRÓPRIA caixa. Ninguém desconecta a do colega.
  update public.gmail_contas
    set ativo = false, history_id = null, watch_expira_em = null
    where usuario_id = v_ator;
  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comunicacao.gmail_desconectado', 'gmail_contas', v_ator::text, p);
end $$;

-- ─── Pedido de apresentação: enviar pelo cano da casa ───────────────────────
/*
 * Antes o "enviar" era marcação manual de quem mandou por fora (04l). Agora ele
 * enfileira de verdade, e o texto migra do `pedidos_apresentacao.mensagem` para
 * o ledger — a constraint `pedidos_apresentacao_sem_copia_do_ledger` garante que
 * ele não fique nos dois lugares.
 */
create or replace function public.app_pedido_apresentacao_enviar(p jsonb)
returns public.pedidos_apresentacao language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_pedido public.pedidos_apresentacao;
  v_msg public.mensagens_outbox;
begin
  if not public.app_tem_modulo('comunicacao') then
    raise exception 'Sem acesso ao módulo Comunicação.' using errcode = '42501';
  end if;

  select * into v_pedido from public.pedidos_apresentacao where id = (p ->> 'id')::uuid;
  if v_pedido.id is null then
    raise exception 'Pedido não encontrado.' using errcode = 'no_data_found';
  end if;
  if v_pedido.contato_sacado_id is null then
    raise exception 'O pedido não tem contato do sacado escolhido.' using errcode = '23514';
  end if;

  v_msg := public.app_comunicacao_enfileirar(jsonb_build_object(
    'canal', coalesce(nullif(p ->> 'canal', ''), 'email'),
    'contato_id', v_pedido.contato_sacado_id,
    'corpo', coalesce(nullif(p ->> 'corpo', ''), v_pedido.mensagem),
    'assunto', coalesce(nullif(p ->> 'assunto', ''), 'Apresentação de fornecedor'),
    'funil', 'fornecedores',
    'funil_card_id', v_pedido.fornecedor_cnpj
  ));

  update public.pedidos_apresentacao
    set status = 'enviado',
        -- O texto passa a viver no ledger; aqui fica o estado e a referência.
        -- A comunicação real só existirá quando o worker enviar, e é ele quem
        -- preenche `comunicacao_id` — daqui sai apenas o rascunho apagado.
        mensagem = null
    where id = v_pedido.id
    returning * into v_pedido;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comunicacao.apresentacao_enviada', 'pedidos_apresentacao', v_pedido.id::text,
          jsonb_build_object('outbox_id', v_msg.id));

  return v_pedido;
end $$;

-- ─── Fechar a superfície ────────────────────────────────────────────────────
revoke execute on function
  public.app_comunicacao_enfileirar(jsonb), public.app_conversa_vincular(jsonb),
  public.app_conversa_ignorar(jsonb), public.app_conversa_marcar_lida(jsonb),
  public.app_conversa_definir_modo(jsonb), public.app_agente_aceitar(jsonb),
  public.app_agente_descartar(jsonb), public.app_salvar_template_mensagem(jsonb),
  public.app_salvar_comunicacao_config(jsonb), public.app_salvar_playbook(jsonb),
  public.app_comunicacao_atividade(jsonb), public.app_desconectar_gmail(jsonb),
  public.app_pedido_apresentacao_enviar(jsonb)
from public, anon;

grant execute on function
  public.app_comunicacao_enfileirar(jsonb), public.app_conversa_vincular(jsonb),
  public.app_conversa_ignorar(jsonb), public.app_conversa_marcar_lida(jsonb),
  public.app_conversa_definir_modo(jsonb), public.app_agente_aceitar(jsonb),
  public.app_agente_descartar(jsonb), public.app_salvar_template_mensagem(jsonb),
  public.app_salvar_comunicacao_config(jsonb), public.app_salvar_playbook(jsonb),
  public.app_comunicacao_atividade(jsonb), public.app_desconectar_gmail(jsonb),
  public.app_pedido_apresentacao_enviar(jsonb)
to authenticated, service_role;

-- =============================================================================
-- Módulo, notificações e configuração de fábrica
-- =============================================================================

insert into public.perfil_modulos (perfil_id, modulo_id)
select p.id, 'comunicacao' from public.perfis p
where p.nome in ('Admin', 'Comercial', 'SDR', 'Originador', 'Closer')
on conflict do nothing;

/*
 * As regras do SINO. Ficam de fora daqui as que têm destinatário POR LINHA — o
 * dono da conversa, o advogado daquele processo — porque elas saem por `notify()`
 * no worker, e uma regra aqui faria o sino receber a mesma coisa duas vezes
 * (mesmo cuidado da 0034 e da 0143).
 *
 * `comunicacao.recebida` NÃO tem regra: uma mensagem recebida é do dono da
 * thread, e um perfil inteiro receberia todas as conversas de todo mundo.
 */
insert into public.notificacao_regras (tipo_evento, perfil_id, ativo)
select v.tipo, p.id, true
from (values
  ('conversa.nao_vinculada', 'Admin'),
  ('conversa.nao_vinculada', 'Comercial'),
  ('optout.registrado',      'Admin'),
  ('comunicacao.falhou',     'Admin'),
  ('agente.escalou',         'Comercial')
) as v(tipo, perfil)
join public.perfis p on p.nome = v.perfil
where not exists (
  select 1 from public.notificacao_regras r where r.tipo_evento = v.tipo and r.perfil_id = p.id
);

/*
 * A JANELA nasce fechada nos fins de semana e no horário comercial de São Paulo,
 * e nasce assim porque o custo do erro é assimétrico: uma mensagem enviada tarde
 * demais custa um dia; uma mensagem enviada às 23h custa a relação.
 *
 * `kill_switch` nasce falso e é a única setting deste arquivo que uma pessoa
 * aperta com pressa. Ela para TODOS os modos autônomos de uma vez (§7.5) — não
 * pausa, não agenda, não pergunta.
 */
insert into public.comunicacao_config (chave, valor) values
  ('janela', jsonb_build_object(
      'dias_semana', jsonb_build_array(1, 2, 3, 4, 5),
      'hora_inicio', 9,
      'hora_fim', 18,
      'timezone', 'America/Sao_Paulo')),
  ('cooldown_dias', '3'::jsonb),
  ('teto_diario_por_thread', '3'::jsonb),
  -- Rampa de warmup para número novo: 20/dia, +20 por semana até o teto da conta.
  ('warmup', jsonb_build_object('inicial_por_dia', 20, 'incremento_semanal', 20)),
  ('inatividade_horas', '4'::jsonb),
  ('agente', jsonb_build_object(
      'kill_switch', false,
      'confianca_minima', 0.6,
      -- O DISCADOR é ferramenta DECLARADA e DESLIGADA (§7.2): o agente pode
      -- escolher `ligar`, o executor recusa com "não disponível". Está aqui para
      -- que ligar o discador de IA externo seja uma linha de config, e para que
      -- as decisões que pediram ligação apareçam no log desde já.
      'ligacao_habilitada', false,
      'cadencia_fallback_dias', jsonb_build_array(0, 3, 7))),
  ('plantao', jsonb_build_object(
      'eventos', jsonb_build_array(
        'orcamento.estourado', 'mercado.ingestao_falhou', 'lote.aguardando_aprovacao',
        'analise_propria.divergencia_seguradora', 'analise.limite_reduzido',
        'sdr.aceite_pendente'),
      'perfis', jsonb_build_array('Admin')))
on conflict (chave) do nothing;

-- ─── Base legal do que já existe ────────────────────────────────────────────
/*
 * Derivada da ORIGEM, uma vez, aqui — não digitada depois. Um contato que veio do
 * XML de uma NF-e tem base `dado_publico_nfe`; um que veio de formulário tem
 * aceite; o de um cliente ativo é relação comercial. O que não se encaixa fica
 * NULL de propósito: o portão recusa o envio e a tela pede a base — que é melhor
 * que carimbar "manual" em tudo e nunca mais saber de onde veio.
 */
update public.contatos c set
  base_legal = case
    -- A origem do formulário é gravada como 'formulario:<slug>' (0120), nunca
    -- como 'formulario' seco. Casar pelo prefixo é o que faz o aceite valer.
    when c.origem like 'formulario%'                   then 'formulario_aceite'
    when c.origem in ('xml_nfe', 'nfe', 'sacado')      then 'dado_publico_nfe'
    when exists (select 1 from public.empresas e
                 where e.id = c.empresa_id and e.estagio in ('cliente', 'ex_cliente'))
                                                        then 'relacao_comercial'
    when c.origem is not null                          then 'manual'
  end,
  base_legal_em = now()
where c.base_legal is null;

-- ─── Templates de fábrica, por funil ────────────────────────────────────────
/*
 * Um seed por funil, e não um genérico: a primeira frase de uma mensagem sobre
 * uma nota disponível não se parece com a de um convite para conversa, e um
 * template "olá {nome}" que serve a tudo é o que faz todo mundo escrever à mão
 * de novo — e aí a régua deixa de descrever o que o fornecedor recebe.
 */
-- Os corpos de e-mail usam E'' porque têm quebra de linha real: com
-- `standard_conforming_strings` ligado (o padrão), um '\n' numa string comum é
-- barra-ene literal, e a mensagem sairia com o escape à mostra.
insert into public.templates_mensagem (nome, canal, funil, objetivo, assunto, corpo, variaveis) values
  ('NF disponível para antecipação', 'whatsapp', 'nfs', 'antecipar_nf', null,
   'Olá, {contato_nome}! Aqui é {remetente_nome}, da ONE OS. Vi que a {empresa_nome} tem '
   '{qtd_notas} nota(s) de {sacado_principal} somando {valor_total}. Conseguimos antecipar '
   'esse valor ainda esta semana — quer que eu te mande a simulação?',
   '{contato_nome,empresa_nome,qtd_notas,sacado_principal,valor_total,remetente_nome}'),
  ('NF disponível para antecipação', 'email', 'nfs', 'antecipar_nf',
   'Antecipação disponível para {empresa_nome}',
   E'Olá, {contato_nome},\n\nAqui é {remetente_nome}, da ONE OS. A {empresa_nome} tem '
   '{qtd_notas} nota(s) de {sacado_principal} somando {valor_total} que podem ser '
   'antecipadas.\n\nPosso te mandar a simulação?\n\n{remetente_nome}\nONE OS',
   '{contato_nome,empresa_nome,qtd_notas,sacado_principal,valor_total,remetente_nome}'),
  ('Primeira abordagem ao fornecedor', 'whatsapp', 'fornecedores', 'cadastrar_fornecedor', null,
   'Olá, {contato_nome}! Aqui é {remetente_nome}, da ONE OS. Trabalhamos com antecipação de '
   'recebíveis para fornecedores da construção. Vi que a {empresa_nome} fatura para '
   '{sacado_principal}. Faz sentido conversarmos?',
   '{contato_nome,empresa_nome,sacado_principal,remetente_nome}'),
  ('Pedido de apresentação ao sacado', 'email', 'fornecedores', 'cadastrar_fornecedor',
   'Apresentação de fornecedor — {fornecedor_nome}',
   E'Olá, {contato_nome},\n\nEstamos tentando falar com a {fornecedor_nome}, que é fornecedora '
   'de vocês, para oferecer antecipação dos recebíveis. Você conseguiria nos apresentar a '
   'quem cuida do financeiro lá?\n\nObrigado,\n{remetente_nome}\nONE OS',
   '{contato_nome,fornecedor_nome,remetente_nome}'),
  ('Convite para conversa', 'whatsapp', 'sdr', 'agendar_reuniao', null,
   'Olá, {contato_nome}! Aqui é {remetente_nome}, da ONE OS. Ajudamos construtoras a '
   'antecipar recebíveis e a organizar o pagamento de fornecedores. Tem 20 minutos esta '
   'semana para eu te mostrar como funciona?',
   '{contato_nome,empresa_nome,remetente_nome}'),
  ('Confirmação de reunião', 'whatsapp', 'sdr', 'agendar_reuniao', null,
   'Combinado, {contato_nome}! Nossa conversa fica para {data_reuniao}. Te mando o link '
   'pouco antes. Qualquer coisa é só responder por aqui.',
   '{contato_nome,data_reuniao}'),
  ('Lembrete D-1', 'whatsapp', 'sdr', 'agendar_reuniao', null,
   'Oi, {contato_nome}! Passando para lembrar da nossa conversa amanhã, {data_reuniao}. '
   'Segue de pé?',
   '{contato_nome,data_reuniao}'),
  ('Lembrete H-1', 'whatsapp', 'sdr', 'agendar_reuniao', null,
   'Oi, {contato_nome}! Nossa conversa é daqui a pouco, às {hora_reuniao}. Te espero!',
   '{contato_nome,hora_reuniao}'),
  ('Reagendamento pós no-show', 'whatsapp', 'sdr', 'agendar_reuniao', null,
   'Oi, {contato_nome}! Não consegui te encontrar em {data_reuniao} — imagino que tenha '
   'aparecido algo. Quer que eu remarque para outro dia desta semana?',
   '{contato_nome,data_reuniao}'),
  ('Pedido de documentação', 'email', 'vendas', 'cobrar_documentacao',
   'Documentos para seguirmos com a {empresa_nome}',
   E'Olá, {contato_nome},\n\nPara seguirmos com a análise da {empresa_nome}, preciso dos '
   'documentos abaixo:\n\n{lista_documentos}\n\nAssim que chegarem, retomo daqui.\n\n'
   '{remetente_nome}\nONE OS',
   '{contato_nome,empresa_nome,lista_documentos,remetente_nome}'),
  ('Follow-up de proposta', 'whatsapp', 'vendas', 'cobrar_documentacao', null,
   'Oi, {contato_nome}! Conseguiu olhar a proposta que mandei? Qualquer dúvida eu resolvo '
   'por aqui mesmo.',
   '{contato_nome}'),
  ('Certificado vencendo', 'whatsapp', 'certificados', 'renovar_certificado', null,
   'Olá, {contato_nome}! O certificado digital da {empresa_nome} vence em {dias_para_vencer} '
   'dia(s), em {data_vencimento}. Quer que a gente cuide da renovação?',
   '{contato_nome,empresa_nome,dias_para_vencer,data_vencimento}'),
  ('Cauda de SPEs', 'email', 'certificados', 'renovar_certificado',
   'Certificados das SPEs da {empresa_nome}',
   E'Olá, {contato_nome},\n\nAlém da matriz, identificamos {qtd_spes} SPE(s) da '
   '{empresa_nome} com certificado a vencer. Podemos renovar tudo de uma vez.\n\n'
   '{remetente_nome}\nONE OS',
   '{contato_nome,empresa_nome,qtd_spes,remetente_nome}')
on conflict (nome, canal) do nothing;

-- ─── Playbooks de fábrica ───────────────────────────────────────────────────
/*
 * `acoes_permitidas` é um SUBCONJUNTO do espaço fechado do §7.2, e o recorte é a
 * parte que importa: o playbook de cobrança de documentação não pode marcar
 * "sem interesse", e o de SDR não pode trocar o contato da conversa sem que
 * alguém tenha indicado outro nome. Um playbook que pode tudo é o agente sem
 * playbook nenhum.
 */
insert into public.agente_playbooks (nome, funil, objetivo, instrucoes, acoes_permitidas, prazos, versao) values
  ('Fornecedor a cadastrar', 'fornecedores', 'cadastrar_fornecedor',
   'Você fala em nome da ONE OS com o financeiro de um fornecedor da construção civil. '
   'O objetivo é conseguir que ele se cadastre para antecipar os recebíveis dele. Seja '
   'curto e concreto: cite o sacado e o volume, nunca taxa, limite ou valor de operação. '
   'Se a pessoa disser que não decide, peça o nome de quem decide.',
   '{responder_agora,agendar_toque,mudar_estagio_funil,marcar_sem_interesse,escalar_humano,pedir_enriquecimento_contato,trocar_contato_da_conversa,aguardar}',
   '{"silencio_dias": 4, "max_tentativas": 4, "desistir_apos_dias": 30}', 1),
  ('SDR a contatar', 'sdr', 'agendar_reuniao',
   'Você fala em nome da ONE OS com um decisor de construtora. O objetivo é marcar uma '
   'conversa de 20 minutos. Não explique o produto inteiro: o objetivo da mensagem é a '
   'agenda, não a venda. Ofereça dois horários concretos quando fizer sentido.',
   '{responder_agora,agendar_toque,enviar_link_agendamento,mudar_estagio_funil,marcar_sem_interesse,escalar_humano,trocar_contato_da_conversa,aguardar}',
   '{"silencio_dias": 3, "max_tentativas": 5, "desistir_apos_dias": 21}', 1),
  ('NF em faixa alta', 'nfs', 'antecipar_nf',
   'Um fornecedor tem notas de alto valor disponíveis para antecipação. O objetivo é '
   'conseguir a autorização para simular. NUNCA cite taxa, limite ou valor de operação — '
   'isso é conversa de gente, e um pedido nesse sentido é escalação imediata.',
   '{responder_agora,agendar_toque,mudar_estagio_funil,escalar_humano,aguardar}',
   '{"silencio_dias": 2, "max_tentativas": 3, "desistir_apos_dias": 14}', 1),
  ('Cobrança de documentação', 'vendas', 'cobrar_documentacao',
   'Uma venda está parada esperando documentos do cliente. O objetivo é destravar. Seja '
   'específico sobre o que falta e ofereça ajuda para conseguir. Qualquer menção a prazo '
   'de contrato, taxa ou condição comercial é escalação imediata.',
   '{responder_agora,agendar_toque,escalar_humano,aguardar}',
   '{"silencio_dias": 3, "max_tentativas": 4, "desistir_apos_dias": 20}', 1),
  ('Certificado vencendo', 'certificados', 'renovar_certificado',
   'O certificado digital da empresa está perto de vencer. O objetivo é conseguir o aceite '
   'para renovar. É uma conversa operacional e curta — a urgência já está na data.',
   '{responder_agora,agendar_toque,mudar_estagio_funil,marcar_sem_interesse,escalar_humano,aguardar}',
   '{"silencio_dias": 5, "max_tentativas": 3, "desistir_apos_dias": 45}', 1),
  ('Reengajamento antes do SLA', 'sdr', 'reativar',
   'Um lead distribuído está prestes a estourar o SLA sem toque nenhum. O objetivo é abrir '
   'a conversa antes que ele volte para o pool. Uma mensagem, curta, sem cobrança.',
   '{responder_agora,agendar_toque,escalar_humano,aguardar}',
   '{"silencio_dias": 2, "max_tentativas": 2, "desistir_apos_dias": 10}', 1)
on conflict (nome, versao) do nothing;

-- ─── §5 O passo entre a régua e o envio ─────────────────────────────────────
/*
 * A régua da Antecipação gera `pendente_envio` — o que ela ACHA que deve sair. O
 * worker de envio consome `aprovada`. Entre os dois existe uma pessoa, e é
 * deliberado: ligar canais primeiro e conferir depois é como se queima uma base
 * de contatos.
 *
 * O compositor não passa por aqui: quem escreveu já aprovou ao apertar enviar. A
 * fila de aprovação existe para o que a MÁQUINA gerou.
 *
 * Aprovar NÃO envia. A linha entra na fila e continua passando pelo portão do
 * worker (janela, teto do número, warmup) — aprovar o texto não é aprovar o
 * horário nem a saúde do número.
 */
create or replace function public.app_aprovar_mensagem(p jsonb)
returns setof public.mensagens_outbox language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_ids uuid[];
begin
  if not public.app_tem_modulo('antecipacao') and not public.app_tem_modulo('comunicacao') then
    raise exception 'Sem acesso à fila de envio.' using errcode = '42501';
  end if;

  /*
   * Aceita `id` (uma) ou `ids` (várias). A aprovação em lote é o caso real: a
   * régua gera dezenas por rodada, e aprovar uma a uma faria a pessoa parar de
   * ler o que aprova depois da quinta.
   */
  v_ids := coalesce(
    (select array_agg((value #>> '{}')::uuid) from jsonb_array_elements(p -> 'ids')),
    case when nullif(p ->> 'id', '') is not null then array[(p ->> 'id')::uuid] end
  );

  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'Nenhuma mensagem informada.' using errcode = '22023';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comunicacao.mensagens_aprovadas', 'mensagens_outbox', null,
          jsonb_build_object('quantidade', array_length(v_ids, 1)));

  return query
    update public.mensagens_outbox
      set status = 'aprovada', erro = null
      where id = any (v_ids) and status = 'pendente_envio'
      returning *;
end $$;

revoke execute on function public.app_aprovar_mensagem(jsonb) from public, anon;
grant execute on function public.app_aprovar_mensagem(jsonb) to authenticated, service_role;

comment on function public.app_aprovar_mensagem(jsonb) is
  'Move mensagens da régua de `pendente_envio` para `aprovada`. Aprovar NÃO envia: a '
  'linha entra na fila e continua passando pelo portão do worker.';
