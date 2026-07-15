import { Stack } from 'expo-router'

import { ModuleStack } from '@/components/shell/module-stack'

/**
 * The bell stays in this module's header too, even though it is redundant as
 * navigation (you are already here).
 *
 * <NotificationsBell> is the mount point for the notifications runtime — push
 * registration, Realtime, tap handling — and it runs that hook before it decides
 * whether to render anything. Drop the bell from this stack and a user whose only
 * granted module is `notificacoes` lands on this tab, never focuses a screen that
 * has a bell, and silently never registers for push. Redundant chrome is cheaper
 * than that.
 */
export default function NotificacoesLayout() {
  return (
    <ModuleStack>
      <Stack.Screen name="index" options={{ title: 'Notificações' }} />
    </ModuleStack>
  )
}
