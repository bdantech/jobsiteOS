import { View, type ViewProps } from 'react-native'

import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

/** "Bruno Chiaroni" → "BC". Diacritics survive: RN renders them fine. */
export function initials(nome: string): string {
  const parts = nome
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)

  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''

  return (first + last).toUpperCase() || '?'
}

export interface AvatarProps extends ViewProps {
  nome: string
  size?: 'sm' | 'default' | 'lg'
  className?: string
}

const SIZE: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'h-8 w-8',
  default: 'h-10 w-10',
  lg: 'h-14 w-14',
}

const TEXT: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'text-xs',
  default: 'text-sm',
  lg: 'text-lg',
}

/** No image support on purpose: this phase has no avatar upload anywhere. */
export function Avatar({ nome, size = 'default', className, ...props }: AvatarProps) {
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={nome}
      className={cn(
        'items-center justify-center rounded-full bg-primary/15',
        SIZE[size],
        className,
      )}
      {...props}
    >
      <Text className={cn('font-semibold text-primary', TEXT[size])}>{initials(nome)}</Text>
    </View>
  )
}
