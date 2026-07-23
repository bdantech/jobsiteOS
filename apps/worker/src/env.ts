import { z } from 'zod'

/**
 * Fail fast, at boot, with a readable list. A worker that starts without
 * DATABASE_URL only discovers it four hours into a download.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  NODE_ENV: z.string().default('development'),

  /** Bearer token on every route. Long enough that guessing is not a strategy. */
  WORKER_SECRET: z.string().min(24, 'WORKER_SECRET precisa de ao menos 24 caracteres.'),

  /**
   * DIRECT Postgres connection (port 5432), NOT the transaction pooler (6543):
   * the ingestion holds a session across COPY streams and TEMP staging tables,
   * and a transaction-pooled connection loses both between statements.
   */
  DATABASE_URL: z.string().url(),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  /**
   * A Receita migrou os dados abertos para um SHARE PÚBLICO do Nextcloud. Os arquivos
   * baixam de {BASE}/{mes}/{arquivo} via WebDAV, autenticados com o token do share como
   * usuário do Basic-auth (senha vazia). O caminho antigo (/dados/cnpj/dados_abertos_cnpj)
   * responde 404 hoje.
   */
  RECEITA_BASE_URL: z
    .string()
    .url()
    .default('https://arquivos.receitafederal.gov.br/public.php/webdav'),
  /**
   * O token do share público do Nextcloud, usado como usuário do Basic-auth. Vazio =
   * nenhum header de auth (para um espelho que sirva caminhos simples). Só é enviado a
   * URLs de /public.php/webdav, nunca ao fallback.
   */
  RECEITA_SHARE_TOKEN: z.string().default('YggdBLfdninEJX9'),
  /** Mirror. NEVER used automatically — only when a job is triggered with { fallback: true }. */
  RECEITA_FALLBACK_URL: z.string().url().default('https://dados-abertos-rf-cnpj.casadosdados.com.br'),
  /** Month folder, YYYY-MM. Defaults to the current month. */
  RECEITA_MES: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  /** How many zipped parts each of Empresas/Estabelecimentos/Socios is split into. */
  RECEITA_PARTES: z.coerce.number().int().min(1).max(20).default(10),

  /**
   * O CNO também migrou para o Nextcloud, num SHARE PRÓPRIO (o do CNPJ é outro). O
   * caminho direto antigo (/dados/cno/cno.zip) responde HTTP 500 hoje. Baixa do
   * WebDAV com CNO_SHARE_TOKEN como usuário do Basic-auth, igual ao CNPJ.
   */
  CNO_SOURCE_URL: z
    .string()
    .url()
    .default('https://arquivos.receitafederal.gov.br/public.php/webdav/Dados/Cadastros/CNO/cno.zip'),
  /** Token do share público do CNO (≠ do CNPJ). Só é enviado a URLs /public.php/webdav. */
  CNO_SHARE_TOKEN: z.string().default('gn672Ad4CF8N6TK'),

  /** Where downloads are cached. A resumed run reuses whatever is already here. */
  DOWNLOAD_DIR: z.string().default('/tmp/jobsiteos-worker'),

  /** Total attempts per download (1 initial + retries), spread over hours. */
  RETRY_TENTATIVAS: z.coerce.number().int().min(1).max(10).default(5),
  /** First backoff. Grows ×3: 15min → 45min → 2h15 → 6h45. The Receita server is slow, not flaky. */
  RETRY_BASE_MS: z.coerce.number().int().min(1).default(15 * 60 * 1000),
  RETRY_FATOR: z.coerce.number().min(1).default(3),

  // The promotion threshold is NOT here. It lives in app_config (migration 0016),
  // written by the Pirâmide and read by derivadas/promover.ts. It was an env var,
  // and that made the setting have two owners: an admin who chose "somente manual"
  // in the UI would still watch the next ingestion auto-promote at whatever this
  // said. The one the admin could see was the one that lost.

  /** notify() needs these for Web Push. Expo push needs no key. */
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
})

export type Env = z.infer<typeof envSchema>

function carregar(): Env {
  const r = envSchema.safeParse(process.env)
  if (!r.success) {
    const linhas = r.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    // Names only. A value is never printed: half of these are secrets.
    throw new Error(`Variáveis de ambiente inválidas:\n${linhas.join('\n')}`)
  }
  return r.data
}

export const env: Env = carregar()

/** Current month as the Receita names its folders (YYYY-MM). */
export function mesCorrente(): string {
  if (env.RECEITA_MES) return env.RECEITA_MES
  const hoje = new Date()
  return `${hoje.getUTCFullYear()}-${String(hoje.getUTCMonth() + 1).padStart(2, '0')}`
}
