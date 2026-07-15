import { View } from 'react-native'

import { NotificationsBell } from '@/features/notificacoes/bell'

/**
 * The notifications bell, positioned for a header slot.
 *
 * Every module stack gets it through <ModuleStack> (headerRight) and the "Mais"
 * screen gets it through <ScreenHeader>, so the bell is reachable from every
 * screen of the app without each feature having to remember it.
 */
export function HeaderBell() {
  return (
    <View className="pr-1">
      <NotificationsBell />
    </View>
  )
}
