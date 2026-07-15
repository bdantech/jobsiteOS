'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { grantedModules } from '@jobsiteos/core'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useTabsHydrated,
  useTabsStore,
  useTabsStoreApi,
} from '@/components/shell/tabs-store-provider'
import { titleForRoute } from '@/components/shell/route-title'
import type { Tab } from '@/stores/tabs'

interface TabBarProps {
  grantedModuleIds: string[]
}

export function TabBar({ grantedModuleIds }: TabBarProps) {
  const router = useRouter()
  const store = useTabsStoreApi()
  const hydrated = useTabsHydrated()
  const tabs = useTabsStore((state) => state.tabs)
  const activeTabId = useTabsStore((state) => state.activeTabId)

  // Without a distance threshold, dnd-kit swallows the click that activates a tab:
  // every press becomes a (zero-length) drag. 6px is far enough to be a deliberate drag
  // and short enough that reordering still feels immediate.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const activate = React.useCallback(
    (id: string) => {
      const tab = store.getState().tabs.find((candidate: Tab) => candidate.id === id)
      if (!tab || id === store.getState().activeTabId) return

      store.getState().activateTab(id)
      // THE tab-switch: a route push, not a mount. The route re-renders and re-fetches;
      // no second React tree is kept alive in the background.
      router.push(tab.route)
    },
    [router, store],
  )

  const close = React.useCallback(
    (id: string) => {
      const nextRoute = store.getState().closeTab(id)
      // Non-null only when the closed tab was the active one — then the neighbour it
      // handed focus to has to actually be navigated to.
      if (nextRoute) router.push(nextRoute)
    },
    [router, store],
  )

  const openModuleTab = React.useCallback(() => {
    const [first] = grantedModules(grantedModuleIds)
    if (!first) return

    store.getState().openTab(first.route, titleForRoute(first.route), { activate: true })
    router.push(first.route)
  }, [grantedModuleIds, router, store])

  const onDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      store.getState().reorderTabs(String(active.id), String(over.id))
    },
    [store],
  )

  // Loading state: localStorage has not been read yet, so we do not know how many tabs
  // there are. Rendering zero would flash an empty bar on every reload.
  if (!hydrated) {
    return (
      <div className="flex items-center gap-1 px-1" aria-hidden>
        <Skeleton className="h-8 w-40 rounded-md" />
        <Skeleton className="h-8 w-28 rounded-md" />
      </div>
    )
  }

  const canClose = tabs.length > 1

  return (
    <div
      role="tablist"
      aria-label="Abas abertas"
      className="flex min-w-0 items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={tabs.map((tab) => tab.id)} strategy={horizontalListSortingStrategy}>
          {tabs.map((tab) => (
            <SortableTab
              key={tab.id}
              tab={tab}
              active={tab.id === activeTabId}
              canClose={canClose}
              onActivate={activate}
              onClose={close}
            />
          ))}
        </SortableContext>
      </DndContext>

      {grantedModuleIds.length > 0 && (
        <button
          type="button"
          onClick={openModuleTab}
          title="Nova aba"
          aria-label="Nova aba"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

interface SortableTabProps {
  tab: Tab
  active: boolean
  canClose: boolean
  onActivate: (id: string) => void
  onClose: (id: string) => void
}

function SortableTab({ tab, active, canClose, onActivate, onClose }: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
  })

  // @dnd-kit/utilities' CSS.Transform.toString() would do this, but that package is not a
  // direct dependency of this app. Y is pinned to 0: the tab bar is a single row, and a
  // tab lifting vertically out of it while dragging looks broken.
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${Math.round(transform.x)}px, 0, 0)` : undefined,
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="tab"
      aria-selected={active}
      tabIndex={0}
      title={tab.title}
      onClick={() => onActivate(tab.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onActivate(tab.id)
        }
      }}
      onAuxClick={(event) => {
        // Middle click closes, like every browser since 2004.
        if (event.button !== 1 || !canClose) return
        event.preventDefault()
        onClose(tab.id)
      }}
      className={cn(
        'group flex h-8 max-w-[13rem] shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-border bg-background font-medium text-foreground shadow-sm'
          : 'border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        isDragging && 'z-10 opacity-80 shadow-md',
      )}
    >
      {active && <span aria-hidden className="h-3.5 w-0.5 shrink-0 rounded-full bg-brand" />}

      <span className="truncate">{tab.title}</span>

      {canClose && (
        <button
          type="button"
          aria-label={`Fechar aba ${tab.title}`}
          // The tab is a drag handle; without this the pointer-down would start a drag
          // instead of pressing the ✕.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onClose(tab.id)
          }}
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            // Always visible on the active tab; on hover/focus elsewhere, so a row of
            // inactive tabs is not a row of ✕s.
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100',
          )}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
