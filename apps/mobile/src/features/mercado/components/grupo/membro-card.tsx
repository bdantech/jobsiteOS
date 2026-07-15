import { memo } from 'react'
import { Pressable, View } from 'react-native'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Text } from '@/components/ui/text'
import { anoDe, camadaLabel, camadaVariant, formatCnpj, formatInteiro, registroTitulo } from '../../format'
import type { MembroGrupo } from '../../types'
import { situacaoLabel, situacaoVariant } from './situacao'

export interface MembroCardProps {
  membro: MembroGrupo
  onPress: (membro: MembroGrupo) => void
}

function obrasTexto(obras: number): string {
  if (obras === 0) return 'Sem obras ativas'
  return obras === 1 ? '1 obra ativa' : `${formatInteiro(obras)} obras ativas`
}

/**
 * One company of the group: ano de abertura, situação and obras — the three
 * things §5.4 asks for, and together they answer the only question that matters
 * about an SPE: is this a live project, or the shell of a finished one?
 *
 * memo: a holding can carry hundreds of these in the FlatList below.
 */
export const MembroCard = memo(function MembroCard({ membro, onPress }: MembroCardProps) {
  const titulo = registroTitulo(membro)
  const ano = anoDe(membro.data_inicio_atividade)
  const situacao = situacaoLabel(membro.situacao_cadastral)
  const obras = membro.obras_ativas ?? 0

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${titulo}${situacao ? `, ${situacao}` : ''}${ano ? `, aberta em ${ano}` : ''}`}
      onPress={() => onPress(membro)}
      className="active:opacity-80"
    >
      <Card className="gap-2 p-4">
        <View className="flex-row items-start justify-between gap-3">
          <Text variant="label" className="flex-1 text-base" numberOfLines={2}>
            {titulo}
          </Text>
          {situacao ? (
            <Badge variant={situacaoVariant(membro.situacao_cadastral)}>
              <Text>{situacao}</Text>
            </Badge>
          ) : null}
        </View>

        {membro.cnpj ? <Text variant="muted">{formatCnpj(membro.cnpj)}</Text> : null}

        <View className="flex-row flex-wrap items-center gap-2">
          {membro.is_spe ? (
            <Badge variant="outline">
              <Text>SPE</Text>
            </Badge>
          ) : null}
          {membro.camada ? (
            <Badge variant={camadaVariant(membro.camada)}>
              <Text>{camadaLabel(membro.camada)}</Text>
            </Badge>
          ) : null}
          {/* Promoted rows have a Company 360 behind them; staging rows do not. */}
          {membro.empresa_id ? (
            <Badge variant="secondary">
              <Text>Na base</Text>
            </Badge>
          ) : null}
        </View>

        <View className="flex-row flex-wrap items-center gap-x-2">
          <Text variant="muted" className="text-xs">
            {ano ? `Aberta em ${ano}` : 'Abertura não informada'}
          </Text>
          <Text variant="muted" className="text-xs">
            ·
          </Text>
          <Text variant="muted" className="text-xs">
            {obrasTexto(obras)}
          </Text>
          {membro.uf ? (
            <>
              <Text variant="muted" className="text-xs">
                ·
              </Text>
              <Text variant="muted" className="text-xs">
                {membro.uf}
              </Text>
            </>
          ) : null}
        </View>
      </Card>
    </Pressable>
  )
})
