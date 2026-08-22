# Leads & formulários (Prompt 04i)

Formulários embutíveis nas landing pages. O lead que preenche não vira um e-mail numa
caixa: vira **empresa deduplicada, contato com ponto focal e card na fila de um SDR**,
com o dossiê chegando por trás.

> **Estado: fase 1 de 2.** O que está no ar é *captar e rotear*. Auto-resposta,
> `/agendar/{token}`, dashboard por UTM, tools de IA e mobile ficaram para a fase 2 —
> as decisões já tomadas para elas estão registradas em [Fase 2](#fase-2-decidido-mas-não-construído).

## Onde está o quê

- **Banco**: migration `0120`. Tabelas `formularios`, `formulario_submissoes`,
  `formulario_visualizacoes`. RPCs `formulario_publico`, `formularios_lista`,
  `app_salvar_formulario`, `app_processar_submissao`.
- **Core** (`packages/core/src/leads/`): catálogo de campos, validação da porta
  pública, normalizador de UTM e o motor de roteamento inbound — 25 testes.
- **Web**: `/comercial/leads` (lista + construtor + submissões), `/f/{slug}` (página
  standalone), `/f/{slug}.js` (embed), `POST /api/f/{slug}` (submissão),
  `POST /api/f/{slug}/view` (visualização).

## Como colar no Framer

1. Na página do Framer, insira um componente **Embed** (HTML).
2. Cole a linha que o construtor gera:
   ```html
   <script src="https://{APP_URL}/f/{slug}.js" async></script>
   ```
3. Pronto. Funciona no preview e no publicado.

Para posicionar num ponto exato em vez de logo abaixo do script, coloque também
`<div id="jobsiteos-form-{slug}"></div>` onde o formulário deve aparecer.

**O script se defende da página do cliente.** Ele monta dentro de um **shadow DOM**:
prefixo de classe protegeria contra colisão de nome, não contra herança nem contra
seletor de elemento (`input { ... }` numa landing page qualquer deforma o formulário de
um jeito que só aparece na página dela). O tema vem da **luminância do fundo** do
container, não de `prefers-color-scheme` — numa landing page preta aberta por quem usa
o sistema no claro, a media query deixaria o formulário branco no meio do preto.

E se o formulário não existir ou estiver inativo, o script emite um `console.warn` e
nada mais: um script de terceiro que estoura pode derrubar o JS da página inteira, e o
custo do nosso erro não pode ser a landing page do cliente.

## O que roda automático, e o que custa dinheiro

| etapa | quando | custo |
|---|---|---|
| Cadastral (CNAE, capital, natureza, Simples) | sempre, via `cnpj_lookup_fila` | zero |
| Cascata de domínio | sempre | zero |
| Estimativa de faturamento (04c) | sempre | zero |
| Score e potencial (04d) | sempre, sobre o enriquecimento acima | zero |
| **Contatos (Apollo)** | **só com o toggle ligado no formulário** | **pago** |
| Protesto | **sob demanda**: botão para o SDR quando fizer sentido | pago |

O pago roda como lote automático de 1 item (`lotes_enriquecimento`, `criado_por = null`,
já aprovado — é política, não pedido) para manter rastreabilidade e custo contabilizado,
e respeita `comercial_config.orcamento_inbound_mensal` (default **R$ 300/mês**, alerta
em 80%).

O teto nasce em 300 e não em zero de propósito: com zero, o toggle do formulário
existiria sem nunca fazer nada, e alguém levaria um dia para descobrir por quê.

## A porta aberta para a internet

`POST /api/f/{slug}` pode ser chamado por qualquer um, quantas vezes quiser, com
qualquer corpo. As defesas, nesta ordem:

1. **Rate limit** por IP e por CNPJ (5 e 3 por 10 min). São dois abusos diferentes: uma
   botnet troca de IP e mantém o CNPJ; um script bobo mantém o IP e sorteia CNPJ.
2. **Honeypot** (campo fora da tela, não `display:none` — parte dos bots ignora o
   escondido assim) e **tempo mínimo de 2s**.
3. Validação server-side de CNPJ (dígito verificador) e e-mail; consentimento quando
   configurado, com aceite e timestamp gravados.
4. IP só como **hash com sal**. Sem sal, hash de IPv4 é reversível por força bruta em
   segundos — são 4 bilhões de valores.

**As duas checagens de spam vêm ANTES da validação**, e isso não é detalhe: validar
CNPJ primeiro faria o bot receber "CNPJ inválido" e aprender o formato certo na segunda
tentativa.

### O que a LP valida ao vivo

- **CNPJ**: dígito verificador checado a cada tecla, e o **botão fica travado** até
  fechar. O erro só aparece com os 14 dígitos digitados — acusar no terceiro é discutir
  com quem ainda está digitando. Antes o erro só surgia no submit, e a pessoa preenchia
  tudo para descobrir no fim que o primeiro campo estava errado.
- **Telefone**: máscara `(11) 98765-4321` enquanto digita, fechando o hífen só quando
  sabe se é fixo ou celular.
- **E-mail**: formato barra; **provedor pessoal apenas avisa**, em âmbar, e deixa
  seguir. Muita gente de obra usa gmail, e vermelho ensinaria que ela errou — ela não
  errou. A lista de provedores vem de `packages/core` (a mesma da cascata de domínio),
  interpolada no script.
- **Consentimento nasce marcado**: a pessoa está preenchendo um formulário para pedir
  contato, e o texto descreve o que ela veio fazer. Desmarcado, viraria obstáculo em vez
  de transparência. Ela pode desmarcar — e aí o envio é barrado, como deve ser.

**Spam recebe 200 e a tela de sucesso.** O bot não pode aprender o que o denunciou, e
um humano que caiu como falso-positivo não vê erro nenhum. A linha fica em
`descartada_spam` para alguém achar depois — uma porta que descarta sem registro é uma
porta em que ninguém confia no dia em que um lead real "sumiu".

Sem CAPTCHA na v1 (mata conversão). O ponto de extensão está no mesmo lugar das outras
defesas, caso o spam apareça.

## O pipeline

Tudo numa transação (`app_processar_submissao`): submissão, empresa, contato e lead
nascem juntos ou não nascem. Um lead de SDR apontando para uma submissão que falhou pela
metade é pior que uma submissão perdida — o SDR liga sem saber o que a pessoa pediu.

- **Empresa**: dedup por CNPJ. Existe → **enriquece, nunca duplica**, e só preenche
  campo vazio: o que veio da Receita vale mais que o que a pessoa digitou com pressa num
  celular. Não existe → cria e enfileira em `cnpj_lookup_fila`.
- **Contato**: dedup por e-mail ou telefone dentro da empresa. Novo contato vira **ponto
  focal** se a empresa ainda não tiver um — quem se apresentou é o canal que existe.
- **Lead de SDR**: `origem = 'inbound'`. Se já houver lead vivo, **reaproveita e carimba
  o toque** em vez de abrir um segundo: dois SDRs na mesma porta é pior que nenhum.

### Quem atende

`rotearInbound` (core, com testes) desce uma cascata até achar dono:

| degrau | quem | aviso na submissão |
|---|---|---|
| 1 | SDR com `direcao in\|both`, cobrindo o território, menor carga | — |
| 2 | qualquer SDR ativo, menor carga | "nenhum SDR marcado para inbound" |
| 3 | `vendedor_destino_id` do formulário | "não há SDR cadastrado" |
| 4 | qualquer vendedor ativo, menor carga | "não há SDR nem destino" |
| 5 | ninguém | "atribua à mão" |

Dentro do degrau 1, **se ninguém cobre o território o lead vai para o SDR de inbound
menos carregado assim mesmo**. Um lead inbound é alguém pedindo contato agora; deixá-lo
órfão porque o território do RS não estava configurado jogaria fora a única vantagem que
o inbound tem sobre o outbound.

**A cascata existe por causa de um lead perdido de verdade.** A primeira versão parava
no degrau 1 e devolvia `null` quando não havia SDR nenhum. Na primeira submissão real da
base — onde o único vendedor cadastrado era um originador — o lead virou empresa e
contato e não apareceu em funil algum, silenciosamente. Cada degrau abaixo do primeiro
grava um aviso visível na tela de Leads: atribuir um lead de reunião a quem não trabalha
reuniões é uma solução temporária, e precisa parecer temporária em vez de virar o normal
que ninguém nota.

### Supressão não bloqueia

Quem preenche o formulário está **pedindo** contato, e o "não me procure" de seis meses
atrás não vale contra isso. Mas ignorar o registro em silêncio também não: a submissão
vai para `revisao`, **sem criar lead**, e um humano decide. Nem bloqueia, nem atropela.

## A pergunta de intenção e a divergência de papel

`cedente` / `sacado` / `erp` — configurável por formulário, e omitível inteira (a LP do
Brik não precisa dela). O roteamento é o mesmo em todos os casos (**o SDR trabalha**); o
que muda é o pitch. `cedente` marca a empresa com `tipagem_antecipacao = 'aquisicao'`.

Depois que a cadastral chega, o CNAE é comparado com a intenção declarada:

- CNAE 41/42/6810 → **contratante** (constrói ou incorpora)
- o resto → **prestador**
- sem CNAE → **indefinido**, e indefinido nunca diverge

Divergir **não é defeito do lead**. Costuma ser lead confuso OU lead muito interessante
— o subempreiteiro grande que também subcontrata é os dois papéis ao mesmo tempo. Por
isso a divergência levanta bandeira no card e **nunca descarta**.

## Como ler o dashboard

A **taxa de conversão** (submissões ÷ visualizações) é o número que separa problema de
formulário de problema de tráfego. Ela só existe porque o script registra a
visualização: sem denominador, "12 submissões" pode ser 12 de 20 ou 12 de 4.000.

A aba **Submissões** mostra tudo, inclusive `descartada_spam` e `erro`. A pergunta que
ela responde é "o lead do fulano chegou?", e uma lista que esconde o que deu errado
responde "não chegou" nos dois casos em que chegou e foi barrado.

## Fase 2 (decidido, mas não construído)

- **Auto-resposta**: em **modo sombra**, como a outbox da antecipação (04) — grava em
  `mensagens_outbox` com `pendente_envio` e não envia. O texto se valida antes de o
  canal existir; ligar canal primeiro e conferir depois é como se queima uma base.
- **`/agendar/{token}`**: disponibilidade por **horário comercial global** em
  `comercial_config` (seg–sex, 9h–18h, slots de 60 min, antecedência mínima de 4h) menos
  os eventos já marcados. `vendedor_eventos` só guarda compromissos — não existe noção
  de jornada, e ela precisou ser inventada.
- Dashboard por UTM com drill-down, tools de IA, selo de origem no mobile.

## Fora de escopo (Prompt 05+)

WhatsApp (campo e toggle já previstos, desabilitados), sequências de nutrição,
Google Calendar, A/B test automático, CAPTCHA.

## Enriquecimento do lead

Até 22/08/2026 isto não existia, e o buraco era grande: o formulário criava a empresa,
enfileirava o cadastral da Receita e parava. Domínio, funcionários, faturamento e score só
aconteciam por botão na ficha ou pelo lote mensal — um lead que chegava no dia 8 ficava
quase trinta dias sem faturamento estimado e sem score. E é o score que alimenta o
`valor_esperado_mensal`, que é a régua pela qual o SDR decide para quem ligar primeiro: o
lead novo entrava na fila **sem a nota que define a ordem**.

Pior: `formularios.enriquecimento_pago` já existia como Switch no construtor e como badge
na lista, e **nada o lia**. Era um botão que prometia um poder que não existia.

### A ordem é dependência, não preferência

```
domínio  →  funcionários  →  faturamento  →  score
```

- **domínio** é a chave que o Apollo usa para achar contato;
- **funcionários** é o sinal principal do estimador de faturamento;
- **faturamento** é a base do limite potencial e entra no score;
- **score** vem por último porque lê tudo que veio antes.

Inverter qualquer par produz um resultado pior **em silêncio**: o score sai de uma base
mais pobre e ninguém nota, porque um score sempre sai.

### O que é grátis roda sempre; o que custa espera o toggle

| Etapa | Custo | Quando roda |
|---|---|---|
| Domínio (e-mail do contato, e-mail da Receita, heurística, validação DNS) | zero | sempre |
| Faturamento estimado | zero | sempre |
| Score | zero | sempre |
| Funcionários | por consulta | só com `enriquecimento_pago` |
| Contatos Apollo | por consulta | só com `enriquecimento_pago` |
| Domínio via busca Claude (etapa 5) | por consulta | só com `enriquecimento_pago` |

"Em todo lead que chega" é a pior frase possível ao lado de uma chamada paga: lead de
teste, concorrente curioso e spam que passou pelo filtro também chegam.

### O e-mail digitado vira domínio

`app_processar_submissao` salva o e-mail da submissão como **contato** (e o primeiro vira
ponto focal). A etapa 2 do resolvedor de domínio lê exatamente os e-mails dos contatos da
empresa. Provedor genérico é descartado em `dominioDeEmail` → `motivoDescarteDominio`, e o
domínio derivado ainda passa por validação de DNS/MX contra o CNPJ — **gmail.com nunca
vira o domínio de ninguém**, e um domínio que não resolve não é aceito.

### Dois gatilhos, um deles é rede de segurança

O caminho normal é o próprio endpoint do formulário acordar o worker assim que a submissão
entra — `void dispararEnriquecerLeads()`, sem esperar. Quem preencheu está olhando um
spinner, e fazer a pessoa esperar por trabalho que não é dela seria trocar a experiência de
quem vira cliente pela conveniência de quem escreve o código.

O cron `/api/cron/leads-enriquecer` (de hora em hora) varre o que aquele caminho perdeu:
worker fora do ar, deploy no meio do envio, erro de rede entre a Vercel e o Railway. Sem
ele um lead ficaria para sempre sem domínio e sem score, e ninguém descobriria — o lead
aparece na lista de qualquer jeito.

A varredura usa o índice `formulario_submissoes_pendentes_idx`, criado na 0120 esperando
exatamente por ela.

### Limitação honesta

Sem `enriquecimento_pago`, funcionários não é buscado — e funcionários é o sinal principal
do estimador. Para um lead que não é do Simples e não tem ERP conhecido, **o faturamento
não sai**, e sem faturamento o score fica pobre. O caminho gratuito cobre bem o lead do
Simples; para o resto, o toggle é o que fecha a conta.

### O cadastral é o primeiro elo, e ele não estava garantido

`app_processar_submissao` só enfileira `cnpj_lookup_fila` quando a empresa é **NOVA**. Um
CNPJ que já existia por outra via — importação de lista, por exemplo — podia estar fora de
`mercado_universo`, e aí não há CNAE, não há Simples, não há situação cadastral, não há
idade.

Isso mata dois elos de uma vez:

- o **estimador** exige ao menos um sinal (funcionários, ERP ou Simples) e não encontra
  nenhum → sem faturamento;
- o **scorecard** não consegue avaliar idade, regularidade nem capital social → completude
  abaixo do mínimo → `dados_insuficientes`.

Foi exatamente o que aconteceu com o primeiro lead real (22/08/2026): domínio resolvido,
faturamento vazio, score vazio — e a causa estava dois passos antes de onde o sintoma
aparecia. O job agora verifica `mercado_universo`, enfileira e **drena a fila ali mesmo**,
com orçamento curto, antes das outras etapas.

### O diário do enriquecimento

`formulario_submissoes.enriquecimento_resultado` (0124) guarda, por etapa, o que aconteceu
e por que não aconteceu.

O motivo é concreto: no primeiro lead real, `processada_em` estava preenchido e nada
enriquecido. Descobrir por quê exigiu cruzar `empresas`, `enriquecimentos`,
`mercado_universo` e `cnpj_lookup_fila` — e mesmo assim o erro da etapa que falhou só
existia no log do container.

Um job que registra "terminei" sem registrar **o que fez** obriga alguém a fazer
arqueologia toda vez que o resultado decepciona. `processada_em` diz que o job passou; o
diário diz o que ele conseguiu, e as duas respostas são diferentes.

Etapa pulada também vira linha: "enriquecimento pago desligado neste formulário" e "sem
domínio: o Apollo não teria por onde buscar" são respostas, e silêncio não é.
