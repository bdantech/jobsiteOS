import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Animated, {
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Path } from 'react-native-svg'

/**
 * A ABERTURA: a splash nativa é uma foto, isto é o filme que começa nela.
 *
 * A splash nativa (plugin `expo-splash-screen` no app.json) mostra SÓ o ponto
 * verde, de `PONTO` dp, no centro do navy. O quadro 0 daqui é exatamente essa
 * imagem — mesmo fundo, mesmo ponto, mesmo lugar —, e é por isso que a troca
 * nativa → JS não se vê. Mexeu no `imageWidth` do app.json? Mexa em `PONTO`.
 *
 * Linha do tempo (ms):
 *   120–720   o ponto sobe para o canto do J enquanto o traço do J se desenha
 *   760–1100  o ponto pulsa; "JobsiteOS" sobe com fade
 *   depois    segura até a sessão resolver (`pronto`) e sai com zoom + fade
 *
 * Com "reduzir movimento" ligado não há filme: nasce no quadro final e sai só
 * com fade.
 *
 * ⚠️ PROVISÓRIO como o ícone (assets/images/icon.svg): a geometria do J é a
 * dele. Trocou a marca, trocam os dois.
 */

const NAVY = '#050E40'
const VERDE = '#2DAD40'

/** Diâmetro do ponto em dp — IGUAL ao `imageWidth` do expo-splash-screen. */
const PONTO = 22
/** O ícone é desenhado em 1024 com o ponto de raio 62: o lado sai do ponto. */
const LADO = (PONTO * 1024) / 124
const ESCALA = LADO / 1024

const J = 'M600 272 V600 A150 150 0 0 1 300 600'
/** Reta de 328 + meia-volta de raio 150. */
const COMPRIMENTO_J = 328 + Math.PI * 150

/** Onde o ponto mora no desenho, medido a partir do centro da marca. */
const PONTO_X = (736 - 512) * ESCALA
const PONTO_Y = (272 - 512) * ESCALA

const ENTRA = Easing.bezier(0.65, 0, 0.35, 1)
const DESACELERA = Easing.bezier(0.33, 1, 0.68, 1)
const ACELERA = Easing.bezier(0.32, 0, 0.67, 0)

const PathAnimado = Animated.createAnimatedComponent(Path)

export function AberturaAnimada({ pronto }: { pronto: boolean }) {
  const reduzir = useReducedMotion()
  const [montada, setMontada] = useState(true)
  const [iniciada, setIniciada] = useState(false)
  const [entradaCompleta, setEntradaCompleta] = useState(false)

  const traco = useSharedValue(0)
  const caminho = useSharedValue(0)
  const pulso = useSharedValue(1)
  const nome = useSharedValue(0)
  const saida = useSharedValue(0)

  // Só esconde a nativa quando o quadro 0 já está NA TELA — antes disso, o
  // que apareceria no lugar dela é o app por baixo.
  const aoMedir = useCallback(() => {
    SplashScreen.hideAsync()
      .catch(() => {})
      .finally(() => setIniciada(true))
  }, [])

  useEffect(() => {
    if (!iniciada) return

    if (reduzir) {
      traco.value = 1
      caminho.value = 1
      nome.value = 1
      setEntradaCompleta(true)
      return
    }

    traco.value = withDelay(120, withTiming(1, { duration: 600, easing: ENTRA }))
    caminho.value = withDelay(120, withTiming(1, { duration: 560, easing: DESACELERA }))
    pulso.value = withDelay(
      760,
      withSequence(
        withTiming(1.35, { duration: 140, easing: DESACELERA }),
        withSpring(1, { damping: 9, stiffness: 190 }),
      ),
    )
    nome.value = withDelay(
      720,
      withTiming(1, { duration: 380, easing: DESACELERA }, (fim) => {
        if (fim) runOnJS(setEntradaCompleta)(true)
      }),
    )
  }, [iniciada, reduzir, traco, caminho, pulso, nome])

  useEffect(() => {
    if (!entradaCompleta || !pronto) return
    saida.value = withTiming(1, { duration: reduzir ? 200 : 320, easing: ACELERA }, (fim) => {
      if (fim) runOnJS(setMontada)(false)
    })
  }, [entradaCompleta, pronto, reduzir, saida])

  // Com `strokeLinecap="round"`, um traço de comprimento ZERO ainda pinta a
  // tampa — meia bolinha no topo do J no quadro 0, que a splash nativa não tem.
  const propsDoJ = useAnimatedProps(() => ({
    strokeDashoffset: COMPRIMENTO_J * (1 - traco.value),
    strokeOpacity: traco.value > 0.001 ? 1 : 0,
  }))

  const estiloDoPonto = useAnimatedStyle(() => ({
    transform: [
      { translateX: -PONTO_X * (1 - caminho.value) },
      { translateY: -PONTO_Y * (1 - caminho.value) },
      { scale: pulso.value },
    ],
  }))

  const estiloDoNome = useAnimatedStyle(() => ({
    opacity: nome.value,
    transform: [{ translateY: 10 * (1 - nome.value) }],
  }))

  const estiloDoFundo = useAnimatedStyle(() => ({ opacity: 1 - saida.value }))

  const estiloDaMarca = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + (reduzir ? 0 : 0.08) * saida.value }],
  }))

  if (!montada) return null

  return (
    <Animated.View
      onLayout={aoMedir}
      pointerEvents={entradaCompleta && pronto ? 'none' : 'auto'}
      style={[StyleSheet.absoluteFill, estilos.fundo, estiloDoFundo]}
    >
      <StatusBar style="light" />
      <Animated.View style={[estilos.marca, estiloDaMarca]}>
        <Svg width={LADO} height={LADO} viewBox="0 0 1024 1024">
          <PathAnimado
            d={J}
            fill="none"
            stroke="#FFFFFF"
            strokeWidth={116}
            strokeLinecap="round"
            strokeDasharray={[COMPRIMENTO_J, COMPRIMENTO_J]}
            animatedProps={propsDoJ}
          />
        </Svg>
        <Animated.View style={[estilos.ponto, estiloDoPonto]} />
        <Animated.View style={[estilos.nome, estiloDoNome]}>
          <Text style={estilos.textoDoNome}>JobsiteOS</Text>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  )
}

const estilos = StyleSheet.create({
  fundo: {
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    elevation: 1000,
  },
  // A marca fica no centro exato da tela (onde a nativa pôs o ponto); o nome
  // pendura abaixo em absoluto para não empurrar esse centro.
  marca: { width: LADO, height: LADO },
  ponto: {
    position: 'absolute',
    left: 736 * ESCALA - PONTO / 2,
    top: 272 * ESCALA - PONTO / 2,
    width: PONTO,
    height: PONTO,
    borderRadius: PONTO / 2,
    backgroundColor: VERDE,
  },
  nome: {
    position: 'absolute',
    top: LADO + 8,
    left: -120,
    right: -120,
    alignItems: 'center',
  },
  textoDoNome: {
    color: '#FFFFFF',
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 24,
    letterSpacing: 0.3,
  },
})
