/**
 * Creates the first admin user. Idempotent: run it as many times as you like.
 *
 *   pnpm seed          (from the repo root)
 *
 * It does NOT create the 'Admin' perfil — migration 0004 already did, because
 * perfis is plain data. It creates the auth.users row (only reachable through
 * the Admin API, which is why this is a script and not SQL) and the matching
 * public.usuarios row that links it to that perfil.
 *
 * The generated password is printed exactly once, to stdout, and never stored
 * anywhere. must_change_password=true forces a rotation on first login, so a
 * password that scrolls out of a terminal buffer is not a lost account.
 */
import { randomInt } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@jobsiteos/core'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(__dirname, '..')

/**
 * Minimal .env loader. tsx does not read .env.local on its own, and adding
 * dotenv just for this script is not worth a dependency. Real environment
 * variables always win, so CI can override the file.
 */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return

  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const eq = line.indexOf('=')
    if (eq === -1) continue

    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnvFile(resolve(APP_ROOT, '.env.local'))

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`✖ Variável de ambiente ausente: ${name}`)
    console.error('  Defina-a em apps/web/.env.local (veja .env.example).')
    process.exit(1)
  }
  return value
}

/**
 * Satisfies alterarSenhaSchema (>=12 chars, minúscula, maiúscula, número) BY
 * CONSTRUCTION — one of each class up front, the rest random, then shuffled with
 * a CSPRNG so the guaranteed characters do not sit in fixed positions.
 */
function generatePassword(): string {
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const digits = '23456789'
  const symbols = '!@#$%&*?'
  const all = lower + upper + digits + symbols

  const pick = (set: string): string => set[randomInt(set.length)]!

  const chars = [pick(lower), pick(upper), pick(digits), pick(symbols)]
  while (chars.length < 20) chars.push(pick(all))

  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    const a = chars[i]!
    const b = chars[j]!
    chars[i] = b
    chars[j] = a
  }

  return chars.join('')
}

async function main(): Promise<void> {
  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  const email = requireEnv('SEED_ADMIN_EMAIL').toLowerCase().trim()

  const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // ── 1. The Admin perfil (created by migration 0004) ────────────────────────
  const { data: perfil, error: perfilError } = await admin
    .from('perfis')
    .select('id, nome')
    .eq('nome', 'Admin')
    .maybeSingle()

  if (perfilError) {
    console.error(`✖ Falha ao consultar perfis: ${perfilError.message}`)
    process.exit(1)
  }
  if (!perfil) {
    console.error("✖ Perfil 'Admin' não encontrado.")
    console.error('  Rode as migrações primeiro: pnpm db:push')
    process.exit(1)
  }

  // ── 2. Already seeded? ────────────────────────────────────────────────────
  const { data: usuarioExistente, error: usuarioError } = await admin
    .from('usuarios')
    .select('id, email, perfil_id')
    .eq('email', email)
    .maybeSingle()

  if (usuarioError) {
    console.error(`✖ Falha ao consultar usuarios: ${usuarioError.message}`)
    process.exit(1)
  }

  if (usuarioExistente) {
    console.log(`✓ Usuário ${email} já existe. Nada a fazer.`)
    console.log('  Esqueceu a senha? Use "Esqueci minha senha" ou redefina pelo painel do Supabase.')
    process.exit(0)
  }

  // ── 3. Create the auth user ───────────────────────────────────────────────
  const senha = generatePassword()

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { nome: 'Admin' },
  })

  let authUserId = created?.user?.id ?? null
  let senhaFoiDefinida = true

  if (createError) {
    // Partial seed: the auth user exists but its usuarios row does not (e.g. a
    // previous run died between the two writes). Adopt it rather than failing —
    // the whole point of this script is to be re-runnable.
    const jaExiste =
      createError.status === 422 || /already|exists|registered/i.test(createError.message)

    if (!jaExiste) {
      console.error(`✖ Falha ao criar usuário de autenticação: ${createError.message}`)
      process.exit(1)
    }

    const existing = await findAuthUserByEmail(admin, email)
    if (!existing) {
      console.error(`✖ ${email} já existe em auth.users, mas não foi possível localizá-lo.`)
      process.exit(1)
    }

    authUserId = existing
    // We did not set this user's password, so we must not print the one we
    // generated: it is not the password that works.
    senhaFoiDefinida = false
    console.log(`ℹ Usuário de autenticação ${email} já existia. Vinculando ao perfil Admin…`)
  }

  if (!authUserId) {
    console.error('✖ Não foi possível obter o id do usuário de autenticação.')
    process.exit(1)
  }

  // ── 4. Link it to the Admin perfil ────────────────────────────────────────
  const { error: insertError } = await admin.from('usuarios').insert({
    id: authUserId,
    nome: 'Admin',
    email,
    perfil_id: perfil.id,
    ativo: true,
    must_change_password: true,
  })

  if (insertError) {
    console.error(`✖ Falha ao criar a linha em usuarios: ${insertError.message}`)

    // Don't leave an auth user with no usuarios row behind — that account can
    // log in but has no perfil, which getSessionContext() treats as logged out.
    // Only clean up what THIS run created.
    if (senhaFoiDefinida) {
      await admin.auth.admin.deleteUser(authUserId)
      console.error('  Usuário de autenticação removido (rollback).')
    }
    process.exit(1)
  }

  console.log('')
  console.log('✓ Admin criado com sucesso.')
  console.log('')
  console.log(`  E-mail: ${email}`)

  if (senhaFoiDefinida) {
    console.log(`  Senha:  ${senha}`)
    console.log('')
    console.log('  ⚠ Esta senha é exibida UMA ÚNICA VEZ e não fica salva em lugar nenhum.')
    console.log('    Copie-a agora. O primeiro login vai exigir a troca da senha.')
  } else {
    console.log('  Senha:  (inalterada — o usuário de autenticação já existia)')
  }
  console.log('')
}

/** The Admin API has no get-by-email, so page through until we find it. */
async function findAuthUserByEmail(
  admin: ReturnType<typeof createClient<Database>>,
  email: string,
): Promise<string | null> {
  const perPage = 200

  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) return null

    const match = data.users.find((u) => u.email?.toLowerCase() === email)
    if (match) return match.id

    if (data.users.length < perPage) return null
  }

  return null
}

main().catch((error: unknown) => {
  console.error(`✖ Erro inesperado: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
