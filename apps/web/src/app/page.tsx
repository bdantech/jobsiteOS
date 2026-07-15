import { redirect } from 'next/navigation'
import { grantedModules } from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'

/**
 * The app has no public landing page — it is an internal tool. "/" is just a
 * router: anonymous users go to the login screen, everyone else lands on the
 * first module their perfil actually grants (so a user without `empresas`
 * doesn't get bounced into a 403).
 */
export default async function HomePage() {
  const context = await getSessionContext()

  if (!context) redirect('/login')

  if (context.usuario.must_change_password) redirect('/alterar-senha')

  const [primeiroModulo] = grantedModules(context.grantedModuleIds)

  // A perfil with no modules is a misconfiguration, not a crash: send them
  // somewhere that can explain itself.
  if (!primeiroModulo) redirect('/sem-acesso')

  redirect(primeiroModulo.route)
}
