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

## Cargos-alvo (settings `cargos_alvo`)

- `titulos` e `senioridades` vão como filtro para o Apollo, com
  `include_similar_titles: false` — sem isso o Apollo alarga a busca para "cargos
  com os mesmos termos" e traz gente fora da lista.
- `departamentos` **não é filtro de API**: `person_departments` não existe na People
  Search e era descartado em silêncio. Hoje serve só de desempate na ordenação
  local, e nunca elimina ninguém (sócios e diretores costumam vir sem departamento).
- A **ordem** de `senioridades` é a prioridade do corte: o worker ordena por ela e
  então fatia em `max_contatos_por_empresa` — e a fatia é o que se paga.

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
