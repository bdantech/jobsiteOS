# Análise de crédito proprietária (Prompt 04j)

A esteira do 04d responde **"o que a seguradora disse"**. Isto responde **"o que nós
dizemos"**, lendo os documentos contábeis do sacado.

```
IA LÊ os documentos  →  a MATEMÁTICA decide  →  IA ESCREVE a narrativa
                             ↑
                    REVISÃO HUMANA no meio
```

**Escopo: SACADOS** (`tipo in ('construtora','incorporadora')`), o mesmo recorte do 04d.
Os tetos de concentração por sacado e de cobertura da seguradora só fazem sentido aqui, e
a pergunta do cedente é adesão, não limite.

---

## O que a IA faz e o que ela não faz

| Etapa | Quem faz | O que produz |
|---|---|---|
| Extração | `claude-sonnet-4-6` sobre os PDFs | números **com citação de origem** (documento, página, trecho) |
| Revisão | **uma pessoa** | confirmação ou correção dos campos críticos |
| Cálculo | `packages/core/src/credito/analise.ts` | indicadores, cinco tetos, cenários, recomendação |
| Parecer | `claude-sonnet-4-6` sobre os números já calculados | memorando de comitê em oito seções |
| Decisão | **uma pessoa do perfil Crédito** | `operar_*` / `nao_operar` + limite operacional |

**Nenhuma etapa autoaprova crédito.** O parecer critica o limite calculado (seção 8) e
**não o altera** — um número produzido por modelo de linguagem é indefensável não porque
o modelo erre muito, mas porque quando ele erra ninguém consegue dizer onde.

### Por que os PDFs vão inteiros ao modelo

O bloco `document` da Anthropic aceita PDF nativo **e** escaneado no mesmo caminho: o
modelo lê o texto quando existe e enxerga a página quando não existe, já devolvendo a
página de origem. A alternativa — `pdfjs-dist` para o texto e um rasterizador para o
resto — traria uma dependência nativa (canvas/poppler) para o Railway, dois caminhos de
extração para testar, e faria a citação de página ser nossa em vez de ser do modelo.

Todos os documentos vão num **request só**. É o que permite ao modelo cruzar o DRE com a
relação de faturamento e apontar o conflito, que é metade do valor da extração. O que não
couber no orçamento de bytes (28MB) fica de fora **e aparece nas lacunas** — nunca em
silêncio.

### Por que a revisão interrompe o fluxo

Um limite de R$ 4 milhões construído sobre um EBITDA que o modelo leu numa linha errada
é, na tela, indistinguível de um limite correto. O status para em `aguardando_revisao` e
o cálculo não roda antes da confirmação.

A tela de revisão mostra o número **ao lado do trecho de onde ele saiu** — conferir um
balanço abrindo o PDF em outra aba é o tipo de trabalho que ninguém faz duas vezes.

Confirmar **sem alterar** também é um ato e fica gravado. Corrigir guarda o que o modelo
tinha lido em `valor_original`: a primeira pergunta que se faz de um extrator é "com que
frequência ele erra", e ela não tem resposta se a correção sobrescrever.

Campo crítico que veio `null` **não** entra na fila de revisão: isso é lacuna, e a tela
não pede confirmação de linha em branco.

---

## As fórmulas

Onze indicadores, cada um com fórmula fixa, insumos à vista e faixa parametrizada:

liquidez corrente e seca · endividamento geral · dívida líquida/EBITDA · margem EBITDA e
líquida · ROE · giro do ativo · PMR · CAGR de receita · cobertura de juros.

Três decisões que valem a pena registrar:

- **Soma parcial não vira total.** `ativo circulante + não circulante` com uma das metades
  ausente devolve `null`, não a metade. Meio ativo com cara de ativo inteiro produziria um
  endividamento de 100% numa empresa saudável.
- **Divisão por zero é `null`, nunca `Infinity`.**
- **Resultado financeiro positivo não é cobertura infinita.** Não há juros a cobrir, então
  o indicador é inaplicável — e diz isso.
- **O CAGR usa os ANOS declarados**, não a contagem de linhas: exercícios de 2021 e 2024
  são três períodos, e tratá-los como dois inflaria o crescimento de uma base que só tem
  furo.

### Os cinco tetos — vale o MENOR entre os aplicáveis

| # | Teto | Fórmula | Quando não se aplica |
|---|---|---|---|
| 1 | Capacidade financeira | receita anual × `base_pct` × penalidade de alavancagem × penalidade de liquidez | sem receita comprovada nos documentos |
| 2 | Capacidade operacional | média mensal de NF-e × `fator` | **análise inicial** (a empresa ainda não opera) ou zero NF-e na janela |
| 3 | Concentração de portfólio | PL do fundo × `pct_max_por_sacado` | `pl_fundo` não configurado |
| 4 | Cobertura da seguradora | limite Atradius vigente | sem análise vigente |
| 5 | Banda do scorecard | banda da faixa de score (04d) | faixa sem banda, ou empresa nunca pontuada |

> **A regra que governa o arquivo inteiro: não aplicável nunca é zero.**
>
> Um teto que não pode ser calculado sai da conta do mínimo — não entra como 0, que o
> tornaria automaticamente vinculante e reprovaria toda empresa nova. É a mesma regra do
> scorecard (04d), onde fator sem dado sai do numerador **e** do denominador, e pela mesma
> razão: ausência de informação não é informação ruim.
>
> Na UI o teto não aplicável aparece com o mesmo destaque dos outros, **sempre com o
> motivo escrito**. Escondê-lo faria o limite parecer o resultado de cinco réguas quando
> ele saiu de duas.

O **teto 2 é o mais confiável em reanálise**: é comportamento observado, não declaração. A
média divide pela janela inteira, não pelos meses com nota — quem emitiu em dois dos seis
meses tem média baixa, e é isso mesmo que o teto deve enxergar.

### Cenários e knockouts

Conservador = menor teto × `0,7`. **Base = menor teto = `limite_recomendado`.**
Agressivo = menor teto × `1,3`, sempre com condicionantes explícitas — o agressivo sem
condicionante é só um número maior.

**NÃO OPERAR** automático, sempre com o motivo listado: knockout do scorecard, PL negativo,
dívida líquida/EBITDA acima do teto, liquidez abaixo do mínimo, menor teto abaixo do
mínimo operacional, ou **nenhum teto calculável** (que é motivo explícito, não silêncio).

---

## Parâmetros versionados

`analise_parametros`: uma versão por mudança, **nunca update**, uma só ativa (índice
parcial único). Cada análise grava `parametros_versao` — é o que mantém uma análise de
dezoito meses atrás reproduzível quando a política mudar, e é justamente a análise antiga
que alguém vai querer defender num comitê.

A **lógica** das fórmulas mora no core e é fixa. O que é editável são percentuais,
fatores, limiares e pontos de corte. Um jsonb que carregasse a lógica seria uma linguagem
de expressão dentro do banco, e nenhum teste alcançaria as versões que alguém salvar
depois. Mesma decisão do scorecard (04d §3).

`PARAMETROS_PADRAO` em `packages/core/src/credito/analise.ts` e o seed da v1 na migração
0122 são o mesmo conteúdo, palavra por palavra. **Os dois mudam juntos.**

### `pl_fundo` nasce vazio, de propósito

O teto de concentração protege o **fundo**, não o cliente — e o PL do fundo não existe na
base. Ele fica `null` na v1 e o teto sai não aplicável até alguém configurá-lo na tela de
parâmetros. Um número inventado ali apertaria todo limite da casa sem ninguém perceber de
onde veio.

### A prévia do editor é fictícia de propósito

`/credito/parametros` roda o **mesmo** `calcularAnalise` do worker, sem cópia, sobre uma
construtora-exemplo fixa. Uma empresa real da base tornaria a prévia refém do estado dela:
no dia em que aquele balanço mudasse, o mesmo ajuste mostraria um efeito diferente, e a
tela deixaria de ser comparável consigo mesma.

---

## O confronto e a decisão

| Quadrante | Leitura |
|---|---|
| `ambos_aprovam` | Caminho livre. Limite sugerido = **menor dos dois** (a cobertura é o teto real). |
| `ambos_negam` | Não operar. Duas leituras independentes chegaram ao mesmo lugar. |
| `so_nos` | **A decisão que só um FIDC com dado próprio pode tomar**: operar sem cobertura, com limite reduzido ou com garantia adicional. |
| `so_seguradora` | **Alerta de complacência.** Ela aprovou o que a nossa análise recusa. |

**Motivo obrigatório em tudo que não seja o caminho trivial do quadrante.** Trivial é um
só por quadrante: `ambos_aprovam → operar_com_cobertura` e `ambos_negam → nao_operar`. Em
`so_nos` e `so_seguradora` **não existe** caminho trivial — qualquer decisão ali é uma
divergência entre duas leituras, e divergência sem motivo escrito é o que ninguém consegue
auditar seis meses depois.

`motivoObrigatorio()` no core e o CHECK `analises_proprietarias_motivo_da_divergencia_check`
são o mesmo predicado, duplicado de propósito: o core dá a mensagem antes do clique, o
banco é a última linha. **Os dois mudam juntos.**

### A decisão NÃO sobrescreve o número da seguradora

`analises_credito.limite_aprovado` continua sendo o que a Atradius concedeu, e nada aqui o
toca. O que decidimos vai para **`limite_operacional`**, campo novo e com nome próprio,
junto de `decisao_interna`.

Duas verdades diferentes precisam de dois campos:

- em `so_nos` existe operacional **sem** aprovado;
- em `so_seguradora` existe aprovado **sem** operacional;
- o fator "histórico de análises" do scorecard e a view `analise_vigente` leem a
  **seguradora** — se a nossa decisão ocupasse o mesmo campo, o scorecard passaria a se
  alimentar da nossa própria decisão.

A antecipação lê o operacional; o scorecard continua lendo o da seguradora.

---

## Gatilhos

- **Manual**: botão no painel do sacado, nos estágios anteriores ao envio e na reanálise de
  cliente. Ação **paga**: cada corrida relê os documentos no modelo.
- **Automático**: `enviarAnalises()` chama `dispararPropriaSeFaltar()` depois de cada
  pedido aberto na Atradius. Roda em paralelo e **não bloqueia** o envio — o envio já
  aconteceu e não pode ser desfeito por uma extração que demorou. Usa INSERT direto em vez
  do RPC: o RPC exige `auth.uid()` e o módulo Crédito do usuário, e aqui não há usuário.
- **Reanálise**: `sugerirReanalises()` (diário) **notifica** quando a análise vigente vence
  em menos de 60 dias. Sugerir é notificar; executar é ler dez PDFs num modelo, e "em lote
  automático" é a forma mais cara possível de descobrir que a maioria não mudou. Uma
  sugestão por análise — reemitir o evento por 60 dias transformaria o sino num lugar que
  ninguém olha.

O RPC recusa uma segunda análise enquanto houver uma em andamento no mesmo sacado: duas
corridas gastariam o dobro de tokens sobre os mesmos PDFs e produziriam dois pareceres
divergentes para a mesma pergunta.

O single-flight do worker é **por análise**, não por tipo de job — a única exceção no
`jobs/index.ts`. Dois analistas rodando dois sacados ao mesmo tempo é o uso normal; o que
não pode é a mesma análise rodar duas vezes.

---

## Falha nunca é silenciosa

Qualquer etapa que estoure grava `status = 'falhou'` com `erro` legível e a `etapa` em que
parou, mais o evento `analise_propria.falhou`. Meia extração gravada e nenhum aviso é pior
do que erro nenhum. Retry é manual (o mesmo botão).

O disparo do worker pela web é **best-effort**: se ele estiver fora do ar, a análise fica
em `processando` e `/api/cron/credito-reanalises` a drena. Falhar a action perderia o
registro que já foi gravado — e deixaria alguém olhando um spinner que nunca resolve.

---

## Segurança

- `analises_proprietarias` e `analise_parametros`: leitura **só** com o módulo `credito` —
  nem Empresas, nem Comercial, nem o dono da carteira. Documento contábil de terceiro é o
  dado mais sensível da base.
- Escrita **só** por RPC `SECURITY DEFINER`, todos com `revoke ... from public, anon`.
  Verificado: o Originador enxerga 0 linhas nas duas tabelas.
- Bucket `analise-docs` continua privado, com policy amarrada a `app_tem_modulo('credito')`
  (0073).
- **Texto extraído e payloads de IA não são logados em claro.** O log do worker registra
  id da análise, etapa e mensagem de erro — nunca o conteúdo do documento nem o corpo do
  request ao modelo.
- Retenção: os documentos seguem o ciclo de vida da `analises_credito` (`on delete
  cascade` em `analise_docs`); a análise proprietária sobrevive à esteira
  (`on delete set null`), porque o parecer vale como registro histórico da decisão mesmo
  quando o pedido é apagado.

---

## Onde tudo mora

- **Migração**: `0122_analise_de_credito_propria.sql`, aplicada em quatro partes
  (`0122a_analise_propria_tabelas` … `0122d_analise_propria_painel`).
- **Core** (`packages/core/src/credito/analise.ts`): indicadores, tetos, cenários,
  knockouts, quadrantes, vocabulário da extração. **37 testes** — cada fórmula, teto não
  aplicável fora do mínimo, cada knockout, os cenários, o motivo obrigatório.
- **Worker** (`credito/analise-propria.ts`): `processarAnalisePropria` (extração →
  cálculo → parecer), `drenarAnalisesProprias`, `sugerirReanalises`. Rotas
  `POST /jobs/credito/analise-propria`, `/analises-drenar`, `/sugerir-reanalises`.
- **Web**: painel do sacado embutido em `/credito/analises/[id]` (abas Análise · Revisão ·
  Parecer · Seguradora e decisão · Contexto) e `/credito/parametros` (webOnly).
- **Mobile**: leitura do painel, **decisão** e foto de documento pela câmera, na ficha da
  análise. A revisão da extração e o editor de parâmetros são webOnly: conferir sete campos
  contra o trecho de origem em 6" produziria uma conferência apressada, que é pior que
  nenhuma porque fica gravada como se alguém tivesse olhado.
- **Cron**: `/api/cron/credito-reanalises` (diário, 09h30).
- **Tools**: `credito.analise_proprietaria` (read), `credito.comparar_seguradora` (read),
  `credito.rodar_analise` (mutates — dispara, nunca decide).
- **Eventos**: `analise_propria.iniciada` · `.aguardando_revisao` · `.concluida` ·
  `.falhou` · `.divergencia_seguradora` · `credito.decisao_registrada` ·
  `reanalise.sugerida`.
- **Env**: `ANTHROPIC_API_KEY` no worker (já existia, usada pela busca de domínio).

## O que ainda não existe

- A foto pela câmera entra como tipo **`outros`** e precisa ser reclassificada na web antes
  de a análise rodar — a extração lê o documento pelo que ele diz ser, e quem fotografa na
  mesa do cliente não sabe distinguir balanço de balancete.
- `expo-image-picker` foi adicionado ao mobile: **exige um build nativo novo** (EAS /
  prebuild) para a câmera funcionar no app instalado.

## Fora de escopo (04j §11)

Autoaprovação, precificação dinâmica de taxa por risco, calibração estatística das fórmulas
contra inadimplência observada (fase futura, quando houver histórico), integração com
bureaus de score.
