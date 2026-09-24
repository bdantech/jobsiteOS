import { Bell } from 'lucide-react-native'
import { useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'

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
            /*
       * Este botão vive SEMPRE sobre o navy do cabeçalho, então ele não lê
       * `colors`: um ícone em `foreground` aqui seria quase invisível no tema
       * claro e sumiria de vez no escuro, onde `foreground` é quase branco...
       * sobre um fundo que também não muda. Cor fixa é o que descreve a
       * verdade desta superfície.
       */
      className={cn(
        'size-11 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] active:opacity-70',
        className,
      )}
    >
      <Bell size={20} color="#FFFFFF" />

      {unread > 0 ? (
        /*
          UM CÍRCULO DE TAMANHO FIXO, e não uma pílula que cresce.

          A pílula anterior tinha 16px de altura para um texto de 10px com a
          entrelinha da Poppins, que é alta: o "9+" encostava nas bordas e o
          dígito saía cortado embaixo. Agora o círculo tem 20px — cabe "9+" com
          folga — e o texto ocupa a caixa inteira com `lineHeight` igual à
          altura, centralizado nos dois eixos. `includeFontPadding: false` tira
          o respiro extra que o Android põe acima da fonte e que empurrava o
          número para baixo.

          Na quina do botão, meio para fora: dentro dele o círculo cobriria o
          sino.
        */
        <View
          className="absolute -right-1.5 -top-1.5 size-5 items-center justify-center rounded-full border-2 border-brand bg-[#E5484D]"
        >
          <Text
            className="font-semibold text-white"
            style={{
              fontSize: unread > MAX_BADGE ? 9 : 10,
              lineHeight: 16,
              textAlign: 'center',
              includeFontPadding: false,
            }}
          >
            {unread > MAX_BADGE ? `${MAX_BADGE}+` : unread}
          </Text>
        </View>
      ) : null}
    </Pressable>
  )
}
