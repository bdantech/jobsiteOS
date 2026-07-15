import { formatCnpj } from '@jobsiteos/core'
import { View } from 'react-native'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Text } from '@/components/ui/text'
import { formatData } from './format'
import type { Socio } from './types'

const TIPO_LABELS: Record<string, string> = {
  PF: 'Pessoa física',
  PJ: 'Pessoa jurídica',
  estrangeiro: 'Estrangeiro',
}

/**
 * A sócio-PJ is a CNPJ (14 digits) and worth formatting. A sócio-PF arrives from
 * the Receita as an already-masked CPF ("***123456**") — do NOT run it through
 * formatCnpj, which would return it untouched anyway, but the intent matters:
 * only PJ documents are CNPJs.
 */
function documento(socio: Socio): string | null {
  if (!socio.cpf_cnpj_socio) return null
  return socio.tipo_socio === 'PJ' ? formatCnpj(socio.cpf_cnpj_socio) : socio.cpf_cnpj_socio
}

function SocioItem({ socio }: { socio: Socio }) {
  const doc = documento(socio)
  const entrada = formatData(socio.data_entrada)
  const tipo = socio.tipo_socio ? (TIPO_LABELS[socio.tipo_socio] ?? socio.tipo_socio) : null

  return (
    <View className="gap-1">
      <View className="flex-row items-start justify-between gap-3">
        <Text variant="label" className="flex-1" numberOfLines={2}>
          {socio.nome_socio ?? 'Sócio não identificado'}
        </Text>
        {tipo ? (
          <Badge variant={socio.tipo_socio === 'PJ' ? 'secondary' : 'outline'}>
            <Text>{tipo}</Text>
          </Badge>
        ) : null}
      </View>

      {socio.qualificacao ? (
        <Text variant="muted" className="text-xs">
          {socio.qualificacao}
        </Text>
      ) : null}

      <View className="flex-row flex-wrap items-center gap-x-2">
        {doc ? (
          <Text variant="muted" className="text-xs">
            {doc}
          </Text>
        ) : null}
        {doc && entrada ? (
          <Text variant="muted" className="text-xs">
            ·
          </Text>
        ) : null}
        {entrada ? (
          <Text variant="muted" className="text-xs">
            Entrada em {entrada}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

/** The QSA. Sócios-PJ are what the worker walks to assemble grupos econômicos. */
export function UniversoSocios({ socios }: { socios: Socio[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sócios ({socios.length})</CardTitle>
      </CardHeader>

      <CardContent className="gap-4">
        {socios.length === 0 ? (
          <Text variant="muted">
            Nenhum sócio no quadro societário da Receita para este CNPJ.
          </Text>
        ) : (
          socios.map((socio, index) => (
            <View key={socio.id} className="gap-4">
              {index > 0 ? <Separator /> : null}
              <SocioItem socio={socio} />
            </View>
          ))
        )}
      </CardContent>
    </Card>
  )
}
