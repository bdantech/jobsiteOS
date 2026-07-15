'use server'

import { randomInt } from 'node:crypto'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { Resend } from 'resend'
import { z } from 'zod'
import {
  MODULE_IDS,
  criarUsuarioSchema,
  definirAtivoUsuarioSchema,
  salvarPerfilSchema,
  BRAND_ACCENT,
} from '@jobsiteos/core'
import type { Json, Supabase } from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionContext, isAdmin, type SessionContext } from '@/lib/auth'

/**
 * Admin server actions.
 *
 * ─── WHICH CLIENT, AND WHY ──────────────────────────────────────────────────
 * Verified against the live database, not the migration files (they diverge):
 *
 *   usuarios  → SERVICE ROLE, unavoidably.
 *               • no INSERT policy for `authenticated` at all;
 *               • the live `usuarios_update_self` policy is `id = auth.uid()`
 *                 with NO admin branch, and the only UPDATE column grant is
 *                 `nome`. So an admin cannot change someone else's perfil_id or
 *                 ativo with their own client, by design.
 *               • auth.users rows only exist through the Admin API.
 *
 *   perfis, perfil_modulos → USER-SCOPED client.
 *               Their RLS policy is `ALL USING app_is_admin()` and
 *               `authenticated` holds SELECT/INSERT/UPDATE/DELETE. An admin can
 *               therefore do this under RLS, so we let the DATABASE re-check the
 *               authorization rather than switching it off. Service role here
 *               would buy nothing and remove a lock.
 *
 * Every action starts with requireAdmin(). For the usuarios actions that check
 * IS the authorization — the service role bypasses RLS entirely, so nothing
 * downstream will second-guess us. Do not reorder it, and do not pick up the
 * admin client before it has passed.
 */

// ─── Result envelope ────────────────────────────────────────────────────────

export type FieldErrors = Record<string, string[] | undefined>

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; message: string; fieldErrors?: FieldErrors }

function fail(message: string, fieldErrors?: FieldErrors): { ok: false; message: string; fieldErrors?: FieldErrors } {
  return { ok: false, message, fieldErrors }
}

const FORBIDDEN = 'Você não tem permissão para esta ação.'

/** Identity + admin check. Returns null when the caller is not an admin. */
async function requireAdmin(): Promise<SessionContext | null> {
  const context = await getSessionContext()
  if (!context || !isAdmin(context)) return null
  return context
}

function parse<T>(schema: z.ZodType<T>, input: unknown): { ok: true; data: T } | { ok: false; fieldErrors: FieldErrors } {
  const result = schema.safeParse(input)
  if (!result.success) return { ok: false, fieldErrors: result.error.flatten().fieldErrors }
  return { ok: true, data: result.data }
}

/**
 * Append-only audit trail. Written with the USER-SCOPED client on purpose: the
 * audit_log insert policy is `usuario_id = auth.uid()`, so the database itself
 * guarantees the row names the real actor and cannot be forged.
 *
 * Never fatal — the mutation it describes has already happened, and failing the
 * action here would tell the admin a change was rejected when it was not.
 * Payloads NEVER carry secrets (in particular: never the temporary password).
 */
async function auditar(
  supabase: Supabase,
  usuarioId: string,
  acao: string,
  entidade: string,
  entidadeId: string,
  payload: Json,
): Promise<void> {
  const { error } = await supabase.from('audit_log').insert({
    usuario_id: usuarioId,
    acao,
    entidade,
    entidade_id: entidadeId,
    payload,
  })
  if (error) console.error(`[admin] falha ao gravar audit_log (${acao}):`, error.message)
}

// ─── Lockout guards ─────────────────────────────────────────────────────────

/**
 * The perfis that still grant the 'admin' module. Everything that could remove
 * the last administrator from the system is checked against this.
 */
async function perfisComAdmin(supabase: Supabase): Promise<string[] | null> {
  const { data, error } = await supabase
    .from('perfil_modulos')
    .select('perfil_id')
    .eq('modulo_id', 'admin')

  if (error) return null
  return data.map((row) => row.perfil_id)
}

/**
 * Would this change leave the system with zero active administrators? Used by
 * both "deactivate user" and "change perfil" — the two ways to strip the last
 * admin of their powers.
 *
 * NOTE (TOCTOU): this is a check-then-act on the service role, so two admins
 * demoting each other in the same instant could in principle both pass. The
 * blast radius is a lockout recoverable with `pnpm seed` / the Supabase console,
 * and closing it properly needs a SECURITY DEFINER function (a migration, which
 * this agent does not own). Called out for the reviewer rather than hidden.
 */
async function ficariaSemAdmin(
  supabase: Supabase,
  usuarioAlvoId: string,
): Promise<boolean | null> {
  const perfisAdmin = await perfisComAdmin(supabase)
  if (perfisAdmin === null) return null
  if (perfisAdmin.length === 0) return false

  const { data, error } = await supabase
    .from('usuarios')
    .select('id')
    .eq('ativo', true)
    .in('perfil_id', perfisAdmin)

  if (error) return null

  const adminsAtivos = data.map((u) => u.id)
  // Only a problem if the target is currently one of the admins, and the only one.
  return adminsAtivos.includes(usuarioAlvoId) && adminsAtivos.length <= 1
}

// ─── Temporary password ─────────────────────────────────────────────────────

/**
 * Satisfies alterarSenhaSchema (>=12 chars, lower, upper, digit) BY CONSTRUCTION
 * — one of each class up front, the rest random, then shuffled with a CSPRNG so
 * the guaranteed characters do not sit in fixed positions. Visually ambiguous
 * characters (l/1/I, O/0) are excluded: this password gets read off a screen and
 * typed by hand.
 */
function gerarSenhaTemporaria(): string {
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

/** Origin of the current request, so the e-mail can link to this deployment. */
async function origemDaAplicacao(): Promise<string | null> {
  const h = await headers()
  const origin = h.get('origin')
  if (origin) return origin

  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (!host) return null

  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

interface EnvioEmail {
  nome: string
  email: string
  senha: string
  loginUrl: string | null
}

/**
 * Sends the temporary password. Returns a failure instead of throwing: a dead
 * Resend key must NOT cost us the user that was already created — the caller
 * falls back to showing the password on screen once.
 */
async function enviarEmailSenhaTemporaria(
  dados: EnvioEmail,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL

  if (!apiKey || !from) {
    return { ok: false, erro: 'Envio de e-mail não configurado (RESEND_API_KEY / RESEND_FROM_EMAIL).' }
  }

  const nome = escapeHtml(dados.nome)
  const senha = escapeHtml(dados.senha)
  const loginUrl = dados.loginUrl

  const botao = loginUrl
    ? `<p style="margin:32px 0;">
         <a href="${escapeHtml(loginUrl)}/login"
            style="background:${BRAND_ACCENT};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;display:inline-block;font-weight:600;">
           Acessar o JobsiteOS
         </a>
       </p>`
    : ''

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b;">
    <table role="presentation" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <tr><td>
        <h1 style="margin:0 0 24px;font-size:20px;color:${BRAND_ACCENT};">JobsiteOS</h1>
        <p style="margin:0 0 16px;font-size:16px;">Olá, ${nome}!</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
          Sua conta no <strong>JobsiteOS</strong>, a plataforma interna da ONE OS, foi criada.
          Use a senha temporária abaixo para entrar. Ela funciona apenas uma vez:
          <strong>no primeiro acesso você será obrigado a definir uma nova senha</strong>.
        </p>
        <p style="margin:0 0 8px;font-size:13px;color:#71717a;">Sua senha temporária:</p>
        <p style="margin:0 0 24px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:20px;font-weight:700;letter-spacing:1px;background:#f4f4f5;border:1px solid #e4e4e7;border-radius:8px;padding:16px;text-align:center;">
          ${senha}
        </p>
        ${botao}
        <p style="margin:24px 0 0;font-size:13px;color:#71717a;line-height:1.6;">
          Por segurança, não compartilhe esta senha com ninguém. Se você não esperava
          este e-mail, avise a equipe de administração.
        </p>
      </td></tr>
    </table>
  </body>
</html>`

  const text = [
    `Olá, ${dados.nome}!`,
    '',
    'Sua conta no JobsiteOS, a plataforma interna da ONE OS, foi criada.',
    'Use a senha temporária abaixo para entrar. No primeiro acesso você será',
    'obrigado a definir uma nova senha.',
    '',
    `Senha temporária: ${dados.senha}`,
    '',
    loginUrl ? `Acesse: ${loginUrl}/login` : '',
    '',
    'Por segurança, não compartilhe esta senha com ninguém.',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from,
      to: dados.email,
      subject: 'Seu acesso ao JobsiteOS',
      html,
      text,
    })

    if (error) return { ok: false, erro: error.message }
    return { ok: true }
  } catch (error: unknown) {
    return { ok: false, erro: error instanceof Error ? error.message : 'Falha desconhecida no envio.' }
  }
}

// ─── usuarios ───────────────────────────────────────────────────────────────

export interface CriarUsuarioResult {
  usuario_id: string
  nome: string
  email: string
  emailEnviado: boolean
  /**
   * ONLY populated when the e-mail failed. On the happy path the password is
   * never returned to the browser — it lives exclusively in the user's inbox.
   */
  senhaTemporaria?: string
  erroEmail?: string
}

export async function criarUsuarioAction(input: unknown): Promise<ActionResult<CriarUsuarioResult>> {
  const context = await requireAdmin()
  if (!context) return fail(FORBIDDEN)

  const parsed = parse(criarUsuarioSchema, input)
  if (!parsed.ok) return fail('Dados inválidos.', parsed.fieldErrors)

  const { nome, email, perfil_id } = parsed.data

  const supabase = await createClient()
  const admin = createAdminClient()

  // The perfil must exist. Read it under RLS (perfis is admin-gated) so a bad id
  // is a validation error, not a foreign-key explosion halfway through.
  const { data: perfil, error: perfilError } = await supabase
    .from('perfis')
    .select('id, nome')
    .eq('id', perfil_id)
    .maybeSingle()

  if (perfilError) return fail('Não foi possível validar o perfil selecionado.')
  if (!perfil) return fail('Dados inválidos.', { perfil_id: ['Perfil não encontrado.'] })

  // Friendly duplicate check. The unique index on usuarios.email is still the
  // real guarantee — this only produces a better message in the common case.
  const { data: existente } = await admin
    .from('usuarios')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (existente) {
    return fail('Dados inválidos.', { email: ['Já existe um usuário com este e-mail.'] })
  }

  const senha = gerarSenhaTemporaria()

  const { data: criado, error: authError } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { nome },
  })

  if (authError || !criado?.user) {
    const jaExiste =
      authError?.status === 422 || /already|exists|registered/i.test(authError?.message ?? '')

    if (jaExiste) {
      return fail('Dados inválidos.', {
        email: ['Este e-mail já está cadastrado na autenticação.'],
      })
    }
    return fail('Não foi possível criar o usuário de autenticação.')
  }

  const authUserId = criado.user.id

  const { error: insertError } = await admin.from('usuarios').insert({
    id: authUserId,
    nome,
    email,
    perfil_id,
    ativo: true,
    must_change_password: true,
  })

  if (insertError) {
    // Never leave an auth user with no usuarios row behind: it can authenticate
    // but getSessionContext() treats it as logged out, so it is an invisible
    // account that also squats the e-mail's unique index. Roll back what we made.
    await admin.auth.admin.deleteUser(authUserId)
    return fail('Não foi possível vincular o usuário ao perfil. Nenhum usuário foi criado.')
  }

  await auditar(supabase, context.user.id, 'usuario.criado', 'usuarios', authUserId, {
    nome,
    email,
    perfil_id,
    perfil_nome: perfil.nome,
  })

  const envio = await enviarEmailSenhaTemporaria({
    nome,
    email,
    senha,
    loginUrl: await origemDaAplicacao(),
  })

  revalidatePath('/admin/usuarios')

  if (!envio.ok) {
    // The user EXISTS. Hand the password back exactly once so the admin can
    // deliver it out of band — losing it here means the account is unusable.
    return {
      ok: true,
      data: {
        usuario_id: authUserId,
        nome,
        email,
        emailEnviado: false,
        senhaTemporaria: senha,
        erroEmail: envio.erro,
      },
    }
  }

  return {
    ok: true,
    data: { usuario_id: authUserId, nome, email, emailEnviado: true },
  }
}

export async function definirAtivoUsuarioAction(input: unknown): Promise<ActionResult> {
  const context = await requireAdmin()
  if (!context) return fail(FORBIDDEN)

  const parsed = parse(definirAtivoUsuarioSchema, input)
  if (!parsed.ok) return fail('Dados inválidos.', parsed.fieldErrors)

  const { usuario_id, ativo } = parsed.data

  // Deactivating yourself logs you out on the next request (getSessionContext
  // treats an inactive user as anonymous). Nothing good comes of allowing it.
  if (!ativo && usuario_id === context.user.id) {
    return fail('Você não pode desativar a própria conta.')
  }

  const supabase = await createClient()

  if (!ativo) {
    const semAdmin = await ficariaSemAdmin(supabase, usuario_id)
    if (semAdmin === null) return fail('Não foi possível verificar os administradores ativos.')
    if (semAdmin) {
      return fail(
        'Este é o único administrador ativo. Promova outro usuário antes de desativá-lo.',
      )
    }
  }

  const admin = createAdminClient()

  const { data: atualizado, error } = await admin
    .from('usuarios')
    .update({ ativo })
    .eq('id', usuario_id)
    .select('id, nome')
    .maybeSingle()

  if (error) return fail('Não foi possível atualizar o status do usuário.')
  if (!atualizado) return fail('Usuário não encontrado.')

  await auditar(
    supabase,
    context.user.id,
    ativo ? 'usuario.reativado' : 'usuario.desativado',
    'usuarios',
    usuario_id,
    { nome: atualizado.nome, ativo },
  )

  revalidatePath('/admin/usuarios')
  return { ok: true, data: undefined }
}

/** Core ships no schema for this one — it is defined here, next to its only use. */
const definirPerfilUsuarioSchema = z.object({
  usuario_id: z.string().uuid(),
  perfil_id: z.string().uuid('Selecione um perfil.'),
})

export async function definirPerfilUsuarioAction(input: unknown): Promise<ActionResult> {
  const context = await requireAdmin()
  if (!context) return fail(FORBIDDEN)

  const parsed = parse(definirPerfilUsuarioSchema, input)
  if (!parsed.ok) return fail('Dados inválidos.', parsed.fieldErrors)

  const { usuario_id, perfil_id } = parsed.data

  const supabase = await createClient()

  const { data: perfil, error: perfilError } = await supabase
    .from('perfis')
    .select('id, nome')
    .eq('id', perfil_id)
    .maybeSingle()

  if (perfilError) return fail('Não foi possível validar o perfil selecionado.')
  if (!perfil) return fail('Dados inválidos.', { perfil_id: ['Perfil não encontrado.'] })

  // Moving the last active admin onto a perfil without the 'admin' module is a
  // lockout by another name. Same guard as deactivation.
  const perfisAdmin = await perfisComAdmin(supabase)
  if (perfisAdmin === null) return fail('Não foi possível verificar os administradores ativos.')

  const novoPerfilEhAdmin = perfisAdmin.includes(perfil_id)

  if (!novoPerfilEhAdmin) {
    const semAdmin = await ficariaSemAdmin(supabase, usuario_id)
    if (semAdmin === null) return fail('Não foi possível verificar os administradores ativos.')
    if (semAdmin) {
      return fail(
        'Este é o único administrador ativo. Promova outro usuário antes de trocar o perfil deste.',
      )
    }
  }

  const admin = createAdminClient()

  const { data: atualizado, error } = await admin
    .from('usuarios')
    .update({ perfil_id })
    .eq('id', usuario_id)
    .select('id, nome')
    .maybeSingle()

  if (error) return fail('Não foi possível alterar o perfil do usuário.')
  if (!atualizado) return fail('Usuário não encontrado.')

  await auditar(supabase, context.user.id, 'usuario.perfil_alterado', 'usuarios', usuario_id, {
    nome: atualizado.nome,
    perfil_id,
    perfil_nome: perfil.nome,
  })

  revalidatePath('/admin/usuarios')
  return { ok: true, data: undefined }
}

// ─── perfis ─────────────────────────────────────────────────────────────────

export interface SalvarPerfilResult {
  perfil_id: string
}

export async function salvarPerfilAction(input: unknown): Promise<ActionResult<SalvarPerfilResult>> {
  const context = await requireAdmin()
  if (!context) return fail(FORBIDDEN)

  const parsed = parse(salvarPerfilSchema, input)
  if (!parsed.ok) return fail('Dados inválidos.', parsed.fieldErrors)

  const { id, nome, descricao, modulos } = parsed.data

  // The registry is the source of truth for what a module IS. An id that is not
  // in it would sit in perfil_modulos granting nothing and confusing every later
  // read, so reject it here rather than storing garbage.
  const desconhecidos = modulos.filter((m) => !MODULE_IDS.includes(m))
  if (desconhecidos.length > 0) {
    return fail('Dados inválidos.', {
      modulos: [`Módulo desconhecido: ${desconhecidos.join(', ')}.`],
    })
  }

  const novos = [...new Set(modulos)]
  const supabase = await createClient()

  const perfisAdmin = await perfisComAdmin(supabase)
  if (perfisAdmin === null) return fail('Não foi possível verificar os perfis de administração.')

  // THE LOCKOUT GUARD. Removing 'admin' from the last perfil that grants it
  // would leave nobody able to reach this screen ever again — recoverable only
  // with direct database access.
  if (id && perfisAdmin.includes(id) && !novos.includes('admin') && perfisAdmin.length <= 1) {
    return fail(
      'Este é o último perfil com acesso à Administração. Conceda o módulo a outro perfil antes de removê-lo daqui.',
    )
  }

  let perfilId: string

  if (id) {
    const { data, error } = await supabase
      .from('perfis')
      .update({ nome, descricao: descricao ?? null })
      .eq('id', id)
      .select('id')
      .maybeSingle()

    if (error) {
      if (error.code === '23505') {
        return fail('Dados inválidos.', { nome: ['Já existe um perfil com este nome.'] })
      }
      return fail('Não foi possível salvar o perfil.')
    }
    if (!data) return fail('Perfil não encontrado.')
    perfilId = data.id
  } else {
    const { data, error } = await supabase
      .from('perfis')
      .insert({ nome, descricao: descricao ?? null })
      .select('id')
      .maybeSingle()

    if (error) {
      if (error.code === '23505') {
        return fail('Dados inválidos.', { nome: ['Já existe um perfil com este nome.'] })
      }
      return fail('Não foi possível criar o perfil.')
    }
    if (!data) return fail('Não foi possível criar o perfil.')
    perfilId = data.id
  }

  // Sync perfil_modulos as a DIFF, never as delete-all-then-reinsert: a retained
  // module's row is never deleted, so a failure between the two statements can't
  // transiently strip a grant (in particular, can't strip 'admin' from the perfil
  // of the admin doing the editing).
  const { data: atuaisRows, error: atuaisError } = await supabase
    .from('perfil_modulos')
    .select('modulo_id')
    .eq('perfil_id', perfilId)

  if (atuaisError) return fail('Perfil salvo, mas não foi possível ler os módulos atuais.')

  const atuais = atuaisRows.map((row) => row.modulo_id)
  const aRemover = atuais.filter((m) => !novos.includes(m))
  const aInserir = novos.filter((m) => !atuais.includes(m))

  if (aInserir.length > 0) {
    const { error } = await supabase
      .from('perfil_modulos')
      .insert(aInserir.map((modulo_id) => ({ perfil_id: perfilId, modulo_id })))

    if (error) return fail('Perfil salvo, mas não foi possível conceder os módulos.')
  }

  if (aRemover.length > 0) {
    const { error } = await supabase
      .from('perfil_modulos')
      .delete()
      .eq('perfil_id', perfilId)
      .in('modulo_id', aRemover)

    if (error) return fail('Perfil salvo, mas não foi possível remover os módulos.')
  }

  await auditar(
    supabase,
    context.user.id,
    id ? 'perfil.atualizado' : 'perfil.criado',
    'perfis',
    perfilId,
    { nome, descricao: descricao ?? null, modulos: novos },
  )

  revalidatePath('/admin/perfis')
  revalidatePath('/admin/usuarios')
  return { ok: true, data: { perfil_id: perfilId } }
}

const excluirPerfilSchema = z.object({ perfil_id: z.string().uuid() })

export async function excluirPerfilAction(input: unknown): Promise<ActionResult> {
  const context = await requireAdmin()
  if (!context) return fail(FORBIDDEN)

  const parsed = parse(excluirPerfilSchema, input)
  if (!parsed.ok) return fail('Dados inválidos.', parsed.fieldErrors)

  const { perfil_id } = parsed.data
  const supabase = await createClient()

  const perfisAdmin = await perfisComAdmin(supabase)
  if (perfisAdmin === null) return fail('Não foi possível verificar os perfis de administração.')

  if (perfisAdmin.includes(perfil_id) && perfisAdmin.length <= 1) {
    return fail(
      'Este é o último perfil com acesso à Administração. Excluí-lo deixaria o sistema sem administradores.',
    )
  }

  // usuarios.perfil_id is ON DELETE SET NULL, so deleting a perfil in use would
  // silently strip every one of its users of all access instead of failing.
  // Refuse, and make the admin move them somewhere first.
  const { data: emUso, error: emUsoError } = await supabase
    .from('usuarios')
    .select('id')
    .eq('perfil_id', perfil_id)

  if (emUsoError) return fail('Não foi possível verificar os usuários deste perfil.')
  if (emUso.length > 0) {
    const plural = emUso.length === 1 ? 'usuário vinculado' : 'usuários vinculados'
    return fail(
      `Este perfil tem ${emUso.length} ${plural}. Mova-os para outro perfil antes de excluí-lo.`,
    )
  }

  const { data: perfil, error: perfilError } = await supabase
    .from('perfis')
    .select('nome')
    .eq('id', perfil_id)
    .maybeSingle()

  if (perfilError) return fail('Não foi possível excluir o perfil.')
  if (!perfil) return fail('Perfil não encontrado.')

  // perfil_modulos cascades on the FK, so its rows go with it.
  const { error } = await supabase.from('perfis').delete().eq('id', perfil_id)
  if (error) return fail('Não foi possível excluir o perfil.')

  await auditar(supabase, context.user.id, 'perfil.excluido', 'perfis', perfil_id, {
    nome: perfil.nome,
  })

  revalidatePath('/admin/perfis')
  return { ok: true, data: undefined }
}
