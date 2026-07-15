'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { alterarSenhaSchema, loginSchema, MODULE_IDS } from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionContext } from '@/lib/auth'
import type { FormState } from '@/lib/form-state'

/**
 * FormState / ESTADO_INICIAL now live in `@/lib/form-state`: a 'use server' file
 * may only export async functions, so the plain `ESTADO_INICIAL` object could not
 * stay here (it broke `next build` as soon as a server component imported this
 * module). Re-exporting the *type* is safe — types are erased.
 */
export type { FormState }

/**
 * Supabase auth errors arrive in English and are user-facing. Map the ones a
 * real person can actually hit; everything else collapses into a generic message
 * rather than leaking an internal string.
 *
 * Deliberately NOT distinguishing "no such e-mail" from "wrong password":
 * that difference turns the login form into a user-enumeration oracle.
 */
function mensagemErroLogin(code: string | undefined, status: number | undefined): string {
  if (code === 'invalid_credentials') return 'E-mail ou senha inválidos.'
  if (code === 'email_not_confirmed') return 'E-mail ainda não confirmado.'
  if (code === 'user_banned') return 'Usuário desativado.'
  if (code === 'over_request_rate_limit' || status === 429) {
    return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
  }
  return 'Não foi possível entrar. Tente novamente.'
}

function mensagemErroSenha(code: string | undefined): string {
  if (code === 'same_password') return 'A nova senha deve ser diferente da senha atual.'
  if (code === 'weak_password') return 'Senha muito fraca. Escolha uma senha mais forte.'
  return 'Não foi possível alterar a senha. Tente novamente.'
}

// ─── login ──────────────────────────────────────────────────────────────────

export async function entrar(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    senha: formData.get('senha'),
  })

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Confira os campos destacados.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const supabase = await createClient()

  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.senha,
  })

  if (error || !data.user) {
    return { status: 'error', message: mensagemErroLogin(error?.code, error?.status) }
  }

  // The password was right, but Supabase Auth knows nothing about `ativo` — that
  // lives in `usuarios`. Check it with the SERVICE ROLE: the user-scoped client
  // cannot answer this question, because the RLS select policy is gated on
  // app_usuario_ativo(), so a deactivated user reading their own row gets zero
  // rows — indistinguishable from "row missing". Both cases must fail closed.
  const admin = createAdminClient()

  const { data: usuario } = await admin
    .from('usuarios')
    .select('ativo, must_change_password, perfil_id')
    .eq('id', data.user.id)
    .maybeSingle()

  if (!usuario || !usuario.ativo) {
    // Undo the session we just created: an inactive user must not hold a valid
    // cookie for even one request.
    await supabase.auth.signOut()
    return {
      status: 'error',
      message: usuario
        ? 'Usuário desativado.'
        : 'Usuário sem cadastro no JobsiteOS. Fale com um administrador.',
    }
  }

  if (usuario.must_change_password) redirect('/alterar-senha')

  // The brief lands everyone on /empresas, but a perfil that doesn't grant
  // `empresas` would be bounced straight back out by the middleware. Send those
  // users through "/", which resolves the first module they can actually see.
  let temEmpresas = false

  if (usuario.perfil_id) {
    const { data: modulos } = await admin
      .from('perfil_modulos')
      .select('modulo_id')
      .eq('perfil_id', usuario.perfil_id)

    temEmpresas = (modulos ?? []).some(
      (m) => m.modulo_id === 'empresas' && MODULE_IDS.includes(m.modulo_id),
    )
  }

  redirect(temEmpresas ? '/empresas' : '/')
}

// ─── logout ─────────────────────────────────────────────────────────────────

export async function sair(): Promise<never> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

// ─── troca de senha ─────────────────────────────────────────────────────────

/**
 * Sets a new password for the CALLER and clears must_change_password.
 *
 * Two clients, on purpose:
 *  - the password itself goes through the USER-SCOPED client (auth.updateUser),
 *    so Supabase applies it to whoever owns the session cookie and to nobody
 *    else. There is no user id in play that an attacker could substitute.
 *  - must_change_password is a column `authenticated` has no UPDATE grant on
 *    (migration 0005 grants update on `nome` only), so it needs the service
 *    role. The row is pinned to context.user.id — the id from the revalidated
 *    JWT, never from the form — so this cannot touch another user's row.
 */
async function definirNovaSenha(formData: FormData): Promise<FormState> {
  const context = await getSessionContext()
  if (!context) redirect('/login')

  const parsed = alterarSenhaSchema.safeParse({
    senha: formData.get('senha'),
    confirmacao: formData.get('confirmacao'),
  })

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Confira os campos destacados.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const supabase = await createClient()

  const { error } = await supabase.auth.updateUser({ password: parsed.data.senha })
  if (error) return { status: 'error', message: mensagemErroSenha(error.code) }

  const admin = createAdminClient()

  const { error: flagError } = await admin
    .from('usuarios')
    .update({ must_change_password: false })
    .eq('id', context.user.id)

  if (flagError) {
    // The password DID change (Supabase Auth already committed it). Say so, or
    // the user retries with a password that is now the old one and gets a
    // confusing "same password" error.
    return {
      status: 'error',
      message:
        'Sua senha foi alterada, mas houve uma falha ao concluir o processo. Faça login novamente.',
    }
  }

  return { status: 'success', message: 'Senha alterada com sucesso.' }
}

/** Forced screen: on success the user is finally let into the app. */
export async function alterarSenhaObrigatoria(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const resultado = await definirNovaSenha(formData)
  if (resultado.status !== 'success') return resultado

  // "/" resolves the first granted module, so this works for any perfil.
  revalidatePath('/', 'layout')
  redirect('/')
}

/** Same operation from /settings, where the user is just changing their password. */
export async function alterarSenhaConta(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return definirNovaSenha(formData)
}
