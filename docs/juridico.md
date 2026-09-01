# Jurídico: processos judiciais contra sacados devedores (Prompt 08)

O último elo do funil. Mercado acha a empresa, Antecipação encontra a nota, Crédito diz
quanto ela sustenta, Comercial vende — e quando o dinheiro não volta, é aqui que ele é
perseguido.

**Escopo: JUDICIAL e contra SACADO DEVEDOR.** Cobrança extrajudicial (notificação,
protesto, acordo pré-judicial) é o Prompt 07 e ainda não existe;
`processos.vinculo_cobranca_id` está reservado para o dia em que existir, sem FK. Processo
em que não somos parte é dado de risco do Radar, não entra aqui.

---

## O processo chega importado, não originado

A empresa já tem ações em andamento quando o módulo nasce. O fluxo começa buscando o que
existe — pelos **nossos CNPJs**, no Escavador — e não criando uma cobrança. Isso decide o
modelo inteiro:

- a chave primária é o **`numero_cnj` com máscara** (`0000000-00.0000.0.00.0000`), porque
  é o identificador que já existe no mundo, é o que o advogado fala em voz alta e o que
  ele cola na petição. Guardar os 20 dígitos crus obrigaria toda tela a remontar a
  máscara e todo log a ser ilegível;
- capa, movimentações e envolvidos são escritos **só pelo service role**, no worker. Não
  há RPC para editá-los. Um atalho de tela para "corrigir a data da citação" produziria
  um cronograma que a próxima sincronização desfaz em silêncio;
- o que se escreve daqui é o que é **nosso**: situação interna, advogado, observações,
  operações cobradas, custos, recuperações, prazos e o parecer.

## `status_predito` não é `situacao_interna`

| | `status_predito` | `situacao_interna` |
| --- | --- | --- |
| O que é | Classificação do **Escavador** sobre o andamento no tribunal | Onde **nós** colocamos o processo |
| Valores | `ATIVO` \| `INATIVO` | `em_andamento` · `suspenso` · `acordo` · `ganho` · `perdido` · `encerrado` |
| Quem move | O robô, a cada sincronização | Uma pessoa, na tela |

Elas discordam com frequência, e **a discordância é a informação**: `INATIVO` no tribunal
com `em_andamento` aqui é um processo que parou e ninguém viu. Uma coluna só apagaria
exatamente essa pergunta.

## O vínculo com `empresas` é por CNPJ, nunca por nome

O devedor é procurado no polo **oposto** ao nosso, e por documento. "Construtora Alfa
Ltda" e "CONSTRUTORA ALFA LTDA - EM RECUPERAÇÃO JUDICIAL" são a mesma empresa com dois
nomes, e são empresas diferentes quando a razão social se parece por acaso. Casar por nome
penduraria o processo na ficha de quem nada tem com ele.

Não achou o CNPJ em `empresas` → `empresa_devedora_id` fica **nulo** e o CNPJ entra em
`cnpj_lookup_fila` (a mesma fila da Antecipação — duas filas consultariam as mesmas APIs
gratuitas pelo mesmo CNPJ e se atropelariam no rate limit). A lista mostra a **fila de
vinculação manual no topo da tela**, e não numa aba: um processo sem empresa some da
Company 360 do devedor e não bloqueia crédito para ele. É o defeito mais caro do módulo, e
ele não pode depender de alguém lembrar de procurar por ele.

## A fase só anda para a frente

`processos.fase_atual` é a fase **mais avançada já detectada**, não a última:

```
distribuicao → citacao → contestacao_embargos → instrucao → sentenca → recurso →
transito_julgado → cumprimento_execucao → penhora → leilao_expropriacao → arquivamento
```

Uma "juntada de petição" classificada como instrução, chegando depois da penhora, é
descartada do cronograma. Sem essa regra, o cronograma mediria tempo por fase com o
relógio reiniciando a cada vaivém — e apagaria justamente a lentidão que ele existe para
mostrar. Repetir a mesma fase também não abre etapa nova, pelo mesmo motivo.

### O classificador é determinístico, e isso é uma escolha

Palavra-chave sobre o conteúdo da movimentação, com **exceções** que anulam o casamento
("citação negativa" contém "citação" e é o contrário do marco). Quando duas regras casam
no mesmo texto, vence a **mais avançada**: uma movimentação que menciona sentença e
cumprimento aconteceu depois das duas.

Um modelo que acerta 90% produz, numa carteira de trezentos processos, trinta cronogramas
errados por rodada — e ninguém tem como saber **quais**. Palavra-chave erra também, mas de
um jeito auditável: dá para abrir a regra, ver a expressão que casou (`termo_detectado`,
mostrado na tela) e corrigi-la.

A régua vive em `juridico_config.classificador`. **Lista vazia = use a de fábrica**
(`REGRAS_FASE_PADRAO`, no core); preenchida, ela **substitui** a régua inteira —
complementar faria uma regra removida na tela continuar valendo pelo padrão.

Corrigir uma palavra-chave **não reclassifica o passado sozinho**. É um botão separado
("Reclassificar a base inteira"), porque a varredura pode mover a fase de centenas de
processos e mover a fase dispara alerta de lentidão e notificação.

## Os dois níveis de sincronização, e o caro é o segundo

| | O que faz | Custo |
| --- | --- | --- |
| Ler a base do Escavador | `GET` capa + movimentações | barato, é o padrão |
| `solicitar-atualizacao` | o **robô vai ao site do tribunal** | **crédito por processo, por rodada** |

`forcar_atualizacao_tribunal` nasce **desligado**. Ligado com 300 processos e 5 dias por
semana são 1.500 chamadas pagas por semana — e a tela escreve essa conta ao lado do
interruptor antes de ele ser apertado.

A **agenda** (dias da semana, hora, escopo) vive em `juridico_config.monitoramento` e é
conferida **dentro do job**, não no `vercel.json`: o cron dispara todo dia e o job decide
se hoje é dia. Codificar os dias no cron obrigaria um deploy para mudar a agenda — e a
agenda é justamente a setting que muda o custo.

O dia da semana é o de **São Paulo**, não o de UTC. O container roda em UTC; uma rodada
marcada para as 7h de segunda dispararia às 4h UTC, que ainda é domingo no fuso de quem
configurou — e o job simplesmente não rodaria nas segundas, em silêncio.

## O callback só grava

`POST /api/webhooks/escavador` (web) e `POST /webhooks/escavador` (worker) fazem a **mesma
coisa**: validam o `ESCAVADOR_CALLBACK_TOKEN`, gravam a linha em `juridico_callbacks` e
respondem. A URL cadastrada no painel deles pode apontar para qualquer uma das duas.

Quem processa é o job. O Escavador reenvia até **11 vezes com backoff** quando não recebe
200; buscar a capa, paginar as movimentações e reclassificar levaria dezenas de segundos, e
o reenvio chegaria com o primeiro processamento ainda rodando.

**A idempotência é a chave primária, não um `if`**: `juridico_callbacks.uuid` é PK, então o
reenvio bate na chave antes de qualquer decisão. Um `23505` responde **200** — é o caso
normal do reenvio, e um erro faria o Escavador tentar de novo para sempre.

Falha ao **gravar** responde **500** de propósito, ao contrário do webhook do Apollo: aí
nós queremos o reenvio, porque perder um `novo_processo` é perder uma ação nova contra nós.

### Dois segredos, e eles não se misturam

`ESCAVADOR_TOKEN` é o Bearer da API — é ele que **gasta dinheiro**, e vive só no worker.
`ESCAVADOR_CALLBACK_TOKEN` é o segredo de **entrada**. Reaproveitar o token de saída como
segredo de entrada o publicaria num header que qualquer um pode nos fazer comparar batendo
na nossa URL.

**Os dois são gerados no painel do Escavador**, e são valores diferentes: o da API, na
área de credenciais; o do callback, junto da configuração de callback. Nós não inventamos
nenhum dos dois — o do callback a gente **copia** do painel deles para
`ESCAVADOR_CALLBACK_TOKEN`, no worker **e** na web, com o mesmo valor. Se divergirem, uma
das duas URLs recusa tudo em silêncio.

A rota aceita esse segredo em `Authorization` (com ou sem `Bearer`), em
`X-Escavador-Token`, `X-Callback-Token`, `X-Api-Token`, `X-Token` ou em `?token=` na URL.
A lista é larga de propósito: quando o token é emitido por eles, não escolhemos onde ele
chega, e descobrir o lugar certo por tentativa e erro num painel de terceiro é caro. A
comparação é a mesma em todos os casos — tempo constante, falha fechada.

Quando a rota recusa, ela registra no log os **nomes** dos cabeçalhos que vieram (nunca os
valores). É o que transforma "o painel não salva" em "eles mandam em `X-Alguma-Coisa` e a
gente não lê".

## O custo só existe no nosso log

A API não tem extrato consultável. Cada resposta traz o header **`Creditos-Utilizados`**, e
`juridico_sync_log` é a **única** fonte do gasto acumulado — sem ela, o custo do módulo só
apareceria na fatura, um mês depois de alguém ter ligado a atualização forçada.

Por isso o cliente do Escavador não usa o `requisitarJson` genérico do worker: aquele
devolve só o corpo, e aqui o header é metade da informação. Gravar a linha de log nunca
derruba a chamada — perder uma linha de contabilidade é perder um número; perder a
sincronização por causa dela é perder o trabalho.

**Throttle: 130 ms entre chamadas** (~460/min, contra o limite de 500). A folga não é
excesso de zelo: o retry de uma chamada acontece *dentro* da janela do minuto que já estava
cheio, e é aí que a conta estoura.

## O cálculo vai para os autos

A ordem das incidências está declarada e é a da jurisprudência corrente:

```
principal → correção monetária → juros de mora → multa → honorários → custas
```

Juros **sobre o corrigido** (a correção só recompõe poder de compra, não é ganho). Multa
sobre o principal corrigido, sem os juros. Honorários sobre o subtotal e **nunca sobre as
custas** — custas são reembolso, não proveito econômico.

Três decisões que o número esconde:

- **Mora fracionada.** 45 dias são 1,5 mês de juros, não 1. Truncar subtrairia meio mês de
  mora de toda operação da carteira.
- **Mês sem índice não vira zero.** A competência ausente é tratada como fator 1 **e vai
  para a lista de faltantes**, que aparece na memória, na tela (em âmbar, não em verde) e
  no CSV. Tratá-la como zero daria o mesmo número e esconderia o buraco; abortar o cálculo
  deixaria o advogado sem nada na véspera do protocolo.
- **Os parâmetros são gravados junto do resultado**, nunca referenciados. A taxa da casa
  muda; o cálculo de março continua sendo o de março.

`processo_calculos` é **append-only**. Cada geração é uma linha nova, porque a memória de
março é a que sustenta a petição de março — e é a que a parte contrária está atacando.

A tabela de índices é **editável e importável** (`AAAA-MM;valor` colado da planilha), e não
é buscada em API no meio do cálculo: uma memória juntada aos autos precisa ser reproduzível
daqui a dois anos, e um índice revisado na fonte mudaria um número já protocolado.

**Exportação**: CSV com `;` e vírgula decimal (é como o Excel em pt-BR abre) e PDF pela
janela de impressão do navegador. Uma biblioteca de PDF no bundle custaria centenas de kB
para produzir um documento que vai ser impresso de qualquer jeito.

## O parecer não é peça

`AVISO_PARECER` acompanha o texto na web, no celular e na resposta das tools — **acima**
dele, não no rodapé, porque a primeira coisa lida tem de ser a ressalva.

O que sustenta a restrição não é a instrução no prompt, é o **dossiê fechado**: tudo o que
o modelo vê é montado campo a campo em `montarDossie`. "Use apenas os dados fornecidos" só
vale porque o que não está lá não chega nele. E o que está diz **de onde veio** — cálculo
determinístico, movimentação do tribunal, cadastro nosso —, para o texto poder citar a
fonte.

`proximo_passo` sai por **tool call**, não por regex sobre markdown: é o campo que a lista
mostra e que orienta a ação, e um parse que quebra em silêncio quando o modelo muda o
formato de uma seção é o pior lugar para isso acontecer.

As movimentações entram **relevantes primeiro e sem corte**, depois as recentes até 80. É a
ordem que sobrevive ao teto de tokens: se algo cair, cai a juntada de rotina, nunca a
citação.

Editar grava uma **linha nova** com `editado = true`. A tela distingue "o modelo disse" de
"o advogado escreveu" — misturar os dois é como um texto de IA vira citação de autoridade
dentro da própria casa.

## Processo nosso ativo é knockout de crédito

`empresas.tem_processo_nosso_ativo` é cache mantido por **trigger** sobre `processos` —
não por job. A pergunta "esta empresa tem processo nosso?" é lida no momento em que alguém
decide operar com ela, e uma varredura noturna deixaria até 24h de janela concedendo limite
a quem estamos executando.

No scorecard (04d) ele vem **antes** de `situacao_irregular`, e a razão não é gravidade
relativa: é o único fato da lista que **nós** produzimos. Situação cadastral vem da Receita,
protesto de cartório, negativa da seguradora. Uma execução ajuizada por nós é a casa
afirmando, com assinatura de advogado, que ele não pagou. Não há chance de concessão a
estimar.

O score é cache, e ele precisa ser reconciliado por dois caminhos:

- **na hora**, quando o processo é novo (é na semana da ação que alguém pede limite);
- **diariamente**, no job de alertas, porque marcar o processo como "ganho" na tela roda um
  RPC em SQL que não tem como chamar o worker. Sem isso a empresa continuaria bloqueada
  depois de a ação ter acabado, e ninguém saberia por quê. A comparação é com o knockout da
  linha **mais recente** de `empresa_scores` — a tabela é append-only, e procurar "existe
  linha com o knockout" acharia a pontuação de seis meses atrás para sempre.

## Quem é notificado, e por quê não é uma regra de perfil

| evento | quem | push? |
| --- | --- | --- |
| `processo.importado` | perfil Jurídico (sino) | não |
| `processo.novo_detectado` (callback) | gestores + Jurídico | **sim** |
| `processo.movimentacao_relevante` | **o advogado daquele processo** | **sim** |
| `processo.fase_lenta` | **o advogado daquele processo** | **sim** |
| prazo em D-3 e D-1 | **o responsável pelo prazo** | **sim** |
| `processo.sem_movimentacao` | sino, pelo evento | não |
| `recuperacao.registrada` | Jurídico + Admin | não |

Os três destinatários em negrito são calculados **por linha**, e por isso saem de
`notify()` no worker e não do fan-out de `notificacao_regras`. Uma regra de perfil mandaria
as trezentas movimentações relevantes do mês para todo mundo do Jurídico, e o segundo dia
disso é o dia em que ninguém abre mais o sino.

**Advogado externo não tem `usuario_id`** — ele não tem (nem deve ter) sessão na
plataforma. Nesse caso o aviso vai para o perfil Jurídico + Admin, que é quem fala com o
escritório. Cair no silêncio seria pior: o processo com advogado externo é justamente o que
ninguém daqui olha todo dia.

Os alertas de fase lenta e processo parado são **idempotentes por 24h** (conferem
`empresa_eventos`). Um processo estourado fica estourado por semanas, e um aviso diário
sobre um fato que não mudou é como se ensina alguém a ignorar o sino. O aviso de prazo usa
colunas próprias (`avisado_d3_em`, `avisado_d1_em`), porque D-3 e D-1 são **dois** avisos
sobre o mesmo prazo e uma janela de tempo não os distinguiria. **D-1 é conferido antes de
D-3**: um prazo criado com dois dias de antecedência nunca passa pela janela de D-3, e
testar D-3 primeiro faria o aviso da véspera sair carimbado como o de três dias antes.

## O que a RLS deixa cada um ver

`processos` é lida por quem tem **`juridico` ou `empresas`**. A Company 360 mostra a seção
Jurídico com os processos daquela empresa e o valor em disputa, e ela é aberta pelo
comercial, pelo crédito, por quem trabalha a conta — saber que existe ação contra o sacado
é o que muda a conversa que essa pessoa vai ter hoje.

O **conteúdo**, não. Movimentação é texto de tribunal sobre o mérito; parecer é análise de
risco da casa. Nenhum dos dois é matéria de quem abriu a ficha para ver o telefone do
contato. A fronteira é "existe e vale tanto" contra "eis o que está acontecendo lá dentro".

Por isso o link para `/juridico/<cnj>` na Company 360 **só sai para quem tem o módulo**:
oferecer um link que leva a `/sem-acesso` é pior que não oferecer link nenhum.

`juridico_callbacks` fica **sem policy nenhuma** e com `ALL` revogado — é fila, não tela.

## Saldo líquido: recuperado − custos

O número que responde "esta ação está pagando o próprio custo?". Ele não existe em nenhuma
das duas somas isoladas, e é assim que uma carteira inteira de execuções deficitárias passa
despercebida com um "recuperado" bonito no topo. Aparece no detalhe do processo, na lista,
no painel e na Company 360, sempre ao lado das duas parcelas.

## Mobile

Lista com filtro por situação (não kanban: seis colunas num celular são uma visível e cinco
escondidas), detalhe com cronograma, movimentações e parecer, agenda de prazos com
conclusão, e **registro de custo com foto do comprovante** — a guia de custas em papel na
mesa do fórum é o momento em que o comprovante existe; fotografar depois é fotografar
nunca.

Não cabem no celular: gerar cálculo, gerar parecer e as configurações. Os dois primeiros
custam e produzem documento que alguém lê inteiro antes de usar — a memória tem nove
colunas por operação. As configurações são calibragem com tabela. Espremer isso em 6"
produziria uma versão pior das duas coisas.

## Jobs

| job | rota do worker | quando |
| --- | --- | --- |
| Descobrir processos | `POST /jobs/juridico/descobrir` | sob demanda (admin) |
| Sincronizar | `POST /jobs/juridico/sincronizar` | `/api/cron/juridico-sincronizar`, 10:00 UTC — **o job confere a agenda** |
| Callbacks | `POST /jobs/juridico/callbacks` | disparado pelo webhook + junto do sync |
| Classificar fases | `POST /jobs/juridico/classificar` | sob demanda, depois de mexer nas regras |
| Alertas | `POST /jobs/juridico/alertas` | `/api/cron/juridico-alertas`, 11:00 UTC — **todo dia** |
| Parecer | `POST /jobs/juridico/parecer` | **síncrono**, do clique |
| Monitoramentos | `POST /jobs/juridico/monitoramentos` | sob demanda |

Os alertas rodam **todo dia, inclusive nos que não sincronizam**: uma audiência de terça
precisa do aviso de segunda mesmo que segunda não seja dia de sincronizar — o prazo corre
pelo calendário do fórum, não pelo nosso. E rodam **depois** do sync (11:00 contra 10:00),
para contar dias parados sobre o que acabou de chegar.

O parecer é o único síncrono: quem clicou acabou de autorizar um gasto em tokens e está com
a tela aberta.

## A ordem de ligar o módulo

Os três botões em **Configurações → Jurídico** fazem coisas diferentes, e a ordem
importa. Rodar o terceiro primeiro não dá erro: dá silêncio.

| Botão | O que faz | Quando |
| --- | --- | --- |
| **Descobrir processos agora** | Pergunta ao Escavador quais processos existem para cada CNPJ nosso e traz a capa deles | **Primeiro.** É o único que popula `processos` do zero |
| **Cadastrar monitoramentos** | Registra um monitoramento por CNPJ para o Escavador nos avisar de ação nova | Depois, uma vez (idempotente por termo) |
| **Sincronizar agora** | Relê capa e movimentações dos processos **que já conhecemos** | Depois — com a tabela vazia ele não tem o que fazer e não escreve log nenhum |

## Cadastrar a URL de callback no Escavador

1. Painel do Escavador → **Configurações → Callbacks**.
2. URL, nas duas formas que funcionam:
   - com o segredo na própria URL (use esta se o painel só tiver campo de URL):
     `https://<seu-dominio>/api/webhooks/escavador?token=<ESCAVADOR_CALLBACK_TOKEN>`
   - ou `https://<seu-dominio>/api/webhooks/escavador` + header
     `Authorization: Bearer <ESCAVADOR_CALLBACK_TOKEN>`, se o painel oferecer header.

   A URL do worker (`https://<worker>/webhooks/escavador`) aceita exatamente as mesmas
   duas formas e grava na mesma tabela, com a mesma chave — cadastrar as duas não
   duplica nada.
3. Eventos: **`novo_processo`** e **`atualizacao_processo_concluida`**. Os demais chegam,
   são marcados como processados e ignorados — o que impede a fila de crescer para sempre
   com linhas que ninguém vai olhar.

### Se o painel recusa a URL ao salvar

A rota responde **GET e HEAD com 200** quando o token confere, e responde 200 a um POST
de corpo vazio: é a verificação que os painéis fazem antes de salvar. Antes ela só
aceitava POST com header, então a verificação levava 401 ou 405 e o botão de salvar
parecia não fazer nada.

Para conferir de fora, sem depender do painel:

```bash
curl -i "https://<seu-dominio>/api/webhooks/escavador?token=<ESCAVADOR_CALLBACK_TOKEN>"
```

`200` com `{"ok":true}` significa URL no ar e segredo certo. `401` é token errado (ou
`ESCAVADOR_CALLBACK_TOKEN` faltando no ambiente da web — a rota **falha fechada** de
propósito). `404` significa que o deploy com esta rota ainda não subiu.

## A carteira abre nos que pedem decisão

A lista entra filtrada em **Abertos** — tudo menos `encerrado`. `ganho` e `perdido` ficam
de propósito: eles ainda têm dinheiro a receber ou custo a apurar depois do fim da ação, e
escondê-los faria a recuperação ser esquecida justamente quando ela é possível.
`encerrado` é o único que quer dizer "não há mais nada aqui". "Todas as situações" continua
a um clique.

A ordem é **valor decrescente, com acordo no fim**. Um processo em acordo já foi resolvido
— o que resta é acompanhar o pagamento, não decidir — e mantê-lo no topo por ser o de maior
valor empurraria para baixo justamente os que ainda pedem decisão.

**Encerrar** e **marcar acordo** são botões no topo da ficha, e os dois desfazem: o rótulo
vira "Reabrir" e "Desfazer acordo". O seletor completo de seis situações continua em
"Gestão do processo" — os botões são o atalho das duas transições do dia a dia, não um
segundo dono do campo.

## Conferir qual build do worker está no ar

`GET https://<worker>/health` devolve o **commit** e desde quando o processo está de pé:

```json
{ "ok": true, "db": "ok", "commit": "52ca741", "branch": "main", "desde": "..." }
```

Isso existe por um caso concreto. Um parser do valor da causa foi corrigido, testado e
mergeado; quatro horas depois o worker ainda gravava o valor errado e sobrescreveu um
backfill que já tinha corrigido o passado. Sem o commit no `/health` não havia como
distinguir as duas hipóteses — e elas pedem coisas opostas: **código errado se conserta
escrevendo, deploy parado se conserta clicando**.

Um `commit` certo com `desde` de duas semanas atrás também é resposta: o build subiu, o
processo não reiniciou.

## O briefing e o parecer são coisas diferentes

Duas saídas de IA no módulo, e a diferença não é de tamanho:

| | Briefing | Parecer |
| --- | --- | --- |
| Responde | "abri este processo, me situe" | "preciso entender este caso a fundo" |
| Onde | topo da ficha, sem pedir | aba **Parecer**, sob demanda |
| Lê | 25 movimentações | 80 + todas as relevantes |
| Devolve | fase, o que aconteceu, próxima ação, urgência | 6 seções + risco + próximo passo |
| Guarda | uma linha, sobrescrita | histórico, com edição |

Fundir os dois transformaria o briefing num parecer curto, que é pior nas duas
funções: longo demais para situar, raso demais para decidir.

### Quando ele é regerado sozinho

No sync do dia configurado em `juridico_config.monitoramento.dia_resumo_ia` — **sexta por
padrão**. Um dia, e não todos: o resumo custa token por processo, e ele muda quando chega
movimentação, não quando o relógio vira. Rodá-lo nas cinco sincronizações da semana
pagaria cinco vezes pelo mesmo texto.

Fica junto dos dias de sync, e não no código, pela mesma razão que eles: é a setting que
decide o custo. `null` desliga o automático; o botão de cada processo continua em qualquer
dia. A tela avisa quando o dia escolhido não está na agenda de sync — porque aí os resumos
nunca seriam regerados.

### A validade é por movimentação, não por data

`processo_briefings.ate_movimentacao_em` guarda até onde o texto leu. Um briefing de
três meses atrás sobre um processo parado há um ano **está atual**; um de ontem sobre um
processo que teve penhora hoje **não está**, e a tela mostra a tarja. Expirar por tempo
erraria os dois casos e gastaria token justamente nos processos parados, que são a
maioria de qualquer carteira.

O sync regenera o que ficou velho na mesma corrida que trouxe a movimentação nova — não
há relógio próprio para isso, porque um relógio próprio acordaria de hora em hora para
descobrir que nada mudou. Se a geração falhar, ela **não derruba** a sincronização: o
dado do tribunal já está gravado, e um texto de apoio que não saiu não é motivo para
marcar como falha uma corrida que trouxe o que importava.

### O modelo não conta prazo

Mesma restrição do parecer, repetida no prompt do briefing: ele não tem calendário
forense nem contagem de prazos. Pode **repetir** um prazo que uma movimentação cite
literalmente, atribuindo a ela; não pode afirmar quantos dias faltam nem se cabe recurso.
"Contestar até sexta" é o tipo de frase que soa útil e perde prazo.

## Custo por tipo de chamada

O painel em **Configurações → Nossos CNPJs** mostra créditos, chamadas e erros dos últimos
30 dias, quebrados por tipo. A janela é de 30 dias porque a pergunta é "quanto este módulo
custa por mês" — um total desde sempre só cresce, e um número que só cresce para de ser
lido.

| tipo | quando dispara |
| --- | --- |
| `busca_cnpj` | descoberta: resumo (barato) + páginas de `/envolvido/processos` |
| `atualizacao_processo` | capa, movimentações e `solicitar-atualizacao` |
| `callback` | reservado ao processamento de callback |
| `monitoramento` | criar, listar e remover monitoramentos |

Duas economias embutidas na descoberta: **`GET /envolvido/resumo` antes de varrer** (é
barato e diz se há zero processos, o que pula a varredura inteira) e **`status=ATIVO` por
padrão** (um CNPJ de FIDC com dez anos acumula centenas de ações encerradas; o corte na
origem separa uma importação de dez páginas de uma de duzentas). As movimentações são
**opcionais** na descoberta e desligadas por padrão — a capa já dá a lista, e a timeline
vem na primeira sincronização.

## Limites conhecidos

- **A API do Escavador nunca foi chamada de verdade.** Os endpoints, os nomes dos campos e
  a paginação por cursor foram escritos contra a documentação da v2. O consolidador da capa
  e a normalização dos envolvidos têm testes sobre payloads de exemplo
  (`packages/core/src/juridico/escavador.test.ts`); o que não foi exercitado é o formato
  real. Se um campo vier com outro nome, o sintoma é uma coluna nula na capa — não uma
  quebra —, porque toda leitura é defensiva.
- **O teto de páginas por cursor é 200.** `links.next` é opaco, e uma API que devolva a
  mesma URL duas vezes viraria um laço gastando crédito a 460 chamadas por minuto. O
  resultado marca `truncado`, e o log avisa.
- **`vinculo_cobranca_id` não tem FK.** A tabela do Prompt 07 não existe; a coluna
  documenta a intenção sem fingir que há integridade referencial.
- **Os benchmarks de fase são referências, não estatística da casa.** Os valores de fábrica
  (citação 60d, contestação 45d, sentença 180d, penhora 90d) foram semeados para o alerta
  existir desde o primeiro dia. Quando houver histórico, eles deveriam sair da mediana real
  por comarca — hoje saem da tela de configurações.
