import { View } from 'react-native'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Text } from '@/components/ui/text'
import { formatInteiro, formatMoedaCompacta } from '../../format'
import type { GrupoMetricas as Metricas } from '../../types'

function Metrica({ label, valor, hint }: { label: string; valor: string; hint?: string }) {
  return (
    <View className="w-1/2 gap-0.5 pb-4 pr-3">
      <Text variant="muted" className="text-xs uppercase tracking-wide">
        {label}
      </Text>
      <Text variant="heading" numberOfLines={1}>
        {valor}
      </Text>
      {hint ? (
        <Text variant="muted" className="text-xs">
          {hint}
        </Text>
      ) : null}
    </View>
  )
}

export interface GrupoMetricasProps {
  metricas: Metricas
  /** Sum of `obras_ativas` over the members actually loaded — see `truncado`. */
  obrasAtivas: number
  /** True when the member list was capped: the obra sum then covers only part of the group. */
  truncado: boolean
}

/**
 * Group-level metrics, §5.4.
 *
 * These are the numbers that dimension an incorporadora correctly. SPE count and
 * SPE velocity (24m) say how fast it launches; obras say how much it is building
 * right now. `empresas_total`, `spes_total` and `capital_agregado` come from the
 * server and cover the WHOLE group even when the list below is capped — the obra
 * sum is the one derived from the loaded rows, and it says so.
 */
export function GrupoMetricas({ metricas, obrasAtivas, truncado }: GrupoMetricasProps) {
  const ufs = metricas.ufs.length > 0 ? metricas.ufs.join(', ') : 'Não informado'

  return (
    <Card>
      <CardHeader>
        <CardTitle>Métricas do grupo</CardTitle>
      </CardHeader>

      <CardContent>
        <View className="flex-row flex-wrap">
          <Metrica label="Empresas" valor={formatInteiro(metricas.empresas_total)} />
          <Metrica label="SPEs" valor={formatInteiro(metricas.spes_total)} />
          <Metrica
            label="SPEs em 24m"
            valor={formatInteiro(metricas.spes_24m)}
            hint="Abertas nos últimos 24 meses"
          />
          <Metrica
            label="Empresas com obra"
            valor={formatInteiro(metricas.empresas_com_obra)}
            hint="Com ao menos uma obra ativa"
          />
          <Metrica
            label="Obras ativas"
            valor={formatInteiro(obrasAtivas)}
            hint={truncado ? 'Soma das empresas carregadas' : undefined}
          />
          {/* Capital agregado is null until the worker has computed it. "—" is the
              truth; "R$ 0" would be a claim about the group's size. */}
          <Metrica label="Capital agregado" valor={formatMoedaCompacta(metricas.capital_agregado)} />
        </View>

        <View className="gap-0.5">
          <Text variant="muted" className="text-xs uppercase tracking-wide">
            UFs
          </Text>
          <Text>{ufs}</Text>
        </View>
      </CardContent>
    </Card>
  )
}
