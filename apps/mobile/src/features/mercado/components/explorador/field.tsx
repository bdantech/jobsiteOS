import { View } from 'react-native'

import { Text } from '@/components/ui/text'

export interface FieldProps {
  label: string
  value: string | null
}

/** An unfilled Receita field is information too — say so instead of hiding the row. */
export function Field({ label, value }: FieldProps) {
  return (
    <View className="gap-0.5">
      <Text variant="muted" className="text-xs uppercase tracking-wide">
        {label}
      </Text>
      <Text className={value ? undefined : 'text-muted-foreground'}>{value ?? 'Não informado'}</Text>
    </View>
  )
}

/**
 * Two fields side by side — the sheet has a lot of short values.
 *
 * Takes the fields as props rather than children: NativeWind has no arbitrary
 * child selector (`[&>*]:flex-1` is a no-op in RN), so the flex-1 has to be on a
 * real wrapper View.
 */
export function FieldPair({ left, right }: { left: FieldProps; right: FieldProps }) {
  return (
    <View className="flex-row gap-4">
      <View className="flex-1">
        <Field {...left} />
      </View>
      <View className="flex-1">
        <Field {...right} />
      </View>
    </View>
  )
}
