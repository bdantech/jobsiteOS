# JOBSITEOS — Internal Operations Platform for ONE OS
## Claude Code Prompt 01: Foundation & Shell (Web + Mobile)

> This is the first of a series of prompts. This prompt builds the **foundation and shell** of the application on BOTH platforms (web and mobile). Business modules (Mercado, Radar, Cadências, WhatsApp Hub, Carteira, Cobrança, Jurídico) will be specified and built in subsequent prompts. Build the foundation so that modules plug in with minimal friction on both platforms.

---

## 0. Environment prerequisites (already done — assume all of this is in place)

The operator has already completed the following before running this prompt:

1. **Dedicated Supabase project** created for JobsiteOS.
2. **Supabase MCP connected and authenticated**, scoped to this project (`claude mcp add --transport http supabase "https://mcp.supabase.com/mcp?project_ref=..."` + OAuth via `/mcp`). Use the MCP tools as the primary way to work with the database: apply migrations with version tracking, execute SQL, inspect schema, generate TypeScript types, and read logs for debugging. Still write every migration as a numbered `.sql` file in `/supabase/migrations` (the repo is the source of truth) and then apply it via MCP.
3. **`.env.local` exists** at `apps/web` with: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `SEED_ADMIN_EMAIL`. Read variable NAMES from it if needed, but NEVER print, log, or commit the values — especially the service role key. Generate VAPID keys and `CRON_SECRET` yourself and append them to `.env.local` and `.env.example`.
4. Mobile env (`apps/mobile/.env`): `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_BASE_URL`. Only the anon key ever ships to the mobile app — the service role key must never appear outside server-side code on the web app.

If anything from this list is missing, stop and ask the operator instead of improvising credentials.

## 1. Context

ONE OS is a Brazilian construction fintech. Products: **Onepay** (receivables anticipation / risco sacado, ~R$50MM portfolio) and **Brik** (ERP for subcontractors). JobsiteOS is the **internal operations platform** used by ONE OS employees to manage the entire company lifecycle: TAM mapping → lead enrichment → outbound sequences → WhatsApp sales → credit portfolio monitoring → collections → litigation.

Core architectural principle: **one company (CNPJ), many lenses.** A single `empresas` entity is the source of truth. Every module reads and writes state on top of it. Nothing duplicates company records.

## 2. Stack (non-negotiable)

**Monorepo**: Turborepo + pnpm workspaces.

```
/apps/web         → Next.js 15 (App Router, TS, RSC by default), deployed on Vercel
/apps/mobile      → Expo (React Native, Expo Router, EAS build), iOS + Android
/packages/core    → SHARED: Tool Registry, zod schemas, Supabase generated types,
                    AI tool definitions, domain helpers, constants
/supabase         → migrations (numbered SQL), edge functions
```

- **Supabase**: Postgres (RLS on everything), Auth (email + password), Storage, Realtime
- **Web UI**: shadcn/ui, zinc neutral palette, primary/accent `#1a7a4a` (ONE OS green), dark/light via `next-themes` (default: system)
- **Mobile UI**: NativeWind v4 + react-native-reusables (shadcn conventions ported to RN), same zinc tokens and `#1a7a4a` accent, dark/light following system with manual override
- **AI Bar**: Anthropic API (`claude-sonnet-4-6`), streaming, tool calling — one server implementation consumed by both platforms
- **Email**: Resend (temp passwords, digests)
- **Push**: Web Push (VAPID + service worker) on web; **Expo Notifications** (Expo push tokens) on mobile — unified behind one `notify()` helper
- **State**: Zustand (client/UI state), TanStack Query (server state on both platforms), zod for ALL input validation (schemas live in `packages/core`, shared)
- **Cron**: Vercel Cron hitting `/api/cron/*` (secured with `CRON_SECRET`) — plumbing only for now

> **Rule for this and all future prompts**: every feature ships on web AND mobile. When a pattern doesn't translate (e.g. browser tabs), this prompt defines the mobile equivalent explicitly. If a future spec is silent about mobile, implement the closest idiomatic RN equivalent — never skip mobile.

## 3. Conventions

- Server Actions (web) for mutations; API routes only for streaming (AI), webhooks, and cron. Mobile calls the same logic via Next.js API routes (`/api/*` is the mobile backend) — factor mutation logic into `packages/core` + thin route handlers so web actions and mobile endpoints share one implementation.
- Every mutation goes through a **write helper** that validates (zod), writes, optionally emits an `empresa_eventos` row, and always writes `audit_log` — one transaction.
- All UI text in **Brazilian Portuguese**. Code, comments, identifiers in English.
- TypeScript strict everywhere; no `any` in app code.

## 4. Auth & user management

- Login: email + password only. No self-signup, no OAuth. Same flow on both platforms.
- **Admin creates users** inside the app (Admin module, web): generates a strong temporary password, creates the user via Supabase Admin API (service role, server-side only), sets `must_change_password = true`, emails the temp password via Resend.
- Guards: unauthenticated → login; `must_change_password` → forced change-password screen before anything else (web middleware; mobile root layout gate).
- `/settings` (web) and Settings screen (mobile): change password, theme, push opt-in, notification preferences.
- Admin can deactivate users (`ativo = false` blocks login, never delete).
- Mobile: persist session with Supabase + SecureStore adapter.

## 5. RBAC + Tool Registry (the core abstraction)

One registry — living in `packages/core` — drives four things: **web navigation, mobile navigation, permissions, and AI capabilities.**

```ts
// packages/core/registry/types.ts
export interface ModuleTool {
  id: string;              // e.g. "empresas.search"
  name: string;            // human label (pt-BR)
  description: string;     // used as the Anthropic tool description
  inputSchema: z.ZodType;  // converted to JSON Schema for Anthropic
  execute: (input, ctx: { userId, supabase }) => Promise<unknown>; // server-only
  mutates: boolean;        // if true, AI must get user confirmation before executing
}

export interface AppModule {
  id: string;              // e.g. "empresas"
  name: string;            // "Empresas"
  icon: string;            // icon token resolved per platform (lucide web / lucide-react-native)
  route: string;           // web route; mobile maps it to its own navigator
  tools: ModuleTool[];
}
```

- Modules self-register in `packages/core/registry/index.ts`. For this phase register: `empresas` (with a functional `empresas.search` tool), `admin`, `notificacoes`.
- **Database**: `perfis`, `perfil_modulos` (profile → module id), `usuarios.perfil_id`. Admin UI (web) creates profiles and toggles module access with switches.
- Web sidebar and mobile bottom-tab/drawer render only granted modules. Route guards on both platforms block ungranted access. AI Bar receives only granted tools.
- Seed: profile `Admin` (all modules) + one admin user (`SEED_ADMIN_EMAIL`).

## 6. Data foundation (migrations to create now)

```sql
-- Companies: the single source of truth
create table empresas (
  id uuid primary key default gen_random_uuid(),
  cnpj text unique not null,
  razao_social text,
  nome_fantasia text,
  tipo text not null default 'construtora',  -- 'construtora' | 'fornecedor'
  uf text, municipio text,
  cnae_principal text,
  porte text,
  -- lifecycle: single canonical stage; modules refine with their own tables later
  estagio text not null default 'mercado',
    -- mercado | lead | prospect | cliente | ex_cliente
  tam_camada text,            -- TAM layer, definition comes in Mercado module
  -- ERP intelligence (Brik)
  erp_atual text,             -- which ERP the company uses today (competitive intel)
  erp_mrr numeric(12,2),      -- MRR paid to ONE OS for Brik (null = not a Brik customer)
                              -- ^ SUPERSEDED by Prompt 02 §2: erp_mrr is what the company pays for its CURRENT ERP (erp_atual) — competitive intel, NOT ONE OS revenue (see migration 0011).
  erp_canal_venda text,       -- channel that sold the ERP (e.g. 'inbound', 'outbound', 'parceiro', 'onepay-cross')
  criado_em timestamptz default now(),
  atualizado_em timestamptz default now()
);

-- Notes: multi-author, timestamped (shown in Company 360 timeline too)
create table empresa_notas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id) on delete cascade,
  autor_usuario_id uuid not null,
  conteudo text not null,
  criado_em timestamptz default now()
);

-- Event backbone: powers Company 360 timeline, AI context, notifications, audit trail
create table empresa_eventos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id),
  tipo text not null,        -- e.g. 'estagio.alterado', 'nota.criada', 'whatsapp.mensagem'
  payload jsonb not null default '{}',
  ator_usuario_id uuid,      -- null when system/cron generated
  criado_em timestamptz default now()
);
create index on empresa_eventos (empresa_id, criado_em desc);
create index on empresa_eventos (tipo, criado_em desc);

-- Contacts (people at companies)
create table contatos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id),
  nome text, cargo text,
  email text, telefone text, whatsapp text,
  origem text,               -- enrichment source
  criado_em timestamptz default now()
);

-- Users, profiles, RBAC
create table perfis (
  id uuid primary key default gen_random_uuid(),
  nome text unique not null,
  descricao text
);
create table perfil_modulos (
  perfil_id uuid references perfis(id) on delete cascade,
  modulo_id text not null,   -- matches AppModule.id in the registry
  primary key (perfil_id, modulo_id)
);
create table usuarios (
  id uuid primary key references auth.users(id),
  nome text not null,
  email text unique not null,
  perfil_id uuid references perfis(id),
  ativo boolean default true,
  must_change_password boolean default true,
  web_push_subscriptions jsonb default '[]',  -- VAPID subscriptions
  expo_push_tokens jsonb default '[]',        -- Expo push tokens (per device)
  prefs_notificacoes jsonb default '{}',
  criado_em timestamptz default now()
);

-- Notifications
create table notificacoes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references usuarios(id),
  titulo text not null,
  corpo text,
  url text,                  -- deep link (web route; mobile resolves via linking config)
  lida boolean default false,
  criado_em timestamptz default now()
);

-- Audit log (every mutation through the write helper lands here)
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid,
  acao text not null,
  entidade text, entidade_id text,
  payload jsonb,
  criado_em timestamptz default now()
);
```

## 7. Shell UX

### 7.1 Web layout
- Left sidebar (collapsible): registry-driven module list, notifications bell with unread badge, user menu (theme toggle, settings, logout).
- Top: **tab bar** + **AI bar trigger**.

### 7.2 Notion-style tabs (web only)
- Cmd/Ctrl+click on any internal link opens a new tab. Zustand store persisted to `localStorage` per user: `{ tabs: [{ id, title, route }], activeTabId }`, restored on load.
- Tab title syncs with page; ✕ or middle-click closes; drag to reorder (dnd-kit).
- Inactive tabs keep only their route and re-fetch on activation — do NOT keep multiple live React trees.

### 7.3 Mobile layout (the tabs equivalent)
- Bottom tab bar with the user's 4 most relevant granted modules + a "Mais" tab opening a full module grid (registry-driven).
- Stack navigation per module (Expo Router). Global elements: AI button (floating action button, bottom-right, above tab bar) and notifications bell in headers.
- Deep linking configured so notification `url`s open the right screen.

### 7.4 AI Bar (both platforms)
- Web: Cmd/Ctrl+K opens a command-palette-style floating panel. Mobile: FAB opens a full-screen chat sheet.
- Single backend: `/api/ai` (web app) streams from Anthropic; mobile consumes the same endpoint with streaming fetch.
- System prompt includes: user name, profile, current route/screen, and a compact catalog of the user's granted tools.
- **Tool calling**: convert granted `ModuleTool`s (zod → JSON Schema). Execute server-side with the user's Supabase context (RLS applies). Tools with `mutates: true` require explicit in-UI confirmation before execution ("A IA quer criar X — confirmar?") on both platforms.
- Day-one capabilities: answer questions over data (search tools), navigate ("abre a empresa X" → opens tab on web / pushes screen on mobile), create records via tools.
- Render tool activity inline ("🔎 buscando empresas…").

### 7.5 Notifications (both platforms)
- In-app: bell → panel/screen listing `notificacoes`, Supabase Realtime for live updates, mark as read.
- Push: web → VAPID service worker; mobile → Expo Notifications with token registration on login (store per device in `expo_push_tokens`). One server helper `notify(userIds, { titulo, corpo, url })` writes rows AND fans out to both push channels based on what each user has registered.
- **Notification rules scaffold**: table `notificacao_regras (tipo_evento, perfil_id | usuario_id)` — when an `empresa_eventos` row of that tipo is created, notify subscribers. Wire the trigger; rules get populated by future modules.

## 8. Deliverables of this phase

**Web**: login, forced change-password, settings, `/admin/usuarios` (create with temp password + email, deactivate, assign profile), `/admin/perfis` (create/edit, toggle modules), `/empresas` (searchable table + Company 360 detail page: fields incl. tipo/ERP data, notes section, event timeline; "nova empresa" form to test the plumbing end to end), shell with tabs + AI bar (functional `empresas.search`) + notifications with push.

**Mobile**: login, forced change-password, settings (password, theme, push opt-in), Empresas module (search list + Company 360 screen with notes + timeline), notifications screen with Expo push working, AI chat sheet consuming the same `/api/ai` with working tool calls, registry-driven bottom tabs.

Admin module can be web-only in this phase (mark it `webOnly: true` in the registry and handle that flag on mobile navigation).

## 9. Quality bar

- Loading, empty, and error states on every page/screen (skeletons).
- Web responsive (sidebar → drawer on small viewports) even though mobile app exists — people will open the web app on phones.
- `.env.example` per app documenting every variable: Supabase (URL, anon, service role), Anthropic key, Resend key, VAPID keys, `CRON_SECRET`, `SEED_ADMIN_EMAIL`; mobile: Supabase URL/anon, API base URL, EAS project id.
- README: monorepo setup, running migrations, seeding, deploying web to Vercel, EAS build/submit basics, generating VAPID keys, testing Expo push.
- Do not build business modules beyond the placeholders listed. Adding a module must equal: (1) migration, (2) module screens in both apps, (3) register in `packages/core/registry`. Prove it by keeping `empresas` fully registry-driven on both platforms.

## 10. Out of scope for this prompt (coming next, design for them)

- **Mercado**: TAM layers, ingestion of company universes, segmentation
- **Radar**: contact enrichment pipelines (Receita WS, Econodata, Apollo)
- **Cadências**: multi-channel touchpoint sequences (email/WhatsApp), enrollment, dormancy
- **WhatsApp Hub**: multi-account inbox, templates, semi-automated messaging
- **Carteira**: credit portfolio, periodic financial health checks (cron)
- **Cobrança**: late-payment playbook with staged escalation
- **Jurídico**: lawsuit tracking, linked to Cobrança escalation
