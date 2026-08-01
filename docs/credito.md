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

## Onde está o quê

- **Banco**: migração `0073` (tabelas, RLS, RPCs, bucket `analise-docs`, view
  `analise_vigente`, cache em `empresas`, 8 variáveis no Explorador), `0074` (whitelist
  de ordenação — as colunas do 04c também tinham ficado de fora, e clicar no cabeçalho
  delas caía silenciosamente em `cnpj`), `0075` (o perfil Crédito precisa do módulo
  `empresas`) e `0076` (cadastro e sócios das empresas do CRM).
- **Core** (`packages/core/src/credito/`): `score.ts`, `economia.ts`, `seguradora.ts`,
  `schemas.ts`, `mutations.ts`. 26 testes.
- **Worker**: `credito/potencial.ts` (calibrar, scores, potencial) e `credito/esteira.ts`
  (enviar, poll, backfill, sync, expirar), mais `credito/atradius.ts`.
- **Web**: card na Company 360, `/credito` (esteira), `/credito/painel`,
  `/credito/scorecard`, `/credito/config`, `/credito/analises/[id]`.
- **Mobile**: bloco na ficha (com "Solicitar análise"), esteira com filtro por estágio e
  detalhe. Scorecard, painel e configurações são webOnly.
- **Cron**: `/api/cron/credito-mensal` (dia 7, 08h) e `/api/cron/credito-sync` (diário, 09h).
- **Env**: `ATRADIUS_CLIENT_ID`, `ATRADIUS_CLIENT_SECRET`, `ATRADIUS_BASE_URL`,
  `ATRADIUS_POLICY_ID` — todas opcionais.

## Fora de escopo

Calibração estatística automática dos pesos do scorecard (chega com histórico de decisões
acumulado), chance de adesão do fornecedor, declarações de faturamento à seguradora,
sinistros/non-payment.
