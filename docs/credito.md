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

### Sandbox ou produção é uma setting, não uma variável de ambiente

O ambiente vive em `credito_config.atradius.ambiente` (`sandbox` | `producao`) e se troca
em **/credito/config**. A alternativa — uma variável do worker — obrigaria um redeploy a
cada ida e volta de quem está homologando, e o resultado prático disso é que ninguém
alterna: o teste roda contra produção "só desta vez".

| | Homologação (`sandbox`) | Produção (`producao`) |
| --- | --- | --- |
| Base URL | `https://api-uat.atradius.com` | `https://api.atradius.com` |
| Credenciais | `ATRADIUS_SANDBOX_*` | `ATRADIUS_PROD_*` |

As URLs moram no core (`AMBIENTES_SEGURADORA`) porque a tela precisa **mostrar** para onde
o worker vai bater; uma segunda cópia no worker divergiria no dia em que o host mudasse, e
a tela passaria a mentir.

Três regras que o desenho impõe:

1. **Nada herda entre ambientes.** Faltando `ATRADIUS_SANDBOX_CLIENT_SECRET`, a esteira
   para com "credencial ausente" — nunca cai calada nas credenciais de produção. Um teste
   que vira pedido de cobertura real é o acidente que isto existe para impedir.
2. **O default é sandbox.** Linha de config ausente ou com valor desconhecido → homologação.
   O pior caso de um erro de configuração tem de ser um teste que não valeu nada.
3. **As credenciais não vêm para o banco.** `credito_config` é legível por qualquer usuário
   com o módulo Crédito. O que a tela decide é *qual conjunto* o worker usa.

`configurada()` é assíncrono por causa disto: quais variáveis são exigidas depende do que a
tela escolheu, e isso mora no banco. O token OAuth é cacheado **por ambiente** — sem isso,
alternar continuaria mandando o token da sandbox para a URL de produção por até uma hora, e
o 401 pareceria credencial errada em vez de cache velho. A troca leva até 60s para valer no
worker (TTL do cache de `lerAmbienteSeguradora`).

O nome do cabeçalho da application key (`x-application-key`) tem a mesma ressalva de
`ROTAS`: é a forma documentada publicamente, não confirmada contra o handbook. Está isolado
numa constante para a correção ser uma linha.

### A apólice é descoberta, não configurada

O id da apólice não aparece no portal de desenvolvedores. `policies/details` **não** lista
apólices — exige `policyId` e recusa `customerId` ("Unknown query parameter"); foi por
acreditar que ele listava que a primeira versão da descoberta nasceu torta.

A descoberta vem das **coberturas**: cada uma diz a que apólice pertence, e `/covers` aceita
`customerId` sozinho. Uma chamada, e o id sai do próprio dado. Com o id em mãos,
`policies/details?policyId=X` enriquece com status, moeda e validade. O resultado é cacheado
por uma hora, por ambiente — um contrato se renova uma vez por ano, e consultar a cada
chamada colocaria uma ida à rede na frente de cada página do backfill.

Detalhe indisponível **não** derruba a esteira: seguimos com o id, que é do que as outras
chamadas precisam. Parar aí transformaria uma indisponibilidade do `policy-management` em
esteira fora do ar, com `cover-management` de pé. Já apólice **não vigente** derruba: ela
continua respondendo detalhes, e receber pedido sob contrato cancelado é o acidente que a
verificação existe para impedir.

**A descoberta tem dois modos de falha, e nenhum vira chute.** Carteira vazia (apólice nova,
sem cobertura) não tem de onde tirar o id. Mais de uma apólice não permite escolher: o pedido
submetido sob o contrato errado não dá erro, dá um limite aprovado sob uma cobertura que a
operação não assumiu — e isso só aparece num sinistro. Nos dois casos a saída é a mesma:
dizer o que houve e nomear `ATRADIUS_*_POLICY_ID`, que existe para esses casos e não para o
comum.

A apólice é resolvida **uma vez, antes do laço** de `enviarAnalises`, e não dentro dele:
`resolverBuyer` pode ser cobrado e roda antes do pedido, então uma apólice irresolvível
viraria uma busca de buyer paga por análise pendente, seguida de falha.

Campos confirmados no retorno real (22/08/2026): o corpo vem embrulhado em **`data`**, com
um objeto único — não uma lista, e não a página com `items` que os outros recursos usam.
Dentro dele, `policyId`, `policyStatus` (`"live"`), `policyStartDate`, `policyExpiryDate` e
`policyCurrency`.

Duas lições que valem para os outros endpoints. A primeira: `"live"` não batia em nenhum
dos termos que eu tinha imaginado para "vigente" (`active`, `in force`) — vocabulário de
status se confirma contra resposta real, e o mesmo risco está de pé em `mapearEstagio`, que
traduz o status das decisões. A segunda: o envelope `data` com objeto único teria estourado
a leitura anterior, que assumia array.

**A apólice do exemplo é em EUR.** Os nossos limites são em BRL. Pedir cobertura numa moeda
que a apólice não opera raramente dá erro — dá um número aceito e lido na moeda dela.
`pedirCobertura` registra um aviso quando as duas divergem, mas não bloqueia: como converter
(ou se a apólice brasileira é outra) é decisão de negócio.

### Buyer: três endpoints, e quase nada do que eu supus sobreviveu

Domínio `organisation-management`, confirmados em 22/08/2026:

| Endpoint | Uso aqui |
| --- | --- |
| `GET /credit-insurance/organisation-management/v1/buyers?country=&uid=&uidType=` | `resolverBuyer` — a busca por CNPJ |
| `GET /credit-insurance/organisation-management/v1/buyers/{buyerId}` | `detalharBuyer` |
| `GET /credit-insurance/organisation-management/v1/buyers/my-buyers?customerId=&policyId=` | **ainda não usado** — ver abaixo |

#### Autenticação

`POST /authenticate/v2/tokens`, com **Basic auth** (client id e secret em base64),
`Content-Type: application/json` e **corpo vazio**. Devolve
`{ data: { access_token, token_type: "Bearer", expires_in: 1800 } }`.

Não é o `POST /oauth2/token` com `grant_type=client_credentials` no form que eu tinha
escrito — três coisas erradas de uma vez: caminho, forma de autenticar e content-type. O
sintoma foi **403, não 401**, e a distinção importa: o gateway barra rota fora do contrato
antes de olhar credencial. Um 401 teria mandado caçar a credencial errada; o 403 apontava
para a rota, que era o problema.

Meia hora de validade é curta o bastante para o token vencer no meio de um backfill — daí a
margem de 60s antes do vencimento existir de verdade, e não por precaução teórica.

Correções que os exemplos reais impuseram:

- O cabeçalho é **`Atradius-App-Key`**, não o `x-application-key` que eu tinha suposto. Toda
  chamada leva também um **`Atradius-Correlation-Id`** — gerado por chamada (não por
  tentativa) e registrado no log de erro, porque sem ele um chamado com a Atradius sobre
  "uma consulta que falhou ontem" descreve o problema em vez de apontá-lo.
- `data` é **array** nos três, inclusive no de id único (devolve um array de um).
- `buyerId` é **número**, não string.
- O rating é **`currentBuyerRating`**, não `rating`. Há também `currentBuyerRatingClass`,
  `previousBuyerRating` e `buyerRatingChange` — hoje só o primeiro é lido.
- O identificador nacional **não é um campo**: vive dentro de `uniqueIdentifiers[]`, cujo
  formato de item os exemplos não mostram (o array vem vazio nos três). Por isso
  `cnpjDosIdentificadores` varre os valores de texto do item e aceita o que tiver 14
  dígitos: 14 dígitos *é* a definição de CNPJ, e essa regra sobrevive ao nome da chave —
  que é justamente o que não sabemos.
- **O nome do buyer não aparece em exemplo nenhum.** Fica null até se confirmar, o que é
  seguro porque a esteira nunca casa buyer por nome, só por CNPJ.

#### `uidType`: o enum não tem CNPJ

A busca aceita `country` (ISO 3166-1 Alpha-3, `BRA`) e um par `uid`/`uidType`, onde
`uidType` é um enum **fechado**: `VAT`, `NRN`, `CR`, `DB`, `FC`, `SN`, `TK`. Nenhum é
`CNPJ`. O apêndice da doc lista os aceitos por país.

Por isso `uid_type` é **setting** (`credito_config.atradius.uid_type`, default `NRN`) e não
constante: errar não devolve erro de rota — devolve "buyer não encontrado", que a esteira lê
como "não existe na Atradius" e manda para revisão manual. Falha silenciosa numa chamada que
pode ser cobrada, e descobrir o certo é tentar na sandbox. Tentar precisa ser um clique.

`organizacao_id` (o customer id da ONE OS, `24953910`) mora na mesma linha. Identifica, não
autentica — por isso não virou mais uma variável por ambiente.

#### `my-buyers` é saúde, não cobertura

`GET .../buyers/my-buyers` devolve **health information**: rating atual e anterior, data da
mudança, e aceita `healthChange=up|down` e janelas por `buyerRatingUpdatedAfter/Before`.
Basta `policyId` **ou** `customerId` (mandamos os dois).

Usamos como listagem: o backfill pré-carrega o mapa CNPJ→buyer com **uma** chamada em vez de
uma por buyer, e cai no detalhamento um a um se ela falhar — uma otimização que derruba o
job quando indisponível é pior que a versão não otimizada.

O uso que ele *permite* e que ainda não existe: alerta de **rebaixamento de rating**
(`healthChange=down`). É o mesmo tipo de sinal que `houveReducaoDeLimite` já trata como
evento próprio, e chega antes do corte de limite.

### Cobertura: `cover-management`, e o que é uma "decisão" para a Atradius

O que aqui se chama decisão, lá se chama **cover**. Todas confirmadas em 22/08/2026:

| Endpoint | Uso aqui |
| --- | --- |
| `POST .../cover-management/v1/covers` | `pedirCobertura` |
| `GET .../covers?customerId=&policyId=` | `listarPortfolio` |
| `GET .../covers/decisions?...` | `listarDecisoes`, e metade do mapa do poll |
| `GET .../covers/applications?...` | a outra metade: o que ainda **não** foi decidido |
| `PUT .../covers` (`action: supersede`) | **não usado** — alteraria um limite já concedido |
| `PATCH .../covers/{id}/cover-type` | não usado |

Quatro decisões de leitura que valem registro:

**Duas moedas, e só uma vale.** Todo valor vem em `...InPolicyCurrency` e
`...InUserCurrency` (no exemplo, EUR e DKK). Lemos sempre a da apólice: é nela que a
cobertura existe, e a "user currency" é conveniência de exibição de quem consultou. Misturar
as duas produziria um limite numericamente plausível e factualmente errado.

**O valor aplicado não é o valor aprovado.** `creditLimitApplicationAmount...` é o que
pedimos; o que a Atradius concedeu está em `totalDecision.decisionAmtInPolicyCurrency`. Não
há fallback de um para o outro — seria registrar como aprovado um número que ninguém aprovou.

**Os códigos decidem o estágio.** Os apêndices abriram os enums, e `mapearEstagio` lê nesta
ordem: `historicCode` (a cobertura acabou) → `decisionCode` → valor concedido. O terceiro
degrau ficou como rede para código que a Atradius acrescente depois: melhor inferir pelo
valor que travar o poll de todas as análises num código desconhecido.

Três leituras dos apêndices que não são óbvias na tabela:

- **DC05** ("refusal for increase — current cover remains unchanged") é `negada`: o que foi
  recusado é o **pedido**, que é o que a esteira acompanha. A cobertura anterior seguir de pé
  não torna o pedido aprovado.
- **DC06/DC07** são preliminares. Marcá-los tira a análise do poll, mas não da história: o
  sync diário casa por `atradius_case_id` em qualquer estágio e recolhe a decisão final
  dentro da janela de 30 dias.
- **ACLD, ICLD e MCLD** (amended, re-issued, maintained) ficaram **fora** do mapa de
  históricos: encerram uma *versão* da cobertura, que segue existindo com outro conteúdo.
  Forçar estágio a partir deles esconderia o que a decisão nova diz.

**Pendência não é estágio — e isso era um bug.** `pendingProcessIndicator` é um apêndice
próprio ("Batch Action Indicators"): `C` = pending cancellation, `W` = pending withdrawal, e
por aí. A cobertura **ainda vale hoje**. Antes do apêndice, `pendingProcessStatus: "Pending
Cancellation"` casava com a busca textual por "cancel" e derrubava para `cancelada` uma
cobertura de pé — zerando um limite que a operação ainda podia usar. Agora vira o campo
`pendencia`, que entra no motivo (a única superfície que a tela já mostra) sem mentir sobre o
estágio. É o aviso mais antecipado que a seguradora dá de que vai cortar.

**O poll virou um mapa.** Não existe `GET /covers/{coverId}` — só listagens por apólice.
Consultar caso a caso baixaria a lista inteira uma vez por análise aberta. `mapaDeCoberturas`
junta decisões + aplicações num índice por `coverId`, cacheado por dois minutos: uma rodada
de poll, duas chamadas. As aplicações entram primeiro e as decisões por cima — a decisão é a
informação mais nova, e a ordem inversa mostraria "em análise" para algo já decidido.

**Paginação não existe na doc de cobertura.** Nenhum endpoint documenta cursor, página ou
offset, então `proximoCursor` é sempre null. Inventar um parâmetro faria a API ignorá-lo em
silêncio, e o backfill acharia que leu tudo tendo lido a primeira página. Pelo mesmo motivo,
o recorte de data do sync é aplicado **por nós**, depois de receber a lista.

**Datas vêm em UTC ou BST.** O apêndice de formato avisa que as respostas podem vir em
UTC+01:00. `dataDaAtradius` corta os dez primeiros caracteres em vez de converter: isso
preserva a data como a seguradora a apresenta — a mesma que aparece no portal e que alguém
vai conferir. Converter para UTC recuaria um dia em qualquer carimbo entre 00:00 e 01:00 BST.

**BRL está na lista de moedas suportadas**, e `BRA` na de países. A apólice do exemplo ser em
EUR é característica daquela apólice, não limitação da API.

**Validade não vem da Atradius.** Uma cobertura viva não tem "válido até" — ela vale até ser
cancelada. `withdrawalDate`/`effectiveToDate` só aparecem quando já acabou. É por isso que
`validade_padrao_meses` da nossa config segue preenchendo esse campo.

#### O que o cover resolveu do buyer

`uniqueIdentifiers` teve o formato confirmado — `[{uid, uidType, uidTypeDescription}]` — e
cada cobertura já traz `buyerName` e os identificadores do buyer. O backfill passou a ler o
CNPJ da própria decisão, caindo para a listagem da apólice e só então para o detalhamento
individual. Na prática, o degrau caro quase nunca é alcançado.

Ainda assim o CNPJ é validado por **14 dígitos**, e não pelo `uidType` declarado: qual
`uidType` o Brasil usa é justamente o que não sabemos, e aceitar pelo tipo declarado gravaria
um VAT europeu como CNPJ no dia em que um buyer estrangeiro entrasse na apólice.

#### `customerId` é obrigatório no envio

Diferente dos GETs, onde `policyId` sozinho basta, o corpo do POST exige `customerId`. Por
isso o Organization ID entrou no gate de `configurada()` mesmo sem ser necessário para as
leituras: `resolverBuyer` pode ser cobrado e roda antes do POST, então faltar esse campo
sairia caro em vez de sair claro.

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

### O backfill recusa rodar fora de produção

O interruptor de ambiente troca a **seguradora**, não o nosso banco. Sync e poll só tocam
análises que nasceram aqui, então rodá-los contra a sandbox é inofensivo. O backfill
**insere**: cobertura da apólice que não existe na nossa base vira linha nova em
`analises_credito`.

Rodando em homologação, isso grava os buyers de mentira da sandbox no banco de produção como
análises indistinguíveis das reais — e uma vez dentro, elas contam no funil, no scorecard e
em qualquer conciliação de carteira. O ambiente de teste existe para que errar não custe;
aqui custaria.

### Zero lido não é o mesmo que não consegui ler

Os três jobs que falam com a seguradora distinguem `ok`, `nao_configurada` e **`erro`**, e
só logam "concluído" quando de fato concluíram. Antes, `listarDecisoes` falhando produzia
`Sync da Atradius interrompido.` seguido de `Sync da Atradius concluído.` com `status: 'ok'`
e zeros — a mesma linha final de um sync bem-sucedido num dia sem novidade. O poll era pior:
engolia cada falha com um `continue` calado.

Isso importa porque zeros são o resultado ESPERADO no dia a dia. Um job que falha
produzindo exatamente o que se espera ver quando está tudo bem é um job que pode estar
parado há semanas sem ninguém notar. Hoje: `Sync da Atradius FALHOU.`,
`Poll de decisões FALHOU.` (ou "concluído com falhas", quando só parte falhou) e
`Backfill da Atradius FALHOU.` — este último porque o backfill é o job que se roda uma vez,
confiando que trouxe a apólice inteira.

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

`analises_plataforma` guarda o endpoint `credit-analyses?role=drawee` inteiro, com
`analysis.id` como chave natural — o sync é idempotente. **Sempre `role=drawee`**: sem o
filtro viriam as análises de cedente, e cedente não é cliente neste sentido —
fornecedor apareceria como ex-cliente da carteira.

### O vocabulário real não é o previsto, e isso zerou a primeira carga

A especificação dizia `status: approved | expired`. A produção **não tem `expired`**:
tem `approved` (53) e **`blocked`** (21), e são os `blocked` que carregam as saídas —
todos os 21 com limite consumido (operaram de verdade) e **nenhum** presente no
temperature report.

O classificador exigia `status = 'approved'` para reconhecer que houve relação, então os
21 caíram em "nunca foi cliente" e a lista nasceu **vazia com a base cheia deles**. O
critério passou a ser o **limite concedido** (`approved`, ou `credit_limit`/
`consumed_limit` > 0), que é o fato: uma análise com limite abriu a porta, tenha sido
bloqueada depois ou não. Negada sem limite continua de fora.

A assimetria é deliberada: para ser **vigente** ainda se exige `approved`. Um `blocked`
com data futura não é cliente — a plataforma bloqueou, ele não opera (são 10 casos, todos
fora do temperature report). O guard de conflito continua acima de tudo.

Junto veio o segundo defeito: **18 dos 21 ex-clientes não tinham ficha em `empresas`**, e
o job os descartava com "sem empresa na base". Faz sentido que não tenham — quem saiu
antes de o CRM existir nunca foi promovido por sync nenhum, e o do temperature report só
enxerga quem está ativo hoje. Pular esses perderia justamente os mais antigos, então o
job passou a **criar a ficha** (espelhando `resolverEmpresa` do 03, derivadas do universo
incluídas), já nascendo em `ex_cliente` — passar por `cliente` acenderia, por um instante,
um cliente que não existe.

### Uma análise por empresa: o que a fonte expõe (e o que não)

Depois da correção do vocabulário, ainda faltavam saídas. A contagem denuncia o porquê:
**74 análises para 74 CNPJs e 74 `company.id` — exatamente uma por empresa**, com
`analysis.id` indo de 5 a 578. A plataforma tem centenas de análises; o endpoint entrega
uma.

`role=drawee` está correto e não se mexe nele: sem o filtro viriam as análises de
cedente, e cedente não é cliente neste sentido. A conclusão que sobra é que **a fonte
expõe a análise ATUAL de cada empresa**, não o histórico — então `expired`/`reproved` de
análises antigas não estão atrás de um parâmetro nosso, e a lista de ex-clientes fica
limitada a quem tem a análise corrente em estado terminal. Ampliar isso depende da
plataforma (um parâmetro de histórico, ou outro endpoint).

Enquanto isso, o resultado carrega um **censo por status** do que a fonte devolveu, antes
de qualquer recorte, mais `cnpjs_distintos` ao lado de `itens`. Os dois juntos respondem,
na página de Ingestões e sem credencial de produção, se apareceu status novo e se a fonte
passou a mandar mais de uma análise por empresa. Foi errando o vocabulário uma vez
(`expired` que não existe) que esse instrumento virou necessário.

**A paginação não era o problema, mas ficou conferível.** 74 itens em 2 páginas com
`pageSize=200` pedido só fecha se o servidor ignora o nosso tamanho e usa o dele (50) —
dedução, não prova. O resultado passou a gravar o envelope de cada página (`page`,
`pageSize`, `totalPages`, `total`, itens recebidos) no meta da ingestão, e o job avisa
quando a última página vem CHEIA, que é o sintoma de um `totalPages` mentiroso. Foi um
`.limit()` ignorado em silêncio que já custou 800 linhas na lista de fornecedores a
prospectar.

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

### Filial e SPE não são o cliente que saiu (0109)

Dos 21 ex-clientes da primeira carga, **17 não eram clientes**:

| | qtd | o que era |
|---|---:|---|
| Filiais | 5 | Todas com cliente **ativo na mesma raiz de CNPJ**. A VALKA CONSTRUÇÕES apareceu **quatro vezes**, uma por filial, sendo cliente ativa o tempo todo. Filial não é empresa — é endereço da mesma pessoa jurídica. |
| SPEs | 12 | Herança da prática antiga de abrir análise por SPE. A SPE nasce com o empreendimento e some quando a obra acaba; o cliente é a holding. |
| Matrizes comuns | 4 | Os ex-clientes de verdade. |

A correção vive em duas camadas, e as duas são necessárias porque respondem a
perguntas diferentes:

**No classificador** — raiz de CNPJ ou grupo econômico com cliente ativo → `grupo_ainda_cliente`,
uma saída nova e **silenciosa**. Não é `conflito`: conflito é dado divergente e chama o
Admin; isto é o desenho da carteira, e notificar a cada obra encerrada de um cliente ativo
seria alarme sobre o normal. Pega os 6 casos factualmente errados (5 filiais + a SPE do
grupo ativo) e **desfaz** os já marcados, voltando para `mercado` — não para `cliente`,
que inflaria a contagem da carteira com veículos de obra.

A ordem importa: o guard vem **depois** do conflito. Se o próprio CNPJ está ativo no
temperature report, é dado divergente e alguém precisa olhar; aqui o CNPJ realmente parou,
e quem continua operando é o resto da casa.

**Na view** — as flags `e_filial`, `e_spe` e `e_principal`. Elas não escondem nada: a lista
é que abre no recorte de cliente principal, com os outros a um clique e marcados com selo.
As 11 SPEs cujo grupo **realmente** saiu continuam sendo perda — elas só não são a resposta
para "quais clientes perdemos?". Uma view que as apagasse tornaria impossível ler "as cinco
SPEs daquele grupo saíram no mesmo trimestre", que é informação.

Sobraram 4 clientes principais, somando R$ 6,05 mi de último limite.

### SPE que o flag não pega (0111)

Com o endpoint novo a lista foi a 148, e o grupo RFM apareceu com **27 entidades**.
A reclamação não era o volume: era que SPEs e filiais estavam ocupando a lista de
clientes principais.

A causa é o enriquecimento. `mercado_universo.is_spe` é derivado do lookup cadastral,
e **55 dos 148 ex-clientes nem estão no universo** — para eles o flag é `false` por
ausência de dado, não por serem matriz. Empresas com "SPE" na própria razão social
passavam como cliente principal.

Duas evidências novas, ambas independentes do enriquecimento:

| Evidência | Detalhe |
|---|---|
| `SPE`/`SCP` como palavra inteira na razão social | A borda de palavra é o que faz a regra funcionar: sem ela, "ESPECIAL" e "PROSPECT" virariam veículo |
| Natureza jurídica **2127** | Sociedade em Conta de Participação — veículo de investimento por definição legal. O código veio de graça com a 0105 |

`origem_spe` registra qual das três decidiu (`flag`, `nome`, `natureza_2127`). Uma
heurística que não diz por que classificou é uma que ninguém consegue contestar — e
esta vai errar em algum caso.

**Medido:** principais caem de 90 para **37**, e o RFM sai de 14 entidades na lista
para **4** — as operacionais (RFM CONSTRUTORA e RFM INCORPORADORA, com R$ 5 mi de
limite, contra R$ 1 mi dos veículos).

A raiz continua sendo o enriquecimento: os 55 CNPJs ausentes foram enfileirados em
`cnpj_lookup_fila`. Quando o lookup rodar, `is_spe` e o grupo econômico voltam a
funcionar para eles e a heurística de nome vira rede, não pilar.

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
| Análise `blocked` na plataforma (0108) | Análise não renovada pela plataforma |

A ordem importa: uma empresa baixada pode ter protesto e certificado vencido ao mesmo
tempo, e das três a que explica a saída é o fechamento. Invertida, "inadimplência"
carimbaria empresas que simplesmente encerraram. `blocked` entra por último de propósito:
diz **quem** fechou a porta, não **por quê** — com protesto na frente, a razão do bloqueio
provavelmente é a inadimplência, e é ela que explica.

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
  A tela de Configurações lista os três com horário e explicação, **importando o
  `vercel.json` de verdade** — uma cópia escrita à mão envelheceria em silêncio, e alguém
  investigaria "por que a decisão só apareceu de manhã" contra um horário que já mudou.
  O sync de análises da plataforma NÃO tem cron próprio: vai encadeado ao
  `/api/cron/radar-onepay`, **depois** do temperature report — a ordem é a regra, porque a
  detecção de saída consulta `clientes_onepay` para não rebaixar quem está ativo.
- **Env** (worker/Railway, todas opcionais): `ATRADIUS_PROD_CLIENT_ID`,
  `ATRADIUS_PROD_CLIENT_SECRET`, `ATRADIUS_PROD_APP_KEY` e as equivalentes
  `ATRADIUS_SANDBOX_*`. `ATRADIUS_*_POLICY_ID` é override e normalmente fica vazia — a
  apólice é descoberta pela API. A base URL **não** é env: vem do ambiente escolhido na tela.

## A carteira: limite concedido × cobertura (23/08/2026)

**`/credito/carteira`**, view [`credito_carteira`](../supabase/migrations/0127_carteira_de_credito.sql).
Um FULL OUTER JOIN por CNPJ entre `analises_plataforma_atual` (o que a plataforma concedeu)
e as análises com limite aprovado vigente (o que a seguradora ampara).

A página é **um número** — exposição descoberta em R$ — com a lista como detalhamento. A
lista responde "quais empresas"; o cabeçalho responde "quanto estamos arriscando sem seguro",
que é a pergunta que faz alguém agir.

Quatro situações, com donos diferentes — misturá-las produziria uma tela que ninguém sabe de
quem é:

| Situação | Significa | Dono |
| --- | --- | --- |
| `descoberto` / `parcial` | Limite operando com cobertura insuficiente | Crédito |
| `ocioso` | Cobertura vigente sem limite na plataforma | Comercial |
| `aguardando_plataforma` | A esteira aprovou, o limite ainda não veio | Operações |
| `coberto` | Nada a fazer | — |

Três recortes que mudam o número:

**Cobertura é por VALOR, não por estágio.** DC05 ("refusal for increase") produz uma
cobertura em vigor cujo *pedido* foi recusado. Eram 6 linhas e R$ 7,15 milhões — filtrar por
estágio diria que estamos mais descobertos do que estamos.

Com `codigo_decisao` em coluna, o mapa pôde ser conferido contra a carga real e fecha: os 24
`DC03` (recusa) têm valor **zero**, então nenhuma recusa esconde cobertura, e nenhuma
cobertura está classificada como recusa. Os aprovados se distribuem em DC01 (22), DC10 (12),
DC11 (7), DC05 (6), DC04 (5), DC22 e DC02.

**`blocked` não entra.** Tem limite registrado na plataforma mas o cliente não opera;
contá-lo inflaria o descoberto com risco que não existe.

**`descoberto` nunca é negativo.** Cobertura acima do limite é folga, não exposição, e somar
folga como dívida inverteria o sinal do total.

A coluna **Consumido** é o que separa dois riscos de mesmo tamanho nominal: um limite de
R$ 5 mi com 90% sacado e sem seguro não é o mesmo problema que um limite de R$ 5 mi parado.
Por isso o tile de exposição descoberta mostra, embaixo, quanto dela **já saiu**.

A coluna `plataforma_diz_ter_seguro` vem do `has_insurance` do endpoint da plataforma. Ela
não é usada no cálculo — é uma **terceira opinião**, e a tela marca quando ela discorda da
seguradora. Na primeira carga, 1 das 55 análises aprovadas dizia ter seguro enquanto a
apólice tinha 84 coberturas: alguém está errado, e até aqui ninguém olhava.

## Fora de escopo

Calibração estatística automática dos pesos do scorecard (chega com histórico de decisões
acumulado), chance de adesão do fornecedor, declarações de faturamento à seguradora,
sinistros/non-payment.

---

## A segunda leitura (04j)

A partir do Prompt 04j existe uma análise **proprietária**, que lê os documentos contábeis
do sacado e produz a nossa própria recomendação — ao lado, e nunca por cima, da leitura da
seguradora. `analises_credito` ganhou `limite_operacional`, `decisao_interna` e
`analise_propria_id`; **`limite_aprovado` continua sendo o número da Atradius**, e é ele
que o fator "histórico de análises" e a view `analise_vigente` leem.

Ver **[docs/analise-credito.md](analise-credito.md)**.

## A receita prevista, e por que a fórmula mudou de forma (22/08/2026)

A conta era `volume = limite × giro`, com o giro calibrado na carteira. O resultado estava
certo, mas a forma escondia a premissa mais forte de todas: **a carteira usa cerca de 35%
do que os limites permitiriam**. Esses 35% estavam dissolvidos dentro do giro, e o prazo
médio — que APARECE na tela de Economia da operação — praticamente se anulava contra ele.

Quem abria a tela via taxa, TAC, NF média e prazo, e não conseguia reconstruir o número.
Uma fórmula que não se reconstrói a partir dos parâmetros visíveis é uma fórmula que
ninguém confere.

Agora:

```
volume mensal     = limite × (30 / prazo médio) × utilização média
receita financeira = volume × taxa × (prazo / 30)     ( = limite × utilização × taxa )
receita TAC        = (volume ÷ NF média) × TAC
```

O primeiro fator é quantas vezes o limite gira no mês; o segundo é quanto dele se usa. Os
dois são visíveis, e **discordar de um deles virou uma conversa possível**.

`utilizacao_media` em branco significa "usa o medido na carteira" — e, para configurações
gravadas antes desta mudança, é derivada do giro antigo: `giro × prazo ÷ 30`. A conversão é
exata, e há teste provando que o número não muda. Uma reescrita que altera o resultado em
silêncio é a pior espécie de refatoração.

## O valor esperado acompanha o score

`valor_esperado_mensal = receita_mensal_prevista × chance_concessao`, e a chance vem da
faixa do score. `pontuarLote` gravava a chance nova e deixava o valor esperado com a chance
**antiga** — a régua de ordenação da base ficava mentindo até o job mensal passar.

O job mensal escondia o defeito: ele pontua e só depois estima o potencial, então a ordem
certa acontecia por acidente uma vez por mês. Em todo o resto — decisão de crédito,
expiração de análise, enriquecimento de lead, análise proprietária — o score é repontuado
sozinho e o valor esperado ficava para trás.

Agora o último elo se refaz na mesma escrita. Não é preciso refazer a cadeia inteira: a
receita prevista **não depende do score**.

## Enriquecer tudo, num clique

Na ficha havia um botão para domínio, outro para funcionários, o faturamento só saía na
recalibração mensal e o scorecard era um terceiro botão. Quatro cliques numa ordem que é
**dependência, não preferência**:

```
cadastral → domínio → funcionários → faturamento → score
```

O Apollo é consultado por domínio; os funcionários são o sinal principal do estimador; o
score lê tudo que veio antes. Quem clicasse fora de ordem pagava uma consulta para receber
`sem_dominio`. A tela cobrava da pessoa um conhecimento que é do código.

`enriquecer-empresa.ts` roda a cadeia inteira e **pula** o que foi obtido há menos de 30
dias — domínio e funcionários são pagos por CNPJ, e um botão que reconsulta tudo a cada
clique é um botão que ninguém aperta duas vezes sem culpa. Cada etapa devolve o que fez ou
por que não fez: um botão "enriquecer tudo" que termina em silêncio faz a pessoa clicar de
novo, que é exatamente o comportamento caro que a janela existe para evitar.

Os botões avulsos ficam. Quem quer só o domínio não deve ter de pagar o resto.
