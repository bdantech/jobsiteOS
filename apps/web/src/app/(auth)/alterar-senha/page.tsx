import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireSessionContext } from '@/lib/auth'
import { AlterarSenhaForm } from './alterar-senha-form'

export const metadata: Metadata = {
  title: 'Alterar senha',
}

/**
 * The forced change-password gate.
 *
 * WHY THIS LIVES IN (auth) AND NOT (app), despite requiring a session:
 * the (app) layout redirects to /alterar-senha whenever must_change_password is
 * true. If this page sat inside (app), that layout would wrap the gate itself
 * and redirect it to itself — an infinite loop that makes the screen
 * unreachable. Since must_change_password defaults to true for every user an
 * admin creates, that would lock every new user out of the app permanently.
 *
 * Living in (auth) also matches what the screen IS: a full-screen gate with no
 * sidebar, no tabs and no AI bar — "nothing else gets through" applies to the
 * chrome as much as to the routes.
 *
 * The (auth) layout renders no session-dependent chrome, so the session check is
 * this page's own job — the middleware routes, but it never authorizes.
 */
export default async function AlterarSenhaPage() {
  const context = await requireSessionContext()

  // Nothing to force. Users changing a password they already know use /settings.
  if (!context.usuario.must_change_password) redirect('/')

  return <AlterarSenhaForm nome={context.usuario.nome} />
}
