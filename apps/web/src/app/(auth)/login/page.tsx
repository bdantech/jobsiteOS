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

  // `erro=link`: o link de "esqueci minha senha" venceu ou já foi usado.
  const mensagem =
    erro === 'desativado'
      ? 'Usuário desativado.'
      : erro === 'link'
        ? 'Este link para criar a senha venceu ou já foi usado. Peça outro em "Esqueci minha senha".'
        : undefined
  return <LoginForm erroInicial={mensagem} />
}
