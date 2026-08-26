import { FlaskConical } from 'lucide-react-native'
import { View } from 'react-native'

import { Text } from '@/components/ui/text'

import { useBeta } from './queries'

/**
 * A tarja de beta no celular (04m §5).
 *
 * Sem botão de fechar, pelo mesmo motivo da web: isto é o estado da plataforma,
 * não uma notificação. Se desse para dispensar, cada pessoa veria uma coisa
 * diferente e a tarja passaria a significar "você ainda não fechou".
 *
 * Ela é injetada pelo `screenLayout` do <ModuleStack>, ou seja: ABAIXO do header
 * nativo, dentro da tela. Acima do navegador ela brigaria com o inset de status
 * bar que o header nativo calcula sozinho — e o resultado seria uma faixa de
 * espaço em branco entre a tarja e o título, diferente em cada plataforma.
 */
export function BannerBeta() {
  const beta = useBeta()
  if (!beta.habilitado) return null

  return (
    <View
      accessibilityRole="text"
      className="flex-row items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5"
    >
      <FlaskConical size={13} color="#92400e" />
      <Text className="flex-1 text-center text-xs text-amber-900 dark:text-amber-200">
        {beta.texto}
      </Text>
    </View>
  )
}
