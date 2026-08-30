# JOBSITEOS — Claude Code Prompt 05A: O Cano, o Ledger e o Agente
## Transporte real (WhatsApp, e-mail), inbox unificado, thread por pessoa e Agente de Próximo Passo

> Builds on Prompts 01–08. **Reutiliza e absorve** o que já existe: `mensagens_outbox`, `whatsapp_contas` (token no Vault), `faixa_disparos`, `supressao` + `estaSuprimido()`, `contatos.ponto_focal`, evento `toque.manual`, `vendedores.whatsapp_conta_id`/`email_remetente`, `renderizarTemplate()`, a aba "Mensagens" vazia do `ModalDoCard`, `pedidos_apresentacao`, `notify()`, Resend. UI pt-BR, code English. Migrations via Supabase MCP.
> **Fora deste prompt**: campanhas em massa e win-back (05B), voz/gravação/transcrição e análise de conversas (05C), SMS (descartado do roadmap).

---

## 1. Princípios

1. **Uma conversa, uma thread — por pessoa, não por card.** A mesma pessoa fala com SDR, originador e closer. A thread mora em `contatos`/`empresas`; os cards dos funis **apontam** para ela e filtram a mesma conversa. Nunca criar histórico paralelo por card.
2. **Um registro só de toque.** O ledger é canônico e **absorve** o que hoje está espalhado em `toque.manual`, `mensagens_outbox`, `pedidos_apresentacao` e `descoberta_execucoes` (com backfill). Duas cópias divergentes pagam uma coisa e mostram outra.
3. **A IA fala como persona própria** (ex.: "Carina, da ONE OS"), com número e remetente próprios. **Nunca** assina como um humano. Se perguntarem se é um robô, não nega e escala para humano.
4. **Nada sai sem passar pelo portão**: supressão, janela de envio, cooldown, ponto focal, base legal e teto por número — em toda mensagem, humana ou de IA.
5. **Plantão interno é transporte separado**: alertas internos por WhatsApp não passam por warmup, supressão ou teto do canal de mercado.

## 2. Ledger e threads

```sql
create table conversas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id),
  contato_id uuid references contatos(id),
  canal text not null,                      -- whatsapp | email
  identificador_externo text not null,      -- telefone E.164 ou e-mail
  -- estado do relacionamento (usado pelo agente, §7)
  objetivo text,                            -- agendar_reuniao | cadastrar_fornecedor | cobrar_documentacao
                                            -- | renovar_analise | reativar | antecipar_nf | renovar_certificado | nenhum
  playbook_id uuid,
  responsavel_vendedor_id uuid references vendedores(id),
  modo_agente text default 'sugestao',      -- sugestao | autonomo | desligado
  status text not null default 'ativa',     -- ativa | aguardando_resposta | pausada | encerrada
  ultima_mensagem_em timestamptz,
  ultima_direcao text,
  proxima_acao_em timestamptz,              -- agendamento do agente
  nao_lidas int default 0,
  unique (canal, identificador_externo)
);
create index on conversas (empresa_id);
create index on conversas (responsavel_vendedor_id, status);
create index on conversas (proxima_acao_em) where proxima_acao_em is not null;

create table comunicacoes (                 -- LEDGER CANÔNICO
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid references conversas(id),
  empresa_id uuid references empresas(id),
  contato_id uuid references contatos(id),
  canal text not null,                      -- whatsapp | email | ligacao | reuniao | interno
  direcao text not null,                    -- entrada | saida
  -- autoria
  usuario_id uuid references usuarios(id),
  vendedor_id uuid references vendedores(id),
  por_ia boolean default false,
  -- conteúdo
  assunto text, corpo text, preview text,
  anexos jsonb default '[]',
  -- transporte
  provedor text,                            -- wasender | gmail | resend | app_link | manual
  id_externo text,                          -- message id do provedor (idempotência)
  thread_externa text,                      -- Message-ID / In-Reply-To (e-mail)
  conta_remetente text,                     -- número ou endereço usado
  status_envio text,                        -- pendente | enviada | entregue | lida | falhou | descartada
  erro text, tentativas int default 0,
  -- contexto
  origem text,                              -- compositor | outbox | agente | app_toque | inbox | sistema
  template_id uuid,
  funil text, funil_card_id text,           -- de onde partiu (nfs | fornecedores | sdr | vendas | certificados)
  triagem jsonb,                            -- classificação da resposta (§6)
  criado_em timestamptz default now(),
  enviado_em timestamptz,
  unique (provedor, id_externo)
);
create index on comunicacoes (conversa_id, criado_em desc);
create index on comunicacoes (empresa_id, criado_em desc);
create index on comunicacoes (vendedor_id, criado_em desc);

create table conversas_nao_vinculadas (     -- inbox de identificação
  id uuid primary key default gen_random_uuid(),
  canal text not null, identificador_externo text not null,
  nome_sugerido text,                       -- pushName do WhatsApp / display name do e-mail
  primeira_mensagem_em timestamptz, ultima_mensagem_em timestamptz,
  qtd_mensagens int default 1,
  conta_recebedora text,                    -- qual número/inbox recebeu
  vendedor_sugerido_id uuid references vendedores(id),
  status text default 'pendente',           -- pendente | vinculada | ignorada
  unique (canal, identificador_externo)
);
```

**Refatoração em vez de backfill** — as quatro fontes que hoje registram "toque" **nunca produziram comunicação real** (a régua sempre esteve em sombra), portanto não há histórico a preservar. Fazer o certo desde já, sem camada de compatibilidade:

- **`toque.manual`**: deixa de ser evento-registro. O clique em `tel:`, `wa.me` ou `mailto:` passa a **gravar direto em `comunicacoes`** (canal correspondente, `direcao = 'saida'`, `origem = 'app_toque'`, `provedor = 'app_link'`, `status_envio = 'enviada'` — sabemos que abriu o app, não que a mensagem saiu; documentar essa semântica). O evento continua sendo emitido no `empresa_eventos` apenas como notificação de timeline, derivado do ledger — nunca como fonte.
- **`mensagens_outbox`**: permanece **exclusivamente como fila de saída** (o que ainda não foi enviado). Ao enviar, a linha vira registro em `comunicacoes` e a outbox guarda apenas a referência (`comunicacao_id`). Remover dela qualquer papel de histórico; a UI de histórico lê o ledger.
- **`pedidos_apresentacao`**: mantém apenas o **estado do pedido** (rascunho → enviado → respondido) e passa a referenciar `comunicacao_id` do envio. O texto enviado e a resposta vivem no ledger.
- **`descoberta_execucoes`** (04l): continua registrando **descoberta de contato** (o que é), sem qualquer semântica de toque. Se uma descoberta terminar em mensagem, o vínculo é via `comunicacoes`.

Migrações desta refatoração: adicionar `comunicacao_id` em `mensagens_outbox` e `pedidos_apresentacao`; **remover** colunas/uso que dupliquem conteúdo de mensagem nessas tabelas; ajustar as telas que hoje leem histórico dessas fontes para ler `comunicacoes`. Se houver alguma linha residual de teste, descartar — não migrar.

**Regra permanente**: a partir daqui, **todo módulo escreve comunicação apenas no ledger**. Qualquer tabela que precise saber "o que foi falado" referencia `comunicacoes`, nunca copia.

**Base legal por contato**:
```sql
alter table contatos add column base_legal text;      -- formulario_aceite | relacao_comercial | dado_publico_nfe | indicacao | manual
alter table contatos add column base_legal_em timestamptz;
alter table contatos add column base_legal_detalhe text;
```
Preenchida automaticamente pela origem (formulário → `formulario_aceite`; NF-e → `dado_publico_nfe`; cliente ativo → `relacao_comercial`; vinculado no inbox → `relacao_comercial` se houver operação, senão `manual`). Exibida como tag no contato. **Toda mensagem de e-mail de saída para contato sem `formulario_aceite` inclui link de descadastro.**

## 3. Transportes

### 3.1 WhatsApp (Wasender)
- Cliente em `packages/core/transportes/wasender.ts`. Token por conta **lido do Vault** (a tabela guarda só o ponteiro, como já é hoje).
- **Envio individual** (vendedores) e **envio da IA** usam o mesmo cliente, mas contas diferentes: número da IA **nunca** é o de relacionamento humano.
- **Webhook de recebimento** `POST /api/webhooks/wasender`: idempotente por id da mensagem, resolve conta recebedora → resolve contato (§4) → grava em `comunicacoes` + atualiza `conversas`.
- **Tetos e ritmo**: `mensagens_por_dia` por conta (config; rampa de warmup para contas novas: 20/dia subindo semanalmente), intervalo mínimo aleatório entre envios (config, default 25–70s), fila por conta. Aplica-se principalmente às contas de IA — o vendedor mandando individualmente raramente encosta no teto, mas o teto existe como proteção.
- Status de entrega/leitura, quando o provedor enviar, atualizam `status_envio`.

### 3.2 E-mail — dois caminhos com propósitos distintos
- **Gmail OAuth por usuário** (Google Workspace): envia e recebe **como a pessoa**. Escopos `gmail.send`, `gmail.readonly`, `gmail.modify`. Tokens no Vault, refresh automático, reconexão guiada quando expirar. Recebimento por **Gmail Watch + Pub/Sub** (preferido) com fallback de polling por `historyId` a cada N minutos. Threading por `Message-ID`/`In-Reply-To`/`References`.
  - **Filtro obrigatório**: só entram no ledger e-mails cujo remetente/destinatário casem com um contato conhecido ou com um domínio de empresa da base — **nunca** ingerir a caixa pessoal inteira. Documentar isso no README e mostrar na tela de conexão.
- **Resend**: envio do sistema e da IA, de domínio próprio (`@oneos.com.br` ou subdomínio dedicado para automação). Webhook de eventos (`delivered`, `bounced`, `complained`, `opened`) → atualiza status; **hard bounce e complaint viram linha em `supressao` automaticamente** e rebaixam o contato.

### 3.3 Plantão interno (transporte separado)
Cliente próprio, número próprio, sem warmup/supressão/janela: alertas críticos (`orcamento.estourado`, `mercado.ingestao_falhou`, `lote.aguardando_aprovacao`, `analise_propria.divergencia_seguradora`, `analise.limite_reduzido`, `sdr.aceite_pendente`) para a equipe. Configurável por perfil em settings.

## 4. Inbox e vinculação

- **Resolução automática**: identificador → `contatos` → `contatos_descobertos` (04l) → domínio de e-mail conhecido → CNPJ citado no corpo. Achou: vincula, cria/atualiza `conversas`.
- **Não resolveu**: entra em `conversas_nao_vinculadas`. Aparece como **fila destacada ao logar** (e ao voltar após inatividade configurável, default 4h): "3 conversas aguardando identificação".
- **Vincular** (1 tela): escolher empresa (busca por nome/CNPJ), **informar o nome do contato — pré-preenchido com o `pushName` do WhatsApp / display name do e-mail** —, cargo opcional. Ao confirmar: **cria o contato oficial** na empresa (`origem = 'vinculado_inbox'`, `base_legal` conforme §2), migra as mensagens já recebidas para a thread e registra evento. Opção "ignorar" (spam/pessoal) some da fila.
- **Inbox unificado** (tela própria + widget na home): abas Não lidas / Minhas / Não vinculadas / Todas (gestores); filtros por canal, empresa, vendedor, funil; busca no conteúdo.

## 5. Envio: compositor, templates e o passo que faltava

- **`aprovada → enviada`**: worker consome `mensagens_outbox`, verifica o portão (§1.4), envia pelo transporte, grava no ledger, retry com backoff (3 tentativas) e registro de falha legível. Falha permanente → status `falhou` + notificação ao dono.
- **Compositor** (Company 360, aba Mensagens do `ModalDoCard`, inbox): escolher contato (ponto focal pré-selecionado), canal, **template**, editar e enviar. Mostra a mensagem renderizada com as variáveis reais antes de enviar.
- **Templates**: tabela `templates_mensagem` (nome, canal, funil, objetivo, assunto, corpo, variáveis usadas, ativo, criado_por). Usar o `renderizarTemplate()` existente e o catálogo de variáveis em pt-BR. Seeds por funil: NFs (nota disponível para antecipação), fornecedores (primeira abordagem, pedido de apresentação), SDR (convite para conversa, confirmação, lembrete D-1/H-1, reagendamento pós no-show), vendas (pedido de documentação, follow-up de proposta), certificados (vencimento, cauda de SPEs).
- **Botões de um toque nos funis**: o mesmo botão que hoje abre `wa.me` passa a oferecer **"Enviar pela conta da casa"** (registra no ledger) além de "Abrir no meu WhatsApp" (segue registrando `toque.manual`). Escolha lembrada por usuário.
- **Reuniões (incluído aqui por ROI imediato)**: confirmação no agendamento, lembrete D-1 e H-1, e mensagem de reagendamento automática ao marcar no-show. Dados já existem em `vendedor_eventos`.
- **Janela de envio**: `comunicacao_config.janela` (seg–sex 9h–18h, timezone SP) — mensagem gerada fora da janela é **agendada** para a próxima abertura, não descartada. Envio manual por humano pode furar a janela com confirmação explícita.

## 6. Triagem de resposta

Toda mensagem de entrada passa por triagem. **Qualidade acima de custo**: classificador barato só para casos inequívocos (opt-out explícito por palavra-chave, auto-resposta de férias/ausência, mensagem vazia/mídia sem texto). **Todo o resto vai para o modelo**, que retorna JSON estruturado: `intencao` (interesse | recusa | adiar | duvida | negociacao | reclamacao | indicacao_de_contato | operacional | outro), `sentimento`, `urgencia`, `pedido_de_humano` (bool), `dados_extraidos` (data mencionada, nome/telefone/e-mail de outra pessoa, valores), `resumo_curto`.

Efeitos automáticos: opt-out → `supressao` + aviso ao dono da conversa; `pedido_de_humano`, reclamação ou negociação → escalação (§7); **primeira resposta de um contato que estava em "nunca contatado" → move o card para "contatado"** em todos os funis que tenham esse estágio; `conversas.status = 'ativa'` e cadência/agente reavaliam.

## 7. Agente de Próximo Passo

### 7.1 O que é
Um **decisor**, não um chatbot. Acorda por evento (resposta recebida, no-show, silêncio de N dias, NF nova em faixa, crédito decidido, certificado vencendo, lead distribuído) e responde a uma pergunta: **qual é o próximo passo desta relação?**

**Dois modos por conversa/carteira** (`conversas.modo_agente`):
- **`sugestao`** (default para humanos): a decisão aparece como "Próximo passo sugerido" no card e no inbox, com a mensagem pronta — o vendedor envia com um clique, edita ou descarta. É o copiloto.
- **`autonomo`** (default nas carteiras da IA): executa direto, respeitando todos os guardrails.

### 7.2 Espaço de ações (fechado — o agente só escolhe daqui)
`responder_agora` · `agendar_toque(D+N, canal)` · `enviar_link_agendamento` · `mudar_estagio_funil` · `marcar_sem_interesse(soft|eterna)` · `escalar_humano(motivo)` · `pedir_enriquecimento_contato` · `trocar_contato_da_conversa` (§7.4) · `ligar` (**ferramenta declarada e DESLIGADA** — feature flag `agente.ligacao_habilitada = false`; o executor lança "não disponível". Preparada para o discador de IA externo) · **`aguardar`** (não fazer nada agora, com data de reavaliação — ação de primeira classe).

Saída sempre estruturada: `{ acao, canal, quando, conteudo_sugerido, objetivo_atualizado, confianca, justificativa }`.

### 7.3 Playbooks por funil (config, não código)
```sql
create table agente_playbooks (
  id uuid primary key default gen_random_uuid(),
  nome text not null, funil text not null, objetivo text not null,
  instrucoes text not null,                 -- contexto e tom para o modelo
  acoes_permitidas text[] not null,
  templates_disponiveis uuid[],
  prazos jsonb,                             -- { silencio_dias, max_tentativas, desistir_apos_dias }
  ativo boolean default true, versao int not null
);
```
Seeds: fornecedores `a_cadastrar`, SDR `a_contatar`, NF em faixa alta, cobrança de documentação, certificado vencendo, reengajamento antes do SLA.

### 7.4 Indicação de outro contato (pedido explícito)
Quando a triagem detectar `indicacao_de_contato` ("fala com o Marcelo do financeiro, (11) 9xxxx"), o agente pode `trocar_contato_da_conversa`: **cria o novo contato** na empresa (nome, canal, `base_legal = 'indicacao'`, evidência = trecho da mensagem), abre nova thread com ele **herdando o objetivo e o histórico do card**, e encerra educadamente a thread anterior (agradecimento). O contato anterior fica marcado como `nao_e_o_decisor` (não suprimido — pode voltar a ser útil) e, se a empresa não tiver ponto focal, o novo é sugerido como tal.

### 7.5 Guardrails (não negociáveis)
Só atua onde a IA é titular na carteira (modo autônomo) · **escalação imediata** para humano em: menção a taxa/preço/prazo/limite, reclamação, ameaça jurídica, irritação, pedido de humano, ou "você é um robô?" (não negar, escalar) · respeita janela, supressão, cooldown, ponto focal e base legal · nunca cita limite, taxa ou valor de operação · teto diário por thread e por número · **kill switch global** de um clique em settings (para tudo, todos os modos autônomos) · toda decisão registrada com justificativa.

### 7.6 Rede de segurança e aprendizado
- Falha do modelo, `confianca` abaixo do mínimo (config) ou modo desligado → cai numa **cadência fixa simples** do playbook (D0/D3/D7, para ao responder). Nunca ficar sem próximo passo.
- `agente_decisoes` registra entrada resumida, decisão, execução e **desfecho** (respondeu? agendou? converteu? suprimiu?) — base do painel de eficácia por playbook e da futura calibração (espírito do 04f). Política/prompt do agente **versionados**.

```sql
create table agente_decisoes (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid references conversas(id),
  playbook_id uuid references agente_playbooks(id),
  gatilho text not null, contexto_resumo jsonb,
  acao text not null, canal text, quando timestamptz,
  conteudo_sugerido text, confianca numeric(4,3), justificativa text,
  modo text not null,                       -- sugestao | autonomo
  executada boolean default false, executada_em timestamptz,
  aceita_por uuid references usuarios(id), descartada boolean default false,
  desfecho text, desfecho_em timestamptz,
  modelo text, tokens int,
  criado_em timestamptz default now()
);
```

## 8. Painel de atividade (restrito)

Visível **apenas a gestores e a quem tem `vendedor_acessos`** — nunca ao próprio vendedor sobre si (decisão explícita: evitar incentivo a volume vazio). Por pessoa e consolidado: enviadas/recebidas por canal e por dia, **contatos distintos por dia**, empresas tocadas, tempo médio de primeira resposta, e — sempre lado a lado com volume — **taxa de resposta, reuniões agendadas e NFs convertidas**. Filtros por período, canal, funil, vendedor.

## 9. Integrações e superfícies

- **Aba "Mensagens" do `ModalDoCard`** (nfs, fornecedores, sdr, vendas, certificados): renderiza a thread da pessoa filtrada pelo contexto do card, com compositor e o "próximo passo sugerido" do agente.
- **Company 360**: seção de contatos vira compositor completo; **timeline** recebe toda comunicação (entrada e saída) — é onde as conversas dos cinco funis se encontram.
- **Mobile**: inbox completo, fila de não vinculadas, compositor com templates, push de mensagem recebida e de próximo passo sugerido, botões de envio nos cards. Settings, playbooks e painel de atividade = `webOnly`.
- **Eventos**: `comunicacao.enviada`, `comunicacao.recebida`, `comunicacao.falhou`, `conversa.nao_vinculada`, `conversa.vinculada`, `contato.indicado`, `agente.decidiu`, `agente.escalou`, `agente.executou`, `optout.registrado`.
- **Tools de IA**: `comunicacao.historico_empresa` (read), `comunicacao.enviar_mensagem` (mutates — respeita portão; em `sugestao` apenas enfileira), `comunicacao.proximo_passo` (read), `comunicacao.inbox_pendentes` (read).

## 10. Entregáveis

**Worker/handlers**: `comunicacao/enviar-fila` (outbox → transporte, retry, tetos, janela), `comunicacao/gmail-sync`, `comunicacao/triagem`, `agente/decidir` (por evento) e `agente/executar-agendados` (varre `proxima_acao_em`), `comunicacao/lembretes-reuniao` (diário/horário).
**Refatoração (§2)**: migrar `toque.manual`, `mensagens_outbox`, `pedidos_apresentacao` e `descoberta_execucoes` para o novo modelo, ajustando todas as telas que leem histórico dessas fontes. Sem camada de compatibilidade — não há dados reais a preservar.
**Core**: clientes Wasender/Gmail/Resend atrás de uma interface `Transporte` única; portão de envio (`podeEnviar()` — supressão, janela, cooldown, base legal, teto) com testes; motor do agente com testes (espaço de ações fechado, guardrails, fallback, troca de contato).
**Segurança**: tokens (Wasender, Gmail refresh) **sempre no Vault**; conteúdo de mensagens sob RLS por empresa/vendedor; e-mails ingeridos filtrados por contato/domínio conhecido.
**Env**: `WASENDER_API_KEY`/base URL, `WASENDER_WEBHOOK_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_PUBSUB_TOPIC`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `PLANTAO_WHATSAPP_CONTA_ID`.
**Docs**: README — arquitetura do ledger e por que thread é por pessoa, o portão de envio, como conectar o Gmail, política de warmup, o que o agente pode e não pode, como ligar/desligar modos e o kill switch.

## 11. Fora de escopo

Campanhas em massa, win-back e segmento→campanha (05B) · voz, gravação Android, transcrição de Meet e análise de conversas (05C) · SMS (descartado) · discador de IA (ferramenta declarada e desligada aqui).
