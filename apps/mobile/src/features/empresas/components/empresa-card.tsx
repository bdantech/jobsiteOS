import { formatCnpj } from '@jobsiteos/core'
import { memo } from 'react'
import { Pressable, View } from 'react-native'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Text } from '@/components/ui/text'
import { empresaTitulo, estagioLabel, estagioVariant, localizacao, tipoLabel } from '../format'
import type { EmpresaListItem } from '../types'

export interface EmpresaCardProps {
  empresa: EmpresaListItem
  onPress: (id: string) => void
}

/** memo: FlatList re-renders rows on every keystroke of the search box otherwise. */
export const EmpresaCard = memo(function EmpresaCard({ empresa, onPress }: EmpresaCardProps) {
  const titulo = empresaTitulo(empresa)
  const local = localizacao(empresa.municipio, empresa.uf)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${titulo}, ${estagioLabel(empresa.estagio)}`}
      onPress={() => onPress(empresa.id)}
      className="active:opacity-80"
    >
      <Card className="gap-2 p-4">
        <View className="flex-row items-start justify-between gap-3">
          <Text variant="label" className="flex-1 text-base" numberOfLines={2}>
            {titulo}
          </Text>
          <Badge variant={estagioVariant(empresa.estagio)}>
            <Text>{estagioLabel(empresa.estagio)}</Text>
          </Badge>
        </View>

        <Text variant="muted">{formatCnpj(empresa.cnpj)}</Text>

        <View className="flex-row items-center gap-2">
          <Text variant="muted" className="text-xs uppercase tracking-wide">
            {tipoLabel(empresa.tipo)}
          </Text>
          {local ? (
            <>
              <Text variant="muted" className="text-xs">
                ·
              </Text>
              <Text variant="muted" className="flex-1 text-xs" numberOfLines={1}>
                {local}
              </Text>
            </>
          ) : null}
        </View>
      </Card>
    </Pressable>
  )
})
