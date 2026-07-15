import { forwardRef } from 'react'
import { TextInput, View, type TextInputProps } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

export interface InputProps extends TextInputProps {
  label?: string
  /** pt-BR message under the field. Also flips the border red. */
  error?: string
  className?: string
  containerClassName?: string
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, className, containerClassName, editable = true, ...props },
  ref,
) {
  const { colors } = useTheme()

  return (
    <View className={cn('gap-1.5', containerClassName)}>
      {label ? <Text variant="label">{label}</Text> : null}

      <TextInput
        ref={ref}
        editable={editable}
        placeholderTextColor={colors.mutedForeground}
        selectionColor={colors.primary}
        accessibilityLabel={label}
        className={cn(
          'h-12 rounded-lg border border-input bg-background px-4 text-base text-foreground',
          error ? 'border-destructive' : 'focus:border-primary',
          !editable && 'opacity-50',
          className,
        )}
        {...props}
      />

      {error ? <Text variant="destructive">{error}</Text> : null}
    </View>
  )
})
