# JobsiteOS

Internal operations platform for **ONE OS** — the whole company lifecycle in one place: TAM mapping →
lead enrichment → outbound → WhatsApp sales → credit portfolio → collections → litigation.

Core architectural principle: **one company (CNPJ), many lenses.** A single `empresas` entity is the
source of truth. Every module reads and writes state on top of it. Nothing duplicates company records.

---

## Layout

```
apps/web         Next.js 15 (App Router, RSC by default) → Vercel. Also the mobile backend (/api/*).
apps/mobile      Expo (React Native, Expo Router, EAS) → iOS + Android.
apps/worker      Node/TypeScript container → Railway. Ingestão do Mercado (Receita, CNO), jobs do Radar
                 e da Antecipação (sync de NFs 4/4h, reclassificação do funil, outbox, lookup cadastral).
packages/core    SHARED: Tool Registry, zod schemas, generated Supabase types, write helpers, notify().
supabase/        Numbered SQL migrations. The repo is the source of truth for the schema.
docs/            Notas por módulo: radar.md, antecipacao.md, comercial.md, fornecedores.md, credito.md, leads.md, reports.md, juridico.md, comunicacao.md.
prompts/         The build specs.
```

## The Tool Registry

`packages/core/src/registry` is the spine. One array drives **four** things:

| It drives | How |
| --- | --- |
| Web navigation | The sidebar renders `grantedModules(ids)` |
| Mobile navigation | The tab bar renders `grantedMobileModules(ids)` (drops `webOnly`) |
| Permissions | `perfil_modulos.modulo_id` matches `AppModule.id`; RLS enforces it in Postgres |
| AI capabilities | The AI Bar is offered `grantedTools(ids)`, converted zod → JSON Schema |

**Adding a module is exactly three steps:** (1) a migration, (2) screens in both apps, (3) one entry in
`packages/core/src/registry/index.ts`. If you find yourself touching navigation or permission code to
add a module, something has gone wrong.

## Security model

Worth understanding before you write a mutation, because it is enforced in the database, not in the app.

**RLS is on for all 10 tables** and is driven by the registry: `app_tem_modulo('empresas')` returns true
only if your `perfil` grants that module. A user cannot read a module's data by guessing a URL, or by
calling PostgREST directly with their own token.

**Three columns on `usuarios` are not granted to `authenticated` at all** — not even on your own row:
`web_push_subscriptions`, `expo_push_tokens`, `prefs_notificacoes`. Rows are protected by RLS; these
columns are protected by column-level GRANTs, so no browser session can enumerate a colleague's push
endpoints. Reading or writing them **requires the service-role client**, i.e. server-side code.

**Every mutation is one transaction.** `criarEmpresa` / `atualizarEmpresa` / `criarNota` call
`SECURITY INVOKER` Postgres functions (migration `0008`) that write the row **+** the `empresa_eventos`
row **+** the `audit_log` row atomically. Three sequential `supabase-js` inserts would be three
transactions, and a crash between them would leave a company with no audit trail. Never bypass these
helpers with a raw `.insert()`.

**The service role bypasses RLS entirely.** Any server action that reaches for it must first check the
caller's permissions itself — that check *is* the authorization.

## Setup

```bash
pnpm install

cp apps/web/.env.example    apps/web/.env.local     # fill in
cp apps/mobile/.env.example apps/mobile/.env        # fill in

pnpm seed          # creates the first admin user from SEED_ADMIN_EMAIL, prints a temp password ONCE
pnpm dev           # web on :3000, mobile via Expo
```

### Environment

Every variable is documented in the two `.env.example` files. The ones that bite:

- `SUPABASE_SERVICE_ROLE_KEY` — **server-only**, bypasses RLS. Never `NEXT_PUBLIC_*`, never in
  `apps/mobile`. The mobile app reaches privileged operations through the Next.js API instead.
- `EXPO_PUBLIC_API_BASE_URL` — on a **physical device**, `localhost` is the phone, not your Mac. Use
  your machine's LAN IP (`http://192.168.x.x:3000`).
- VAPID keys — generate with `npx web-push generate-vapid-keys`. `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and
  `VAPID_PUBLIC_KEY` must hold the **same** value.
- `CRON_SECRET` — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

## Migrations

The repo is the source of truth. Write a numbered file, then apply it:

```bash
# supabase/migrations/00NN_what_it_does.sql
supabase db push                       # or apply via the Supabase MCP
pnpm db:types                          # regenerate packages/core/src/types/database.ts
```

**Regenerate the types after every migration.** They are checked in, and a stale `database.ts` is how
you get a `supabase.rpc()` call that typechecks locally and 404s in production.

**And re-apply the two repo patches**, which the generator does not emit — the file carries a
`PATCHES DO REPO` note at the bottom listing both:

1. the `Views<>` helper (the current generator folds views into `Tables<>`, and the repo imports
   `Views<'name'>` everywhere);
2. `| null` on the nullable RPC arguments of `app__conversa_para` (every RPC argument comes out
   required and non-nullable, even when the function accepts null).

Without (1) the web build breaks; without (2) the worker does not compile. `pnpm typecheck` catches
both, which is why it is the step after `pnpm db:types` and not an optional one.

Run the linter after any schema change — it catches missing RLS policies:

```bash
supabase db lint    # or: get_advisors via the Supabase MCP
```

Three `SECURITY DEFINER` warnings for `app_is_admin` / `app_tem_modulo` / `app_usuario_ativo` are
**expected and correct**. RLS policies call those helpers as the invoking role, so `authenticated` must
hold `EXECUTE` or every policy on every table would deny. They only ever return a boolean about the
caller themselves.

## Deploying

**Web (Vercel):** point it at the repo, set the root to `apps/web`, add every var from
`apps/web/.env.example`. `vercel.json` already registers the cron entries; they authenticate with
`CRON_SECRET`.

**Mobile (EAS):**

```bash
cd apps/mobile
eas init            # writes the EAS project id — Expo push will NOT deliver without it
eas build --profile preview --platform ios
eas submit
```

**Testing Expo push:** it does not work on the simulator — you need a physical device. Log in on the
device (which registers its token), grab the token, and send a test through
[expo.dev/notifications](https://expo.dev/notifications).

**Testing Web Push:** requires HTTPS or `localhost`. Subscribe from `/settings`, then trigger a
notification through `notify()`.

## Mercado

### `camada` is not `estagio`. Start here.

This is the one thing everybody gets wrong, and getting it wrong corrupts data, not just copy.

| | `camada` | `estagio` |
| --- | --- | --- |
| What it means | **Market fit** — how well a company matches who we can sell to | **Relationship history** — how far we have got with them |
| Values | `universo` → `tam` → `sam` → `som` | `mercado`, `lead`, `oportunidade`, `cliente`, … |
| Who moves it | **Nobody.** A worker job recomputes it from versioned rules (`camada_regras`) over Receita/CNO/ERP data | **Humans**, through actions in other modules |
| Where it lives | `mercado_universo.camada` and `empresas.camada` | `empresas.estagio` |

They are **orthogonal axes**. A company can be SOM and still `estagio = 'mercado'` (perfect fit, never
contacted). A company can be `cliente` and only TAM (we sold to someone slightly outside the ideal
profile). Promotion into `empresas` sets `estagio = 'mercado'` **precisely because promotion is a
classification event** — passing a rule is not a conversation.

Never write "empresa avançou para SOM" as if it were a funnel step, and never sort a pipeline by
`camada`. `empresas.tam_camada` (Prompt 01) was **dropped** — the layer is `camada`, on both tables.

### The pyramid

**Universo → TAM → SAM → SOM.** The ~2M-CNPJ universe lives in **`mercado_universo`** (staging fed by
the Receita Federal open data), **not** in `empresas`. `empresas` only ever holds companies we have a
reason to hold: they were **promoted**.

- **Promotion threshold: SAM by default** (`CAMADA_PROMOCAO_PADRAO` in `packages/core/src/constants.ts`;
  the worker reads it from its own env var `CAMADA_PROMOCAO`, and `manual` disables auto-promotion).
- **Auto-promotion promotes matrizes only.** A filial is not a company you sell to — it is the same
  customer with a different suffix, and `qtd_filiais` already carries the fact. Promoting every
  establishment would put the same construtora in the base four times, each with its own timeline.
  Manual promotion (`app_promover_empresa` → `promoverEmpresa()` → AI tool `mercado.promover_empresa`)
  deliberately accepts **any** CNPJ, filial included.
- Promotion is **idempotent** and it **adopts**: a company already in `empresas` from a list import
  (which skips staging) is linked, never duplicated. Event: `empresa.promovida`.
- **Rules are versioned, never edited.** `salvarCamadaRegra()` writes the *next* version; a partial
  unique index enforces exactly one `ativa` per layer. Activating one fires the reclassification job,
  and every row that moves logs `camada.alterada` with the rule version that moved it. The Pirâmide
  screen previews a rule (`POST /jobs/preview-regra`) before anyone activates it.
- **All reads go through the view `mercado_explorador`** (universo ⟕ empresas ⟕ mercado_metricas, plus
  the list-imported companies that never passed through staging). `security_invoker`, so RLS applies.
  Every variable in the filter catalog is a real column on it.

### The filter engine: one tree, three compilers, two catalogs

`packages/core/src/mercado/filters.ts`. **One** JSON tree —
`{ operador: 'e' | 'ou', condicoes: [{ variavel, operador, valor }] }` — powers camada rules,
Explorador filters, segmentos, Radar batch selection **and** the Antecipação faixa rules. A catalog
whitelists the variables; anything else fails zod validation before a compiler ever sees it.

Since Prompt 04 the engine is a **factory**, `criarFiltroEngine(catalogo)`, with two instances:

| Engine | Catalog | Filters over |
| --- | --- | --- |
| `mercadoEngine` (the unqualified exports) | `CATALOGO` | `mercado_explorador` |
| `faixaEngine` | `CATALOGO_FAIXAS` (`packages/core/src/antecipacao/faixas.ts`) | `notas_funil` |

The compilers are shared; the catalogs are **not**, and that isolation is the point. `obras_ativas`
does not exist on the funnel view and `dias_para_vencimento` does not exist on the Explorador view — a
single merged catalog would let a faixa rule compile to a column that isn't there, and nobody would
find out until the nightly reclassification failed over 40.000 notes. Both directions are tested
(`src/antecipacao/faixas.test.ts`).

Two compilers, and the split is a security boundary, not a convenience:

| | Compiles to | Who calls it |
| --- | --- | --- |
| `compileToPostgrest(arvore)` | a PostgREST `.or()` string | **Web and mobile.** `supabase.from('mercado_explorador').select(…).or(filtro)` — runs under RLS, and **no SQL ever leaves the client** |
| `compileToSql(arvore)` | `{ text: 'where … $1..$n', values }` | **The worker only.** It needs a direct `pg` connection to reclassify 2M rows in one statement |

**`compileToSql` must never be exposed over HTTP.** The worker's `/jobs/preview-regra` accepts a filter
**tree**, which zod validates against the catalog — never a SQL string. Also in the module:
`parseArvore()` (throws pt-BR `FiltroError`), `descrever()` (human pt-BR prose, used for "regra atual"
and confirmation cards) and `operadoresDe()` (the operators legal for a variable — the rule builder
*must* use it, or it produces trees that fail validation on save).

### The worker (`apps/worker`)

The Receita dump is ~5 GB zipped / ~40 GB of CSV. No serverless function survives that — not on time,
not on memory. So it is a container on Railway, woken monthly by a Vercel Cron
(`vercel.json`: `/api/cron/mercado-receita` on the 10th, `/api/cron/mercado-cno` on the 12th), which
just authenticates and hands off. Jobs return **202 immediately**; progress lives in
`mercado_ingestoes`.

The worker writes the reference tables (`mercado_universo`, `_socios`, `_obras`, `_metricas`,
`grupos_economicos`) with the **service role** — those tables have no insert/update policy for
`authenticated`, so they are read-only to every browser session, by construction.

**Env** (`apps/worker/.env.example`, validated at boot by `src/env.ts` — a missing var fails the
process, not the fourth hour of a download):

| var | why it bites |
| --- | --- |
| `WORKER_SECRET` | Bearer on every route except `/health`. Min 24 chars. **Same value on Vercel** (`WORKER_SECRET`), which also needs `WORKER_URL`. Both are server-only — never `NEXT_PUBLIC_*` |
| `DATABASE_URL` | The **direct** Postgres connection (**5432**), never the transaction pooler (6543). `COPY` and `TEMP` staging tables are session state; the pooler loses both between statements |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Ingestion rows, events and `notify()`. Bypasses RLS |
| `RECEITA_BASE_URL` | Primary source. **Always tried first** |
| `RECEITA_FALLBACK_URL` | The mirror. **Never used automatically** — only on `{ "fallback": true }` |
| `RECEITA_MES`, `RECEITA_PARTES` | Month folder (`YYYY-MM`, defaults to now) and how many zipped parts each of Empresas/Estabelecimentos/Sócios is split into (10) |
| `CNO_SOURCE_URL` | The obras (CNO) dump |
| `DOWNLOAD_DIR` | Where partial downloads are cached, so a retry resumes by `Range` instead of starting over |
| `RETRY_TENTATIVAS`, `RETRY_BASE_MS`, `RETRY_FATOR` | 5 attempts, 15min × 3 → spread over hours (see below) |
| `CAMADA_PROMOCAO` | `tam \| sam \| som \| manual`. The layer that auto-promotes into `empresas` |
| `VAPID_*` | Only needed for Web Push on failure notifications |

#### Running it locally

```bash
cp apps/worker/.env.example apps/worker/.env      # fill in
pnpm --filter @jobsiteos/worker build
pnpm --filter @jobsiteos/worker start             # :8080
```

In Docker — **the build context is the repo root**, because the worker imports `packages/core` (which
ships TypeScript source, no `dist`). A Dockerfile scoped to `apps/worker` would build an image that
dies at `tsc`:

```bash
docker build -f apps/worker/Dockerfile -t jobsiteos-worker .          # from the repo root
docker run --rm -p 8080:8080 --env-file apps/worker/.env jobsiteos-worker
```

#### Triggering the jobs

```bash
S=$WORKER_SECRET; W=http://localhost:8080

curl -s $W/health                                                     # 200 / 503, no auth

curl -s -X POST $W/jobs/receita   -H "authorization: Bearer $S" \
     -H 'content-type: application/json' -d '{}'                      # 202 { ingestao_id }
curl -s -X POST $W/jobs/cno       -H "authorization: Bearer $S" \
     -H 'content-type: application/json' -d '{}'                      # 202 { ingestao_id }

curl -s -X POST $W/jobs/metricas       -H "authorization: Bearer $S"  # 202 { job_id }  SPE → grupos → métricas
curl -s -X POST $W/jobs/reclassificar  -H "authorization: Bearer $S" \
     -H 'content-type: application/json' -d '{}'                      # 202 { job_id }

curl -s $W/jobs/<job_id> -H "authorization: Bearer $S"                # status of a metricas/reclassificar run
```

`/jobs/reclassificar` accepts `{"camada":"sam"}`, but **always recomputes all three**: a row gets the
*highest* layer whose rule matches, so touching SAM can push a company into SOM or out of it.
"Reclassify only SAM" is not a well-defined operation. Ingestion jobs are **single-flight** per kind —
a second concurrent Receita run gets a `409`.

#### `--sample`: the only way to exercise the pipeline without downloading gigabytes

```bash
pnpm --filter @jobsiteos/worker sample     # or: POST /jobs/{receita,cno} with {"sample": true}
```

12 fixture rows in the **real Receita layout** (`;`-separated, latin-1, `20180131` dates, `1500000,00`
decimals), encoded and **zipped at runtime**, so the code path is identical to the monthly run — unzip →
latin-1 → csv-parse → filtro → `COPY` → upsert → SPE → grupos → métricas → reclassificação → promoção →
CNO. **Only the download is skipped.** It runs in ~10 seconds and lands
`universo 5 / tam 1 / sam 2 / som 4`, exercising every branch: the holding outside the CNAE cut that only
enters through the second sócio-PJ pass, an SPE, a company that reaches SOM *only* through an active CNO
obra, and a CNO obra whose responsible party is outside the universe (which must be discarded).

Point `DATABASE_URL` at a Supabase **branch**, not production, unless you mean it.

#### The manual fallback. It is never automatic.

The primary source is **always** the Receita. Each download gets **5 attempts with exponential backoff
spread over hours** (15min → 45min → 2h15 → 6h45): the Receita server is *slow*, not flaky, and retrying
every 5 seconds burns all five attempts in a minute and kills a run that would have worked at 3am. Each
attempt bumps `mercado_ingestoes.tentativa`, so the Ingestões page shows how hard the run had to fight.

When the attempts are exhausted:

1. the run is marked **`falhou`**, with the error on the row;
2. the event **`mercado.ingestao_falhou`** is emitted — with `payload.titulo` and `payload.url`, because
   it is a *system* event with no `empresa_id`, and without them the bell renders the literal string
   `Empresa — mercado.ingestao_falhou`;
3. **`notify()` alerts the admins** (bell + push), and the message carries the fallback instruction.

An admin then goes to **Mercado → Ingestões** and clicks **"Reexecutar com fallback"** (only enabled on
a failed run), which fires `POST /jobs/receita { "fallback": true }` and reads the mirror at
`RECEITA_FALLBACK_URL` instead. **A human decides this, every time.** Swapping the source of truth of the
whole market for a third-party copy is not a decision a retry loop gets to make.

#### Deploying to Railway

`apps/worker/railway.json` already declares it: `DOCKERFILE` builder, `apps/worker/Dockerfile`,
healthcheck on `/health`, restart on failure. Point Railway at the repo and set the env vars above. Two
things that are not optional:

1. **Build context = repo root** (see the Docker note). Railway builds from the repo, so this works out
   of the box — do not "optimize" it down to `apps/worker`.
2. **A volume mounted on `DOWNLOAD_DIR`** (the image defaults it to `/data/receita`). Without one, a
   container restart in hour three of a download starts from zero, and the `Range` resume has nothing to
   resume from. Give the container real RAM, too: the root-CNPJ `Set` for the construction cut is
   ~1.5M strings.

#### Known gaps (reality, not the spec)

- **The real download has never run.** The Receita file names, the `Range` resume and the multi-hour
  backoff exist in code and have never touched the live server. If the RFB renames its parts, the fix is
  `RECEITA_PARTES` plus the strings in `src/jobs/receita.ts`. The CNO is mapped by **header aliases**, not
  column position, so a renamed column degrades one field to `null` instead of shifting every field.
- **A failed run writes two bell rows.** Migration 0014 seeds `notificacao_regras` for
  `mercado.ingestao_falhou`, so the fan-out trigger already inserts a notification — and `notify()`
  (the only path that sends *push*) inserts another. The worker calls `notify()` **only on failure**;
  success relies on the trigger alone. The real fix belongs in the foundation (drop the seeded rule, or
  stop fanning out events the worker notifies itself).
- **The promotion threshold has two homes.** The worker obeys its env var `CAMADA_PROMOCAO`. The
  Pirâmide's "camada de promoção" card persists the admin's choice and pushes it on the reclassify call,
  but the worker currently ignores the body field. **Keep the env var in sync with the setting** until
  one of them wins.

## Antecipação

O **funil de notas fiscais** — onde o trabalho de mercado vira dinheiro. Notas detalhadas em
[`docs/antecipacao.md`](docs/antecipacao.md); o essencial:

### `faixa` is not `estagio_funil`

Same distinction as `camada` vs. `estagio`, same reason. **`faixa`** (`alta` | `boa` | `media` | `null`)
is **computed** by a versioned rule and only the reclassification job writes it. **`estagio_funil`**
(`a_prospectar` → … → `convertida` | `perdida` | `expirada`) moves only by **human action**, through
`app_mover_estagio_nf` — `notas_fiscais` has no UPDATE grant for `authenticated`, so "move a card
without recording the event" is not expressible, not merely discouraged.

Nobody moves a note between faixas. You change the rule, or the data changes. `faixa_motivo` always
says why a note is out: `regra`, `expirada`, `suprimido`, `fora_das_faixas`.

### The daily job is load-bearing

**Without it the funnel rots in two weeks.** The notes don't change — the calendar does. A note that
sat in faixa alta with 40 days of runway becomes, on its own, impossible to operate, and would stay at
the top of the Kanban sorted by an expected revenue that is also wrong (revenue depends on the term).

`/api/cron/antecipacao-diario` (05:00 UTC) runs, in this order — a dependency chain, not a preference:
expired suppressions → cadastral lookup → reclassify (+ expire) → regenerate the outbox.

### The sync is idempotent by `access_key`

`/api/cron/antecipacao-sync` every four hours (`30 9,13,17,21,1,5 * * *` UTC = 06:30/10:30/…/02:30 in
São Paulo). The window reaches back to the last successful run **minus** a 6h cushion, because the
upstream is late sometimes. Overlapping is safe precisely because processing upserts on `access_key`:
new note inserts, repeated note updates — and a cancellation or a `creditAnalysis` change arrive as an
UPDATE of the same row, which is exactly what we want. Runs are logged in `mercado_ingestoes` with
fonte `onepay_nf`, so the Ingestões screen and its re-run button work with no new code.

`raw_xml` is **always** stored — it is the seed of the future Pricing module. A parse failure logs and
carries on (`xml_parse_erro`); value and due date also come from the endpoint.

### The cadence generates; a person approves

Enabling a channel in `/comunicacao/disparos` does **not** enable sending. It enables *generation*: the
job writes the exact message that would go out, to the recipient it would pick, into `mensagens_outbox`
as `pendente_envio`. Transport shipped in Prompt 05A, but that row still sits there until someone
approves it in the Outbox (`app_aprovar_mensagem`) — only then does the sender job pick it up.
Validating the cadence before wiring the channels is the whole point: wiring first and checking later
is how a contact base gets burned. Grouping, recipient hierarchy, cooldown and account round-robin are
the Antecipação side; the transport is in `docs/comunicacao.md`.

Discards with reason `sem_contato` are not failures, they are input: each is a supplier in a faixa that
nobody can reach, and the list of them is exactly the filter for a Radar contacts batch.

### Suppression has a shelf life

One list (Radar's), now with `expira_em`. **Soft** (default 90 days) is "not now" and the daily job
lets it lapse; **eterna** (`null`) is LGPD and never expires. `estaSuprimido()` and the `notas_funil`
view apply the **same** validity predicate — if they disagreed, a supplier would vanish from the Kanban
and keep receiving messages, or the reverse.

## Cadastro de Fornecedores

Quem emite NF contra nossos sacados e **não está na plataforma** é demanda latente de antecipação.
Detalhes em [`docs/fornecedores.md`](docs/fornecedores.md); aqui o que decide dinheiro.

### A ordem da cascata é a ordem do custo, e ela foi medida

**528 de 688 (77%) têm telefone no bloco `<emit>` do XML da NF-e**; o cadastro da Receita tem telefone
para **75 (11%)**. O XML ganha por sete vezes e custa zero — está no nosso banco desde o Prompt 04.
Rodar qualquer provedor pago antes de esgotá-lo é pagar por 77% de informação que já temos.

Quem é CANDIDATO não é decidido aqui: vem da view `antecipacao_fornecedores_a_prospectar`, a mesma da
tela de fornecedores a prospectar. O que qualifica é o sacado ter **crédito aprovado** — não bastar
estar cadastrado foi medido na 0102 (70% da lista original eram notas contra empresas sem limite). A
única diferença entre as duas telas é o corte de volume (`corte_volume`, R$ 25 mil).

```
CAMADA 0+1 — automática, roda para TODOS, sem clique
  1. xml_nfe        zero      alta     emit/fone, emit/email, varredura de infCpl
  2. receita        zero      média    email_rfb, telefone1_rfb, telefone2_rfb
  3. contatos_base  zero      média    o que já temos, da ficha ou do mesmo domínio
  4. site_empresa   zero      média    /contato, /fale-conosco, rodapé
  5. google_places  R$ 0,18   alta*    *se o endereço bater com o cadastral

CAMADA 2+4 — UM CLIQUE do originador, pago, com o custo na tela antes de perguntar
  6. novavida       R$ 0,35   média    sócios (em PME, o sócio É quem decide)
  7. apollo         R$ 1,20   média    só com domínio E porte ≥ mínimo
  8. claude_busca   R$ 0,10   média    site, Instagram/Facebook, Maps, sindicatos

CAMADA 3 — botão SEPARADO: pedir apresentação ao sacado (texto copiável, envio é 05)
```

### Automático vs. pago: dois orçamentos que nunca se somam

- **`orcamento_automatico_mensal`** paga o que roda sem clique — hoje, só o Google Places na varredura
  noturna. Ninguém autorizou individualmente essas consultas, então elas **não podem** sair do teto de
  ninguém.
- **`teto_mensal_por_originador`** paga o clique. Ele é a **autorização**: dentro dele o originador
  aciona sozinho. Estourou, precisa de liberação do gestor.

Somar os dois faria a varredura noturna comer o saldo de quem não pediu nada — e essa pessoa
descobriria no dia em que precisasse clicar.

**Estourar o orçamento automático não para o job**: só o item pago é pulado. As quatro etapas grátis
continuam rodando, porque são elas que trazem os 77%.

O custo mostrado no botão é o **teto**. Com `parar_ao_encontrar_alta` (default ligado) a cascata para na
primeira fonte de confiança alta e a fatura sai menor. Prometer o teto e cobrar menos é a única direção
aceitável do erro.

### Confiança é procedência, não qualidade

- **alta** — campo estruturado declarado pela própria empresa, **com data**: o `<fone>` de uma NF-e
  emitida na semana passada, um `wa.me` publicado no próprio site, uma ficha do Places cujo endereço
  bate com o cadastral.
- **média** — é da empresa, mas sem data ou sem estrutura: o telefone que o contador cadastrou na
  abertura, um e-mail no texto livre da nota, o celular de um sócio.
- **baixa** — procedência fraca, ou reprovado na validação.

"Alta" declarada por um modelo vira **média** na gravação: leitura de página web não alcança campo
estruturado. E **contato do Claude sem URL de origem é descartado** — um telefone sem procedência é
indistinguível de um inventado, e a evidência não é auditoria, é a prova de que a busca aconteceu.

**Evidência aparece em toda linha.** "Achado no `emit` da NF 12345 de agosto" e "achado numa página do
Google" pedem primeiras frases diferentes, e é a primeira frase que decide se a ligação continua.

**Contato inválido é rebaixado, nunca apagado.** A linha ruim é a evidência de que a fonte entrega lixo,
e é ela que justifica desligar um provedor no painel de eficácia (§6). Apagar faria um provedor com 5%
de validade sumir do relatório parecendo limpo.

### Credenciais

`NOVAVIDA_USUARIO`, `NOVAVIDA_SENHA`, `NOVAVIDA_CLIENTE` e `GOOGLE_PLACES_API_KEY` vivem **só em env do
worker**. Nunca em `fornecedores_config` — ela é lida por `authenticated` para o card mostrar o custo do
clique, e uma credencial ali seria distribuída a todo mundo com o módulo. O token da Nova Vida fica em
`integracao_tokens`, com RLS sem policy **e** `ALL` revogado de `anon`/`authenticated`.

## Jurídico

O último elo do funil: quando o dinheiro não volta, é aqui que ele é perseguido. Detalhes
em [`docs/juridico.md`](docs/juridico.md); aqui o que decide comportamento.

### `status_predito` não é `situacao_interna`

Mesma família de distinção de `camada` vs. `estagio` e `faixa` vs. `estagio_funil`.
**`status_predito`** (`ATIVO` | `INATIVO`) é a leitura do **Escavador** sobre o andamento no
tribunal; **`situacao_interna`** (`em_andamento` → … → `encerrado`) é onde **nós** colocamos
o processo. As duas discordam com frequência, e a discordância É a informação: `INATIVO` no
tribunal com `em_andamento` aqui é um processo que parou e ninguém viu.

Nada vindo do Escavador é escrito por uma pessoa — capa, movimentações e envolvidos são do
worker, com service role. O que se escreve pela tela é a gestão, as operações cobradas, os
custos, as recuperações, os prazos e o parecer.

### A fase só anda para a frente

`fase_atual` é a fase **mais avançada já detectada**, não a última. Uma juntada
classificada como instrução chegando depois da penhora é descartada do cronograma — sem
isso, o relógio de cada fase reiniciaria a cada vaivém e apagaria a lentidão que o
cronograma existe para mostrar.

O classificador é **determinístico** (palavra-chave com exceções, régua editável em
`juridico_config.classificador`). Um modelo que acerta 90% produz trinta cronogramas
errados por rodada numa carteira de trezentos processos, e ninguém sabe *quais*. Aqui o
erro é auditável: `termo_detectado` diz na tela qual expressão casou.

Corrigir uma regra **não** reclassifica o passado: é um botão separado, porque a varredura
move a fase de centenas de processos e mover a fase dispara alerta e notificação.

### Dois níveis de sincronização, e o caro nasce desligado

Ler a base do Escavador é barato e é o padrão. Pedir ao robô que vá ao **site do tribunal**
(`solicitar-atualizacao`) custa crédito **por processo, por rodada** — com 300 processos e
5 dias por semana, 1.500 chamadas pagas por semana. A tela escreve essa conta ao lado do
interruptor.

A **agenda** (dias da semana, hora, escopo) vive em `juridico_config` e é conferida DENTRO
do job, não no `vercel.json`: o cron dispara todo dia e o job decide se hoje é dia. E o dia
da semana é o de **São Paulo** — em UTC, uma rodada das 7h de segunda cairia num domingo, e
o job simplesmente não rodaria nas segundas, em silêncio.

### O callback só grava, e a idempotência é a chave primária

`POST /api/webhooks/escavador` (web) e `POST /webhooks/escavador` (worker) fazem a mesma
coisa e gravam na mesma tabela — a URL do painel deles pode apontar para qualquer uma. Elas
validam o token, inserem em `juridico_callbacks` (`uuid` é PK) e respondem. Quem processa é
o job: o Escavador reenvia até 11 vezes com backoff, e fazer o trabalho na rota levaria
dezenas de segundos.

`23505` responde **200** — é o reenvio normal. Falha ao gravar responde **500** de
propósito: aí nós *queremos* o reenvio, porque perder um `novo_processo` é perder uma ação
nova contra nós.

**Dois segredos diferentes.** `ESCAVADOR_TOKEN` é o Bearer da API e vive só no worker — é
ele que gasta dinheiro. `ESCAVADOR_CALLBACK_TOKEN` é o de entrada. Reusar o de saída como
segredo de entrada o publicaria num header que qualquer um pode nos fazer comparar.

### O custo só existe no nosso log

A API não tem extrato. Cada resposta traz `Creditos-Utilizados`, e `juridico_sync_log` é a
única fonte do gasto — sem ela, o custo aparece na fatura um mês depois. Por isso o cliente
do Escavador não usa o `requisitarJson` genérico: aquele devolve só o corpo, e aqui o header
é metade da informação.

### O cálculo vai para os autos

`principal → correção → juros → multa → honorários → custas`, nesta ordem: juros sobre o
**corrigido**, multa sobre o corrigido sem os juros, honorários sobre o subtotal e **nunca**
sobre as custas (reembolso não é proveito econômico).

Três coisas que o total esconde: a **mora é fracionada** (45 dias são 1,5 mês, não 1); um
**mês sem índice não vira zero** — ele não corrige e vai para a lista de faltantes, que
aparece em âmbar na tela, na memória e no CSV; e os **parâmetros são gravados junto do
resultado**, nunca referenciados, porque a taxa da casa muda e o cálculo de março continua
sendo o de março.

`processo_calculos` é append-only. Cada geração é uma linha nova — a memória de março é a
que sustenta a petição de março, e é a que a parte contrária está atacando.

### O parecer não é peça, e o dossiê é que garante isso

`AVISO_PARECER` aparece **acima** do texto na web, no celular e nas tools. Mas o que
sustenta a restrição não é a instrução no prompt: é o dossiê fechado, montado campo a campo
no worker. "Use apenas os dados fornecidos" só vale porque o que não está lá não chega ao
modelo. `proximo_passo` sai por tool call, não por regex sobre markdown.

### Processo nosso ativo é knockout de crédito

`empresas.tem_processo_nosso_ativo` é cache mantido por **trigger** — não por job, porque a
pergunta é lida no instante em que alguém decide operar, e uma varredura noturna deixaria
24h concedendo limite a quem estamos executando.

No scorecard ele vem **antes** de `situacao_irregular`, e não por gravidade: é o único fato
da lista que **nós** produzimos. Situação cadastral vem da Receita, protesto de cartório,
negativa da seguradora. Uma execução ajuizada por nós é a casa afirmando, com assinatura de
advogado, que ele não pagou — não há chance de concessão a estimar.

O score é cache, então ele é reconciliado **na hora** (processo novo) e **diariamente** (no
job de alertas), porque marcar o processo como "ganho" na tela roda um RPC em SQL que não
tem como chamar o worker.

### Notificação de processo é POR LINHA, não por perfil

Movimentação relevante, fase lenta e prazo em D-3/D-1 vão para **o advogado daquele
processo**, com push, por `notify()` no worker. Uma regra de `notificacao_regras` mandaria
as trezentas movimentações relevantes do mês para todo o time, e o segundo dia disso é o dia
em que ninguém abre mais o sino.

Advogado **externo** não tem `usuario_id` — nesse caso o aviso vai para o perfil Jurídico +
Admin, que é quem fala com o escritório. Cair no silêncio seria pior: o processo com
advogado externo é justamente o que ninguém daqui olha todo dia.

### `processos` é lida por `empresas` também; o conteúdo não

A Company 360 mostra a seção Jurídico para quem trabalha a conta — saber que existe ação
contra o sacado muda a conversa de hoje. Movimentação e parecer, não: um é texto de tribunal
sobre o mérito, o outro é análise de risco da casa. E o link para `/juridico/<cnj>` só sai
para quem tem o módulo, porque um link que leva a `/sem-acesso` é pior que link nenhum.

### Saldo líquido

`recuperado − custos`. É o número que responde se a ação paga o próprio custo, e ele não
existe em nenhuma das duas somas isoladas — é assim que uma carteira de execuções
deficitárias passa despercebida com um "recuperado" bonito no topo.

## Comunicação

O cano, o ledger e o agente (Prompt 05A). Detalhes em [docs/comunicacao.md](docs/comunicacao.md).

### Uma conversa, uma thread — por pessoa, não por card

A mesma pessoa fala com o SDR, com o originador e com o closer. Se a thread morasse no
card, a segunda conversa começaria do zero: o vendedor abriria o card de vendas sem ver o
que o SDR combinou na semana passada.

A thread mora em `conversas`, chaveada por **(canal, identificador em forma canônica)**. Os
cards dos cinco funis apontam para ela — `comunicacoes.funil_card_id` diz de onde a mensagem
partiu, e isso é destaque na tela, nunca recorte do histórico.

### `comunicacoes` é o ledger canônico, e é a única fonte

Quatro lugares diziam "falamos com o fornecedor" antes deste módulo: o evento
`toque.manual`, a `mensagens_outbox`, o `pedidos_apresentacao` e — por interpretação de quem
lia — a `descoberta_execucoes`. Duas cópias divergentes pagam uma coisa e mostram outra.

Agora **todo módulo escreve comunicação aqui e só aqui**, e quem precisa saber o que foi
falado referencia uma linha em vez de copiar o texto. A `mensagens_outbox` virou fila pura,
o `pedidos_apresentacao` virou estado puro, e o clique em `wa.me` grava direto no ledger. A
regra não é uma convenção — são dois CHECKs:

```sql
-- mensagens_outbox
check (comunicacao_id is null or (corpo is null and assunto is null))
-- pedidos_apresentacao
check (comunicacao_id is null or mensagem is null)
```

Uma linha que aponta para o ledger não pode carregar a própria cópia do texto. É isso que
impede a outbox de voltar a ser histórico na primeira tela escrita com pressa.

### O portão: nada sai sem passar por ele

Humano ou IA, compositor, outbox ou agente. Duas metades, e a divisão não é arbitrária: o
que é **fato do banco** (supressão, base legal, cooldown) é checado na transação que
enfileira, porque recusar ali é a única forma de a pessoa ver o motivo; o que é **fato do
relógio e da conta** (janela, teto do número, warmup) é do worker, que é quem sabe quantas
mensagens aquele número já mandou hoje.

A função pura devolve a **primeira** recusa nesta ordem, da mais permanente para a mais
temporária:

```
kill switch → supressão → base legal → teto da thread → teto da conta → cooldown → janela
```

**Fora da janela é adiamento, não descarte.** Uma mensagem gerada às 22h não é errada, é
cedo demais: `agendada_para` é a terceira saída. Um humano pode furar a janela com
confirmação explícita — nunca a supressão.

### O agente é um decisor, e o espaço de ações é fechado

Ele não escolhe o que fazer no mundo: escolhe um item de uma lista de dez, definida no
playbook. Um agente com ferramentas abertas exige confiar no julgamento dele sobre o que é
possível; um com espaço fechado só exige confiar sobre qual das dez cabe agora — e a segunda
é auditável linha a linha em `agente_decisoes`.

`aguardar` é ação de primeira classe. Sem ela, um modelo perguntado "qual o próximo passo?"
sempre encontra um passo, e a cadência vira perseguição.

**O agente nunca envia: ele enfileira**, e a fila passa pelo portão. Aceitar uma sugestão na
tela também enfileira — o humano aprovou o texto, não a legalidade do disparo.

Falha do modelo, confiança baixa ou ação fora do playbook caem na cadência fixa (D0/D3/D7).
O ponto não é a cadência ser boa; é que uma conversa sem próximo passo simplesmente some.

### O filtro de ingestão do Gmail é obrigatório

Só entra no ledger e-mail cujo remetente/destinatário case com um contato conhecido ou com o
domínio de uma empresa da base. Nunca a caixa inteira, e domínio genérico (`gmail.com`)
nunca casa.

Não é economia: é a diferença entre um CRM e vigilância sobre o e-mail pessoal de quem
trabalha aqui. A regra está em `deveIngerir()`, é testada, e está escrita na tela de conexão
— a pessoa lê antes de autorizar.

### O painel de atividade recusa mostrar você para você

Ele é de gestores e de quem tem `vendedor_acessos`, e ninguém vê o próprio volume. Um painel
de volume que a pessoa acompanha sobre si vira meta, e a meta mais fácil de bater é mandar
mais mensagem — por isso, também, volume nunca aparece sozinho: taxa de resposta, reuniões
agendadas e NFs convertidas vêm na mesma linha.

A regra não cabe numa policy (ela não diz quais linhas alguém vê, diz quem pode perguntar),
então a view `atividade_comunicacao` **não tem grant** e o acesso é decidido dentro do RPC.

### Segredos

Tokens **sempre no Vault** — o de envio de cada número e o refresh de cada Gmail. O segredo
de cada webhook é **outro** segredo: reusar o de saída na entrada o publicaria num header que
qualquer um pode nos fazer comparar batendo na nossa URL, e o de saída é o que manda mensagem
pelo nosso número. Os dois falham fechados.

## Campanhas

Disparo em massa a partir de segmento, win-back e lotes operacionais (Prompt 05B). Detalhes em
[docs/campanhas.md](docs/campanhas.md); aqui o que muda o comportamento do resto da casa.

**Campanha não tem transporte próprio.** Ela materializa destinatários e empurra para
`mensagens_outbox` — a mesma fila do compositor, da régua e do Agente. Três consequências, e as
três são o motivo do desenho:

- **Um teto por número.** Com uma segunda fila, os dois remetentes contariam o mesmo número
  separadamente: cada um respeitando metade do limite, os dois juntos estourando. O warmup
  viraria ficção.
- **O individual tem prioridade**, e isso é um `ORDER BY campanha_id NULLS FIRST` — não um
  acordo entre dois processos. O vendedor que aperta enviar às 11h não fica atrás de duzentos
  disparos.
- **O portão roda no envio**, não só na simulação, porque o envio é o mesmo código de sempre.
  Quem virou suprimido no meio do caminho é barrado sem que campanha saiba que supressão existe.

**Resposta encerra a campanha**, e o gatilho é o LEDGER. Um trigger em `comunicacoes` marca o
destinatário como `respondida` e o Agente assume dali em diante. Estar no ledger e não no
webhook é deliberado: o Gmail precisaria da sua cópia da regra e o Resend do dele, e três
lugares para a mesma regra é a receita para um deles ficar desatualizado.

**A simulação é obrigatória e vence.** Sem dry-run não há aprovação (o RPC recusa), e qualquer
edição zera a simulação anterior — aprovar sobre um retrato antigo é aprovar outra campanha. O
público congela na materialização pelo mesmo motivo.

**Não existe tool de aprovar.** `campanhas.criar` cria sempre em RASCUNHO; `campanhas.pausar`
pausa. Aprovar é o passo que transforma um rascunho em mil mensagens saindo, e ele existe para
ter um dono humano com nome — `campanhas.aprovada_por` é uma coluna, não um log, e uma tool que
aprovasse tornaria essa coluna uma ficção.

**A atribuição do funil é por JANELA**: a empresa recebeu e depois avançou. Correlação temporal,
não prova de causa. Sem grupo de controle não dá para afirmar mais que isso, e a tela diz isso
em voz alta em vez de mostrar um número que parece maior do que é.

## API de Crédito (04n)

A plataforma de produção cria análises de crédito aqui e recebe de volta cada
mudança de estágio. O documento para o time deles é
[`docs/integracao-credito-plataforma-producao.md`](docs/integracao-credito-plataforma-producao.md).

### A chave é da INTEGRAÇÃO, não de um usuário

Quem chama é um sistema: não há sessão, perfil nem RLS que signifique algo para
ele. A autorização inteira é a chave e o escopo dela, conferidos em
`app/api/v1/_lib/api-key.ts` — o único lugar do caminho da API que decide quem
entra. A chave é guardada como SHA-256 e mostrada uma vez; não existe consulta que
a devolva, o que faz de "perdi a chave" uma rotação e não um chamado.

### Duas portas de idempotência

`Idempotency-Key` cobre o reenvio cego (timeout, retry de fila) e devolve a MESMA
resposta guardada — não um 409 que o cliente não sabe interpretar. `external_id`
cobre o reenvio consciente com outra chave. Juntas fecham o caso em que ninguém
sabe se a primeira chamada chegou.

### O payload de entrada é insumo, nunca decisão

Nada do que a produção manda define estágio, limite ou aprovação. A única coisa
que o corpo decide é se a análise nasce em `docs_recebidos` ou `docs_pendentes` —
e mesmo isso sai do checklist que o Crédito configurou, não de um campo do JSON.

### A emissão do webhook é da TABELA

O estágio muda por cinco caminhos (RPC do kanban, RPC de conclusão pela nossa
decisão, sync da Atradius, esta API, e a mão de um admin no SQL). Pendurar a emissão em cada um
garantiria esquecê-la no sexto, e um webhook que não sai é uma integração que
mente em silêncio. Por isso um gatilho em `analises_credito` enfileira, e o worker
entrega.

### Um construtor só para o payload

O mesmo objeto sai pelo webhook e pelo `GET /analises/{id}`. `montarPayloadCredito`
(em `core/src/server/credito-api.ts`) é o único lugar que o monta — inclusive para
o gatilho, que enfileira só uma semente e deixa o worker construir. Duas montagens
divergiriam na primeira mudança feita em só uma.

### Campo ausente vai como `null`, nunca omitido

O contrato promete forma estável. Um consumidor que faz `payload.credito.score`
não pode receber `undefined` no dia em que a empresa ainda não tinha score.

### O documento vive conosco

URL externa vira 404 no dia em que o outro lado faz uma limpeza — e o documento é
a base de uma decisão de crédito, que uma auditoria vai querer ver muito depois.
Quando a produção manda `url`, o worker baixa e guarda no bucket privado; a
requisição não espera por isso, para não ficar refém do servidor deles.

## Precificação e condições comerciais (04o)

Aprovada a análise, alguém do Crédito define por QUANTO aquele sacado opera:
limite, validade, juros do D0 e do D1, TAC, comissão e acessórios. Publicar essas
condições **muda a natureza do webhook do 04n**: o bloco
`condicoes_comerciais.payload_producao` não é relatório, é o corpo de um
`POST /api/backoffice/credit-analyses` que a produção repassa sem transformação.

### A validação é local porque o erro é caro do outro lado

O contrato deles é validado por Zod, lá. Se a checagem existisse só lá, uma
condição malformada sairia daqui como "publicada", falharia na entrega, e o
analista descobriria pelo log do webhook — horas depois, sem saber qual campo.
`validarCondicoes` (`core/src/credito/precificacao.ts`) é o espelho do Zod deles e
roda em três lugares pela mesma razão: no formulário a cada tecla, de novo na
action (uma action é chamável sem passar pelo botão) e mais uma vez como CHECK no
banco, que torna a incoerência inexprimível.

Falhou, **não sai webhook** — mas a tentativa é gravada como `falha_validacao`,
com a mensagem exata. É ela que responde, três dias depois, por que a produção
nunca recebeu aquelas condições.

### `fee_min` não é piso de segurança

É a **TAC efetiva das notas pequenas**. A tarifa cresce proporcionalmente ao valor
da nota até o limiar (R$ 10.000 por padrão), onde atinge `fee` e para:

```
TAC = fee_min + (fee − fee_min) × min(valor_nf / limiar, 1)
```

Com `fee = 300` e `fee_min = 150`, uma NF de R$ 1.000 paga **R$ 165**. Lido como
piso, pagaria R$ 300 — 30% do valor dela em tarifa. É a diferença entre uma tabela
cara e uma tabela predatória, e é por isso que a conta mora num lugar só
(`calcularTac`), com teste, e a tela tem um **simulador** de R$ 1k / 5k / 10k / 50k
mostrando a taxa efetiva combinada. A tarifa é regressiva: 19,4% na nota de mil
contra 3,5% na de cinquenta mil, na MESMA tabela. Sem o simulador, ninguém vê isso
olhando "2,9% ao mês + R$ 300".

### D0 é o produto caro — o exemplo do contrato deles está invertido

`monthly_rate_d0 > monthly_rate_d1` e `fee_d0 > fee_d1`, sempre. O exemplo do
contrato de produção traz os dois ao contrário; o 04o §3 manda ignorar o exemplo e
seguir a regra, e é a regra que está no core, no CHECK do banco e na documentação
que o time deles lê. Mexer no D0 na tela **rederiva** o D1 e as duas TACs mínimas
pelas regras da matriz — sem isso, baixar o D0 produziria uma incoerência que o
próprio usuário não provocou.

### A matriz é versionada, e a sugestão sempre diz de onde veio

`precificacao_matriz` segue o padrão de `scorecard_versoes` e `analise_parametros`:
versão nova a cada mudança, nunca update. A condição publicada grava a versão que a
sugeriu, então trocar a matriz muda o que será sugerido daqui para frente — nunca o
preço que alguém já combinou com um cliente.

A sugestão vem com a explicação junto (célula da matriz, faturamento, faixa de
score, cobertura, protesto, prazo e ticket médios, e cada ajuste com seu sinal). Um
preço sem procedência chega ao analista com a autoridade de um dado, e é ele quem
vai defendê-lo num comitê.

Os ajustes movem **dentro** da faixa global. Sair dela é decisão do analista — ele
conhece o caso, a matriz não —, mas exige **justificativa escrita**, que fica em
`ajustes` junto do que ele mudou campo a campo.

### A prévia do editor é sobre a carteira real, não sobre uma empresa fictícia

O editor de parâmetros do 04j usa uma empresa inventada, e com razão: lá se ajustam
fórmulas de balanço. Aqui a pergunta é outra — mexer numa célula muda o preço de um
SEGMENTO da carteira, e só a carteira responde "quantos clientes isso atinge, e
quanto". Uma empresa fictícia diria o efeito numa célula e calaria sobre as outras
vinte e quatro. `precificacao_amostra` devolve o CONTEXTO das análises aprovadas do
período, e a tela roda o mesmo `sugerirCondicoes` do formulário sobre ele.

### Uma vigente por análise, garantida por índice

Nova versão entra como `publicada` e a anterior vira `substituida`. Um índice
parcial único garante que a aposentadoria aconteceu: sem ele, um caminho novo que
esquecesse o UPDATE deixaria duas condições "vigentes", e o `GET` escolheria uma
por ordenação — a pior forma possível de decidir por quanto o cliente opera.

### Onde está o quê

- **Banco**: migração `0185` (`condicoes_comerciais`, `precificacao_matriz` com a
  semente v1, RPCs `app_salvar_condicoes` / `app_publicar_condicoes` /
  `app_salvar_matriz_precificacao` / `app_ativar_matriz_precificacao`, e as leituras
  `condicoes_painel` e `precificacao_amostra`).
- **Core**: `credito/precificacao.ts` (matriz, motor, TAC, validador, builder do
  `payload_producao`), com 32 testes. O bloco novo entra no `PayloadCredito` do
  04n, montado pelo MESMO `montarPayloadCredito`.
- **Web**: aba "Condições comerciais" em `/credito/analises/[id]` (só em análise
  aprovada) e `/credito/precificacao` (webOnly).
- **Mobile**: leitura das condições e do simulador. Publicar e editar são webOnly —
  decisão de preço merece tela grande.
- **Worker**: nada novo. A publicação enfileira em `webhook_entregas` e a fila do
  04n entrega.

## Reportar Bugs & Melhorias

Um botão ao lado do sino, em toda a aplicação. Detalhes em [`docs/reports.md`](docs/reports.md);
aqui o que muda o comportamento.

### Não é um módulo, e é por isso que funciona

Reportar não está no registry e não tem guard de módulo: a permissão de escrita é
`app_usuario_ativo()`. Um perfil sem módulo nenhum liberado é justamente o perfil com mais motivo
para dizer que a tela está quebrada. **Ler** é o contrário — `reports_select` entrega ao autor apenas
as linhas dele, e ao admin todas.

### Fluxos de status, por tipo

```
bug        aberto → em_analise → em_correcao → resolvido | nao_procede | duplicado
melhoria   aberto → em_analise → planejado → em_desenvolvimento → entregue | nao_planejado | duplicado
```

Um bug é **consertado**; uma melhoria é **planejada e entregue**. O CHECK `reports_status_do_tipo`
é cruzado — o status tem de pertencer à esteira do tipo —, e o seletor do admin só oferece a esteira
daquele report. `duplicado` exige apontar o original, nos dois sentidos: o CHECK amarra os dois lados.

A mesma régua está em `packages/core/src/reports/schemas.ts`, e um teste compara as duas listas. Se
divergirem, quem descobre é o usuário, no meio de um clique.

### Quem é notificado quando

| evento | quem | push? |
| --- | --- | --- |
| `report.criado` | perfis com o módulo `admin` (sino) | não |
| `report.status_alterado` | o autor | **sim** |
| `report.comentario` público | o autor (ou os admins, se o autor respondeu) | **sim** |
| comentário **interno** | ninguém | — |
| `beta.alterado` | perfis com o módulo `admin` | não |

Um caminho por evento (regra da migração `0016`): `report.criado` e `beta.alterado` saem do trigger
de `empresa_eventos` + `notificacao_regras`; os que precisam de **push** saem de `notificar()` na
server action, porque o trigger só escreve o sino. Salvar prioridade **não** notifica — só mudança de
status. Ninguém é notificado da própria ação.

O evento `report.criado` **não carrega o título**: `empresa_eventos` é legível por quem tem o módulo
`empresas`, e copiar o título ali publicaria para a empresa inteira o texto que a policy restringiu.

### Como ligar o modo beta

**Admin → Configurações → Modo beta**: interruptor, texto (até 200 caracteres), salvar. A tarja
aparece no topo de todas as telas — web e celular — e reflete em **todas as sessões abertas, sem
novo login**: `app_config` está na publicação `supabase_realtime` desde a `0141`.

Sem botão de fechar, de propósito: é o estado da plataforma, não uma notificação. Ligar sem texto é
recusado — uma tarja âmbar vazia é pior que tarja nenhuma.

**`app_config` passa a ser lida pela empresa inteira e por Realtime.** Nada de credencial, chave ou
segredo entra ali — mesma régua de `fornecedores_config`.

### O anexo é um print de dentro do sistema

Bucket **privado**, 5 MB, só imagem, com limite e mime-types no bucket (uma checagem em JavaScript é
uma sugestão). Caminho `{usuario_id}/{arquivo}`, que é a âncora da policy — no upload o report ainda
não existe para servir de chave. Leitura só por URL assinada de 5 minutos.

## Conventions

- All user-facing text is **Brazilian Portuguese**. Code, comments and identifiers are **English**.
- **`erp_mrr` is not our revenue.** It is what the company pays for the ERP it uses **today**
  (`erp_atual`) — competitive intelligence. It coincides with ONE OS revenue only when
  `erp_atual = 'brik'`. Every label says **"MRR do ERP"**, never "MRR Brik" and never a bare "MRR".
  (Prompt 01 defined it wrongly; migration `0011` corrects it with a `comment on column`.)
- Server Actions for mutations. API routes only for streaming (AI), webhooks and cron.
- `/api/*` **is the mobile backend** — factor logic into `packages/core` so web actions and mobile
  endpoints share one implementation.
- TypeScript strict everywhere. No `any` in app code.
- zod validates every input, and the schemas live in `packages/core` so both platforms share them.
- Every feature ships on **web and mobile**. If a spec is silent about mobile, build the closest
  idiomatic RN equivalent — never skip it.
