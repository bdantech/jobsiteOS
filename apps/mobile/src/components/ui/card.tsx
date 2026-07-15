import type { ReactNode } from 'react'
import { View, type ViewProps } from 'react-native'

import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

export interface CardProps extends ViewProps {
  className?: string
  children?: ReactNode
}

export function Card({ className, children, ...props }: CardProps) {
  return (
    <View className={cn('rounded-xl border border-border bg-card', className)} {...props}>
      {children}
    </View>
  )
}

export function CardHeader({ className, children, ...props }: CardProps) {
  return (
    <View className={cn('gap-1 p-4 pb-2', className)} {...props}>
      {children}
    </View>
  )
}

export function CardTitle({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <Text variant="heading" className={className}>
      {children}
    </Text>
  )
}

export function CardDescription({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  return (
    <Text variant="muted" className={className}>
      {children}
    </Text>
  )
}

export function CardContent({ className, children, ...props }: CardProps) {
  return (
    <View className={cn('gap-2 p-4 pt-2', className)} {...props}>
      {children}
    </View>
  )
}

export function CardFooter({ className, children, ...props }: CardProps) {
  return (
    <View className={cn('flex-row items-center gap-2 p-4 pt-0', className)} {...props}>
      {children}
    </View>
  )
}
