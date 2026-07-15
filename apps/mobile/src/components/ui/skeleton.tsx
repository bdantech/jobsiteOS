import { useEffect } from 'react'
import type { ViewProps } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

import { cn } from '@/lib/utils'

export interface SkeletonProps extends ViewProps {
  className?: string
}

/**
 * The loading state of every list, card and detail screen. Pulses on the UI
 * thread (reanimated), so it keeps animating while JS is busy parsing the very
 * response it is waiting for — which is exactly when a JS-driven pulse stutters.
 */
export function Skeleton({ className, style, ...props }: SkeletonProps) {
  const opacity = useSharedValue(0.5)

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    )
  }, [opacity])

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))

  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel="Carregando"
      className={cn('rounded-md bg-muted', className)}
      style={[animatedStyle, style]}
      {...props}
    />
  )
}
