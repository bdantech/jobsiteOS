import type { ReactNode } from 'react'
import { Modal, Pressable, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  className?: string
  children?: ReactNode
}

/**
 * Centred modal. Use it for confirmations — including the one the AI Bar needs
 * before running a `mutates: true` tool ("A IA quer criar X — confirmar?").
 * Anything with a form or a long body belongs in <Sheet> instead.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  className,
  children,
}: DialogProps) {
  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => onOpenChange(false)}
    >
      <View className="flex-1 items-center justify-center p-6">
        <Pressable
          className="absolute inset-0 bg-black/50"
          accessibilityRole="button"
          accessibilityLabel="Fechar"
          onPress={() => onOpenChange(false)}
        />

        <View className={cn('w-full max-w-md gap-4 rounded-xl border border-border bg-card p-5', className)}>
          <View className="gap-1">
            <Text variant="heading">{title}</Text>
            {description ? <Text variant="muted">{description}</Text> : null}
          </View>

          {children}
        </View>
      </View>
    </Modal>
  )
}

export interface ConfirmDialogProps extends Omit<DialogProps, 'children'> {
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  loading?: boolean
  onConfirm: () => void
}

export function ConfirmDialog({
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  destructive = false,
  loading = false,
  onConfirm,
  onOpenChange,
  ...props
}: ConfirmDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} {...props}>
      <View className="flex-row justify-end gap-2">
        <Button variant="ghost" onPress={() => onOpenChange(false)} disabled={loading}>
          <Text>{cancelLabel}</Text>
        </Button>
        <Button
          variant={destructive ? 'destructive' : 'default'}
          onPress={onConfirm}
          loading={loading}
        >
          <Text>{confirmLabel}</Text>
        </Button>
      </View>
    </Dialog>
  )
}
