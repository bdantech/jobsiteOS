import type { ReactNode } from 'react'
import { View } from 'react-native'

import { HeaderActions } from '@/components/shell/header-actions'
import { Text } from '@/components/ui/text'

export interface ScreenHeaderProps {
  title: string
  description?: string
  /** Substitui o par reportar + sino. Pass `null` to render no action at all. */
  right?: ReactNode
}

/**
 * Header for screens that render outside a module stack — i.e. the tabs whose
 * navigator has `headerShown: false`. Mantém reportar e sino no mesmo lugar em
 * que eles ficam em toda tela de stack.
 */
export function ScreenHeader({ title, description, right }: ScreenHeaderProps) {
  return (
    <View className="flex-row items-start justify-between gap-3 px-4 pb-2 pt-2">
      <View className="flex-1 gap-1">
        <Text variant="title">{title}</Text>
        {description ? <Text variant="muted">{description}</Text> : null}
      </View>

      {right === undefined ? <HeaderActions /> : right}
    </View>
  )
}
