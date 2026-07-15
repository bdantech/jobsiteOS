import { AlertTriangle, Inbox } from 'lucide-react-native'
import { View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

export interface EmptyStateProps {
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  className?: string
}

/** The empty state every list screen owes the user. pt-BR copy, always. */
export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  className,
}: EmptyStateProps) {
  const { colors } = useTheme()

  return (
    <View className={cn('items-center justify-center gap-3 px-8 py-16', className)}>
      <View className="h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Inbox size={22} color={colors.mutedForeground} />
      </View>
      <Text variant="heading" className="text-center">
        {title}
      </Text>
      {description ? (
        <Text variant="muted" className="text-center">
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button variant="outline" size="sm" onPress={onAction} className="mt-1">
          <Text>{actionLabel}</Text>
        </Button>
      ) : null}
    </View>
  )
}

export interface ErrorStateProps {
  title?: string
  description?: string
  onRetry?: () => void
  className?: string
}

export function ErrorState({
  title = 'Algo deu errado',
  description = 'Não foi possível carregar os dados. Verifique sua conexão e tente novamente.',
  onRetry,
  className,
}: ErrorStateProps) {
  const { colors } = useTheme()

  return (
    <View className={cn('items-center justify-center gap-3 px-8 py-16', className)}>
      <View className="h-12 w-12 items-center justify-center rounded-full bg-destructive/15">
        <AlertTriangle size={22} color={colors.destructive} />
      </View>
      <Text variant="heading" className="text-center">
        {title}
      </Text>
      <Text variant="muted" className="text-center">
        {description}
      </Text>
      {onRetry ? (
        <Button variant="outline" size="sm" onPress={onRetry} className="mt-1">
          <Text>Tentar novamente</Text>
        </Button>
      ) : null}
    </View>
  )
}
