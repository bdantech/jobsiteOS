import { View } from 'react-native'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Text } from '@/components/ui/text'
import { formatData, formatM2, localizacao, situacaoObraVariant } from './format'
import type { Obra } from './types'

function ObraItem({ obra }: { obra: Obra }) {
  const local = localizacao(obra.municipio, obra.uf)
  const inicio = formatData(obra.data_inicio_obra)

  const detalhes = [obra.destinacao, obra.categoria, obra.tipo_obra].filter(
    (parte): parte is string => Boolean(parte),
  )

  return (
    <View className="gap-1">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-0.5">
          <Text variant="label">CNO {obra.cno}</Text>
          {local ? (
            <Text variant="muted" className="text-xs" numberOfLines={1}>
              {local}
            </Text>
          ) : null}
        </View>

        {obra.situacao ? (
          <Badge variant={situacaoObraVariant(obra.situacao)}>
            <Text>{obra.situacao}</Text>
          </Badge>
        ) : null}
      </View>

      {detalhes.length > 0 ? (
        <Text variant="muted" className="text-xs" numberOfLines={2}>
          {detalhes.join(' · ')}
        </Text>
      ) : null}

      <View className="flex-row flex-wrap items-center gap-x-2">
        {obra.metragem_m2 !== null ? (
          <Text variant="muted" className="text-xs">
            {formatM2(obra.metragem_m2)}
          </Text>
        ) : null}
        {obra.metragem_m2 !== null && inicio ? (
          <Text variant="muted" className="text-xs">
            ·
          </Text>
        ) : null}
        {inicio ? (
          <Text variant="muted" className="text-xs">
            Início em {inicio}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

/**
 * Obras from the CNO, matched on `ni_responsavel` = this CNPJ.
 *
 * An empty list is NOT "this company builds nothing": the CNO registers the
 * party responsible for the work, which for an incorporadora is usually the SPE,
 * not the holding. Say that, rather than implying an absence of activity.
 */
export function UniversoObras({ obras }: { obras: Obra[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Obras — CNO ({obras.length})</CardTitle>
      </CardHeader>

      <CardContent className="gap-4">
        {obras.length === 0 ? (
          <Text variant="muted">
            Nenhuma obra registrada no CNO sob este CNPJ. Em incorporadoras, as obras costumam estar
            no CNPJ da SPE, não no da holding.
          </Text>
        ) : (
          obras.map((obra, index) => (
            <View key={obra.cno} className="gap-4">
              {index > 0 ? <Separator /> : null}
              <ObraItem obra={obra} />
            </View>
          ))
        )}
      </CardContent>
    </Card>
  )
}
