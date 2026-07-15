import { ActivityIndicator, Pressable, View, type PressableProps } from 'react-native'
import type { ReactNode } from 'react'

import { useTheme } from '@/components/color-scheme-provider'
import { TextClassContext } from '@/components/ui/text'
import { cn } from '@/lib/utils'

export type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive'
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon'

const ROOT: Record<ButtonVariant, string> = {
  default: 'bg-primary active:opacity-90',
  secondary: 'bg-secondary active:opacity-90',
  outline: 'border border-input bg-background active:bg-secondary',
  ghost: 'bg-transparent active:bg-secondary',
  destructive: 'bg-destructive active:opacity-90',
}

const LABEL: Record<ButtonVariant, string> = {
  default: 'text-primary-foreground font-semibold',
  secondary: 'text-secondary-foreground font-semibold',
  outline: 'text-foreground font-semibold',
  ghost: 'text-foreground font-semibold',
  destructive: 'text-destructive-foreground font-semibold',
}

const SIZE: Record<ButtonSize, string> = {
  default: 'h-12 px-5',
  sm: 'h-9 px-3',
  lg: 'h-14 px-6',
  icon: 'h-10 w-10',
}

export interface ButtonProps extends Omit<PressableProps, 'children'> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  className?: string
  children?: ReactNode
}

export function Button({
  variant = 'default',
  size = 'default',
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  const { colors } = useTheme()
  const isDisabled = disabled === true || loading

  const spinnerColor =
    variant === 'default' || variant === 'destructive' ? colors.primaryForeground : colors.foreground

  return (
    <TextClassContext.Provider value={LABEL[variant]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        disabled={isDisabled}
        className={cn(
          'flex-row items-center justify-center gap-2 rounded-lg',
          ROOT[variant],
          SIZE[size],
          isDisabled && 'opacity-50',
          className,
        )}
        {...props}
      >
        {loading ? (
          <ActivityIndicator size="small" color={spinnerColor} />
        ) : (
          <View className="flex-row items-center justify-center gap-2">{children}</View>
        )}
      </Pressable>
    </TextClassContext.Provider>
  )
}
