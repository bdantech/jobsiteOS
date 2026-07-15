import { Bell } from 'lucide-react-native'
import { useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Text } from '@/components/ui/text'
import { useSession } from '@/lib/auth'
import { cn } from '@/lib/utils'

import { useUnreadCount } from './queries'
import { useNotificacoesRuntime } from './runtime'

export interface NotificationsBellProps {
  className?: string
}

/** 9+ — a three-digit badge would blow the header layout. */
const MAX_BADGE = 9

/**
 * The bell in the shell header. Also the mount point for the notifications
 * runtime (push registration, Realtime, tap handling) — it is the one component
 * of this feature that lives on every screen for as long as the user is signed in.
 *
 * The runtime hook runs even when the bell renders nothing (a perfil without the
 * `notificacoes` module still RECEIVES notifications — RLS on `notificacoes` is
 * `usuario_id = auth.uid()`, not module-gated — it just has no screen to browse
 * them on, so a push must still register and still deep-link somewhere sane).
 */
export function NotificationsBell({ className }: NotificationsBellProps) {
  const router = useRouter()
  const { colors } = useTheme()
  const { grantedModuleIds } = useSession()

  const canOpen = grantedModuleIds.includes('notificacoes')

  useNotificacoesRuntime()
  const { data: unread = 0 } = useUnreadCount(canOpen)

  // No module, no screen to send them to: the registry decides, not this file.
  if (!canOpen) return null

  const label =
    unread > 0
      ? `Notificações, ${unread} não ${unread === 1 ? 'lida' : 'lidas'}`
      : 'Notificações'

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push('/notificacoes')}
      hitSlop={8}
      className={cn('h-10 w-10 items-center justify-center rounded-full active:bg-muted', className)}
    >
      <Bell size={22} color={colors.foreground} />

      {unread > 0 ? (
        <View
          // Sits on the bell's upper-right; min-w + px lets "9+" widen the pill
          // without the single-digit case turning into an oval.
          className="absolute right-1 top-1 h-4 min-w-4 items-center justify-center rounded-full border border-background bg-primary px-1"
        >
          <Text className="text-[10px] font-semibold leading-none text-primary-foreground">
            {unread > MAX_BADGE ? `${MAX_BADGE}+` : unread}
          </Text>
        </View>
      ) : null}
    </Pressable>
  )
}
