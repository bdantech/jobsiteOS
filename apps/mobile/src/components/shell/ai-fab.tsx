import { Sparkles } from 'lucide-react-native'
import { Platform, Pressable } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useTheme } from '@/components/color-scheme-provider'
import { AiChatSheet } from '@/features/ai/ai-chat-sheet'
import { useAiChatStore } from '@/features/ai/store'

/**
 * React Navigation's default bottom tab bar, before safe-area padding. The FAB
 * cannot ask for the real value — useBottomTabBarHeight() only works inside a
 * screen, and this renders in the layout, as a sibling of the whole navigator.
 * The 16px gap below absorbs any per-platform drift.
 */
const TAB_BAR_HEIGHT = Platform.select({ ios: 49, default: 56 })
const GAP = 16

/**
 * The AI entry point: floating, bottom-right, above the tab bar, on every tab.
 *
 * Placement is the shell's job, which is why this exists rather than reusing
 * src/features/ai/ai-fab.tsx: that one is pinned at `bottom-5`, which on a tab
 * screen lands the button on top of the tab bar, and it takes no safe-area
 * offset. Everything else is delegated:
 *
 *  - open/close state lives in the AI feature's shared store, so ANY other
 *    trigger (an "explique esta empresa" button, a tool result) that calls
 *    openChat() opens this same sheet. Passing `open` as a prop instead would
 *    make <AiChatSheet> ignore the store and silently break those.
 *  - the sheet is mounted here, once, as a sibling of <Tabs>: one conversation
 *    for the whole shell, surviving tab switches.
 */
export function AiFab() {
  const openChat = useAiChatStore((state) => state.openChat)
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Abrir assistente de IA"
        onPress={openChat}
        className="absolute right-4 h-14 w-14 items-center justify-center rounded-full bg-primary active:opacity-90"
        style={{
          bottom: insets.bottom + TAB_BAR_HEIGHT + GAP,
          // RN has no box-shadow: elevation is Android, shadow* is iOS.
          shadowColor: '#000',
          shadowOpacity: 0.22,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
      >
        <Sparkles size={24} color={colors.primaryForeground} />
      </Pressable>

      {/* No open/onOpenChange: uncontrolled, so the store is the single source
          of truth for whether the assistant is on screen. */}
      <AiChatSheet />
    </>
  )
}
