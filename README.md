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
apps/worker      Node/TypeScript container → Railway. The Mercado ingestion (Receita, CNO, derived jobs).
packages/core    SHARED: Tool Registry, zod schemas, generated Supabase types, write helpers, notify().
supabase/        Numbered SQL migrations. The repo is the source of truth for the schema.
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

### The filter engine: one tree, two compilers

`packages/core/src/mercado/filters.ts`. **One** JSON tree —
`{ operador: 'e' | 'ou', condicoes: [{ variavel, operador, valor }] }` — powers **three** features:
camada rules, Explorador filters, and segmentos. A `CATALOGO` whitelists the variables; anything else
fails zod validation before a compiler ever sees it.

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
