# Comunicação: o cano, o ledger e o agente (Prompt 05A)

Onde as conversas dos cinco funis se encontram. Mercado acha a empresa, Radar acha o
contato, Antecipação encontra a nota, Comercial vende — e aqui é onde alguém **fala** com
a pessoa do outro lado.

**Escopo:** transporte real (WhatsApp e e-mail), inbox unificado, thread por pessoa e o
agente de próximo passo. Campanhas em massa e win-back são o 05B; voz, gravação e análise
de conversa são o 05C; SMS foi descartado do roadmap.

---

## Uma conversa, uma thread — por pessoa, não por card

A mesma pessoa fala com o SDR, com o originador e com o closer. Se a thread morasse no
card, a segunda conversa começaria do zero e a terceira também: o vendedor abriria o card
de vendas sem enxergar o que o SDR combinou na semana passada.

A thread mora em `conversas`, chaveada por **(canal, identificador em forma canônica)**.
Os cards dos cinco funis **apontam** para ela: `comunicacoes.funil` e
`comunicacoes.funil_card_id` dizem de onde a mensagem partiu, e isso é filtro de leitura e
destaque na tela — nunca dono do histórico. A aba "Mensagens" de qualquer card mostra a
thread inteira da empresa, com o que partiu daquele card marcado.

A forma canônica é uma função só, escrita duas vezes de propósito e testada nas duas:
`app__identificador_canonico` no banco e `identificadorCanonico()` no core. O mesmo celular
chega como `+55 (11) 99999-8888`, `5511999998888` e `011999998888`; o mesmo e-mail chega
com maiúsculas. Se o webhook normalizasse de um jeito e o compositor de outro, a mesma
pessoa teria duas threads e o cooldown não veria nenhuma das duas.

## Um registro só de toque

Antes deste módulo, "falamos com o fornecedor" estava escrito em quatro lugares: o evento
`toque.manual`, a `mensagens_outbox`, o `pedidos_apresentacao` e — por interpretação de
quem lia — a `descoberta_execucoes`. Duas cópias divergentes pagam uma coisa e mostram
outra: o cooldown lê uma, a tela lê a outra, e o fornecedor recebe dois toques no mesmo
dia.

**`comunicacoes` é o ledger canônico.** Todo módulo escreve comunicação aqui e só aqui;
quem precisa saber "o que foi falado" **referencia** uma linha, nunca copia o texto.

O que mudou em cada uma das quatro fontes:

| Fonte | Papel novo |
| --- | --- |
| `toque.manual` | Deixou de ser evento-registro. O clique em `tel:`/`wa.me`/`mailto:` grava direto em `comunicacoes` (`origem = 'app_toque'`, `provedor = 'app_link'`). O evento continua sendo emitido, **derivado** do ledger, para a timeline e o sino. |
| `mensagens_outbox` | Fila de saída, exclusivamente. Ao enviar, o texto vai para o ledger e a linha guarda só `comunicacao_id`. |
| `pedidos_apresentacao` | Estado do pedido (rascunho → enviado → respondido) e a referência. `mensagem` vira null no envio. |
| `descoberta_execucoes` | **Não mudou.** Ela registra descoberta de contato, que é o que sempre foi. |

Não houve backfill, e não havia o que migrar: a régua sempre esteve em modo sombra, então
nenhuma das quatro produziu comunicação real. O que existe no lugar de uma camada de
compatibilidade são dois CHECKs que tornam a duplicação **inexprimível**:

```sql
-- mensagens_outbox
check (comunicacao_id is null or (corpo is null and assunto is null))
-- pedidos_apresentacao
check (comunicacao_id is null or mensagem is null)
```

É isso que impede a outbox de voltar a ser histórico na primeira tela escrita com pressa.

## O portão

**Nada sai sem passar por aqui** — humano ou IA, compositor, outbox ou agente. O portão
tem duas metades, e a divisão não é arbitrária:

- **fato do banco** (supressão, base legal, ponto focal, cooldown) é checado na transação
  que **enfileira** (`app_comunicacao_enfileirar`). Recusar ali é a única forma de a
  pessoa ver o motivo na tela;
- **fato do relógio e da conta** (janela, teto do número, warmup, intervalo entre envios) é
  do worker, porque só ele sabe quantas mensagens aquele número já mandou hoje e que horas
  são quando a fila for consumida.

A função pura está em `packages/core/src/comunicacao/portao.ts` e devolve a **primeira**
recusa nesta ordem, da mais permanente para a mais temporária:

```
kill switch → supressão → base legal → teto da thread → teto da conta → cooldown → janela
```

A ordem é o que faz a mensagem de erro dizer a coisa mais importante em vez da mais
recente.

### Fora da janela é adiamento, não descarte

Uma mensagem gerada às 22h não é errada, é cedo demais. Descartá-la perde o toque; mandá-la
manda WhatsApp de madrugada para um fornecedor. `mensagens_outbox.agendada_para` é a
terceira saída — a linha continua `aprovada`, o worker é que não a pega ainda.

Um envio manual **pode furar a janela** com confirmação explícita. Nunca a supressão:
supressão é um pedido da pessoa, janela é etiqueta.

### Base legal e descadastro

`contatos.base_legal` responde "por que podemos falar com esta pessoa", e é derivada da
ORIGEM, nunca digitada: formulário → aceite, NF-e → dado público, cliente ativo → relação
comercial. Contato sem base legal **não é abordado**.

Todo e-mail para contato **sem** `formulario_aceite` leva link de descadastro. O anexo é
feito no worker, no último instante antes do envio — não no template: um template novo
escrito com pressa não pode ser a diferença entre uma mensagem conforme e uma que não é.

## Os três canos

| Cano | Para quê | Credencial |
| --- | --- | --- |
| **Wasender** | WhatsApp, individual e da IA. Contas diferentes por `tipo`. | Token **por conta**, no Vault |
| **Gmail OAuth** | E-mail **como a pessoa**: sai da caixa dela, entra na thread do cliente | Refresh token **por usuário**, no Vault |
| **Resend** | E-mail do sistema e da IA, de domínio próprio | `RESEND_API_KEY` em env |

Os três ficam atrás de uma interface `Transporte` única (`packages/core/src/transportes/`).
O worker de envio tem uma fila e precisa de uma função que mande; ele não sabe qual dos
três recebeu. O que a interface deliberadamente **não** faz é decidir se pode mandar —
isso é do portão, e um transporte que checasse supressão seria o quarto lugar onde essa
regra vive.

### Por que dois caminhos de e-mail

Gmail manda como a PESSOA; Resend manda como a CASA. Preferir o Resend quando há Gmail
conectado quebraria a thread do outro lado e faria o cliente achar que trocou de
interlocutor. Misturar os dois no mesmo domínio queimaria a reputação do domínio principal
com volume de máquina — e um domínio queimado derruba junto o e-mail que as pessoas mandam
à mão. Por isso a IA escreve de um **subdomínio dedicado**.

### O filtro de ingestão do Gmail é obrigatório

Só entra no ledger e-mail cujo remetente/destinatário case com um **contato conhecido** ou
com o **domínio de uma empresa da base**. Nunca a caixa inteira. Domínio genérico
(`gmail.com`, `outlook.com`…) nunca casa: usá-lo como critério transformaria "só o que é da
base" em "tudo".

Isso não é economia de token: é a diferença entre um CRM e vigilância sobre o e-mail
pessoal de quem trabalha aqui. A regra está em `deveIngerir()`, é testada, e está escrita
na tela de conexão — a pessoa lê antes de autorizar, não depois.

### Warmup, teto e ritmo

Um número novo que dispara 200 mensagens no primeiro dia é banido no segundo, e o número
banido leva junto a conversa de todo mundo que já falava por ele. A rampa é 20/dia subindo
20 por semana até o teto da conta, e é linear porque uma curva mais esperta seria
impossível de explicar a quem vê a conta parar.

O intervalo entre dois envios da mesma conta é **aleatório** (25–70s por padrão). Uma
cadência perfeitamente regular é a assinatura mais óbvia de robô que existe.

Os quatro campos ficam em **Comunicação → Contas WhatsApp**. A 0144 acrescentou as colunas
e não estendeu junto nem o grant nem a escrita — o efeito só apareceu depois: a 0052 tinha
trocado o `grant select` de TABELA por um coluna a coluna (para esconder `token_secret_id`),
e um grant coluna a coluna **não alcança colunas futuras**. As cinco novas nasceram
ilegíveis para `authenticated` e a tela de Configurações quebrava com `permission denied`.
A 0145 concede as cinco explicitamente — nunca a tabela, que reabriria o ponteiro do Vault —
e estende `app_salvar_whatsapp_conta` para alcançar a linha inteira.

### As três telas que vieram da Antecipação

Disparos, Outbox e Contas WhatsApp nasceram no menu da Antecipação por ordem de chegada, não
por assunto. Desde o 05A vivem aqui: a régua, a fila que ela produz e os números que a enviam
são comunicação. Os componentes continuam em `components/antecipacao/` — os dados são faixas,
e faixa é conceito de lá; o que mudou foi o menu, não o dono.

O select de `whatsapp_contas`, `mensagens_outbox` e `faixa_disparos` passou a aceitar
`comunicacao` **ou** `antecipacao` (0145). Não alarga exposição de fato: quem tem Comunicação
já lê o ledger inteiro, e a outbox é um subconjunto do que vai virar ledger. Sem isso a tela
apareceria no menu e viria vazia para quem tem exatamente o módulo em que ela agora está.

### O plantão interno é transporte separado

Alerta crítico (`orcamento.estourado`, `mercado.ingestao_falhou`, …) sai por conta própria,
sem warmup, supressão, janela nem teto. Um orçamento estourado às 23h de um sábado é
exatamente o alerta que precisa sair às 23h de um sábado.

A separação é de arquivo (`worker/src/comunicacao/plantao.ts`) e não uma flag no envio
normal: uma condição num caminho compartilhado é o que alguém remove por engano no primeiro
refactor do portão. As mensagens vão para o ledger com `canal = 'interno'` e ficam fora do
painel de atividade.

## Inbox e vinculação

A resolução automática tenta, na ordem em que a certeza cai: `contatos` →
`contatos_descobertos` (04l) → domínio de e-mail conhecido → CNPJ citado no corpo.

O que não resolve vira **fila de identificação**, e essa é a decisão importante: adivinhar
é pior que perguntar. Vincular a mensagem à empresa errada põe a conversa de um estranho na
timeline de um cliente, e ninguém encontra o erro depois.

Vincular é **uma tela e um clique**, e três coisas acontecem juntas ou nenhuma: o contato
oficial nasce na empresa (com base legal derivada), as mensagens já recebidas migram para a
thread dele, e a fila perde a linha. O nome vem pré-preenchido com o `pushName` do WhatsApp
ou o display name do e-mail — pedir para digitar do zero é o atrito que faz a fila
acumular, e uma fila acumulada é o mesmo que não ter fila.

Uma conversa **ignorada que volta a falar retorna para a fila**: quem marcou spam pode ter
errado, e a segunda mensagem é a evidência.

## Triagem

Toda mensagem de entrada passa por triagem, e a régua é **qualidade acima de custo**: o
classificador barato resolve só o inequívoco (opt-out por palavra-chave, auto-resposta de
ausência, mídia sem texto); todo o resto vai ao modelo.

A tentação é a inversa — regex para tudo — e ela custa caro do jeito errado. "Não tenho
interesse agora, me chama em março" classificado como recusa vira supressão, e um lead que
pediu para ser chamado em março entra na lista de não-abordar. Um falso opt-out é
irreversível na prática; um token gasto não é.

**Classificar não muda nada sozinho.** O que muda é o que a classificação dispara:

- opt-out → linha em `supressao` (do CANAL daquela pessoa, não da empresa) + aviso ao dono;
- reclamação, negociação, pedido de humano, menção a taxa/preço/prazo/limite, ameaça
  jurídica, ou "você é um robô?" → **escalação imediata**, e o modo autônomo daquela thread
  cai para sugestão;
- **primeira resposta de quem estava em "nunca contatado" → move o card** para "contatado",
  em todos os funis que tenham esse estágio. É o efeito que faz o funil parar de mentir:
  mover o card à mão depois de responder é a etapa que ninguém faz.

## O agente de próximo passo

Um **decisor**, não um chatbot. Acorda por evento (resposta recebida, silêncio de N dias,
no-show, NF nova em faixa, certificado vencendo, lead distribuído) e responde a uma
pergunta: qual é o próximo passo desta relação?

### O espaço de ações é fechado, e é isso que o torna seguro

O modelo não escolhe o que fazer no mundo: escolhe um item de uma lista de dez. Um agente
com ferramentas abertas exige confiar no julgamento dele sobre **o que é possível**; um
agente com espaço fechado só exige confiar no julgamento sobre **qual das dez cabe agora**
— e a segunda é uma pergunta auditável linha a linha em `agente_decisoes`.

```
responder_agora · agendar_toque · enviar_link_agendamento · mudar_estagio_funil
marcar_sem_interesse · escalar_humano · pedir_enriquecimento_contato
trocar_contato_da_conversa · ligar (DESLIGADA) · aguardar
```

**`aguardar` é ação de primeira classe**, e não a ausência de decisão. Sem ela, um modelo
perguntado "qual o próximo passo?" sempre encontra um passo, e a cadência vira perseguição.

**`ligar` é declarada e desligada** (`agente.ligacao_habilitada = false`). Está no espaço
para que ligar o discador de IA externo seja uma linha de config — e, mais útil agora, para
que as decisões em que o agente teria ligado apareçam no log. Saber quantas vezes ligar era
o passo certo é o argumento para comprar o discador, e esse número não existe se a ação não
puder ser escolhida.

### Dois modos, e o default é uma decisão

`sugestao` (default para humanos) mostra a decisão pronta no card e no inbox; quem envia é
a pessoa. `autonomo` (default nas carteiras da IA) executa direto, respeitando todos os
guardrails. Um agente que começa autônomo numa carteira humana manda a primeira mensagem
antes de alguém ter lido uma única sugestão dele.

### A ordem é: guardrail → modelo → validação → execução

O guardrail roda **antes** do modelo porque não faz sentido gastar token numa conversa que
já é de humano. A validação roda **depois** porque o modelo pode escolher fora do playbook,
e uma ação fora do contrato não é um erro a corrigir: é uma decisão a descartar.

O agente **nunca envia** — ele enfileira, e a fila passa pelo portão. Um caminho de envio
direto "porque o agente decidiu" seria o quarto lugar onde a supressão precisa ser
lembrada. O mesmo vale para aceitar uma sugestão na tela: o humano aprovou o **texto**, não
a legalidade do disparo.

### Nunca ficar sem próximo passo

Falha do modelo, JSON fora do schema, ação fora do playbook ou confiança abaixo do mínimo
caem todos na **cadência fixa** do playbook (D0/D3/D7 por padrão) — e caem no mesmo lugar de
propósito: do ponto de vista da relação, "o agente não soube" é uma coisa só.

O ponto não é a cadência ser boa. É que uma conversa sem próximo passo simplesmente some, e
a única coisa pior que um follow-up medíocre é nenhum. Quando a cadência acaba, a decisão é
**parar** — e parar também é um próximo passo.

### Indicação de outro contato

Quando a triagem detecta `indicacao_de_contato` ("fala com o Marcelo do financeiro,
(11) 9xxxx"), o agente cria o novo contato com `base_legal = 'indicacao'` e a evidência (o
trecho da mensagem), abre a thread dele herdando o objetivo, e encerra a anterior com
agradecimento.

O contato anterior fica `nao_e_o_decisor` — **nunca suprimido**. "Fala com o Marcelo" diz
que esta pessoa não decide, não que ela não pode ser abordada: suprimir queimaria um
contato que volta a ser útil no dia em que o Marcelo sair.

### O playbook é config, e editar cria uma versão

A versão anterior fica inativa e as decisões que ela produziu continuam apontando para ela.
Sobrescrever faria o painel de eficácia comparar resultados de instruções diferentes sob o
mesmo nome — a forma mais silenciosa de aprender errado.

### O desfecho é o que transforma o log em painel

`agente_decisoes.desfecho` (respondeu / agendou / converteu / suprimiu / sem_resposta /
escalou) é apurado uma vez por dia. Sem ele, a tabela diria quantas vezes o agente decidiu e
nunca quantas vezes ele acertou.

## O painel de atividade e o que ele recusa mostrar

Visível **apenas a gestores e a quem tem `vendedor_acessos`** — e nunca ao próprio vendedor
sobre si. Um painel de volume que a pessoa acompanha sobre si mesma vira meta, e a meta mais
fácil de bater aqui é mandar mais mensagem.

Pela mesma razão, **volume nunca aparece sozinho**: taxa de resposta, reuniões agendadas e
NFs convertidas vêm na mesma linha. Uma tela que só conta mensagens enviadas ensina a mandar
mensagem, não a vender.

A regra não cabe numa policy — ela não diz quais LINHAS alguém vê, diz QUEM pode perguntar.
Por isso a view `atividade_comunicacao` **não tem grant** para `authenticated` e o acesso é
decidido dentro de `app_comunicacao_atividade`. Uma view legível por todos deixaria a regra
na tela, onde ela é uma sugestão.

## Os seis relógios

| Job | Cadência | Por quê |
| --- | --- | --- |
| `comunicacao/enviar-fila` | 5 min | Uma mensagem aprovada não pode esperar meia hora |
| `comunicacao/triagem` | 5 min | É ela que acorda o agente |
| `comunicacao/gmail-sync` | 10 min | É o **fallback** do Pub/Sub, não o caminho principal |
| `comunicacao/lembretes-reuniao` | 1 h | O lembrete H-1 precisa dessa granularidade |
| `agente/decidir` | 1 h | Decisões de relação não são de minuto |
| `agente/executar-agendados` | 1 h | O relógio que o próprio agente marcou |

O lembrete **H-1 fura a janela de propósito**, e é a única automação que faz isso: um
lembrete de uma reunião que começa em uma hora não pode esperar até as 9h do dia seguinte —
nessa altura ele não é um lembrete, é um obituário.

A idempotência dos lembretes é o **ledger**, não uma coluna de controle: "já existe saída
para esta empresa, com este template, nesta janela?". Uma coluna `lembrete_d1_enviado` é
estado duplicado e mente quando o envio falha.

## Segurança

- **Tokens sempre no Vault.** `whatsapp_contas.token_secret_id` e
  `gmail_contas.*_secret_id` são ponteiros; o valor só sai por `app__segredo_vault`, que é
  `SECURITY DEFINER` com `EXECUTE` apenas para `service_role`. O valor nunca é logado — nem
  truncado, nem mascarado: uma máscara num log é uma decisão que alguém revisa uma vez e um
  `console.log` de depuração desfaz.
- **Segredos de webhook são outros segredos.** `WASENDER_WEBHOOK_SECRET` não é o token de
  envio; `RESEND_WEBHOOK_SECRET` não é a API key. Reusar o de saída na entrada o publicaria
  num header que qualquer um pode nos fazer comparar batendo na nossa URL — e o de saída é o
  que manda mensagem pelo nosso número. Os dois **falham fechados**.
- **Nenhuma tabela do módulo tem `insert`/`update`/`delete` para `authenticated`.** O único
  caminho de escrita são as RPCs (e o service role, no worker), o que torna "gravar uma
  mensagem sem passar pelo portão" inexprimível em vez de apenas desencorajado.
- **`gmail_contas` é lida só pelo próprio dono**, e os dois ponteiros de segredo estão fora
  do grant coluna a coluna (mesma correção da 0052: revogar SELECT de coluna depois de um
  grant de TABELA não corta nada).

## O que o 05B acrescentou aqui

Campanhas (05B) não trouxeram transporte novo: elas escrevem em `mensagens_outbox` com
`origem = 'campanha'` e o job de envio deste módulo continua sendo quem envia. Três coisas
mudaram deste lado:

- `mensagens_outbox` ganhou `campanha_id` e `campanha_destinatario_id`, e a ordenação da fila
  passou a ser `campanha_id NULLS FIRST` — o envio individual tem prioridade sobre disparo em
  massa, e isso é um ORDER BY em vez de um acordo entre dois processos.
- `comunicacoes` ganhou `campanha_id`, que é como o painel agrupa. E um trigger de INSERT:
  toda mensagem de ENTRADA marca o destinatário de campanha correspondente como `respondida`.
- Campanha conta como **automática** no portão, então o kill switch alcança um disparo em
  massa — que é exatamente para o que ele existe.

Detalhes em [`campanhas.md`](campanhas.md).

## Como ligar

1. **WhatsApp** — cadastre as contas em Comunicação → Contas WhatsApp e defina o `tipo` de
   cada uma: `relacionamento`, `ia` ou `plantao`. O número da IA **nunca** é o de um humano —
   enquanto não houver uma conta `ia` ativa com token, a persona simplesmente não envia, e a
   tela avisa.

   O Wasender emite **duas credenciais por número**, e as duas vão na ficha da conta:

   | | O que faz | Como guardamos |
   | --- | --- | --- |
   | **Token de envio** | manda mensagem — é o que **gasta dinheiro** | Vault (0045). Nunca reexibido |
   | **Segredo do webhook** | prova que o webhook veio dele | **hash** (0152). Nunca lido, só comparado |

   O segundo é hash e não Vault porque ele nunca precisa ser LIDO — só comparado. Guardar o
   digest basta, é estritamente mais seguro (não há caminho que o devolva, nem para o service
   role) e a validação vira uma consulta indexada em vez de N leituras do Vault num caminho
   quente.

   `WASENDER_WEBHOOK_SECRET` continua valendo como **fallback**: é o caminho de quem tem um
   número só, e sem ele ligar o primeiro exigiria cadastrar a conta antes de o webhook existir.
   Com dois ou mais números, cadastre o segredo de cada um na ficha — um segredo global faria
   os webhooks do segundo número levarem 401, e um 401 em webhook não aparece em tela nenhuma:
   as respostas daquele número simplesmente sumiriam. Ponha `WASENDER_BASE_URL` (`https://wasenderapi.com`, só o host — o cliente
   concatena `/api/send-message`) e `WASENDER_WEBHOOK_SECRET` no worker e na web, e cadastre
   `https://<dominio>/api/webhooks/wasender?secret=<segredo>` no painel do provedor.

   `WASENDER_BASE_URL` é a falta que **não** aparece na ficha da conta: o número pode ter
   token, estar ativo e mesmo assim nenhum envio sair, porque a base URL é da aplicação e vive
   no Railway/Vercel, não no Vault. A fila diz qual das duas faltou — leia o erro da linha em
   Comunicação → Outbox antes de mexer na credencial.
2. **Gmail** — crie o app OAuth no Google Cloud com `redirect_uri`
   `https://<dominio>/api/auth/gmail/callback` e escopos `gmail.send`, `gmail.readonly`,
   `gmail.modify`. Cada pessoa conecta a própria caixa em Comunicação → Configurações. Para
   o push, crie o tópico Pub/Sub, dê publish à conta de serviço do Gmail e aponte a
   subscription para `https://<dominio>/api/webhooks/gmail?token=<GOOGLE_PUBSUB_TOKEN>`.
3. **Resend** — verifique o domínio e o subdomínio de automação, ponha `RESEND_API_KEY`,
   `RESEND_REMETENTE` e `RESEND_REMETENTE_IA`, e cadastre o webhook em
   `https://<dominio>/api/webhooks/resend`.
4. **Warmup** — deixe "Em warmup" ligado em cada número novo (é o padrão da tela). Sem
   `warmup_iniciado_em` o número já nasce com o teto cheio, e o teto cheio no primeiro dia é
   como se bane um número. Desligar a chave limpa a data e devolve o teto — é uma decisão, e
   por isso a RPC distingue "não mandei o campo" de "mandei `null`".
5. **Kill switch** — está em Comunicação → Configurações, primeiro card. É a única coisa
   naquela tela que alguém aperta com pressa.
