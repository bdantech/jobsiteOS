import { formatCnpj } from '@jobsiteos/core'
import { View } from 'react-native'

import { Badge } from '@/components/ui/badge'
import { Text } from '@/components/ui/text'
import {
  camadaLabel,
  camadaVariant,
  localizacao,
  situacaoLabel,
  situacaoVariant,
} from './format'
import type { UniversoRegistro } from './types'

/**
 * Identity of a universe record: who it is, and the ONE axis that exists for a
 * company nobody has spoken to yet — `camada`. There is no `estagio` here: a
 * staging row has no relationship history, and inventing one would conflate the
 * two axes the module exists to keep apart.
 */
export function UniversoHeader({ universo }: { universo: UniversoRegistro }) {
  const titulo = universo.nome_fantasia || universo.razao_social || formatCnpj(universo.cnpj)
  const local = localizacao(universo.municipio, universo.uf)
  const situacao = situacaoLabel(universo.situacao_cadastral)

  // The razão social is worth showing on its own line only when it isn't the title.
  const subtitulo = universo.nome_fantasia && universo.razao_social ? universo.razao_social : null

  return (
    <View className="gap-2">
      <Text variant="title">{titulo}</Text>

      {subtitulo ? <Text variant="muted">{subtitulo}</Text> : null}

      <Text variant="muted">{formatCnpj(universo.cnpj)}</Text>

      {local ? <Text variant="muted">{local}</Text> : null}

      <View className="mt-1 flex-row flex-wrap gap-2">
        <Badge variant={camadaVariant(universo.camada)}>
          <Text>{camadaLabel(universo.camada)}</Text>
        </Badge>

        {situacao ? (
          <Badge variant={situacaoVariant(universo.situacao_cadastral)}>
            <Text>{situacao}</Text>
          </Badge>
        ) : null}

        {universo.is_spe ? (
          <Badge variant="outline">
            <Text>SPE</Text>
          </Badge>
        ) : null}

        {universo.matriz_filial ? (
          <Badge variant="outline">
            <Text>{universo.matriz_filial}</Text>
          </Badge>
        ) : null}
      </View>
    </View>
  )
}
