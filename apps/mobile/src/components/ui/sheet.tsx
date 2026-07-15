import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Dimensions, KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

const SCREEN_HEIGHT = Dimensions.get('window').height
const OPEN_MS = 220
const CLOSE_MS = 180

export interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  description?: string
  /** Height of the panel. Default is content-sized with a 90% ceiling. */
  className?: string
  children?: ReactNode
}

/**
 * Bottom sheet. Drives the AI chat (full height) and every confirm/edit flow.
 *
 * Deliberately hand-rolled on Modal + reanimated rather than pulling in a sheet
 * library: we need exactly two behaviours (slide in, drag to dismiss), and the
 * animation must run on the UI thread while the JS thread is streaming tokens
 * from /api/ai — which is precisely when a JS-driven sheet drops frames.
 */
export function Sheet({ open, onOpenChange, title, description, className, children }: SheetProps) {
  const insets = useSafeAreaInsets()
  const [mounted, setMounted] = useState(open)

  const translateY = useSharedValue(SCREEN_HEIGHT)
  const backdropOpacity = useSharedValue(0)

  const close = useCallback(() => onOpenChange(false), [onOpenChange])
  const unmount = useCallback(() => setMounted(false), [])

  useEffect(() => {
    if (open) {
      setMounted(true)
      translateY.value = withTiming(0, { duration: OPEN_MS })
      backdropOpacity.value = withTiming(1, { duration: OPEN_MS })
      return
    }

    backdropOpacity.value = withTiming(0, { duration: CLOSE_MS })
    translateY.value = withTiming(SCREEN_HEIGHT, { duration: CLOSE_MS }, (finished) => {
      // Keep the panel mounted until the exit animation ends, or it vanishes.
      if (finished) runOnJS(unmount)()
    })
  }, [open, translateY, backdropOpacity, unmount])

  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      // Downward only: dragging up must not detach the sheet from the bottom.
      translateY.value = Math.max(0, event.translationY)
    })
    .onEnd((event) => {
      if (event.translationY > 120 || event.velocityY > 900) {
        runOnJS(close)()
      } else {
        translateY.value = withTiming(0, { duration: 150 })
      }
    })

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }))
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }))

  if (!mounted) return null

  return (
    <Modal visible transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <View className="flex-1 justify-end">
        <Animated.View className="absolute inset-0 bg-black/50" style={backdropStyle}>
          <Pressable
            className="flex-1"
            accessibilityRole="button"
            accessibilityLabel="Fechar"
            onPress={close}
          />
        </Animated.View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Animated.View
            style={panelStyle}
            className={cn(
              'max-h-[90%] rounded-t-xl border border-border bg-card',
              className,
            )}
          >
            <GestureDetector gesture={panGesture}>
              <View className="items-center pb-1 pt-2">
                <View className="h-1 w-10 rounded-full bg-muted-foreground/40" />
              </View>
            </GestureDetector>

            {title || description ? (
              <View className="gap-1 px-4 pb-2 pt-1">
                {title ? <Text variant="heading">{title}</Text> : null}
                {description ? <Text variant="muted">{description}</Text> : null}
              </View>
            ) : null}

            <View
              className="flex-shrink px-4 pt-1"
              style={{ paddingBottom: insets.bottom + 16 }}
            >
              {children}
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}
