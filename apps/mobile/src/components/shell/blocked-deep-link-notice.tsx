import { moduleForRoute } from '@jobsiteos/core'
import { parse, useURL } from 'expo-linking'
import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'

import { notGrantedNotice, webOnlyNotice, type ModuleNotice } from '@/components/shell/notices'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Text } from '@/components/ui/text'
import { useSession } from '@/lib/auth'
import { canOpenOnMobile } from '@/lib/linking'

/** expo-linking yields "empresas" / "admin"; the registry speaks "/empresas". */
function normalizePath(path: string | null): string | null {
  if (!path) return null
  const trimmed = path.replace(/\/+$/, '')
  if (!trimmed) return null
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

/**
 * Tells the user WHY a deep link went nowhere.
 *
 * The root gate (app/_layout.tsx) already refuses a link into an ungranted or
 * webOnly module — it redirects to the landing route. But a redirect on its own
 * is silent: tap a push notification for /admin and the app just... opens on
 * Empresas, which reads as a bug.
 *
 * So this listens to the incoming URL itself, not to the router. It runs the
 * same registry check the gate runs (canOpenOnMobile) and, when the answer is
 * "no", explains it in pt-BR. The gate still does the actual blocking; this only
 * narrates it, which is why it can live entirely inside the shell.
 */
export function BlockedDeepLinkNotice() {
  const url = useURL()
  const { grantedModuleIds, loading } = useSession()
  const [notice, setNotice] = useState<ModuleNotice | null>(null)

  // Dismissing must be final: useURL() keeps returning the same URL for the rest
  // of the session, so without this the dialog would reopen on every render pass.
  const handled = useRef<string | null>(null)

  useEffect(() => {
    if (loading || !url || handled.current === url) return

    const path = normalizePath(parse(url).path)
    if (!path) return

    const module = moduleForRoute(path)
    // Not a module route (login, /mais, /configuracoes): none of our business.
    if (!module) return
    if (canOpenOnMobile(path, grantedModuleIds)) return

    handled.current = url
    setNotice(module.webOnly ? webOnlyNotice(module) : notGrantedNotice(module))
  }, [url, loading, grantedModuleIds])

  if (!notice) return null

  return (
    <Dialog
      open
      onOpenChange={() => setNotice(null)}
      title={notice.title}
      description={notice.description}
    >
      <View className="flex-row justify-end">
        <Button onPress={() => setNotice(null)}>
          <Text>Entendi</Text>
        </Button>
      </View>
    </Dialog>
  )
}
