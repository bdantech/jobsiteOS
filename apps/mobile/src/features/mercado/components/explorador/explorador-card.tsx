import { ESTAGIO_LABELS, formatCnpj, type Estagio } from '@jobsiteos/core'
import { memo } from 'react'
import { Pressable, View } from 'react-native'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Text } from '@/components/ui/text'
import { camadaLabel, camadaVariant, formatMoeda, localizacao, tituloEmpresa } from './format'
import type { ExploradorListItem } from './types'

export interface ExploradorCardProps {
  row: ExploradorListItem
  onPress: (row: ExploradorListItem) => void
}

/** One fact, one label. Empty facts are dropped rather than rendered as "—". */
function Fato({ children }: { children: string }) {
  return (
    <Text variant="muted" className="text-xs">
      {children}
    </Text>
  )
}

/** memo: FlatList re-renders every row on each keystroke of the search box otherwise. */
export const ExploradorCard = memo(function ExploradorCard({ row, onPress }: ExploradorCardProps) {
  const titulo = tituloEmpresa(row)
  const local = localizacao(row.municipio, row.uf)
  const capital = formatMoeda(row.capital_social)
  const promovida = row.empresa_id !== null

  const fatos: string[] = []
  if (capital) fatos.push(`Capital ${capital}`)
  if (row.obras_ativas && row.obras_ativas > 0) fatos.push(`${row.obras_ativas} obra(s) ativa(s)`)
  if (row.erp_atual) fatos.push(`ERP ${row.erp_atual}`)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${titulo}, camada ${camadaLabel(row.camada)}${
        promovida ? ', já na base de Empresas' : ''
      }`}
      onPress={() => onPress(row)}
      className="active:opacity-80"
    >
      <Card className="gap-2 p-4">
        <View className="flex-row items-start justify-between gap-3">
          <Text variant="label" className="flex-1 text-base" numberOfLines={2}>
            {titulo}
          </Text>
          <Badge variant={camadaVariant(row.camada)}>
            <Text>{camadaLabel(row.camada)}</Text>
          </Badge>
        </View>

        <View className="flex-row items-center gap-2">
          <Text variant="muted">{formatCnpj(row.cnpj)}</Text>
          {row.is_spe ? (
            <Badge variant="outline">
              <Text>SPE</Text>
            </Badge>
          ) : null}
        </View>

        {local ? (
          <Text variant="muted" className="text-xs" numberOfLines={1}>
            {local}
          </Text>
        ) : null}

        {fatos.length > 0 ? (
          <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
            {fatos.map((fato, index) => (
              <View key={fato} className="flex-row items-center gap-2">
                {index > 0 ? <Fato>·</Fato> : null}
                <Fato>{fato}</Fato>
              </View>
            ))}
          </View>
        ) : null}

        {/* `estagio` is the RELATIONSHIP axis and only exists once a company is
            promoted; `camada` above is the MARKET axis. Never one in place of the
            other. */}
        {promovida ? (
          <Text variant="muted" className="text-xs text-primary">
            Na base de Empresas
            {row.estagio ? ` · ${ESTAGIO_LABELS[row.estagio as Estagio] ?? row.estagio}` : ''}
          </Text>
        ) : null}
      </Card>
    </Pressable>
  )
})
