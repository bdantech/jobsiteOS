// The FAB is global chrome, not an AI-feature concern: it must clear the tab bar
// and the home indicator, which only the shell knows about. It lives at
// @/components/shell/ai-fab. This barrel deliberately does NOT export an AiFab —
// two components with that name meant `import { AiFab } from '@/features/ai'`
// silently got the one that renders on top of the tab bar.
export { AiChatSheet, type AiChatSheetProps } from './ai-chat-sheet'
export { useAiChatStore } from './store'
export { useAiChat, type AiChat, type ChatItem, type ChatStatus } from './use-ai-chat'
