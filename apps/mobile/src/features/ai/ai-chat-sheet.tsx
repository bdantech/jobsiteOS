import { grantedTools } from '@jobsiteos/core'
import { usePathname, useRouter } from 'expo-router'
import { MessageSquarePlus, Send, Sparkles, Square, X } from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, TextInput, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useTheme } from '@/components/color-scheme-provider'
import { Sheet, Text } from '@/components/ui'
import { useSession } from '@/lib/auth'
import { canOpenOnMobile } from '@/lib/linking'

import { ChatItemView, ThinkingBubble } from './chat-items'
import { useAiChatStore } from './store'
import { useAiChat } from './use-ai-chat'

/** Panel height as a fraction of the screen — "full-screen sheet", minus a peek. */
const PANEL_RATIO = 0.92
/**
 * <Sheet>'s own chrome above our children: the drag handle block (pt-2 + h-1 +
 * pb-1) plus the content container's pt-1. Subtracted because the sheet sizes its
 * content box to its child, and our child must be given a DEFINITE height for the
 * transcript to scroll instead of pushing the composer off the panel.
 */
const SHEET_CHROME = 24
/** <Sheet> already reserves this at the bottom of its content container. */
const SHEET_BOTTOM_PAD = 16

const SUGGESTIONS_EMPRESAS = [
  'Quais empresas estão em negociação?',
  'Busca a empresa Construtora Alfa',
  'Quantas empresas temos em SP?',
]

export interface AiChatSheetProps {
  /** Omit both to let the sheet drive itself from the shared store. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * The AI chat, as a full-height bottom sheet. Consumes the same POST /api/ai the
 * web AI Bar does — same SSE protocol, same tools, same confirmation semantics —
 * over a bearer token, because Expo has no cookie jar.
 */
export function AiChatSheet({ open: openProp, onOpenChange: onOpenChangeProp }: AiChatSheetProps) {
  const storeOpen = useAiChatStore((state) => state.open)
  const setStoreOpen = useAiChatStore((state) => state.setOpen)

  const open = openProp ?? storeOpen
  const onOpenChange = onOpenChangeProp ?? setStoreOpen

  const router = useRouter()
  const pathname = usePathname()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const { colors } = useTheme()
  const { grantedModuleIds } = useSession()

  const [draft, setDraft] = useState('')
  const scrollRef = useRef<ScrollView>(null)

  // The route is context for the system prompt ("o usuário está em /empresas/x").
  const chat = useAiChat(open ? pathname : null)
  const { items, status, thinking, canSend, send, decide, retry, recover, stop, reset } = chat

  const contentHeight = Math.max(
    height * PANEL_RATIO - SHEET_CHROME - SHEET_BOTTOM_PAD - insets.bottom,
    280,
  )

  const hasTools = useMemo(() => grantedTools(grantedModuleIds).length > 0, [grantedModuleIds])
  const suggestions = useMemo(
    () => (grantedModuleIds.includes('empresas') ? SUGGESTIONS_EMPRESAS : []),
    [grantedModuleIds],
  )

  const scrollToEnd = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: true })
  }, [])

  // Streaming appends to the last bubble, which grows the content: follow it.
  useEffect(() => {
    if (items.length > 0) scrollToEnd()
  }, [items, scrollToEnd])

  const handleSend = useCallback(() => {
    const text = draft.trim()
    if (!text || !canSend) return

    setDraft('')
    send(text)
  }, [canSend, draft, send])

  const handleOpenRoute = useCallback(
    (route: string) => {
      // The route came from a tool result, i.e. from our own server — but it is
      // still model-adjacent output, and the registry is the only thing allowed
      // to say what this user may open. A webOnly or ungranted route is dropped.
      if (!canOpenOnMobile(route, grantedModuleIds)) return

      onOpenChange(false)
      router.push(route)
    },
    [grantedModuleIds, onOpenChange, router],
  )

  const busy = status === 'streaming'
  const showEmpty = items.length === 0 && !thinking

  return (
    <Sheet open={open} onOpenChange={onOpenChange} className="h-[92%]">
      <View style={{ height: contentHeight }} className="flex-col">
        {/* Header */}
        <View className="flex-row items-center justify-between pb-3">
          <View className="flex-row items-center gap-2">
            <Sparkles size={18} color={colors.primary} />
            <Text variant="heading">IA</Text>
          </View>

          <View className="flex-row items-center gap-1">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Nova conversa"
              onPress={reset}
              disabled={items.length === 0}
              className={`h-9 w-9 items-center justify-center rounded-lg active:bg-secondary ${
                items.length === 0 ? 'opacity-40' : ''
              }`}
            >
              <MessageSquarePlus size={18} color={colors.mutedForeground} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fechar"
              onPress={() => onOpenChange(false)}
              className="h-9 w-9 items-center justify-center rounded-lg active:bg-secondary"
            >
              <X size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>
        </View>

        {/* Transcript */}
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          // `grow` lets the empty state centre itself in the viewport while still
          // allowing a long transcript to scroll past it.
          contentContainerClassName="grow gap-3 pb-2"
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={scrollToEnd}
          showsVerticalScrollIndicator={false}
        >
          {showEmpty ? (
            <View className="flex-1 items-center justify-center gap-4 py-10">
              <View className="h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Sparkles size={22} color={colors.primary} />
              </View>
              <View className="gap-1 px-6">
                <Text variant="heading" className="text-center">
                  Como posso ajudar?
                </Text>
                <Text variant="muted" className="text-center">
                  {hasTools
                    ? 'Pergunte sobre a carteira, busque empresas ou peça para cadastrar uma.'
                    : 'Seu perfil ainda não libera nenhuma ferramenta, mas posso responder perguntas gerais.'}
                </Text>
              </View>

              {suggestions.length > 0 ? (
                <View className="w-full gap-2 px-2 pt-2">
                  {suggestions.map((suggestion) => (
                    <Pressable
                      key={suggestion}
                      accessibilityRole="button"
                      onPress={() => send(suggestion)}
                      className="rounded-lg border border-border bg-background px-4 py-3 active:bg-secondary"
                    >
                      <Text className="text-sm text-foreground">{suggestion}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {items.map((item) => (
            <ChatItemView
              key={item.key}
              item={item}
              busy={busy}
              onOpenRoute={handleOpenRoute}
              onDecide={decide}
              onRetry={retry}
              onRecover={recover}
            />
          ))}

          {thinking ? <ThinkingBubble /> : null}
        </ScrollView>

        {/* Composer */}
        <View className="flex-row items-end gap-2 border-t border-border pt-3">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            editable={canSend}
            multiline
            placeholder={
              status === 'awaiting_confirmation'
                ? 'Confirme ou cancele a ação acima…'
                : 'Pergunte alguma coisa…'
            }
            placeholderTextColor={colors.mutedForeground}
            selectionColor={colors.primary}
            accessibilityLabel="Mensagem para a IA"
            onSubmitEditing={handleSend}
            submitBehavior="submit"
            className={`max-h-28 min-h-12 flex-1 rounded-2xl border border-input bg-background px-4 py-3 text-base text-foreground ${
              canSend ? '' : 'opacity-60'
            }`}
          />

          {busy ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Parar"
              onPress={stop}
              className="h-12 w-12 items-center justify-center rounded-full bg-secondary active:opacity-90"
            >
              <Square size={16} color={colors.foreground} fill={colors.foreground} />
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Enviar"
              onPress={handleSend}
              disabled={!canSend || draft.trim().length === 0}
              className={`h-12 w-12 items-center justify-center rounded-full bg-primary active:opacity-90 ${
                !canSend || draft.trim().length === 0 ? 'opacity-40' : ''
              }`}
            >
              <Send size={18} color={colors.primaryForeground} />
            </Pressable>
          )}
        </View>
      </View>
    </Sheet>
  )
}
