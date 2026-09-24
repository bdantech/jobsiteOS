import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * O link do e-mail de "esqueci minha senha" chega aqui (0262).
 *
 * Valida o token de recuperação do Supabase (abre a sessão por cookie) e marca a
 * conta com `must_change_password`. A partir daí o middleware leva a pessoa à tela
 * de troca obrigatória que já existe — a mesma régua de senha, a mesma rotação —,
 * e a flag cai quando ela define a nova. Uma tela só para trocar senha, não duas.
 *
 * Token inválido ou vencido volta ao login com o motivo, sem dizer mais nada.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url)
  const token = url.searchParams.get('token_hash')
  const login = new URL('/login?erro=link', url.origin)
  if (!token) return NextResponse.redirect(login)

  const supabase = await createClient()
  const { data, error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: token })
  if (error || !data.user) return NextResponse.redirect(login)

  await createAdminClient().from('usuarios').update({ must_change_password: true }).eq('id', data.user.id)

  return NextResponse.redirect(new URL('/alterar-senha', url.origin))
}
