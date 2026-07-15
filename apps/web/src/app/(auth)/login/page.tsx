import type { Metadata } from 'next'
import { LoginForm } from './login-form'

export const metadata: Metadata = {
  title: 'Entrar',
}

/**
 * There is no signup and no OAuth: users are created by an admin, who mails them
 * a temporary password. This screen is the only door.
 *
 * `erro=desativado` is set by the middleware when it drops the session of a user
 * who was deactivated while signed in, so the redirect can explain itself.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>
}) {
  const { erro } = await searchParams

  return <LoginForm erroInicial={erro === 'desativado' ? 'Usuário desativado.' : undefined} />
}
