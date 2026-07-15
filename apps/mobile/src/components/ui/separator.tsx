import { View, type ViewProps } from 'react-native'

import { cn } from '@/lib/utils'

export interface SeparatorProps extends ViewProps {
  orientation?: 'horizontal' | 'vertical'
  className?: string
}

export function Separator({ orientation = 'horizontal', className, ...props }: SeparatorProps) {
  return (
    <View
      accessibilityRole="none"
      className={cn(
        'bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  )
}
