import { createJSONStorage, persist } from 'zustand/middleware'
import { createStore } from 'zustand/vanilla'

/**
 * Notion-style tabs (web only).
 *
 * ARCHITECTURAL RULE, do not break it: a tab is NAVIGATION STATE, not a mounted
 * React tree. An inactive tab holds nothing but `{ id, title, route }`. Activating
 * one is a `router.push(tab.route)` — the route re-renders and re-fetches from
 * scratch. Keeping N live trees mounted (the naive implementation) would mean N
 * live Supabase subscriptions, N polling queries and N stale caches, all invisible
 * to the user. So: this store never holds React nodes, scroll positions or data.
 *
 * ROUTES ARE PATHNAMES ONLY (no query string). `usePathname()` is the only route
 * source that does not force every page under a Suspense boundary (`useSearchParams`
 * does), and a tab whose route disagrees with the URL bar would desync on every
 * filter change. Consequence: cmd+clicking a link with a query string opens the tab
 * at its pathname.
 */

export interface Tab {
  id: string
  /** Follows the page's <title>; falls back to the module name from the registry. */
  title: string
  /** Pathname. The single thing an inactive tab remembers. */
  route: string
}

export interface TabsState {
  tabs: Tab[]
  activeTabId: string | null

  /** Opens a tab for `route`. Returns its id. Callers navigate; the store never does. */
  openTab: (route: string, title: string, options?: { activate?: boolean }) => string
  activateTab: (id: string) => void
  /**
   * Closes a tab. Returns the route the caller must navigate to (when the closed tab
   * was the active one), or null when nothing needs to move.
   */
  closeTab: (id: string) => string | null
  /** Points the active tab at `route` — or creates one when there is no active tab. */
  syncRoute: (route: string, fallbackTitle: string) => void
  renameActiveTab: (title: string) => void
  reorderTabs: (activeId: string, overId: string) => void
  /** Drops restored tabs whose module the user no longer has (perfil changed). */
  pruneTabs: (isAllowed: (route: string) => boolean) => void
}

/**
 * Inferred, not `StoreApi<TabsState>`: the persist middleware augments the store with
 * `.persist` (rehydrate / hasHydrated / onFinishHydration), and the provider drives
 * hydration through exactly that API.
 */
export type TabsStore = ReturnType<typeof createTabsStore>

/** Restoring an unbounded array from localStorage is how a tab bar becomes a memory leak. */
const MAX_RESTORED_TABS = 50

const STORAGE_VERSION = 1

/** Per-user key: two people on one machine must not inherit each other's tabs. */
function storageKey(userId: string): string {
  return `jobsiteos:tabs:${userId}`
}

function createTab(route: string, title: string): Tab {
  return { id: crypto.randomUUID(), title, route }
}

function isTab(value: unknown): value is Tab {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.route === 'string' &&
    candidate.route.startsWith('/')
  )
}

// No return annotation on purpose: TabsStore is inferred FROM this function, so annotating
// it here would make the type circular.
function createTabsStore(userId: string) {
  return createStore<TabsState>()(
    persist(
      (set, get) => ({
        tabs: [],
        activeTabId: null,

        openTab: (route, title, options) => {
          // Duplicates are allowed on purpose: cmd+clicking the same link twice
          // gives you two tabs in a browser, and people expect that muscle memory
          // to hold here.
          const tab = createTab(route, title)
          set((state) => ({
            tabs: [...state.tabs, tab],
            activeTabId: options?.activate ? tab.id : (state.activeTabId ?? tab.id),
          }))
          return tab.id
        },

        activateTab: (id) => {
          if (!get().tabs.some((tab) => tab.id === id)) return
          set({ activeTabId: id })
        },

        closeTab: (id) => {
          const { tabs, activeTabId } = get()
          // The last tab stays: an empty tab bar has no route to fall back to, and
          // the UI hides its ✕ anyway. This is the guard behind that.
          if (tabs.length <= 1) return null

          const index = tabs.findIndex((tab) => tab.id === id)
          if (index === -1) return null

          const remaining = tabs.filter((tab) => tab.id !== id)

          if (activeTabId !== id) {
            set({ tabs: remaining })
            return null
          }

          // Closing the active tab hands focus to its right-hand neighbour, or to
          // the new last tab when it was the rightmost. `remaining` is non-empty here
          // (the length <= 1 guard above), but the index is still checked rather than
          // asserted — a wrong assertion would blank the tab bar with no way back.
          const neighbour = remaining[Math.min(index, remaining.length - 1)]
          if (!neighbour) {
            set({ tabs: remaining, activeTabId: null })
            return null
          }

          set({ tabs: remaining, activeTabId: neighbour.id })
          return neighbour.route
        },

        syncRoute: (route, fallbackTitle) => {
          const { tabs, activeTabId } = get()
          const active = tabs.find((tab) => tab.id === activeTabId)

          if (!active) {
            const tab = createTab(route, fallbackTitle)
            set({ tabs: [...tabs, tab], activeTabId: tab.id })
            return
          }

          // Same route: nothing moved (this is the no-op path taken right after a
          // tab activation, and it must NOT clobber the title we already restored).
          if (active.route === route) return

          set({
            tabs: tabs.map((tab) =>
              tab.id === active.id ? { ...tab, route, title: fallbackTitle } : tab,
            ),
          })
        },

        renameActiveTab: (title) => {
          const trimmed = title.trim()
          if (!trimmed) return
          set((state) => ({
            tabs: state.tabs.map((tab) =>
              tab.id === state.activeTabId && tab.title !== trimmed ? { ...tab, title: trimmed } : tab,
            ),
          }))
        },

        reorderTabs: (activeId, overId) => {
          const { tabs } = get()
          const from = tabs.findIndex((tab) => tab.id === activeId)
          const to = tabs.findIndex((tab) => tab.id === overId)
          if (from === -1 || to === -1 || from === to) return

          const next = [...tabs]
          const [moved] = next.splice(from, 1)
          if (!moved) return

          next.splice(to, 0, moved)
          set({ tabs: next })
        },

        pruneTabs: (isAllowed) => {
          const { tabs, activeTabId } = get()
          const allowed = tabs.filter((tab) => isAllowed(tab.route))
          if (allowed.length === tabs.length) return

          set({
            tabs: allowed,
            activeTabId: allowed.some((tab) => tab.id === activeTabId)
              ? activeTabId
              : (allowed[0]?.id ?? null),
          })
        },
      }),
      {
        name: storageKey(userId),
        version: STORAGE_VERSION,
        storage: createJSONStorage(() => localStorage),
        // Hydration is driven explicitly by TabsStoreProvider AFTER mount. Doing it
        // at module scope would read localStorage during SSR-hydration and produce a
        // server/client markup mismatch on the whole tab bar.
        skipHydration: true,
        partialize: (state) => ({ tabs: state.tabs, activeTabId: state.activeTabId }),
        // localStorage is user-writable: treat what comes back as untrusted input.
        merge: (persisted, current) => {
          const saved = persisted as Partial<Pick<TabsState, 'tabs' | 'activeTabId'>> | undefined
          const tabs = Array.isArray(saved?.tabs)
            ? saved.tabs.filter(isTab).slice(0, MAX_RESTORED_TABS)
            : []
          const activeTabId =
            typeof saved?.activeTabId === 'string' && tabs.some((tab) => tab.id === saved.activeTabId)
              ? saved.activeTabId
              : (tabs[0]?.id ?? null)

          return { ...current, tabs, activeTabId }
        },
      },
    ),
  )
}

const stores = new Map<string, TabsStore>()

/**
 * One store per user id, cached so a remount of the shell (e.g. a layout re-render)
 * does not throw the open tabs away.
 *
 * On the server the cache is bypassed: a module-scope Map is shared by every
 * concurrent request, so caching there would hand one user's tabs to another.
 */
export function getTabsStore(userId: string): TabsStore {
  if (typeof window === 'undefined') return createTabsStore(userId)

  const existing = stores.get(userId)
  if (existing) return existing

  const store = createTabsStore(userId)
  stores.set(userId, store)
  return store
}
