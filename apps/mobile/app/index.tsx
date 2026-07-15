import { Redirect } from 'expo-router'

import { useSession } from '@/lib/auth'
import { landingRoute } from '@/lib/linking'

/**
 * "/" is not a screen: it decides where an authenticated user starts, which
 * depends on what their perfil grants. The root gate has already handled the
 * unauthenticated and must_change_password cases before this renders.
 */
export default function Index() {
  const { grantedModuleIds } = useSession()

  return <Redirect href={landingRoute(grantedModuleIds)} />
}
