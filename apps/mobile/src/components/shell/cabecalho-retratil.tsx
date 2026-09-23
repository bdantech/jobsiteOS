import { Search } from 'lucide-react-native'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  Animated,
  Pressable,
  useAnimatedValue,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { HeaderActions } from '@/components/shell/header-actions'
import { Text } from '@/components/ui/text'

/**
 * O CABEÇALHO NAVY QUE ENCOLHE — busca e filtros moram DENTRO dele.
 *
 * ── POR QUE DENTRO, E NÃO COMO PRIMEIRA LINHA DA LISTA ──────────────────────
 * Busca e estágio não são conteúdo, são o RECORTE do conteúdo. Como primeira
 * linha do scroll eles subiam e sumiam junto com os cards, e a pessoa perdia de
 * vista em qual estágio está justamente quando rolou o bastante para esquecer.
 * Dentro do navy, eles saem de cena mas deixam um rastro: o resumo ("Em
 * prospecção · 231 notas") assume a linha debaixo do título.
 *
 * ── O QUE ENCOLHE É A ALTURA, E ELA É MEDIDA, NÃO CHUTADA ───────────────────
 * O painel (busca + chips) é medido no primeiro layout via `onLayout`. Fixar a
 * altura em pixel funcionaria hoje e quebraria no primeiro aparelho com fonte
 * de sistema aumentada — o chip cresce, o número não, e o conteúdo vaza por
 * baixo do navy.
 *
 * ── POSIÇÃO, NÃO DIREÇÃO ───────────────────────────────────────────────────
 * Recolhe assim que a lista sai do topo e volta inteiro quando ela retorna. A
 * primeira versão olhava a DIREÇÃO do gesto com um limiar de 6px, e isso
 * introduzia dois atrasos que se somavam: era preciso acumular movimento
 * suficiente para o limiar, e depois rolar para CIMA para reabrir — de modo que
 * um rolar curto deixava o cabeçalho recolhido no topo da lista, escondendo a
 * busca com nada acima dela para justificar.
 *
 * Por posição o estado é uma função de onde a lista está, não do caminho que
 * ela fez para chegar ali: não há como divergir do que se vê.
 */

export interface CabecalhoRetratilProps {
  titulo: string
  /** A linha que assume o lugar do painel quando ele recolhe. */
  resumo?: string
  /** A busca. Recebe o `ref` do campo para o botão de lupa poder focá-lo. */
  busca: ReactNode
  /** Os chips de estágio, logo abaixo da busca. */
  chips?: ReactNode
  /** Chamado quando a lupa reabre o cabeçalho — a tela foca o campo. */
  aoReabrir?: () => void
}

export function useCabecalhoRetratil() {
  const [recolhido, setRecolhido] = useState(false)

  /*
   * 4px: o bastante para não disparar com o repique do `bounce` do iOS, pouco
   * o bastante para o cabeçalho já estar recolhendo quando o dedo mal andou.
   */
  const aoRolar = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setRecolhido(e.nativeEvent.contentOffset.y > 4)
  }, [])

  return { recolhido, setRecolhido, aoRolar }
}

export function CabecalhoRetratil({
  titulo,
  resumo,
  busca,
  chips,
  aoReabrir,
  recolhido,
  onExpandir,
}: CabecalhoRetratilProps & { recolhido: boolean; onExpandir: () => void }) {
  const { top } = useSafeAreaInsets()
  const [alturaPainel, setAlturaPainel] = useState(0)
  const progresso = useAnimatedValue(0)

  useEffect(() => {
    Animated.timing(progresso, {
      toValue: recolhido ? 1 : 0,
      // 140ms: em 220 a animação terminava depois do gesto e a sensação era
      // de atraso, mesmo com o estado já trocado no primeiro pixel.
      duration: 140,
      // `false` obrigatório: altura e opacidade de layout não rodam na thread
      // de UI. O trecho é curto e a animação é de 220ms — o custo é invisível,
      // e `true` aqui simplesmente não animaria.
      useNativeDriver: false,
    }).start()
  }, [recolhido, progresso])

  const alturaPainelAnimada = progresso.interpolate({
    inputRange: [0, 1],
    outputRange: [alturaPainel, 0],
  })
  const opacidadePainel = progresso.interpolate({
    inputRange: [0, 0.6, 1],
    // Some antes de a altura acabar: um painel meio-alto e ainda opaco parece
    // cortado ao meio, que é pior que um que desaparece cedo.
    outputRange: [1, 0, 0],
  })

  return (
    /*
      RECOLHIDO O NAVY ENCOLHE DE VERDADE.
      
      Só esconder o painel deixava uma faixa escura alta com um título dentro —
      ela continuava comendo a tela sem oferecer nada. Recolhido o recuo cai
      para o mínimo que o status bar exige e o rodapé some: a barra vira uma
      linha de título com o resumo, que é para o que ela serve ali.
    */
    <View
      className="rounded-b-2xl bg-brand px-5"
      style={{ paddingTop: top + (recolhido ? 2 : 8), paddingBottom: recolhido ? 6 : 12 }}
    >
      <View className="min-h-[44px] flex-row items-center justify-between gap-3">
        <View className="min-w-0 flex-1">
          {/*
            `leading-[34px]` num corpo de 26: a Manrope é alta, e com a
            entrelinha colada ao corpo o RN corta o topo das ascendentes — o
            "F" e o "l" de "Funil" apareciam decepados. Folga vertical não é
            estética aqui, é o que faz a palavra caber.
          */}
          <Text
            numberOfLines={1}
            className="font-display text-[26px] leading-[34px] tracking-tight text-white"
          >
            {titulo}
          </Text>
          {recolhido && resumo ? (
            <Text numberOfLines={1} className="text-xs leading-4 text-[#CBD5E1]">
              {resumo}
            </Text>
          ) : null}
        </View>

        <View className="flex-row items-center gap-2">
          {/* A lupa só existe recolhido: expandido, o campo está à vista e um
              botão que rola até ele seria um atalho para o que já se vê. */}
          {recolhido ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Buscar e filtrar"
              onPress={() => {
                onExpandir()
                aoReabrir?.()
              }}
              className="size-11 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] active:opacity-70"
            >
              <Search size={20} color="#FFFFFF" />
            </Pressable>
          ) : null}
          <HeaderActions />
        </View>
      </View>

      <Animated.View
        style={{ height: alturaPainel === 0 ? undefined : alturaPainelAnimada, opacity: opacidadePainel }}
        className="overflow-hidden"
      >
        <View
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height
            // Só cresce: medir durante o recolhimento gravaria uma altura
            // intermediária como se fosse a final, e o painel nunca mais
            // reabriria inteiro.
            setAlturaPainel((atual) => (h > atual ? h : atual))
          }}
          className="gap-3 pt-3"
        >
          {busca}
          {chips}
        </View>
      </Animated.View>
    </View>
  )
}
