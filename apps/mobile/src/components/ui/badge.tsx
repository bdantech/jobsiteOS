import type { ReactNode } from 'react'
import { View, type ViewProps } from 'react-native'

import { TextClassContext } from '@/components/ui/text'
import { cn } from '@/lib/utils'

export type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive' | 'success'

const ROOT: Record<BadgeVariant, string> = {
  default: 'bg-primary border-transparent',
  secondary: 'bg-secondary border-transparent',
  outline: 'bg-transparent border-border',
  destructive: 'bg-destructive border-transparent',
  success: 'bg-primary/15 border-transparent',
}

const LABEL: Record<BadgeVariant, string> = {
  default: 'text-primary-foreground',
  secondary: 'text-secondary-foreground',
  outline: 'text-foreground',
  destructive: 'text-destructive-foreground',
  success: 'text-primary',
}

export interface BadgeProps extends ViewProps {
  variant?: BadgeVariant
  className?: string
  children?: ReactNode
}

export function Badge({ variant = 'default', className, children, ...props }: BadgeProps) {
  return (
    <TextClassContext.Provider value={cn('text-xs font-medium', LABEL[variant])}>
      <View
        className={cn(
          'flex-row items-center self-start rounded-md border px-2 py-0.5',
          ROOT[variant],
          className,
        )}
        {...props}
      >
        {children}
      </View>
    </TextClassContext.Provider>
  )
}
