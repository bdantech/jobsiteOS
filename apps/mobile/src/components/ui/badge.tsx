import type { ReactNode } from 'react'
import { View, type ViewProps } from 'react-native'

import { TextClassContext } from '@/components/ui/text'
import { cn } from '@/lib/utils'

export type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive' | 'success'

const ROOT: Record<BadgeVariant, string> = {
  default: 'bg-primary border-transparent',
  secondary: 'bg-muted border-transparent',
  outline: 'bg-transparent border-border',
  destructive: 'bg-destructive border-transparent',
  success: 'bg-[#E7F2EC] border-transparent',
}

const LABEL: Record<BadgeVariant, string> = {
  default: 'text-primary-foreground',
  secondary: 'text-primary',
  outline: 'text-foreground',
  destructive: 'text-destructive-foreground',
  success: 'text-[#1E7A4D]',
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
          /*
           * Pílula, não retângulo. No desenho todo estado é um chip redondo —
           * faixa, tipagem, status de crédito. O raio é o que separa "rótulo"
           * de "botão": os botões do app são de canto suave (6–10px), e um
           * badge de canto igual ao do botão convida ao toque.
           */
          'flex-row items-center self-start rounded-full border px-2.5 py-0.5',
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
