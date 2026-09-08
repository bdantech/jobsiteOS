import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  useWindowDimensions,
  View,
} from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

const OPEN_MS = 220
const CLOSE_MS = 180

/** Arrasto para baixo que fecha, e velocidade que fecha independente da distância. */
const DISTANCIA_PARA_FECHAR = 120
const VELOCIDADE_PARA_FECHAR = 900
/**
 * Quanto o dedo precisa andar na vertical antes de o arrasto virar "fechar".
 *
 * Não é estética: é o que separa fechar o painel de rolar o conteúdo dele. Baixo
 * demais e qualquer toque trêmulo fecha o sheet no meio de um formulário; alto
 * demais e o gesto parece travado.
 */
const LIMIAR_ARRASTO = 12

export interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  description?: string
  /** Height of the panel. Default is content-sized with a 90% ceiling. */
  className?: string
  children?: ReactNode
}

/**
 * Bottom sheet. Drives the AI chat (full height) and every confirm/edit flow.
 *
 * Deliberately hand-rolled on Modal + reanimated rather than pulling in a sheet
 * library: we need exactly two behaviours (slide in, drag to dismiss), and the
 * animation must run on the UI thread while the JS thread is streaming tokens
 * from /api/ai — which is precisely when a JS-driven sheet drops frames.
 *
 * ── Por que o KeyboardAvoidingView envolve o CONTAINER, e não o painel ──────
 * Ele já envolveu só o painel, sem `flex`, e era isso que deixava uma faixa da
 * tela aparecendo embaixo de TODO sheet do app. Duas consequências saíam daí:
 *
 *  1. sem `flex-1`, o KAV se dimensiona pelo conteúdo, e no iOS ele calcula o
 *     padding do teclado a partir do próprio frame. Dentro de um Modal esse
 *     frame não coincide com a janela, e o resultado é um padding inferior
 *     residual com o teclado FECHADO — o painel subia e descolava do fundo;
 *  2. `max-h-[90%]` é percentual, e percentual em RN precisa de um pai com
 *     altura definida. O pai era o KAV auto-dimensionado, então o teto de 90%
 *     simplesmente não valia.
 *
 * Envolvendo o container `flex-1 justify-end`, os dois somem: o painel fica
 * ancorado no fundo, o 90% resolve contra a altura da janela, e o teclado
 * encolhe o container (que empurra o painel para cima) em vez de deslocá-lo.
 */
export function Sheet({ open, onOpenChange, title, description, className, children }: SheetProps) {
  const insets = useSafeAreaInsets()
  // Hook, e não Dimensions.get() em escopo de módulo: aquele valor era lido uma
  // vez no primeiro import e ficava errado depois de qualquer mudança de janela.
  const { height: alturaJanela } = useWindowDimensions()
  const [mounted, setMounted] = useState(open)

  const translateY = useSharedValue(alturaJanela)
  const backdropOpacity = useSharedValue(0)

  const close = useCallback(() => onOpenChange(false), [onOpenChange])
  const unmount = useCallback(() => setMounted(false), [])

  useEffect(() => {
    if (open) {
      setMounted(true)
      translateY.value = withTiming(0, { duration: OPEN_MS })
      backdropOpacity.value = withTiming(1, { duration: OPEN_MS })
      return
    }

    backdropOpacity.value = withTiming(0, { duration: CLOSE_MS })
    translateY.value = withTiming(alturaJanela, { duration: CLOSE_MS }, (finished) => {
      // Keep the panel mounted until the exit animation ends, or it vanishes.
      if (finished) runOnJS(unmount)()
    })
  }, [open, translateY, backdropOpacity, unmount, alturaJanela])

  /**
   * Arrastar para baixo fecha, de QUALQUER ponto do painel — não só da alça.
   *
   * O par activeOffsetY/failOffsetY é o que torna isso conviável com o conteúdo
   * rolável dentro do sheet:
   *   - `activeOffsetY(LIMIAR)`  — só assume o gesto depois de 12px PARA BAIXO;
   *   - `failOffsetY(-LIMIAR)`   — 12px para cima e o gesto falha de vez, então
   *                                a rolagem do conteúdo recebe o toque inteiro.
   * Sem o segundo, rolar uma lista para cima brigaria com o painel a cada toque.
   */
  const panGesture = Gesture.Pan()
    .activeOffsetY(LIMIAR_ARRASTO)
    .failOffsetY(-LIMIAR_ARRASTO)
    .onUpdate((event) => {
      // Downward only: dragging up must not detach the sheet from the bottom.
      translateY.value = Math.max(0, event.translationY)
    })
    .onEnd((event) => {
      if (event.translationY > DISTANCIA_PARA_FECHAR || event.velocityY > VELOCIDADE_PARA_FECHAR) {
        runOnJS(close)()
      } else {
        translateY.value = withTiming(0, { duration: 150 })
      }
    })

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }))
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }))

  if (!mounted) return null

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={close}
      statusBarTranslucent
      // Android: sem isto a janela do modal para ACIMA da barra de navegação, e
      // sobra uma faixa da tela de trás no rodapé. É o par de statusBarTranslucent
      // para a outra ponta da tela.
      navigationBarTranslucent
    >
      <KeyboardAvoidingView
        className="flex-1 justify-end"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Animated.View className="absolute inset-0 bg-black/50" style={backdropStyle}>
          <Pressable
            className="flex-1"
            accessibilityRole="button"
            accessibilityLabel="Fechar"
            onPress={close}
          />
        </Animated.View>

        <GestureDetector gesture={panGesture}>
          <Animated.View
            style={panelStyle}
            className={cn(
              // `border-x border-t`, e não `border`: a borda de baixo encostava na
              // beirada da tela como um fio solto sob o painel.
              'max-h-[90%] rounded-t-xl border-x border-t border-border bg-card',
              className,
            )}
          >
            {/* A alça continua existindo — ela é a AFFORDANCE de que dá para
                arrastar. O que mudou é que o gesto não mora mais só nela. */}
            <View className="items-center pb-1 pt-2">
              <View className="h-1 w-10 rounded-full bg-muted-foreground/40" />
            </View>

            {title || description ? (
              <View className="gap-1 px-4 pb-2 pt-1">
                {title ? <Text variant="heading">{title}</Text> : null}
                {description ? <Text variant="muted">{description}</Text> : null}
              </View>
            ) : null}

            <View className="shrink px-4 pt-1" style={{ paddingBottom: insets.bottom + 16 }}>
              {children}
            </View>
          </Animated.View>
        </GestureDetector>
      </KeyboardAvoidingView>
    </Modal>
  )
}
