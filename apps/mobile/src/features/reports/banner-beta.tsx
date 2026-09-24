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
 * Ela mora DENTRO do cabeçalho de vidro, abaixo da linha do título. Como faixa
 * da tela ela ficaria por baixo do vidro — o cabeçalho flutua sobre o conteúdo —
 * e passaria borrada, ilegível, justamente no lugar onde deveria ser lida.
 */
export function BannerBeta() {
  const beta = useBeta()
  if (!beta.habilitado) return null

  return (
    <View
      accessibilityRole="text"
      className="mt-2 flex-row items-center justify-center gap-2 rounded-md bg-amber-400/15 px-4 py-1.5"
    >
      <FlaskConical size={13} color="#fcd34d" />
      <Text className="flex-1 text-center text-xs text-amber-200">{beta.texto}</Text>
    </View>
  )
}
