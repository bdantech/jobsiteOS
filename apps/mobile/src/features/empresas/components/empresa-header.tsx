import { formatCnpj } from '@jobsiteos/core'
import { View } from 'react-native'

import { Badge } from '@/components/ui/badge'
import { Text } from '@/components/ui/text'
import { empresaTitulo, estagioLabel, estagioVariant, localizacao, tipoLabel } from '../format'
import type { Empresa } from '../types'

/** razao_social is shown under the title only when the title is the fantasia name. */
export function EmpresaHeader({ empresa }: { empresa: Empresa }) {
  const titulo = empresaTitulo(empresa)
  const local = localizacao(empresa.municipio, empresa.uf)
  const mostrarRazaoSocial = Boolean(empresa.razao_social) && empresa.razao_social !== titulo

  return (
    <View className="gap-2">
      <Text variant="title">{titulo}</Text>

      {mostrarRazaoSocial ? <Text variant="muted">{empresa.razao_social}</Text> : null}

      <Text variant="muted" selectable>
        {formatCnpj(empresa.cnpj)}
      </Text>

      {local ? <Text variant="muted">{local}</Text> : null}

      <View className="mt-1 flex-row flex-wrap gap-2">
        <Badge variant={estagioVariant(empresa.estagio)}>
          <Text>{estagioLabel(empresa.estagio)}</Text>
        </Badge>
        <Badge variant="outline">
          <Text>{tipoLabel(empresa.tipo)}</Text>
        </Badge>
      </View>
    </View>
  )
}
