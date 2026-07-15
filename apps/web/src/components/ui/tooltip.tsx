'use client'

import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@/lib/utils'

/**
 * Tooltip — built on @radix-ui/react-popover, not @radix-ui/react-tooltip.
 *
 * WHY: react-tooltip is not a dependency of this app and package.json is not ours to
 * edit. Popover is already here and carries the identical positioning engine (the same
 * Popper/floating-ui core: side, align, sideOffset, collision flipping), so the only
 * thing hand-written below is the behaviour that separates a tooltip from a popover:
 *
 *   - opens on hover and on keyboard focus, not on click;
 *   - closes on leave, blur, Escape, and on pointer-down (clicking a nav item must not
 *     leave its label floating over the page);
 *   - never takes focus (onOpenAutoFocus is prevented) and never takes pointer events;
 *   - announces as role="tooltip", not role="dialog".
 *
 * The anchor is PopoverPrimitive.Anchor rather than .Trigger, deliberately: Trigger
 * stamps aria-haspopup="dialog" and aria-expanded onto its child, which is a lie when
 * the child is a navigation link. Anchor contributes position and no semantics.
 *
 * Touch is excluded (pointerType === 'touch'): a tooltip that appears under a finger
 * that is already committing to a tap is noise, and on the collapsed sidebar the drawer
 * has shown the label anyway.
 */

interface TooltipProviderContextValue {
  delayDuration: number
}

const TooltipProviderContext = React.createContext<TooltipProviderContextValue>({
  delayDuration: 700,
})

interface TooltipProviderProps {
  /** Hover dwell time before the tooltip appears. The sidebar passes 0 — an icon rail with a lag is an icon rail you cannot read. */
  delayDuration?: number
  children: React.ReactNode
}

function TooltipProvider({ delayDuration = 700, children }: TooltipProviderProps) {
  const value = React.useMemo<TooltipProviderContextValue>(() => ({ delayDuration }), [delayDuration])

  return (
    <TooltipProviderContext.Provider value={value}>{children}</TooltipProviderContext.Provider>
  )
}

interface TooltipContextValue {
  show: () => void
  hide: () => void
}

const TooltipContext = React.createContext<TooltipContextValue | null>(null)

function useTooltipContext(): TooltipContextValue {
  const context = React.useContext(TooltipContext)
  if (!context) throw new Error('<TooltipTrigger>/<TooltipContent> precisam estar dentro de <Tooltip>.')
  return context
}

interface TooltipProps {
  delayDuration?: number
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}

function Tooltip({ delayDuration, open: openProp, onOpenChange, children }: TooltipProps) {
  const { delayDuration: providerDelay } = React.useContext(TooltipProviderContext)
  const delay = delayDuration ?? providerDelay

  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const open = openProp ?? uncontrolledOpen

  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (openProp === undefined) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [onOpenChange, openProp],
  )

  const clearTimer = React.useCallback(() => {
    if (timer.current === null) return
    clearTimeout(timer.current)
    timer.current = null
  }, [])

  const show = React.useCallback(() => {
    clearTimer()
    if (delay <= 0) {
      setOpen(true)
      return
    }
    timer.current = setTimeout(() => setOpen(true), delay)
  }, [clearTimer, delay, setOpen])

  const hide = React.useCallback(() => {
    clearTimer()
    setOpen(false)
  }, [clearTimer, setOpen])

  // A trigger unmounted mid-delay (a module removed from the nav, a drawer closing)
  // must not fire a setState on a dead component.
  React.useEffect(() => clearTimer, [clearTimer])

  const value = React.useMemo<TooltipContextValue>(() => ({ show, hide }), [show, hide])

  return (
    <TooltipContext.Provider value={value}>
      <PopoverPrimitive.Root
        open={open}
        onOpenChange={(next) => {
          if (!next) hide()
        }}
      >
        {children}
      </PopoverPrimitive.Root>
    </TooltipContext.Provider>
  )
}

const TooltipTrigger = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Anchor>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Anchor>
>(({ onPointerEnter, onPointerLeave, onPointerDown, onFocus, onBlur, ...props }, ref) => {
  const { show, hide } = useTooltipContext()

  return (
    <PopoverPrimitive.Anchor
      ref={ref}
      onPointerEnter={(event) => {
        onPointerEnter?.(event)
        if (event.pointerType === 'touch') return
        show()
      }}
      onPointerLeave={(event) => {
        onPointerLeave?.(event)
        hide()
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event)
        hide()
      }}
      onFocus={(event) => {
        onFocus?.(event)
        // Only keyboard focus. Without this, clicking an icon button focuses it and the
        // tooltip springs back up over the page you just navigated to.
        if (!event.currentTarget.matches(':focus-visible')) return
        show()
      }}
      onBlur={(event) => {
        onBlur?.(event)
        hide()
      }}
      {...props}
    />
  )
})
TooltipTrigger.displayName = 'TooltipTrigger'

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, side = 'top', sideOffset = 4, hidden, ...props }, ref) => {
  const { hide } = useTooltipContext()

  // `hidden` is how a caller says "this tooltip has nothing to add right now" — the
  // sidebar passes it while expanded, where the label is already on screen. Rendering
  // nothing beats rendering a display:none popover on every menu item.
  if (hidden) return null

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        side={side}
        sideOffset={sideOffset}
        role="tooltip"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={() => hide()}
        onPointerDownOutside={() => hide()}
        className={cn(
          // pointer-events-none: a tooltip must never be hoverable, or moving the cursor
          // one pixel onto it would fire the trigger's pointerleave and flicker.
          'pointer-events-none z-50 max-w-xs overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
})
TooltipContent.displayName = 'TooltipContent'

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
