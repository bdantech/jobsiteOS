import type { ReactNode } from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { HeaderActions } from '@/components/shell/header-actions'
import { Text } from '@/components/ui/text'

export interface ScreenHeaderProps {
  title: string
  description?: string
  /** Substitui o par reportar + sino. Pass `null` to render no action at all. */
  right?: ReactNode
  /**
   * Conteúdo preso ao cabeçalho, DENTRO do navy: busca, chips de estágio. Sai
   * junto quando o cabeçalho encolhe, e é por isso que mora aqui e não como
   * primeira linha do scroll.
   */
  children?: ReactNode
}

/**
 * O cabeçalho navy — a superfície de marca de toda tela do app.
 *
 * ── POR QUE NAVY, E POR QUE ARREDONDADO EMBAIXO ─────────────────────────────
 * O app é uma lista atrás da outra. Sem uma âncora escura no topo, todas as
 * telas viram a mesma folha branca e a pessoa perde a noção de onde está. O
 * raio de 24 na base é o que faz o conteúdo parecer deslizar POR BAIXO do
 * cabeçalho em vez de começar depois dele.
 *
 * ── O TÍTULO É MANROPE ──────────────────────────────────────────────────────
 * A única tipografia do app que não é Poppins. Ela marca "isto é o nome da
 * tela" sem precisar de mais um tamanho: a diferença de desenho faz o trabalho
 * que um corpo maior faria com mais espaço.
 *
 * ── O `pt` VEM DO INSET, não de um número ───────────────────────────────────
 * Dynamic Island, notch e o nada de um Android antigo pedem recuos diferentes.
 * Um valor fixo acerta um aparelho e erra os outros — e erra escondendo o
 * título atrás do relógio, que é o pior jeito de errar.
 */
export function ScreenHeader({ title, description, right, children }: ScreenHeaderProps) {
  const { top } = useSafeAreaInsets()

  return (
    <View className="rounded-b-2xl bg-brand px-5 pb-4" style={{ paddingTop: top + 8 }}>
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1 gap-1">
          <Text className="font-display text-[26px] leading-7 tracking-tighter text-white">
            {title}
          </Text>
          {description ? (
            <Text className="text-xs text-[#CBD5E1]">{description}</Text>
          ) : null}
        </View>

        {right === undefined ? <HeaderActions /> : right}
      </View>

      {children ? <View className="pt-3">{children}</View> : null}
    </View>
  )
}
