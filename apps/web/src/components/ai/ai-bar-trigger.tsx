'use client'

import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AiBar, type OpenRoute } from './ai-bar'

export interface AiBarTriggerProps {
  /**
   * How to open a route the AI surfaced. The shell passes its Zustand tab store
   * here — `(route, label) => openTab({ route, title: label })` — so results open
   * as tabs. Omitted, the AI Bar navigates with the router instead.
   */
  onOpenRoute?: OpenRoute
  className?: string
}

/**
 * The AI Bar's entry point: a button in the shell header plus the global
 * Cmd/Ctrl+K shortcut. Mount it once, next to the tab bar.
 */
export function AiBarTrigger({ onOpenRoute, className }: AiBarTriggerProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return
      // Beats the browser's own Cmd+K (search bar focus) — this is the palette.
      event.preventDefault()
      setOpen((previous) => !previous)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={className}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <Sparkles className="mr-2 h-4 w-4 text-brand" aria-hidden />
        Perguntar à IA
        <kbd className="ml-3 hidden items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </Button>

      <AiBar open={open} onOpenChange={setOpen} onOpenRoute={onOpenRoute} />
    </>
  )
}
