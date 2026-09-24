import { BlurView } from 'expo-blur'
import type { NativeStackHeaderProps } from 'expo-router/build/react-navigation/native-stack'
import { HeaderHeightContext } from 'expo-router/react-navigation'
import { ChevronLeft } from 'lucide-react-native'
import { use, type ReactNode } from 'react'
import { Platform, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useTheme } from '@/components/color-scheme-provider'
import { HeaderActions } from '@/components/shell/header-actions'
import { Text } from '@/components/ui/text'
import { BannerBeta } from '@/features/reports'
import type { ColorTokens } from '@/lib/theme'

/**
 * O CABEÇALHO DO APP — um só, em toda tela.
 *
 * ── DOIS MODOS, UMA GEOMETRIA ───────────────────────────────────────────────
 * Tela com busca ou filtro usa o <CabecalhoRetratil>: o painel de recorte mora
 * dentro do navy e sai de cena ao rolar. Tela sem recorte usa o <CabecalhoFixo>,
 * que é EXATAMENTE o retrátil já recolhido — mesma linha de título, mesmo recuo,
 * mesmos botões. As duas montam a mesma <LinhaDoTitulo> sobre o mesmo
 * <FundoDeVidro>, e é isso que impede uma de divergir da outra no primeiro
 * ajuste de espaçamento.
 *
 * O header nativo do stack não é mais desenhado: o `header` de toda pilha é o
 * <CabecalhoFixo> (ver `opcoesDePilha`). Com o nativo, empurrar uma tela trocava
 * a Manrope de 26 pela Poppins de 17 e o topo mudava de altura no meio da
 * animação.
 *
 * ── O VIDRO ─────────────────────────────────────────────────────────────────
 * O mesmo recurso da barra flutuante: BlurView com uma tinta translúcida por
 * cima. Para haver o que borrar, o conteúdo precisa passar POR BAIXO — por isso
 * o cabeçalho flutua (`headerTransparent`) e cada tela reserva o espaço dele com
 * `useRecuoDoCabecalho()` no `paddingTop` do scroll, e não num wrapper em volta.
 * Um wrapper faria a lista começar abaixo do vidro, e ele ficaria borrando o
 * fundo liso da tela.
 *
 * A tinta é o navy a 82%: abaixo disso o título branco perde contraste quando
 * um card claro passa por trás; acima, o blur deixa de ser percebido.
 */

/** Recuo acima da linha do título, somado ao inset da status bar. */
const RECUO_TOPO = 8
/** Altura mínima da linha do título — a dos botões de 44 dela. */
const ALTURA_LINHA = 44
/** Respiro abaixo da linha, até a borda arredondada. */
const RECUO_BASE = 12

/** O navy da marca em rgba, para a tinta do vidro. */
function tintaDoVidro(colors: ColorTokens): string {
  const hex = colors.brand.replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return `rgba(${r},${g},${b},0.82)`
}

/** O fundo: blur + tinta. Absoluto, atrás do conteúdo do cabeçalho. */
export function FundoDeVidro() {
  const { colors } = useTheme()

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <BlurView
        intensity={40}
        tint="dark"
        // Sem isto o BlurView do Android é um retângulo sólido — o mesmo motivo
        // da barra flutuante.
        experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: tintaDoVidro(colors) }]} />
    </View>
  )
}

/** O botão de 44 sobre o navy — voltar, lupa, configurações. */
export function BotaoDoCabecalho({
  onPress,
  accessibilityLabel,
  children,
}: {
  onPress: () => void
  accessibilityLabel: string
  children: ReactNode
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      className="size-11 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] active:opacity-70"
    >
      {children}
    </Pressable>
  )
}

export interface LinhaDoTituloProps {
  titulo: string
  /** A linha menor debaixo do título. */
  resumo?: string
  /** Presente quando há para onde voltar: desenha a seta à esquerda. */
  voltar?: () => void
  /** Botões à direita, antes das ações. */
  extra?: ReactNode
  /** Substitui o par reportar + sino. `null` não desenha nada. */
  acoes?: ReactNode
}

export function LinhaDoTitulo({ titulo, resumo, voltar, extra, acoes }: LinhaDoTituloProps) {
  return (
    <View
      className="flex-row items-center justify-between gap-3"
      style={{ minHeight: ALTURA_LINHA }}
    >
      {voltar ? (
        <BotaoDoCabecalho onPress={voltar} accessibilityLabel="Voltar">
          <ChevronLeft size={22} color="#FFFFFF" />
        </BotaoDoCabecalho>
      ) : null}

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
        {resumo ? (
          <Text numberOfLines={1} className="text-xs leading-4 text-[#CBD5E1]">
            {resumo}
          </Text>
        ) : null}
      </View>

      {/* `gap-3`: com `gap-2` a lupa e o sino pareciam um botão só, e o contador
          na quina do sino encostava na lupa. */}
      <View className="flex-row items-center gap-3">
        {extra}
        {acoes === undefined ? <HeaderActions /> : acoes}
      </View>
    </View>
  )
}

export interface CabecalhoFixoProps extends LinhaDoTituloProps {}

/**
 * O cabeçalho sempre recolhido, para as telas sem busca nem filtro.
 *
 * NO FLUXO, e não absoluto: quem o faz flutuar é quem o monta — o stack, com
 * `headerTransparent`, ou a tela, com um wrapper absoluto. Absoluto aqui dentro,
 * o container do stack mediria altura zero e o `HeaderHeightContext` mentiria
 * para todas as telas.
 */
export function CabecalhoFixo(props: CabecalhoFixoProps) {
  const { top } = useSafeAreaInsets()

  return (
    <View
      className="overflow-hidden rounded-b-2xl px-5"
      style={{ paddingTop: top + RECUO_TOPO, paddingBottom: RECUO_BASE }}
    >
      <FundoDeVidro />
      <LinhaDoTitulo {...props} />
      <BannerBeta />
    </View>
  )
}

/**
 * Quanto a tela precisa reservar no topo do scroll para o cabeçalho fixo.
 *
 * O `HeaderHeightContext` traz a altura MEDIDA, mas só depois do primeiro
 * layout: antes disso ele vale o default do React Navigation (inset + 44 no
 * iOS), 20px a menos que este cabeçalho. Usá-lo cru faria cada tela empurrada
 * nascer com a lista 20px alta e descer no quadro seguinte. O piso calculado
 * pela mesma geometria da <LinhaDoTitulo> acerta o primeiro quadro; a medida só
 * ganha quando é MAIOR — com a tarja de beta, que a geometria não conhece.
 */
export function useRecuoDoCabecalho(): number {
  const medido = use(HeaderHeightContext) ?? 0
  const { top } = useSafeAreaInsets()
  return Math.max(medido, top + RECUO_TOPO + ALTURA_LINHA + RECUO_BASE)
}

/**
 * Para o que NÃO rola — esqueleto, erro, vazio devolvidos antes da lista.
 *
 * Esses estados nascem colados no topo, e sem o recuo começariam atrás do
 * vidro: o esqueleto pareceria cortado e o botão "Tentar de novo" do erro
 * ficaria por baixo do título. Scroll de verdade NÃO usa isto — ele leva o
 * recuo no `contentContainerStyle`, para poder passar sob o vidro.
 */
export function AbaixoDoCabecalho({ children }: { children: ReactNode }) {
  const recuo = useRecuoDoCabecalho()
  return (
    <View className="flex-1 bg-background" style={{ paddingTop: recuo }}>
      {children}
    </View>
  )
}

/** O `header` de toda pilha: o título da rota, a seta quando há para onde voltar. */
function CabecalhoDaPilha({ options, route, navigation, back }: NativeStackHeaderProps) {
  const titulo = typeof options.title === 'string' ? options.title : route.name
  const acoes = options.headerRight
    ? options.headerRight({ canGoBack: back !== undefined, tintColor: '#FFFFFF' })
    : null

  return (
    <CabecalhoFixo
      titulo={titulo}
      voltar={back ? () => navigation.goBack() : undefined}
      acoes={acoes}
    />
  )
}

/**
 * As opções compartilhadas por TODO stack do app — o de cada módulo e o raiz
 * (Configurações, o report do deep link).
 *
 * Moravam em `lib/theme.ts` enquanto eram só cores. Agora carregam o componente
 * do cabeçalho, e o tema importar a casca criaria um ciclo com quem importa o
 * tema.
 */
export function opcoesDePilha(colors: ColorTokens) {
  return {
    header: (props: NativeStackHeaderProps) => <CabecalhoDaPilha {...props} />,
    // O cabeçalho flutua sobre a cena, e é isso que dá ao vidro o que borrar.
    headerTransparent: true,
    contentStyle: { backgroundColor: colors.background },
  } as const
}
