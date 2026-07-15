import type { Camada } from '@jobsiteos/core'
import { ChevronRight } from 'lucide-react-native'
import { Pressable, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { Text } from '@/components/ui/text'
import { camadaVariant, formatInteiro, formatPercentual } from '../../format'
import type { IndicadorCamada, ResumoCamada } from '../../types'

export interface CamadaCardProps {
  resumo: ResumoCamada
  onPress: (camada: Camada) => void
}

/** The proportional encoding the pyramid deliberately does not carry. */
function ShareBar({ participacao }: { participacao: number }) {
  // A layer with 0.2% of the universe still has to be visible as *something*.
  const largura = participacao > 0 ? Math.max(participacao, 1.5) : 0

  return (
    <View className="h-1.5 overflow-hidden rounded-full bg-muted">
      <View className="h-full rounded-full bg-primary" style={{ width: `${largura}%` }} />
    </View>
  )
}

function Indicador({ indicador, total }: { indicador: IndicadorCamada; total: number }) {
  return (
    <View className="w-[47%] gap-0.5" accessibilityLabel={indicador.descricao}>
      <Text className="text-base font-semibold text-foreground">
        {total > 0 ? formatPercentual(indicador.participacao) : '—'}
      </Text>
      <Text variant="muted" className="text-xs">
        {indicador.label}
      </Text>
      <Text variant="muted" className="text-xs opacity-70">
        {formatInteiro(indicador.total)}
      </Text>
    </View>
  )
}

/**
 * One layer of the pyramid: how many companies are in it, what share of the
 * universe that is, and how many of them carry each commercial signal.
 *
 * Every number here is an exact count. The indicators are shares OF THE LAYER
 * ("38% do SAM tem ERP identificado"), not of the universe — a percentage of a
 * percentage would be unreadable.
 */
export function CamadaCard({ resumo, onPress }: CamadaCardProps) {
  const { colors } = useTheme()
  const vazia = resumo.total === 0

  return (
    <Pressable
      onPress={() => onPress(resumo.camada)}
      accessibilityRole="button"
      accessibilityLabel={`${resumo.label}: ${formatInteiro(resumo.total)} empresas. Abrir no Explorador.`}
      className="gap-3 rounded-xl border border-border bg-card p-4 active:opacity-80"
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <View className="flex-row items-center gap-2">
            <Badge variant={camadaVariant(resumo.camada)}>
              <Text>{resumo.label}</Text>
            </Badge>
            <Text variant="muted" className="text-xs">
              {formatPercentual(resumo.participacao)} do universo
            </Text>
          </View>
          <Text variant="muted" className="text-xs">
            {resumo.descricao}
          </Text>
        </View>

        <View className="flex-row items-center gap-1">
          <Text variant="title" className="text-xl">
            {formatInteiro(resumo.total)}
          </Text>
          <ChevronRight size={18} color={colors.mutedForeground} />
        </View>
      </View>

      <ShareBar participacao={resumo.participacao} />

      {vazia ? (
        <Text variant="muted" className="text-xs">
          Nenhuma empresa nesta camada ainda.
        </Text>
      ) : (
        <View className="flex-row flex-wrap gap-3 pt-1">
          {resumo.indicadores.map((indicador) => (
            <Indicador key={indicador.id} indicador={indicador} total={resumo.total} />
          ))}
        </View>
      )}
    </Pressable>
  )
}
