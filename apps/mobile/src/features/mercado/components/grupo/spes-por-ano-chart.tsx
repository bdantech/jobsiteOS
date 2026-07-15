import { View } from 'react-native'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Text } from '@/components/ui/text'
import { formatInteiro } from '../../format'
import type { SpesPorAno } from '../../types'

/** Tall enough to read a trend on a phone, short enough not to push the list below the fold. */
const ALTURA_MAXIMA = 88
/** A year with zero SPEs still gets a sliver, so the baseline reads as a baseline. */
const ALTURA_MINIMA = 3
/** Eight 4-digit labels is what fits across a phone without rotating them. */
const MAX_BARRAS = 8

export interface SpesPorAnoChartProps {
  spesPorAno: SpesPorAno[]
  /** True when the member list was capped: the chart then covers only what we loaded. */
  truncado?: boolean
}

/**
 * SPEs opened per year — the launch cadence of an incorporadora, and the single
 * most predictive signal in this market: a group that opened six SPEs last year
 * is building; one that has opened none in three years is winding down.
 *
 * Drawn with plain Views, not SVG: eight bars need no renderer, and this way the
 * bars inherit the theme's accent in both light and dark for free.
 */
export function SpesPorAnoChart({ spesPorAno, truncado = false }: SpesPorAnoChartProps) {
  // The most recent years are the ones that carry signal; drop the tail.
  const barras = spesPorAno.slice(-MAX_BARRAS)
  const maximo = barras.reduce((maior, barra) => Math.max(maior, barra.total), 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>SPEs por ano</CardTitle>
        <CardDescription>
          {truncado
            ? 'Considera apenas as empresas carregadas nesta tela.'
            : 'SPEs abertas em cada ano.'}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {maximo === 0 ? (
          <Text variant="muted">Nenhuma SPE com data de abertura conhecida neste grupo.</Text>
        ) : (
          <View
            className="flex-row items-end gap-2 pt-2"
            accessibilityLabel={`SPEs abertas por ano: ${barras
              .map((barra) => `${barra.ano}, ${barra.total}`)
              .join('; ')}`}
          >
            {barras.map((barra) => (
              <View key={barra.ano} className="flex-1 items-center gap-1">
                <Text variant="muted" className="text-[10px]">
                  {formatInteiro(barra.total)}
                </Text>
                <View
                  className="w-full rounded-t-md bg-primary"
                  style={{
                    height:
                      barra.total === 0
                        ? ALTURA_MINIMA
                        : Math.max(
                            ALTURA_MINIMA,
                            Math.round((barra.total / maximo) * ALTURA_MAXIMA),
                          ),
                  }}
                />
                <Text variant="muted" className="text-[10px]" numberOfLines={1}>
                  {barra.ano}
                </Text>
              </View>
            ))}
          </View>
        )}
      </CardContent>
    </Card>
  )
}
