import type { Camada } from '@jobsiteos/core'
import { useWindowDimensions, View } from 'react-native'
import Svg, { G, Path, Text as SvgText } from 'react-native-svg'

import { useTheme } from '@/components/color-scheme-provider'
import { CAMADA_CHART, formatInteiro, formatPercentual } from '../../format'
import type { ResumoCamada } from '../../types'

export interface PiramideChartProps {
  camadas: ResumoCamada[]
  onSelect: (camada: Camada) => void
}

/** Top of the pyramid down: the narrowest layer is the one hardest to win. */
const ORDEM: readonly Camada[] = ['som', 'sam', 'tam', 'universo']

const ALTURA_BANDA = 54
const ESPACO = 4
/** A perfect apex is a needle: nothing to tap and nowhere to put a label. Cut it. */
const APICE = 0.14
const LARGURA_PIRAMIDE = 0.46

/**
 * The pyramid, on a phone.
 *
 * The four bands have EQUAL height on purpose. Sizing them by share would make
 * `universo` (typically 90%+ of the rows) swallow the chart and squeeze SOM into
 * a 2-pixel sliver that cannot be read or tapped. So the silhouette carries the
 * *concept* — universo ⊃ tam ⊃ sam ⊃ som — and the numbers next to each band
 * carry the *data*, exactly, with no distortion. The proportional encoding lives
 * in the share bar on each layer card below, where a bar can be as long as the
 * truth requires.
 *
 * Tapping a band opens the Explorador pre-filtered by that camada.
 */
export function PiramideChart({ camadas, onSelect }: PiramideChartProps) {
  const { width } = useWindowDimensions()
  const { colors } = useTheme()

  const porCamada = new Map(camadas.map((c) => [c.camada, c]))

  const largura = Math.min(width - 32, 480)
  const larguraPiramide = largura * LARGURA_PIRAMIDE
  const centro = larguraPiramide / 2
  const altura = ALTURA_BANDA * ORDEM.length

  /** Half-width of the pyramid at depth `y`, from the truncated apex to the base. */
  const meiaLargura = (y: number): number =>
    ((APICE + (1 - APICE) * (y / altura)) * larguraPiramide) / 2

  return (
    <View className="items-center">
      <Svg width={largura} height={altura} accessibilityLabel="Pirâmide de mercado">
        {ORDEM.map((camada, i) => {
          const resumo = porCamada.get(camada)
          if (!resumo) return null

          const y0 = i * ALTURA_BANDA + ESPACO / 2
          const y1 = (i + 1) * ALTURA_BANDA - ESPACO / 2
          const hw0 = meiaLargura(y0)
          const hw1 = meiaLargura(y1)

          const d = [
            `M ${centro - hw0} ${y0}`,
            `L ${centro + hw0} ${y0}`,
            `L ${centro + hw1} ${y1}`,
            `L ${centro - hw1} ${y1}`,
            'Z',
          ].join(' ')

          const textoX = larguraPiramide + 14
          const meio = (y0 + y1) / 2

          return (
            <G
              key={camada}
              onPress={() => onSelect(camada)}
              accessibilityRole="button"
              accessibilityLabel={`${resumo.label}: ${formatInteiro(resumo.total)} empresas, ${formatPercentual(resumo.participacao)} do universo. Abrir no Explorador.`}
            >
              {/* An invisible full-width rect would be the ideal hit area, but a
                  transparent fill still receives touches in react-native-svg, so
                  the band + its label already are the target. */}
              {/* Opaque fill straight off the ordinal ramp — no fillOpacity. The
                  ramp's steps were validated as solid colours; compositing them
                  at partial alpha over whatever sits behind the SVG would throw
                  that validation away. `universo` lands below 3:1 against the
                  surface on purpose (it is the least important layer), which is
                  exactly why the total and the share are drawn next to every
                  band: colour is never the only channel here. */}
              <Path d={d} fill={colors[CAMADA_CHART[camada]]} />

              <SvgText
                x={textoX}
                y={meio - 2}
                fill={colors.foreground}
                fontSize={14}
                fontWeight="600"
              >
                {resumo.label}
              </SvgText>
              <SvgText x={textoX} y={meio + 15} fill={colors.mutedForeground} fontSize={12}>
                {`${formatInteiro(resumo.total)} · ${formatPercentual(resumo.participacao)}`}
              </SvgText>
            </G>
          )
        })}
      </Svg>
    </View>
  )
}
