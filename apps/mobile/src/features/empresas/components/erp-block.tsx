import { View } from 'react-native'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Text } from '@/components/ui/text'
import { formatMrr } from '../format'
import type { Empresa } from '../types'

function Field({
  label,
  value,
  hint,
}: {
  label: string
  value: string | null
  hint?: string
}) {
  return (
    <View className="gap-0.5">
      <Text variant="muted" className="text-xs uppercase tracking-wide">
        {label}
      </Text>
      {/* An unfilled field is information too — say so instead of hiding the row. */}
      <Text className={value ? undefined : 'text-muted-foreground'}>{value ?? 'Não informado'}</Text>
      {hint ? (
        <Text variant="muted" className="text-xs">
          {hint}
        </Text>
      ) : null}
    </View>
  )
}

/**
 * The ERP block the spec calls for: erp_atual, erp_mrr, erp_canal_venda.
 *
 * `erp_mrr` is what the company pays for the ERP it uses TODAY (`erp_atual`) —
 * it is NOT ONE OS revenue, and only coincides with it when the current ERP is
 * the Brik. A bare "MRR" inside a card titled "ERP" is exactly the ambiguity that
 * made people read this as our own MRR, so the label says "MRR do ERP" and the
 * hint says whose money it is.
 */
export function ErpBlock({ empresa }: { empresa: Empresa }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>ERP</CardTitle>
      </CardHeader>
      <CardContent className="gap-3">
        <Field label="ERP atual" value={empresa.erp_atual} />
        <Field
          label="MRR do ERP"
          value={formatMrr(empresa.erp_mrr)}
          hint="Valor mensal que a empresa paga pelo ERP que usa hoje."
        />
        <Field label="Canal de venda" value={empresa.erp_canal_venda} />
      </CardContent>
    </Card>
  )
}
