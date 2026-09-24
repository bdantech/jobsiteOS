import { useNavigation } from 'expo-router'
import { HeaderBackContext } from 'expo-router/react-navigation'
import { ListFilter, Search } from 'lucide-react-native'
import { use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, type FlatList } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  BotaoDoCabecalho,
  FundoDeVidro,
  LinhaDoTitulo,
} from '@/components/shell/cabecalho-de-vidro'
import { BannerBeta } from '@/features/reports'

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
 * ── SÓ TRANSFORM E OPACITY, E É POR ISSO QUE NÃO TREME ──────────────────────
 * Duas versões erraram aqui antes desta.
 *
 * A primeira reagia ao scroll com `setState` + `Animated.timing`: quatro saltos
 * (evento → render da tela inteira → efeito → animação) antes de um pixel se
 * mexer. Atraso enorme, e um gatilho em vez de um acompanhamento.
 *
 * A segunda virou interpolação do deslocamento — certo — mas interpolava
 * `height` e `padding`. São propriedades de LAYOUT, e layout não roda na thread
 * de UI: cada quadro pedia um passe de medição no JS, disputando com a FlatList
 * que estava desenhando linhas. Daí os espasmos: o valor chegava certo, o
 * desenho é que chegava aos solavancos.
 *
 * Agora o cabeçalho tem altura FIXA (a expandida) e nada nele muda de tamanho.
 * O que se move são transformações:
 *
 *   • o bloco inteiro sobe    `translateY: -min(y, curso)`
 *   • a linha do título desce `translateY: +min(y, curso)`, anulando a subida
 *   • o painel some           `opacity: 1 → 0`
 *
 * O título fica parado na tela enquanto a borda de baixo do navy sobe — que é
 * exatamente a leitura de "encolheu". E as três rodam com `useNativeDriver`,
 * na thread de UI, sem depender do JS para nada. Não há o que travar.
 *
 * O preço é que o cabeçalho passa a ser ABSOLUTO e sair do fluxo: a lista
 * precisa de `paddingTop` igual à altura dele. Por isso a altura é medida e
 * devolvida para a tela, em vez de o cabeçalho se resolver sozinho.
 *
 * ── O FUNDO É VIDRO, E A GEOMETRIA É A DO FIXO ──────────────────────────────
 * Blur com tinta navy, e a linha do título é a mesma <LinhaDoTitulo> do
 * <CabecalhoFixo> (ver `cabecalho-de-vidro.tsx`): recolhido, este cabeçalho é
 * pixel a pixel o das telas sem recorte.
 *
 * ── O BOOLEANO CUSTA UM RENDER POR TRAVESSIA ────────────────────────────────
 * O resumo e a lupa aparecem/somem, e isso é troca de árvore, não de estilo —
 * precisa de estado. Um listener no valor animado o atualiza só quando o limiar
 * é cruzado: um render por travessia, não por quadro.
 */

export interface CabecalhoRetratilProps {
  titulo: string
  /** A linha que assume o lugar do painel quando ele recolhe. */
  resumo?: string
  /** A busca. Recebe o `ref` do campo para o botão de lupa poder focá-lo. */
  busca?: ReactNode
  /** Os filtros, logo abaixo da busca — uma ou mais faixas. */
  chips?: ReactNode
  /** Chamado quando a lupa reabre o cabeçalho — a tela foca o campo. */
  aoReabrir?: () => void
}

/**
 * O deslocamento da lista, e o gesto de voltar ao topo.
 *
 * Reabrir o cabeçalho é ROLAR ATÉ O TOPO, não mexer num estado à parte: com ele
 * sendo função do scroll, qualquer outro caminho criaria um segundo dono da
 * mesma verdade, e os dois discordariam no primeiro gesto.
 */
export function useCabecalhoRetratil<T>() {
  const deslocamento = useRef(new Animated.Value(0)).current
  const listaRef = useRef<FlatList<T>>(null)
  const [recolhido, setRecolhido] = useState(false)
  /** Altura do cabeçalho expandido. A lista a usa como `paddingTop`. */
  const [alturaCabecalho, setAlturaCabecalho] = useState(0)

  const aoRolar = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: deslocamento } } }], {
        // `true`: o caminho inteiro (evento → interpolação → transform) fica na
        // thread de UI. É isso que faz o cabeçalho acompanhar o dedo.
        useNativeDriver: true,
      }),
    [deslocamento],
  )

  useEffect(() => {
    // 12px: acima do repique do `bounce` do iOS, que oscila alguns pixels
    // parado no topo e faria o resumo piscar.
    const id = deslocamento.addListener(({ value }) => setRecolhido(value > 12))
    return () => deslocamento.removeListener(id)
  }, [deslocamento])

  const voltarAoTopo = useCallback(() => {
    listaRef.current?.scrollToOffset({ offset: 0, animated: true })
  }, [])

  return {
    deslocamento,
    recolhido,
    aoRolar,
    listaRef,
    voltarAoTopo,
    alturaCabecalho,
    setAlturaCabecalho,
  }
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
  onAltura,
}: CabecalhoRetratilProps & {
  deslocamento: Animated.Value
  recolhido: boolean
  onExpandir: () => void
  onAltura: (altura: number) => void
}) {
  const { top } = useSafeAreaInsets()
  const [curso, setCurso] = useState(0)

  /*
   * A seta de voltar aparece sozinha quando a tela foi EMPILHADA (explorador
   * sobre o mapa, sacados por NF sobre o funil). O stack entrega isso pelo
   * `HeaderBackContext` mesmo com `headerShown: false`; a raiz de uma aba não
   * o recebe, e fica sem seta — que é o certo, porque ali não há para onde
   * voltar dentro do módulo.
   */
  const temVolta = use(HeaderBackContext) !== undefined
  const navigation = useNavigation()

  /*
   * O curso é a altura do PAINEL: o cabeçalho termina de encolher exatamente
   * quando a lista andou o tanto que o painel ocupava. Um curso fixo faria o
   * encolhimento correr mais rápido ou mais devagar que o dedo.
   *
   * `|| 1` só para o primeiro quadro, antes da medição: um `inputRange` com
   * início igual ao fim é intervalo inválido e o RN reclama.
   */
  const faixa = curso || 1

  const subir = deslocamento.interpolate({
    inputRange: [0, faixa],
    outputRange: [0, -faixa],
    extrapolate: 'clamp',
  })
  const descer = deslocamento.interpolate({
    inputRange: [0, faixa],
    outputRange: [0, faixa],
    extrapolate: 'clamp',
  })
  // Some na METADE do curso: um painel meio-alto e ainda opaco parece cortado
  // ao meio, que é pior que um que desaparece cedo.
  const opacidadePainel = deslocamento.interpolate({
    inputRange: [0, faixa * 0.5],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  })

  return (
    <Animated.View
      onLayout={(e) => onAltura(e.nativeEvent.layout.height)}
      className="absolute left-0 right-0 top-0 overflow-hidden rounded-b-2xl px-5 pb-3"
      style={{ paddingTop: top + 8, transform: [{ translateY: subir }] }}
    >
      <FundoDeVidro />

      <Animated.View style={{ transform: [{ translateY: descer }] }}>
        <LinhaDoTitulo
          titulo={titulo}
          resumo={recolhido ? resumo : undefined}
          voltar={temVolta ? () => navigation.goBack() : undefined}
          extra={
            /* O botão só existe recolhido: expandido, o painel está à vista e um
               botão que rola até ele seria um atalho para o que já se vê. Lupa
               quando há busca; sem ela, o ícone de filtro — uma lupa que abre só
               chips prometeria um campo que não existe. */
            recolhido ? (
              <BotaoDoCabecalho
                accessibilityLabel={busca ? 'Buscar e filtrar' : 'Filtrar'}
                onPress={() => {
                  onExpandir()
                  aoReabrir?.()
                }}
              >
                {busca ? (
                  <Search size={20} color="#FFFFFF" />
                ) : (
                  <ListFilter size={20} color="#FFFFFF" />
                )}
              </BotaoDoCabecalho>
            ) : null
          }
        />
        <BannerBeta />
      </Animated.View>

      {/*
        O painel NÃO muda de altura — ele só desaparece. Quem encolhe o navy é a
        subida do bloco inteiro; deixar o painel também encolher seria animar
        layout de novo, que é o defeito que esta versão existe para não ter.

        `pointerEvents` desligado quando recolhido: invisível mas ainda no
        lugar, ele continuaria roubando o toque destinado aos cards embaixo.
      */}
      <Animated.View
        pointerEvents={recolhido ? 'none' : 'auto'}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height
          setCurso((atual) => (h > atual ? h : atual))
        }}
        className="gap-3 pt-3"
        style={{ opacity: opacidadePainel }}
      >
        {busca}
        {chips}
      </Animated.View>
    </Animated.View>
  )
}
