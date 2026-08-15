# Crédito: limite potencial, scorecard e esteira (Prompt 04d)

Uma cadeia de multiplicações, e o valor de tudo isto depende de cada elo declarar a
própria ignorância:

```
faturamento estimado (04c) → limite potencial → volume mensal → receita prevista
                                                                      × chance = valor esperado
```

**Escopo: SACADOS** (`tipo in ('construtora','incorporadora')`). Fornecedor tem outra
pergunta — adesão —, que não é esta.

## O aviso honesto, antes de qualquer número

Medido na base no dia da implementação, entre 8.096 sacados:

| fator do scorecard | peso | empresas com o dado |
|---|---|---|
| Protestos | 25 | **15** (0,2%) |
| Faturamento/porte | 15 | **0** |
| Crescimento de equipe | 5 | **1** |
| Capital social | 5 | 5.840 |
| Idade, regularidade, histórico, atividade, certificado | 50 | ~5.840 |

Ou seja: **5.840 empresas passariam no corte de completude com exatamente os mesmos 55%
dos pesos**, e nenhum sinal de risco de crédito de verdade (protesto e faturamento)
entraria na conta de nenhuma delas. O score sairia, teria cara de score, e ordenaria a
base por idade + capital + obras.

E o **limite potencial é nulo para 100% da base**, porque:

- `ratio_limite = credit_limit ÷ faturamento_declarado` precisa de clientes que
  DECLARARAM faturamento. Há **zero**.
- `faturamento_estimado` está nulo em todas as 8.096 — o estimador do 04c nunca rodou,
  porque ele também depende de declarantes.

O `giro_mensal`, esse sim, já sai do real: **14,7%** do limite por mês, mediana de 36
clientes com limite e volume. É o único elo da cadeia que funciona hoje.

### A régua de ordenação não pode ser o default do Explorador

O §5 pede ordenação default por `valor_esperado_mensal`. Foi tentado e **desfeito**: a
chave vive em `empresas`, que entra por LEFT JOIN, então o `limit 51` não desce e o
Postgres materializa as 881 mil linhas do universo antes do sort. Medido: 4,2 ms por
`cnpj` contra **23.350 ms** por valor esperado, com `statement_timeout` de 8 s. Não é
efeito da coluna estar vazia — com dados o plano é idêntico.

A coluna continua **ordenável sob demanda**, e sobre uma seleção filtrada o sort é barato
— que é como a régua serve para priorizar de verdade. Para valer como default no universo
inteiro, ela precisa ser denormalizada em `mercado_universo`, do jeito que `camada` e
`grupo_id` já vivem lá.

**Para ligar o resto**: declarar o faturamento de ~5 clientes na Company 360 → rodar o
estimador (`/radar/estimador`) → rodar "Recalibrar e recalcular" em `/credito/painel`.
Enriquecer protestos de um lote de sacados é o que faz o fator de maior peso sair do
limbo.

## Por que nada disso preenche com um default

Sem `ratio_limite`, o job grava **null** e registra o motivo — nunca zero e nunca um
palpite. As duas alternativas são piores de formas diferentes:

- **Zero** ordena a empresa como "não vale nada" na régua do Explorador, quando o que se
  sabe é que não se sabe.
- **Um default** preencheria a base inteira de limites plausíveis, e plausível é
  exatamente o que ninguém questiona.

## O scorecard

### A regra que governa tudo: fator sem dado sai da conta inteira

`score = Σ pontos obtidos ÷ Σ pesos dos fatores AVALIÁVEIS × 100`. Um fator sem dado sai
do numerador **e** do denominador, e reduz a `completude`.

Com os pesos do seed, uma empresa perfeita sem consulta de protesto dá **93,3**
(renormalizado sobre 75 pesos). Tratando ausência como zero daria **70** — pior que uma
empresa idêntica que foi consultada e está limpa (95). Há teste para os dois números.

Completude abaixo de `completude_minima` (0,5) → `faixa = 'dados_insuficientes'` e **o
score não é exibido**. Um 72 calculado sobre 20% dos pesos parece um 72.

O teto realista é **95**, não 100: "nunca analisada" vale 5 de 10 de propósito — não é
boa notícia nem má, e o teto fica reservado para quem já foi aprovado.

### Knockouts

- `situacao_cadastral != 'ativa'` → score 0, faixa improvável. **Vem antes do corte de
  completude**: uma empresa baixada na Receita é improvável mesmo que não se saiba mais
  nada dela. "Não sei o resto" não apaga o que se sabe.
- Negada nos últimos `knockout_negada_meses` → score **travado** em
  `corte_concessao − 10`, e não zerado. A diferença importa: quem foi negado há cinco
  meses e melhorou em tudo o mais volta a subir quando a janela passa; zerar apagaria a
  informação que o faria voltar.

### Protesto: relativizado e datado

O denominador preferido é o faturamento; sem ele, o capital social — que é pior, e por
isso vai **marcado no breakdown**, para ninguém comparar dois scores como se tivessem
sido medidos com a mesma régua. R$ 100 mil de protesto é 0,17% de uma empresa de 60M
(faixa boa) e 10% de uma de 1M (faixa péssima); o valor absoluto não distingue as duas.

Protesto mais recente que `recencia_protesto_dias` vale **metade dos pontos**: dívida
velha e dívida de ontem não dizem a mesma coisa sobre pagar amanhã.

### O que é editável, e o que não é

A **lógica** de cada fator mora em `packages/core/src/credito/score.ts`, é fixa por id e
tem teste. O que a UI edita são **pesos, limiares e pontos**, versionados em
`scorecard_versoes.definicao`. Um jsonb que carregasse a lógica seria uma linguagem de
expressão dentro do banco, e nenhum teste alcançaria as versões que alguém salvar depois.

O editor tem **prévia de impacto**: roda o mesmo `calcularScore` do worker sobre 600
sacados reais e mostra quantas empresas mudam de faixa antes de ativar. Faixa vira chance,
que vira valor esperado, que vira a ordem da lista de prospecção — ativar sem ver isso é
editar no escuro uma régua que decide o dia de alguém. Ativar **já dispara o recálculo**,
senão a base ficaria com os scores da versão anterior enquanto a tela mostra a nova.

## A confiança propaga

O limite **herda** `faturamento_confianca`. Não existe caminho que devolva `alta` a partir
de uma estimativa `media`: uma multiplicação não cria informação. Se o faturamento é
chute, o valor esperado é o mesmo chute com outra unidade, e precisa dizer isso antes de
chegar ao vendedor.

Quando não há score, a chance usada é `chance_sem_score` (0,5) e o resultado vem
**marcado como presumido** — na web, no mobile e na resposta da IA.

## A esteira

```
rascunho → solicitada → docs_pendentes → enviada_seguradora → em_analise
                                                            → aprovada | aprovada_parcial | negada
                                                            → expirada
```

**Só os quatro primeiros são nossos.** De `enviada_seguradora` em diante quem escreve é o
worker, com service role — o RPC `app_mover_analise` recusa esses estágios. Por isso o
kanban não tem arrastar-e-soltar e o seletor do detalhe só oferece os quatro manuais: uma
coluna que aceita um card promete um poder que não existe, e o banco negaria a escrita,
transformando um gesto natural num erro inexplicável.

### A regra de custo

`resolverBuyer` **pode ser cobrado** pela Atradius. Ele é chamado em **um** lugar: dentro
de `enviarAnalises`, sobre uma análise que um humano marcou. Consequências de desenho:

- A interface `Seguradora` do core **não tem** método de busca aberta de buyer.
- A rota de envio recebe **ids explícitos**, nunca "todas as solicitadas" — um envio em
  massa acidental é uma fatura, não um incômodo.
- Buyer já resolvido numa tentativa anterior não é resolvido de novo: um retry que
  recobra transforma instabilidade de rede em linha na fatura.
- O **backfill** lê `listarPortfolio` e `listarDecisoes` (o que a apólice JÁ tem) e só
  chama `detalharBuyer` para buyers que vieram nessas listas.

Buyer sem CNPJ de 14 dígitos vai para revisão manual (fica sem `empresa_id`) em vez de ser
casado por nome — dois homônimos viram uma empresa só, e o erro só aparece quando alguém
aprova o limite errado.

### Uma função escreve o desfecho

`aplicarDecisao` é a única. Poll, backfill e sync chegam nela por caminhos diferentes;
três cópias seriam três lugares onde "aprovada parcial" pode virar "aprovada". Toda
decisão vira snapshot em `credito_snapshots` (origem `atradius`) + evento.

`analise.limite_reduzido` é evento próprio, e não um caso dentro de "atualizada": a
seguradora **cortando** cobertura que já tinha concedido é o sinal de risco mais forte que
este sistema recebe de fora, e vai para Admin além de Crédito.

`origem = 'atradius_backfill'` marca o que veio da apólice e não foi pedido aqui. O funil
do painel exclui essas linhas: incluí-las inflaria a taxa de aprovação com decisões que
este fluxo não tomou.

## Sobre a integração com a Atradius

O portal de desenvolvedores (`api.atradius.com/developers`) **exige cadastro** para
liberar os handbooks do Buyer e do Cover API. Sem credenciais não foi possível confirmar
caminho de rota, nomes de campo nem formato de paginação.

O que está implementado é a forma documentada publicamente (OAuth2 client-credentials +
REST por apólice), e **toda a superfície que pode divergir está isolada** em `ROTAS` e nas
três funções `mapear*` de `apps/worker/src/jobs/credito/atradius.ts`. Corrigir contra o
handbook real é editar um arquivo.

Sem credencial, `configurada()` devolve false: a esteira funciona inteira até "enviada à
seguradora" e explica o que falta, em vez de estourar um erro de rede que parece um bug.

## Ordem dos jobs (é dependência, não preferência)

```
mensal (dia 7, 08h UTC):  calibrar → scores → potencial
diário (09h UTC):         sync da apólice → poll → expirar
```

- **calibrar antes de scores e potencial**: o ratio e o giro saem da carteira.
- **scores antes de potencial**: a chance é o multiplicador do valor esperado. Invertido,
  produziria uma rodada inteira de valores esperados multiplicados pela chance do mês
  passado — e gravados como snapshot, virando história errada.
- **dia 7, depois do estimador (dia 6)**: o limite é proporção do faturamento estimado.

A expiração roda mesmo sem seguradora configurada: a data de validade é nossa, e uma
aprovação vencida contando como vigente valeria pontos no scorecard que ela não tem mais.

Evento de score só na **mudança de faixa**. Um aviso por empresa por rodada seriam 8 mil
notificações por mês, que é o mesmo que nenhuma.

### Recálculo dirigido depois de uma decisão

Poll, sync, backfill e expiração chamam `recalcularScoresDeCnpjs` com os CNPJs tocados.
Uma decisão mexe em dois fatores da empresa decidida — "histórico de análises" e, se foi
negada, o knockout `negada_recente`. Sem o gatilho, a empresa negada hoje ficaria com a
faixa antiga até a virada do mês, e o valor esperado dela seguiria multiplicado por uma
chance que a própria seguradora acabou de desmentir.

**Dirigido, e não a varredura inteira**: recalcular 8 mil empresas porque UMA foi decidida
é caro o bastante para alguém desligar o gatilho — e gatilho desligado é o mesmo que não
existir. Os dois caminhos usam a mesma função de pontuar (`pontuarLote`), então não há
onde a renormalização divergir.

## Potencial de aumento de limite (0103)

A cadeia da 0073 corre no sentido da PROSPECÇÃO: faturamento → limite potencial → quanto
vale um prospect. Apontada para a **carteira existente**, a mesma conta responde outra
pergunta: *em quem concedemos pouco para o tamanho que ele tem?*

O card vive em **Empresas → Análise**, primeiro da aba — os outros blocos descrevem a
carteira, este diz o que fazer com ela.

**A régua é o nosso próprio comportamento**, não uma política escrita. `ratio_limite` é a
**mediana de `credit_limit ÷ faturamento_declarado`** medida na carteira real: hoje
**1,83%**, sobre 27 clientes declarantes. Um cliente muito abaixo dela não fere uma regra
— está sendo tratado diferente dos comparáveis dele, e isso é uma pergunta que alguém
consegue responder. A tela imprime a mediana e o `n` no cabeçalho: um "espaço" sem a régua
ao lado é um número que ninguém confere.

Na base atual: **14 clientes com espaço**, R$ 25,5 mi somados, e **4 em 100% de consumo**.
Esses quatro são o caso mais nítido — pararam de operar por causa do nosso teto, não por
falta de demanda. O extremo é a CONSTRUTORA ATERPA: fatura R$ 816 mi, tem R$ 150 mil de
limite (0,02%, cerca de 100× abaixo da nossa mediana) e score 71 na faixa alta.

**A forma é um dumbbell** — dois pontos por empresa e a barra entre eles. É o desenho de
"de X para Y por item", e a barra *é* a oportunidade, o que faz a lista se ordenar sozinha.
Um gráfico de dispersão mostraria a correlação melhor e a ação pior: a pergunta aqui não é
"existe correlação?", é "em quem eu mexo primeiro?". Concedido é ponto **sólido** (é fato),
potencial é **vazado** (é estimativa) — dar o mesmo peso visual aos dois é como um número
calibrado vira uma promessa.

**Duas honestidades que a tela precisa dizer em voz alta:**

- **O potencial tem teto** (`cap_pct_faturamento` 15% + `cap_absoluto` R$ 5 mi). Quem bate
  nele aparece com espaço **menor** que o real — e é justamente o topo da lista. Um aviso
  conta quantas empresas estão nessa situação.
- **A confiança do limite é herdada do faturamento** (0073). Se o faturamento é estimado, o
  potencial é o mesmo chute com outra unidade; a linha mostra "confiança média/baixa" ao
  lado do nome quando não é alta.

Quem não tem faturamento **ou** limite conhecido não entra: sem os dois não há comparação a
fazer, e um espaço calculado sobre faturamento nulo seria ruído com cara de oportunidade.

## Ex-clientes: a saída não gera evento, mas deixa marca (04h, 0106)

O sistema sabia quem **é** cliente (temperature report, 03) e quem nunca foi. Não sabia
quem **foi**: a saída de um cliente não emite nada na Onepay — ele simplesmente para de
aparecer. A marca fica na análise de crédito: uma `approved` que venceu e ninguém
renovou.

`analises_plataforma` guarda o endpoint `credit-analyses?role=drawee` inteiro (aprovadas
e expiradas), com `analysis.id` como chave natural — o sync é idempotente. **Sempre
`role=drawee`**: sem o filtro viriam as análises de cedente, e cedente não é cliente
neste sentido — fornecedor apareceria como ex-cliente da carteira.

### O classificador, e as três armadilhas que ele existe para evitar

`classificarCnpj()` em `packages/core/src/credito/ex-clientes.ts` é puro e testado
(15 casos). Cinco saídas: `analise_vigente`, `ex_cliente`, `analise_sem_cadastro`,
`conflito`, `sem_analise_aprovada`.

1. **"Sem análise vigente" não é "foi cliente e saiu".** Quem só teve análise negada
   nunca foi cliente; rebaixá-la inventaria uma perda e a tiraria da fila de prospecção.
   Exige-se ao menos uma `approved` no passado.
2. **A regra de ouro da fonte.** `company.id`/`company.name` nulos = teve análise e
   **nunca** foi cadastrada. Não é ex-cliente — é uma terceira categoria, e a mais
   quente que existe: análise paga, crédito aprovado, ninguém operou.
3. **O temperature report ganha sempre.** Se o CNPJ está lá como `active`, ou converteu
   antecipação nos últimos 60 dias, a análise vencida é atraso de renovação e não saída.
   O caso vira **conflito** (evento para o Admin), nunca rebaixamento: rebaixar apagaria
   um cliente ativo da carteira de alguém.

Duas decisões de borda que os testes fixam: aprovada **sem** `expiration_date` conta
como vigente (não se rebaixa por campo em branco), e `ex_cliente_desde` é a **maior**
expiração entre as aprovadas — a menor seria a data de uma análise já substituída.

A classificação roda **depois** de todas as páginas, por CNPJ, e não por item: um CNPJ
tem várias análises, e decidir na primeira leria o conjunto pela metade — a empresa com
uma vencida na página 1 e uma vigente na página 3 seria rebaixada e restaurada, emitindo
um evento de saída que nunca houve.

### O motivo é humano

O sync grava **"Motivo desconhecido"** e o evento `cliente.tornou_ex` pede a
classificação. Um default vazio viraria "sem motivo" na contagem, indistinguível de
"ninguém classificou ainda" — e é essa ambiguidade que mataria a única pergunta que a
tela existe para responder. Por isso a distribuição separa as duas: **"Não
classificado"** aparece como categoria própria, em cinza, ao lado dos motivos reais.

Treze motivos em `motivos_perda` com o contexto novo `ex_cliente`. O RPC
`app_definir_ex_cliente_motivo` **valida o contexto**: um id de `funil_vendedor` entraria
e o gráfico de churn passaria a somar "Sem documentação", que é motivo de venda perdida,
não de cliente que saiu.

Editável nos dois lugares — inline na lista (quem liga para dez seguidos não deveria
abrir e voltar a cada classificação) e na Company 360 (onde a memória da conta está).

### A sugestão, quando a base já sabe (0107)

Há casos em que pedir a classificação é pedir o que o sistema tem na frente. A view
`ex_clientes` calcula um `motivo_sugerido` **com a evidência junto**, e a regra é
"pré-preenche, humano confirma": a sugestão **nunca** é gravada em
`empresas.ex_cliente_motivo`. Gravar automaticamente encheria o gráfico de churn de
causas que ninguém verificou — e ele seria lido como se tivessem sido.

Três evidências, todas FATO de fonte externa, em ordem de força:

| Evidência | Sugere |
|---|---|
| Situação cadastral `baixada`/`nula` na Receita | Encerrou atividades / recuperação judicial |
| Protesto registrado (`protestos_atual`) | Inadimplência / default |
| Certificado digital vencido **antes** da saída | Certificado / cadastro vencido e não renovado |

A ordem importa: uma empresa baixada pode ter protesto e certificado vencido ao mesmo
tempo, e das três a que explica a saída é o fechamento. Invertida, "inadimplência"
carimbaria empresas que simplesmente encerraram.

Ficou de fora "score despencou no período", que o §2 citava: o scorecard é recalculado
por versão e não guarda série por data de saída, então "despencou" não é uma pergunta que
a base responde hoje — e uma sugestão baseada numa comparação inexistente seria palpite
com cara de fato.

A sugestão some assim que alguém classifica de verdade. "Motivo desconhecido" **não**
conta como classificação: é o default do detector, não uma resposta.

### A reativação limpa o rastro

Quem promove `ex_cliente → cliente` continua sendo o sync do temperature report (03), e
ele agora **limpa `ex_cliente_desde` e o motivo**, emitindo `cliente.reativado`. Manter a
data faria a empresa continuar na lista de ex-clientes com uma saída que já não vale;
manter o motivo faria o gráfico de churn contar de novo, no mês seguinte, alguém que está
operando. O histórico não se perde — os dois eventos ficam na timeline.

### O que NÃO ficou automático

§5 previa que ex-clientes entrassem "pela fonte configurada normalmente" na distribuição
de SDR. **Não entram, e de propósito**: a query de 04g exclui `cliente` e `ex_cliente`
explicitamente, e incluí-los faria a fila do SDR tratar quem já foi cliente como lead
frio — que é exatamente a cadência de reativação que o próprio 04h põe fora de escopo.
O que a integração entrega é a outra metade: as variáveis novas no Explorador
(`e_ex_cliente`, `ex_cliente_meses`, `ex_cliente_motivo`, `teve_analise_sem_cadastro`,
`ultima_analise_limite`, `ultima_analise_expirou_em`) permitem montar o segmento "saiu
por taxa alta há menos de 6 meses com mais de R$ 1 mi de limite" e apontar uma
distribuição dedicada para ele quando a campanha existir.

`ex_cliente_meses` é em **meses e não em data** porque a pergunta de campanha é "saiu há
menos de seis meses" — escrevê-la com data obriga a pessoa a fazer a conta de cabeça.

## Onde está o quê

- **Banco**: migração `0073` (tabelas, RLS, RPCs, bucket `analise-docs`, view
  `analise_vigente`, cache em `empresas`, 8 variáveis no Explorador), `0074` (whitelist
  de ordenação — as colunas do 04c também tinham ficado de fora, e clicar no cabeçalho
  delas caía silenciosamente em `cnpj`), `0075` (o perfil Crédito precisa do módulo
  `empresas`) e `0076` (cadastro e sócios das empresas do CRM).
  `0106` (04h: `analises_plataforma`, as quatro colunas de ex-cliente em `empresas`,
  contexto `ex_cliente` em `motivos_perda` com 13 seeds, views
  `analises_plataforma_atual` / `ex_clientes` / `analises_sem_cadastro`, RPCs
  `app_definir_ex_cliente_motivo` e `ex_clientes_por_motivo`, 6 variáveis novas no
  Explorador, fonte de ingestão `onepay_credit_analyses`) e `0107` (a sugestão de motivo
  com evidência, calculada na view — nunca gravada).
- **Core** (`packages/core/src/credito/`): `score.ts`, `economia.ts`, `seguradora.ts`,
  `schemas.ts`, `mutations.ts`, `ex-clientes.ts` (o classificador puro). 26 + 15 testes.
- **Worker**: `credito/potencial.ts` (calibrar, scores, potencial) e `credito/esteira.ts`
  (enviar, poll, backfill, sync, expirar), mais `credito/atradius.ts` e
  `credito/sync-analises-plataforma.ts` (04h).
- **Web**: card na Company 360, `/credito` (esteira), `/credito/painel`,
  `/credito/scorecard`, `/credito/config`, `/credito/analises/[id]`. Ex-clientes moram na
  aba `/empresas?tab=clientes` (filtro segmentado Atuais | Ex-clientes | Ambos, sub-lista
  "análise aprovada, nunca cadastrada"), e o motivo da saída também na Company 360.
- **Mobile**: bloco na ficha (com "Solicitar análise"), esteira com filtro por estágio e
  detalhe. Scorecard, painel e configurações são webOnly. De 04h, o mobile ganha o badge
  "Ex-cliente desde {data}" na ficha — **não** há aba de clientes Onepay no mobile hoje,
  então não havia lista existente onde pôr o filtro segmentado que §4 pedia.
- **Cron**: `/api/cron/credito-mensal` (dia 7, 08h) e `/api/cron/credito-sync` (diário, 09h).
  O sync de análises da plataforma NÃO tem cron próprio: vai encadeado ao
  `/api/cron/radar-onepay`, **depois** do temperature report — a ordem é a regra, porque a
  detecção de saída consulta `clientes_onepay` para não rebaixar quem está ativo.
- **Env**: `ATRADIUS_CLIENT_ID`, `ATRADIUS_CLIENT_SECRET`, `ATRADIUS_BASE_URL`,
  `ATRADIUS_POLICY_ID` — todas opcionais.

## Fora de escopo

Calibração estatística automática dos pesos do scorecard (chega com histórico de decisões
acumulado), chance de adesão do fornecedor, declarações de faturamento à seguradora,
sinistros/non-payment.
