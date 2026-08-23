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

  // ─── Radar (Prompt 03): integrações externas ──────────────────────────────
  // Todas OPCIONAIS de propósito: sem o secret, o job falha limpo (registra
  // erro/sem_dados) em vez de derrubar o boot do worker. Popular no Railway
  // quando for usar. Nenhuma chamada paga roda sem aprovação de lote.
  APOLLO_API_KEY: z.string().optional(),
  APOLLO_WEBHOOK_SECRET: z.string().optional(),
  /** URL pública (com o secret) que o Apollo chama de volta com os telefones. */
  APOLLO_WEBHOOK_URL: z.string().url().optional(),
  DIRECTD_API_KEY: z.string().optional(),
  ONEPAY_BI_URL: z.string().url().optional(),
  ONEPAY_BI_TOKEN: z.string().optional(),

  // ─── Antecipação (Prompt 04): sync de notas fiscais ───────────────────────
  /**
   * OVERRIDE opcional do endpoint de NFs. Na prática não é preciso definir: é a
   * MESMA API e o MESMO token do sync de clientes, então o job cai em
   * ONEPAY_BI_URL + o caminho padrão. Defina isto só se o recurso de NFs viver em
   * outro caminho (aí passe a URL COMPLETA) ou em outro host.
   *
   * Duas variáveis com o mesmo valor não são redundância inofensiva: são a chance
   * de elas divergirem no dia em que o host mudar e alguém atualizar só uma.
   */
  ONEPAY_NF_URL: z.string().url().optional(),
  /** Idem: ausente, cai no ONEPAY_BI_TOKEN. É a mesma credencial. */
  ONEPAY_NF_TOKEN: z.string().optional(),
  /**
   * Mesmo desenho para o endpoint de antecipações (04e): ausente, o job usa
   * ONEPAY_BI_URL + `/api/v1/anticipations`. É a mesma API e o mesmo token do
   * sync de NFs.
   */
  ONEPAY_ANTECIPACOES_URL: z.string().url().optional(),
  /** Etapa 5 da cascata de domínio (busca web via Anthropic). Opcional. */
  ANTHROPIC_API_KEY: z.string().optional(),

  // ─── Crédito (Prompt 04d): seguradora ─────────────────────────────────────
  // Todas opcionais: sem elas a esteira funciona inteira até "enviada à seguradora",
  // e o envio explica que falta credencial em vez de falhar com erro de rede. É a
  // diferença entre "não configurado" e "quebrado", e ela importa na tela.
  //
  // ── DOIS CONJUNTOS, SEM HERANÇA ENTRE ELES ───────────────────────────────
  // Qual conjunto vale é decidido pela setting `ambiente` em `credito_config`
  // (/credito/config), não por env: alternar homologação↔produção é trabalho de quem
  // está integrando, e não pode exigir redeploy do worker.
  //
  // NÃO existe fallback de sandbox para produção — de propósito. Uma variável faltando
  // no conjunto de homologação tem de dar "credencial ausente", e nunca cair calada nas
  // credenciais de produção: isso transformaria um teste em pedido de cobertura real.
  //
  // A BASE URL não está aqui: ela vem do ambiente escolhido (AMBIENTES_SEGURADORA, no
  // core). Um override por env venceria a setting e a tela passaria a mentir sobre para
  // onde o worker bate.
  ATRADIUS_PROD_CLIENT_ID: z.string().optional(),
  ATRADIUS_PROD_CLIENT_SECRET: z.string().optional(),
  /** Chave da aplicação, emitida pelo portal de desenvolvedores da Atradius. */
  ATRADIUS_PROD_APP_KEY: z.string().optional(),
  /**
   * OVERRIDE da apólice. Normalmente NÃO precisa ser definida: o worker pergunta à API
   * qual é (`policy-management/v1/policies/details`) e usa a única vigente.
   *
   * Defina só quando a credencial alcançar MAIS DE UMA apólice vigente — aí a descoberta
   * para de propósito, porque escolher sozinho seria decidir sob qual contrato a cobertura
   * é pedida, e o pedido errado não dá erro: dá um limite sob uma apólice que a operação
   * não assumiu.
   */
  ATRADIUS_PROD_POLICY_ID: z.string().optional(),

  ATRADIUS_SANDBOX_CLIENT_ID: z.string().optional(),
  ATRADIUS_SANDBOX_CLIENT_SECRET: z.string().optional(),
  ATRADIUS_SANDBOX_APP_KEY: z.string().optional(),
  ATRADIUS_SANDBOX_POLICY_ID: z.string().optional(),

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
