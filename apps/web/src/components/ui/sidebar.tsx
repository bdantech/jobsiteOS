'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { PanelLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * The shadcn Sidebar primitives (the "sidebar-07" block: collapsible to an icon rail),
 * written by hand — the shadcn CLI is interactive and cannot run here.
 *
 * Everything it paints comes from the --sidebar-* tokens in globals.css. There is not a
 * single raw colour in this file, which is the whole point: the sidebar is navy in BOTH
 * themes because it is a SURFACE, and a rebrand should be a change to globals.css alone.
 *
 * Three deliberate departures from the upstream block, each for a reason:
 *
 *  1. The mobile breakpoint is `lg` (1024px), not `md` (768px) — see hooks/use-mobile.ts.
 *     The CSS below (`hidden lg:flex`) and that hook must name the same number.
 *
 *  2. SidebarInset renders a <div>, not a <main>. This shell already has a <main>: the
 *     scroll container inside it. Two <main> elements in one document is invalid, and the
 *     inner one is the honest one — it is what actually holds the page.
 *
 *  3. The active menu item is not painted a colour at all — it is WEIGHT and INK strength
 *     (semibold at 100% against siblings at 65%). A filled navy pill was tried and reads
 *     as a second brand element competing with the logo. Accent grey stays what it always
 *     was: the hover surface. The navy now shows up only where it does a job the greyscale
 *     cannot do — the focus ring.
 *
 *     The one exception is the collapsed rail, where there is no label to embolden: there
 *     the active icon gets the neutral accent tile, since a 65%→100% shift in an icon is
 *     too weak to locate at a glance.
 */

/**
 * Persisted in a cookie, not localStorage, and this is the reason: the server needs the
 * value. It reads this cookie while rendering and hands it to SidebarProvider as
 * `defaultOpen`, so a collapsed sidebar is collapsed in the FIRST byte of HTML. Read from
 * localStorage it could only be applied after hydration, and every page load would flash
 * a full-width sidebar before snapping shut.
 *
 * The server-side read is in components/shell/app-shell.tsx. It cannot import this
 * constant: this module is 'use client', and a server component that imports from a
 * client module receives a client-reference proxy, not a string. The literal is repeated
 * there, with a pointer back here.
 */
const SIDEBAR_COOKIE_NAME = 'sidebar_state'
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365
const SIDEBAR_WIDTH = '16rem'
const SIDEBAR_WIDTH_MOBILE = '18rem'
const SIDEBAR_WIDTH_ICON = '3rem'
const SIDEBAR_KEYBOARD_SHORTCUT = 'b'

interface SidebarContextValue {
  state: 'expanded' | 'collapsed'
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null)

export function useSidebar(): SidebarContextValue {
  const context = React.useContext(SidebarContext)
  if (!context) throw new Error('useSidebar precisa estar dentro de <SidebarProvider>.')
  return context
}

interface SidebarProviderProps extends React.ComponentPropsWithoutRef<'div'> {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

const SidebarProvider = React.forwardRef<HTMLDivElement, SidebarProviderProps>(
  (
    {
      defaultOpen = true,
      open: openProp,
      onOpenChange: setOpenProp,
      className,
      style,
      children,
      ...props
    },
    ref,
  ) => {
    const isMobile = useIsMobile()
    const [openMobile, setOpenMobile] = React.useState(false)

    // Uncontrolled by default; `open`/`onOpenChange` make it controlled, like every other
    // shadcn primitive.
    const [internalOpen, setInternalOpen] = React.useState(defaultOpen)
    const open = openProp ?? internalOpen

    const setOpen = React.useCallback(
      (value: boolean | ((current: boolean) => boolean)) => {
        const next = typeof value === 'function' ? value(open) : value

        if (setOpenProp) setOpenProp(next)
        else setInternalOpen(next)

        document.cookie = `${SIDEBAR_COOKIE_NAME}=${next}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax`
      },
      [open, setOpenProp],
    )

    const toggleSidebar = React.useCallback(() => {
      if (isMobile) setOpenMobile((current) => !current)
      else setOpen((current) => !current)
    }, [isMobile, setOpen])

    React.useEffect(() => {
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key.toLowerCase() !== SIDEBAR_KEYBOARD_SHORTCUT) return
        if (!event.metaKey && !event.ctrlKey) return

        event.preventDefault()
        toggleSidebar()
      }

      window.addEventListener('keydown', onKeyDown)
      return () => window.removeEventListener('keydown', onKeyDown)
    }, [toggleSidebar])

    const state = open ? 'expanded' : 'collapsed'

    const value = React.useMemo<SidebarContextValue>(
      () => ({ state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar }),
      [state, open, setOpen, isMobile, openMobile, toggleSidebar],
    )

    return (
      <SidebarContext.Provider value={value}>
        {/* delayDuration 0: on an icon rail the tooltip IS the label. A 700ms wait to
            learn what a button does is a 700ms wait to navigate. */}
        <TooltipProvider delayDuration={0}>
          <div
            ref={ref}
            style={
              {
                '--sidebar-width': SIDEBAR_WIDTH,
                '--sidebar-width-icon': SIDEBAR_WIDTH_ICON,
                ...style,
              } as React.CSSProperties
            }
            className={cn('group/sidebar-wrapper flex w-full', className)}
            {...props}
          >
            {children}
          </div>
        </TooltipProvider>
      </SidebarContext.Provider>
    )
  },
)
SidebarProvider.displayName = 'SidebarProvider'

interface SidebarProps extends React.ComponentPropsWithoutRef<'div'> {
  side?: 'left' | 'right'
  variant?: 'sidebar' | 'floating' | 'inset'
  collapsible?: 'offcanvas' | 'icon' | 'none'
}

const Sidebar = React.forwardRef<HTMLDivElement, SidebarProps>(
  (
    { side = 'left', variant = 'sidebar', collapsible = 'offcanvas', className, children, ...props },
    ref,
  ) => {
    const { isMobile, state, openMobile, setOpenMobile } = useSidebar()

    if (collapsible === 'none') {
      return (
        <div
          ref={ref}
          className={cn(
            'flex h-full w-[var(--sidebar-width)] flex-col bg-sidebar text-sidebar-foreground',
            className,
          )}
          {...props}
        >
          {children}
        </div>
      )
    }

    // Below `lg` the sidebar is a drawer. This is the Sheet doing it, not a second
    // hand-rolled drawer: same tree, same children, different container.
    if (isMobile) {
      return (
        <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
          <SheetContent
            data-sidebar="sidebar"
            data-mobile="true"
            side={side}
            className="w-[var(--sidebar-width)] border-sidebar-border bg-sidebar p-0 text-sidebar-foreground [&>button]:text-sidebar-foreground [&>button]:ring-offset-sidebar [&>button]:focus:ring-sidebar-ring"
            style={
              {
                '--sidebar-width': SIDEBAR_WIDTH_MOBILE,
              } as React.CSSProperties
            }
          >
            {/* Radix requires a title and a description on any dialog, and a screen reader
                user needs them. Sighted users have the sidebar itself. */}
            <SheetHeader className="sr-only">
              <SheetTitle>Menu de navegação</SheetTitle>
              <SheetDescription>
                Módulos liberados para o seu perfil e opções da sua conta.
              </SheetDescription>
            </SheetHeader>

            <div className="flex h-full w-full flex-col">{children}</div>
          </SheetContent>
        </Sheet>
      )
    }

    return (
      <div
        ref={ref}
        className="group peer hidden text-sidebar-foreground lg:block"
        data-state={state}
        data-collapsible={state === 'collapsed' ? collapsible : ''}
        data-variant={variant}
        data-side={side}
      >
        {/* The spacer. The panel itself is `fixed` (so it never scrolls with the page and
            never becomes a second scroll container), which takes it out of flow — this
            div is what actually reserves its width in the row, and what animates. */}
        <div
          className={cn(
            'relative h-svh w-[var(--sidebar-width)] bg-transparent transition-[width] duration-200 ease-linear',
            'group-data-[collapsible=offcanvas]:w-0',
            'group-data-[side=right]:rotate-180',
            variant === 'floating' || variant === 'inset'
              ? 'group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4))]'
              : 'group-data-[collapsible=icon]:w-[var(--sidebar-width-icon)]',
          )}
        />

        <div
          className={cn(
            'fixed inset-y-0 z-10 hidden h-svh w-[var(--sidebar-width)] transition-[left,right,width] duration-200 ease-linear lg:flex',
            side === 'left'
              ? 'left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]'
              : 'right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]',
            variant === 'floating' || variant === 'inset'
              ? 'p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4)_+2px)]'
              : 'group-data-[collapsible=icon]:w-[var(--sidebar-width-icon)] group-data-[side=left]:border-r group-data-[side=right]:border-l',
            'border-sidebar-border',
            className,
          )}
          {...props}
        >
          <div
            data-sidebar="sidebar"
            className="flex h-full w-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow"
          >
            {children}
          </div>
        </div>
      </div>
    )
  },
)
Sidebar.displayName = 'Sidebar'

const SidebarTrigger = React.forwardRef<
  React.ElementRef<typeof Button>,
  React.ComponentPropsWithoutRef<typeof Button>
>(({ className, onClick, ...props }, ref) => {
  const { toggleSidebar, isMobile, state } = useSidebar()

  const label = isMobile
    ? 'Abrir menu'
    : state === 'expanded'
      ? 'Recolher menu'
      : 'Expandir menu'

  return (
    <Button
      ref={ref}
      data-sidebar="trigger"
      variant="ghost"
      size="icon"
      aria-label={label}
      className={cn('h-8 w-8 shrink-0 text-muted-foreground', className)}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      <PanelLeft />
    </Button>
  )
})
SidebarTrigger.displayName = 'SidebarTrigger'

/**
 * The hit target on the sidebar's outer edge: a 16px-wide invisible strip you can click
 * anywhere along to toggle. Hidden from assistive tech — SidebarTrigger is the real,
 * focusable control, and this is the same action a second time.
 */
const SidebarRail = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<'button'>>(
  ({ className, ...props }, ref) => {
    const { toggleSidebar } = useSidebar()

    return (
      <button
        ref={ref}
        type="button"
        data-sidebar="rail"
        aria-hidden
        tabIndex={-1}
        title="Recolher menu"
        onClick={toggleSidebar}
        className={cn(
          'absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border lg:flex',
          '[[data-side=left]_&]:cursor-w-resize [[data-side=right]_&]:cursor-e-resize',
          '[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize',
          'group-data-[side=left]:-right-4 group-data-[side=right]:left-0',
          className,
        )}
        {...props}
      />
    )
  },
)
SidebarRail.displayName = 'SidebarRail'

/**
 * The content pane beside the sidebar. A <div>, not a <main> — see the note at the top of
 * this file: the shell's own <main> (the scroll container) lives inside this.
 */
const SidebarInset = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('relative flex min-h-0 min-w-0 flex-1 flex-col bg-background', className)}
      {...props}
    />
  ),
)
SidebarInset.displayName = 'SidebarInset'

const SidebarHeader = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-sidebar="header"
      className={cn('flex flex-col gap-2 p-2', className)}
      {...props}
    />
  ),
)
SidebarHeader.displayName = 'SidebarHeader'

const SidebarFooter = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-sidebar="footer"
      className={cn('flex flex-col gap-2 p-2', className)}
      {...props}
    />
  ),
)
SidebarFooter.displayName = 'SidebarFooter'

const SidebarSeparator = React.forwardRef<
  React.ElementRef<typeof Separator>,
  React.ComponentPropsWithoutRef<typeof Separator>
>(({ className, ...props }, ref) => (
  <Separator
    ref={ref}
    data-sidebar="separator"
    className={cn('mx-2 w-auto bg-sidebar-border', className)}
    {...props}
  />
))
SidebarSeparator.displayName = 'SidebarSeparator'

/**
 * `overflow-auto` while expanded, `overflow-hidden` on the icon rail: a scrollbar in a
 * 3rem-wide column would eat most of the icon.
 */
const SidebarContent = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-sidebar="content"
      className={cn(
        'flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden',
        className,
      )}
      {...props}
    />
  ),
)
SidebarContent.displayName = 'SidebarContent'

const SidebarGroup = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-sidebar="group"
      className={cn('relative flex w-full min-w-0 flex-col p-2', className)}
      {...props}
    />
  ),
)
SidebarGroup.displayName = 'SidebarGroup'

interface SidebarGroupLabelProps extends React.ComponentPropsWithoutRef<'div'> {
  asChild?: boolean
}

const SidebarGroupLabel = React.forwardRef<HTMLDivElement, SidebarGroupLabelProps>(
  ({ className, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'div'

    return (
      <Comp
        ref={ref}
        data-sidebar="group-label"
        className={cn(
          'flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 outline-none ring-sidebar-ring transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0',
          // On the rail the label has nowhere to go: it collapses to zero height and fades
          // out, rather than wrapping into an unreadable stack of two-letter lines.
          'group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0',
          className,
        )}
        {...props}
      />
    )
  },
)
SidebarGroupLabel.displayName = 'SidebarGroupLabel'

const SidebarGroupContent = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-sidebar="group-content"
      className={cn('w-full text-sm', className)}
      {...props}
    />
  ),
)
SidebarGroupContent.displayName = 'SidebarGroupContent'

const SidebarMenu = React.forwardRef<HTMLUListElement, React.ComponentPropsWithoutRef<'ul'>>(
  ({ className, ...props }, ref) => (
    <ul
      ref={ref}
      data-sidebar="menu"
      className={cn('flex w-full min-w-0 flex-col gap-1', className)}
      {...props}
    />
  ),
)
SidebarMenu.displayName = 'SidebarMenu'

const SidebarMenuItem = React.forwardRef<HTMLLIElement, React.ComponentPropsWithoutRef<'li'>>(
  ({ className, ...props }, ref) => (
    <li
      ref={ref}
      data-sidebar="menu-item"
      className={cn('group/menu-item relative', className)}
      {...props}
    />
  ),
)
SidebarMenuItem.displayName = 'SidebarMenuItem'

/**
 * No hover or active colours in here — they are applied below, conditionally.
 *
 * Reason: `hover:bg-sidebar-accent` and the active state's own rules are of equal
 * specificity, so which one wins on a hovered active item comes down to the order
 * Tailwind happens to emit them in. Branching in TypeScript makes it a fact instead
 * of a bet.
 */
const sidebarMenuButtonVariants = cva(
  'peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none ring-sidebar-ring transition-colors focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 group-has-[[data-sidebar=menu-action]]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2',
  {
    variants: {
      variant: {
        default: '',
        outline: 'shadow-[0_0_0_1px_hsl(var(--sidebar-border))]',
      },
      size: {
        default: 'h-8 text-sm',
        sm: 'h-7 text-xs',
        lg: 'h-12 text-sm group-data-[collapsible=icon]:!p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

interface SidebarMenuButtonProps
  extends React.ComponentPropsWithoutRef<'button'>,
    VariantProps<typeof sidebarMenuButtonVariants> {
  asChild?: boolean
  isActive?: boolean
  /** Shown only on the icon rail — where it is the item's only label. A string, or full TooltipContent props. */
  tooltip?: string | React.ComponentPropsWithoutRef<typeof TooltipContent>
}

const SidebarMenuButton = React.forwardRef<HTMLButtonElement, SidebarMenuButtonProps>(
  (
    { asChild = false, isActive = false, variant, size, tooltip, className, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button'
    const { isMobile, state } = useSidebar()

    const button = (
      <Comp
        ref={ref}
        data-sidebar="menu-button"
        data-size={size}
        data-active={isActive}
        className={cn(
          sidebarMenuButtonVariants({ variant, size }),
          // The active item is NOT painted a different colour. It is the same ink, at
          // full strength and in semibold, while its siblings sit at 65% (applied by
          // SidebarNav). Measured against the sidebar surface: 16.2:1 active vs 5.3:1
          // resting in light, 14.0:1 vs 6.5:1 in dark — both sides clear the 4.5:1 floor,
          // and the gap between them is what reads as "selected".
          //
          // Weight and ink are not the only cue: the link also carries aria-current="page".
          // On the collapsed rail there is no text to embolden, so the active icon keeps a
          // neutral accent tile — the same grey as hover, not a hue.
          isActive
            ? 'font-semibold text-sidebar-foreground hover:bg-sidebar-accent group-data-[collapsible=icon]:bg-sidebar-accent'
            : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          className,
        )}
        {...props}
      />
    )

    if (!tooltip) return button

    const tooltipProps = typeof tooltip === 'string' ? { children: tooltip } : tooltip

    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        {/* Only on the collapsed rail. Expanded, the label is already on screen, and in
            the drawer there is no rail at all. */}
        <TooltipContent
          side="right"
          align="center"
          hidden={state !== 'collapsed' || isMobile}
          {...tooltipProps}
        />
      </Tooltip>
    )
  },
)
SidebarMenuButton.displayName = 'SidebarMenuButton'

const SidebarMenuBadge = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-sidebar="menu-badge"
      className={cn(
        'pointer-events-none absolute right-1 flex h-5 min-w-5 select-none items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums text-sidebar-foreground',
        'peer-data-[size=sm]/menu-button:top-1 peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5',
        'group-data-[collapsible=icon]:hidden',
        className,
      )}
      {...props}
    />
  ),
)
SidebarMenuBadge.displayName = 'SidebarMenuBadge'

interface SidebarMenuSkeletonProps extends React.ComponentPropsWithoutRef<'div'> {
  showIcon?: boolean
}

const SidebarMenuSkeleton = React.forwardRef<HTMLDivElement, SidebarMenuSkeletonProps>(
  ({ className, showIcon = false, ...props }, ref) => {
    // Random widths, computed once: a column of identically-wide grey bars reads as a
    // rendering bug, not as loading text.
    const width = React.useMemo(() => `${Math.floor(Math.random() * 40) + 50}%`, [])

    return (
      <div
        ref={ref}
        data-sidebar="menu-skeleton"
        className={cn('flex h-8 items-center gap-2 rounded-md px-2', className)}
        {...props}
      >
        {showIcon && <Skeleton className="size-4 rounded-md bg-sidebar-accent" />}
        <Skeleton
          className="h-4 max-w-[--skeleton-width] flex-1 bg-sidebar-accent"
          style={{ '--skeleton-width': width } as React.CSSProperties}
        />
      </div>
    )
  },
)
SidebarMenuSkeleton.displayName = 'SidebarMenuSkeleton'

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
}
