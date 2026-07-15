import { create } from 'zustand'

interface AiChatUiState {
  open: boolean
  setOpen: (open: boolean) => void
  openChat: () => void
  closeChat: () => void
}

/**
 * Open/closed state of the AI sheet, in a store rather than in the tab layout.
 *
 * The FAB is not the only thing that opens the chat — a screen, a notification
 * tap or a deep link may want to as well, and none of them are ancestors of the
 * others. A store lets any of them call `openChat()` without prop-drilling the
 * setter through the navigator. <AiChatSheet> still accepts `open`/`onOpenChange`
 * props, so a caller that already owns the state can drive it directly instead.
 */
export const useAiChatStore = create<AiChatUiState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  openChat: () => set({ open: true }),
  closeChat: () => set({ open: false }),
}))
