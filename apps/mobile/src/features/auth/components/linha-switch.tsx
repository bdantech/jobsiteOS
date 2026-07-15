import { ActivityIndicator, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Switch } from '@/components/ui/switch'
import { Text } from '@/components/ui/text'

export interface LinhaSwitchProps {
  titulo: string
  descricao?: string
  value: boolean
  onValueChange: (value: boolean) => void
  disabled?: boolean
  /** Shows a spinner in place of the switch while the write is in flight. */
  loading?: boolean
}

/** One labelled setting with a switch on the right. */
export function LinhaSwitch({
  titulo,
  descricao,
  value,
  onValueChange,
  disabled = false,
  loading = false,
}: LinhaSwitchProps) {
  const { colors } = useTheme()

  return (
    <View className="flex-row items-center justify-between gap-4 py-3">
      <View className={`flex-1 gap-1 ${disabled ? 'opacity-50' : ''}`}>
        <Text variant="label">{titulo}</Text>
        {descricao ? <Text variant="muted">{descricao}</Text> : null}
      </View>

      {loading ? (
        <View className="h-8 w-12 items-center justify-center">
          <ActivityIndicator size="small" color={colors.mutedForeground} />
        </View>
      ) : (
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          accessibilityLabel={titulo}
        />
      )}
    </View>
  )
}
