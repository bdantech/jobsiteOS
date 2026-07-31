# Módulo Radar (Prompt 03)

Enriquecimento com **controle de custo**: domínios, contatos (Apollo), protestos
(DirectD) e sync de clientes Onepay. Três garantias regem tudo:

1. **Nunca enriquecer sem aprovação humana** — custo estimado na tela antes do "ok".
2. **Nunca pagar duas vezes** pelo mesmo dado — TTL por tipo + cache negativo
   (`enriquecimentos` registra também `sem_dados`).
3. **Esgotar as fontes gratuitas antes das pagas** — a cascata de domínio é o exemplo.

Fluxo de qualquer enriquecimento: **Seleção → Estimativa → Aprovação → Execução →
Reconciliação**.

## Onde está o quê

- **Banco**: migrations `0027`–`0033`. Tabelas: `enriquecimentos` (fonte da verdade
  de custo/TTL), `lotes_enriquecimento` + `lote_itens`, `protestos_consultas` (+ view
  `protestos_atual`), `clientes_onepay` (+ snapshots), `supressao`, `radar_config`.
  Colunas de domínio em `empresas`/`mercado_universo`; `contatos` estendida (Apollo).
- **Core** (`packages/core/src/radar/`): schemas, `estaSuprimido()` (o guard),
  porta `ProvedorCredito`, mutations, registry `radarModule` (webOnly).
- **Worker** (`apps/worker/src/jobs/radar/` + `apps/worker/src/radar/`): os jobs +
  toolkit (config, orçamento, persist, eventos, http, directd, apollo-webhook).
- **Web** (`apps/web/src/app/(app)/radar/` + `components/radar/`): painel, construtor
  de lote, detalhe, supressão, configurações, clientes Onepay.

## Cascata de resolução de domínio (§3)

Ordem obrigatória — só avança quando a etapa anterior não resolve:

1. **E-mail da Receita** (`email_rfb`) — descarta provedores genéricos. `origem=rfb`.
2. **E-mails de contatos** existentes. `origem=contato`.
3. **Coluna de site de listas** (placeholder — sem fonte estruturada hoje).
4. **Heurística + validação**: candidatos a partir de razão/fantasia →
   **DNS → MX → CNPJ na página**. Confiança: **alta** se o CNPJ está na página,
   **média** com DNS+MX, **baixa** só com DNS. `origem=heuristica`.
5. **Busca com Claude** (`incluir_claude`, paga): Anthropic com web search;
   o resultado **nunca é aceito direto** — passa pela validação da etapa 4.

Etapas 1–4 são gratuitas; a 5 só roda se o lote pedir. Tudo grava em
`enriquecimentos` (tipo `dominio`), inclusive `sem_dados`.

Três caminhos usam a MESMA função (`resolverDominio`): o lote, o botão **Resolver
domínio** da ficha e — indiretamente — a tela de Domínios. Duas implementações da cascata
seriam dois lugares onde a ordem das etapas pode divergir, e a ordem É a regra.

O botão da ficha inclui a etapa 5, ao contrário do lote: é um clique deliberado sobre uma
empresa a R$ 0,10, e um botão que responde "não achei" sem ter tentado tudo é um botão
que a pessoa clica de novo achando que falhou.

**A cascata não sobrescreve `dominio_origem = 'manual'`.** Sem essa guarda, uma correção
feita à mão volta ao valor antigo no próximo lote — sem rastro, e a pessoa refaz o mesmo
trabalho no mês seguinte. O universo continua sendo atualizado: lá não há curadoria.

### `www.` não é detalhe cosmético

`organizations/enrich?domain=www.acme.com.br` não acha nada no Apollo, e o job devolve
`sem_dados` — indistinguível de uma empresa que o Apollo realmente não conhece. Três
letras viram "esta empresa não tem headcount", para sempre. Por isso `normalizarDominio`
(core, `radar/dominio.ts`) tira esquema, caminho, porta e `www.`, e a edição manual na
ficha passa por ela.

## Domínios pelos contatos (`/radar/dominios`)

O que os e-mails dos contatos dizem sobre o domínio salvo. Três casos:

| caso | o que é | medido na base |
|---|---|---|
| `ausente` | não há domínio salvo e os contatos sabem qual é | ~174 empresas |
| `malformado` | o salvo aponta para o mesmo lugar, escrito de um jeito que quebra a consulta | 1 |
| `divergente` | são domínios diferentes de verdade | 4 |

O volume está no `ausente` — o e-mail já estava gravado, ninguém tinha lido. É o que
destrava contatos e headcount, que só sabem consultar por domínio.

**Adotar é manual de propósito.** Das quatro divergências reais, uma é uma construtora
cujo contato escreve pelo domínio da marca de vendas: os dois estão certos, cada um para
uma coisa. Uma rotina que equalizasse tudo acertaria três e estragaria a quarta em
silêncio. O que é adotado vira `origem = manual`, que a cascata não sobrescreve.

Não é um tipo de lote, embora a ideia tenha nascido assim. Lote é o fluxo de **gasto**
(seleção → estimativa → aprovação → teto de orçamento); isto não chama API, não custa nada
e não tem o que aprovar. Passá-lo pela cerimônia acrescentaria três telas entre a pessoa e
uma correção de um clique — e o deixaria com data de validade, porque um lote é uma foto.

A tela exige o módulo **Empresas** além de Radar: `contatos` é gated por
`app_tem_modulo('empresas')` e devolveria zero linhas, que a tela leria como "nenhuma
divergência" — a mensagem mais enganosa possível.

## Política de TTL

Configurável em `radar_config.ttl_dias`. A seleção do lote exclui itens
enriquecidos dentro do TTL (e dentro do TTL maior de `sem_dados`). Contatos são
deduplicados **por domínio** (SPEs/filiais compartilham domínio — cobrar por CNPJ
pagaria N vezes).

## Ajustar custos e cargos-alvo

Tudo em `radar_config` (tela **Configurações**, admin):

- `custos`: R$ por unidade (`dominio_claude`, `contato_apollo`, `protesto_sp`,
  `protesto_nacional`). Ajuste ao seu plano Apollo/DirectD.
- `cargos_alvo`: `titulos`, `departamentos`, `senioridades`, `max_contatos_por_empresa`
  — quem revelar no Apollo.
- `orcamento`: `teto_mensal_total` (bloqueia execução), `alerta_percentual` (notifica).
- `apollo`: `revelar_telefone_em_lote`, `bulk_size`.
- `protestos`: `clientes_sempre_nacional`, `prospeccao_incluir_fora_sp_default`.

## Ciclo de um lote e quando ele falha

`rascunho` → `aguardando_aprovacao` → (aprovar) `aprovado` → worker `executando`
→ `concluido`. O worker **materializa** os itens do filtro (excluindo por TTL),
processa com **throttle** e **teto de orçamento**, grava cada tentativa em
`enriquecimentos` e reconcilia o `custo_real`.

- Item que falha vira `erro` (com a mensagem) e **não** trava o lote.
- Teto de orçamento atingido → o lote para no meio (evento `orcamento.estourado`),
  os itens não processados ficam `pendente`.
- Lote em `aprovado` que não executou (worker fora do ar): botão **Executar**
  re-enfileira; a materialização é idempotente (não duplica itens).
- Lote que estourou exceção vira `falhou`.

## Webhook do Apollo (telefone assíncrono)

O telefone chega **depois**, separado, quando o `bulk_match` foi pedido com
`reveal_phone_number=true`. O worker expõe **`POST /webhooks/apollo`** (antes do
`exigirSegredo`, autenticado pelo `APOLLO_WEBHOOK_SECRET` em `?secret=` ou header
`x-webhook-secret`, comparação em tempo constante). Idempotente.

- **Dev**: exponha o worker local por um túnel (ex.: `cloudflared`/`ngrok`) e use a
  URL pública do túnel + `?secret=…` no `APOLLO_WEBHOOK_URL`.
- **Prod**: o próprio host público do worker no Railway:
  `https://<host-do-worker>/webhooks/apollo?secret=<APOLLO_WEBHOOK_SECRET>`.
  **Tem de ser o host do worker (Railway), não o do app web (Vercel)** — a rota é
  do Express; no Next não existe, e o Apollo só receberia 404.

Ciclo de vida de `contatos.telefone_status`:

| valor | significado |
|---|---|
| `null` | telefone não foi pedido neste enriquecimento |
| `pendente` | pedido ao Apollo, aguardando o webhook |
| `recebido` | número entregue |
| `indisponivel` | o Apollo respondeu que não tem número |

Se `revelar_telefone` estiver ligado (settings `apollo.revelar_telefone_em_lote` ou
o checkbox do lote) e `APOLLO_WEBHOOK_URL` estiver vazia, o item **falha antes de
gastar crédito**, em vez de rebaixar para "só e-mail" em silêncio.

O telefone fica de fora do upsert de contatos de propósito: ele só é escrito pelo
webhook, e um reprocessamento (TTL vencido) sobrescreveria com `null` o número já
recebido. Pelo mesmo motivo, `indisponivel` nunca sobrepõe um número existente.

## Contatos sob demanda (botão na ficha da empresa)

`POST /jobs/radar/contatos-empresa` — abre um lote de `contatos` já `aprovado` com um
item só e roda na hora. Passa pelo lote, e não direto pelo processador, porque é o
lote que registra custo, respeita o teto de orçamento e grava `enriquecimentos`; um
caminho paralelo gastaria crédito do Apollo sem aparecer em nenhuma dessas contas.

- Exige **domínio resolvido** na empresa (a busca do Apollo é por organização, e a
  organização se resolve pelo domínio). Sem ele, falha explícita em vez de lote vazio.
  Na ficha, o botão de headcount fica **desabilitado** enquanto não houver domínio e dá
  lugar a **Resolver domínio**: o worker responde 202 antes de descobrir que não tinha o
  que consultar, então a tela exibia "Consultando o Apollo" para algo que já tinha
  terminado em `sem_dominio`.
- O **TTL de contatos vale**: clicar duas vezes dentro da janela não cobra de novo — o
  item volta `pulado`.
- É assíncrono (202). A tela não promete contato na hora; o telefone, então, chega
  minutos depois pelo webhook.

Contatos digitados à mão gravam `origem = 'manual'`, fixada no servidor. O Apollo
nunca os sobrescreve: o upsert casa por `apollo_person_id`, que num contato manual é
nulo. E só o manual pode ser excluído — o do Apollo voltaria no lote seguinte.

## Cargos-alvo (settings `cargos_alvo`)

**A seleção é local, não da API.** A busca (`mixed_people/api_search`) é gratuita e
devolve a empresa inteira; só o `bulk_match` cobra. Então o worker varre todo mundo
sem pagar, filtra em [`selecionarAlvos`](../packages/core/src/radar/cargos.ts) e só
então revela os escolhidos. Filtrar na API não funciona: `person_titles` e
`person_seniorities` se combinam por **OR** (pedir "CFO" + "manager" traz todo
manager da empresa) e `person_departments` não existe.

Duas barreiras primeiro, nesta ordem:

1. **`excluir_titulos` / `excluir_departamentos`** — vetam por área e vencem tudo,
   inclusive os prioritários. RH, comercial, marketing e jurídico não decidem
   antecipação. Sem isto, "Diretora Gente & Cultura" entra por `diretor` e "Business
   Partner" entra por senioridade `partner`.
2. **`senioridades` é allow-list** — quem não está na lista não entra. É o que barra
   `entry` e `intern`; ambos já passaram, e como casavam `finance`/`controller` foram
   classificados prioritários e furaram a fila à frente de diretores.

Só então, quem entra:

3. `titulos` — casam por **trecho**, ignorando acento e caixa, porque os cargos reais
   vêm sujos (`"◾ Head of Procurement at LBX Construtora"`, `"CFO e DRI"`). Precisa
   ter termos em **português e inglês**. Termo de até 4 caracteres é tratado como
   sigla e exige palavra isolada — sem isso `COO` casa "**Coo**rdenador de
   Recrutamento", que foi como duas pessoas de RH entraram num lote pago. Nunca
   inclua `manager` solto (traz a obra inteira), nem `partner`/`owner` (casam
   "Business Partner" e "Product Owner").
4. `senioridades_qualificam` — entram sem depender do título. Existe porque o alto
   escalão costuma vir em inglês ("Chief Operating Officer" não casa `COO`).
5. `prioritarios` — donos e financeiro, que entram mesmo com título fora da lista
   ("Owner Partner", "Comptroller").

Ordem de preferência dentro dos escolhidos: **prioritários primeiro**, depois
senioridade da maior para a menor (a ordem de `senioridades` é que manda), e por fim
quem está num departamento-alvo. O corte em `max_contatos_por_empresa` vem em
seguida — e a fatia é o que se paga.

`departamentos` só desempata: não qualifica nem elimina. Se qualificasse,
`master_operations` traria a obra inteira de volta; sócios e diretores, que costumam
vir sem departamento, seriam os primeiros cortados.

`max_paginas_busca` limita a varredura (100 por página, default 3). Ao truncar, o
worker registra um `warn` — sem isso, "a empresa só tem 300 pessoas" viraria fato
silencioso na análise de custo.

## Variáveis de ambiente (worker)

Todas **opcionais** com guard de falha limpa (sem a chave, o job registra
erro/sem_dados em vez de derrubar o boot):

`APOLLO_API_KEY`, `APOLLO_WEBHOOK_SECRET`, `APOLLO_WEBHOOK_URL`, `DIRECTD_API_KEY`,
`ONEPAY_BI_URL`, `ONEPAY_BI_TOKEN`, `ANTHROPIC_API_KEY`.

## Crons (Vercel → worker)

- `radar-onepay` — diário (07:00 UTC): sync dos clientes Onepay.
- `radar-protestos-clientes` — mensal (dia 5, 08:00 UTC): protestos nacional da
  matriz + SPEs ativas de cada cliente (lote automático já aprovado).

## Rotas do worker

`POST /jobs/radar/onepay`, `POST /jobs/radar/lote` (`{lote_id}`),
`POST /jobs/radar/protestos-clientes`, `POST /webhooks/apollo`.

## Nota sobre os tipos gerados

`radar_cobertura` (RPC) ainda não está em `packages/core/src/types/database.ts`
(cast localizado em `components/radar/queries.ts`). Rode o `pnpm db:types` do
projeto (conta autenticada) para regenerar no formato canônico — ver a memória
`supabase-type-generation-gotcha`.
