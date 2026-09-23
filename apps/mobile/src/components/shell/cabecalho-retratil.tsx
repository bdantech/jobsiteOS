import { Search } from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, Pressable, View, type FlatList } from 'react-native'
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
 * prospecção · 231 oportunidades") assume a linha debaixo do título.
 *
 * ── O CABEÇALHO É UMA FUNÇÃO DO SCROLL, NÃO UMA REAÇÃO A ELE ────────────────
 * Esta é a decisão que importa, e a primeira versão errou nela.
 *
 * Lá a cadeia era: evento de scroll → `setState` → re-render da tela inteira
 * (FlatList incluída) → `useEffect` → `Animated.timing` de 140ms. Quatro saltos
 * antes de um pixel se mexer, e o re-render entrando na fila da thread JS que
 * já está ocupada desenhando linhas durante o scroll. O resultado era o atraso
 * enorme que se via no aparelho — e não adiantava encurtar a animação, porque
 * o atraso não estava nela.
 *
 * Além de tardio, era um GATILHO: cruzou o limiar, toca uma animação pronta. Um
 * cabeçalho que segue o dedo não pode ser uma animação; ele tem que ser uma
 * interpolação da posição da lista.
 *
 * Agora `Animated.event` escreve o deslocamento DIRETO no `Animated.Value`, sem
 * passar por render nenhum, e altura, opacidade e recuos são interpolações
 * desse valor. Não há o que atrasar: não existe etapa entre rolar e encolher.
 *
 * `useNativeDriver` segue `false` — altura e padding são layout, e layout não
 * roda na thread de UI. Mas o caminho crítico deixou de ter React no meio, que
 * era o custo real.
 *
 * ── O BOOLEANO SOBREVIVE, E CUSTA UM RENDER POR TRAVESSIA ───────────────────
 * O resumo e a lupa aparecem/somem, e isso é troca de árvore, não de estilo —
 * precisa de estado. Mas ele é atualizado por um listener no próprio valor
 * animado, só quando o limiar é cruzado: um render por travessia, não por
 * quadro.
 *
 * ── O PAINEL É MEDIDO, NÃO CHUTADO ──────────────────────────────────────────
 * Fixar a altura em pixel funcionaria hoje e quebraria no primeiro aparelho com
 * fonte de sistema aumentada — o chip cresce, o número não, e o conteúdo vaza
 * por baixo do navy.
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

/**
 * O deslocamento da lista, e o gesto de voltar ao topo.
 *
 * A tela passa `aoRolar` para a FlatList e `listaRef` para cá: reabrir o
 * cabeçalho é ROLAR ATÉ O TOPO, não mexer num estado à parte. Com o cabeçalho
 * sendo função do scroll, qualquer outro jeito de reabri-lo criaria um segundo
 * dono da mesma verdade.
 */
export function useCabecalhoRetratil<T>() {
  const deslocamento = useRef(new Animated.Value(0)).current
  const listaRef = useRef<FlatList<T>>(null)
  const [recolhido, setRecolhido] = useState(false)

  const aoRolar = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: deslocamento } } }], {
        useNativeDriver: false,
      }),
    [deslocamento],
  )

  useEffect(() => {
    // 12px: acima do repique do `bounce` do iOS, que chega a oscilar alguns
    // pixels parado no topo e faria o resumo piscar.
    const id = deslocamento.addListener(({ value }) => {
      setRecolhido(value > 12)
    })
    return () => deslocamento.removeListener(id)
  }, [deslocamento])

  const voltarAoTopo = useCallback(() => {
    listaRef.current?.scrollToOffset({ offset: 0, animated: true })
  }, [])

  return { deslocamento, recolhido, aoRolar, listaRef, voltarAoTopo }
}

export function CabecalhoRetratil({
  titulo,
  resumo,
  busca,
  chips,
  aoReabrir,
  deslocamento,
  recolhido,
  onExpandir,
}: CabecalhoRetratilProps & {
  deslocamento: Animated.Value
  recolhido: boolean
  onExpandir: () => void
}) {
  const { top } = useSafeAreaInsets()
  const [alturaPainel, setAlturaPainel] = useState(0)

  /*
   * O curso é a própria altura do painel: o cabeçalho termina de encolher
   * exatamente quando a lista andou o tanto que ele ocupava. Um curso fixo
   * faria o encolhimento correr mais rápido ou mais devagar que o dedo.
   *
   * `|| 1` só para o primeiro quadro, antes da medição: um `inputRange` com
   * início igual ao fim é intervalo inválido e o RN reclama.
   */
  const curso = alturaPainel || 1

  const interp = (de: number, para: number) =>
    deslocamento.interpolate({
      inputRange: [0, curso],
      outputRange: [de, para],
      extrapolate: 'clamp',
    })

  const alturaAnimada = interp(alturaPainel, 0)
  const recuoTopo = interp(top + 8, top + 2)
  const recuoBase = interp(12, 6)

  // Some na METADE do curso: um painel meio-alto e ainda opaco parece cortado
  // ao meio, que é pior que um que desaparece cedo.
  const opacidadePainel = deslocamento.interpolate({
    inputRange: [0, curso * 0.5],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  })

  return (
    <Animated.View
      className="rounded-b-2xl bg-brand px-5"
      style={{ paddingTop: recuoTopo, paddingBottom: recuoBase }}
    >
      <View className="min-h-[44px] flex-row items-center justify-between gap-3">
        <View className="min-w-0 flex-1">
          {/*
            `leading-[34px]` num corpo de 26: a Manrope é alta, e com a
            entrelinha colada ao corpo o RN corta o topo das ascendentes — o
            "F" e o "l" de "Funil" apareciam decepados.
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
        style={{ height: alturaPainel === 0 ? undefined : alturaAnimada, opacity: opacidadePainel }}
        className="overflow-hidden"
      >
        <View
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height
            // Só cresce: medir durante o encolhimento gravaria uma altura
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
    </Animated.View>
  )
}
