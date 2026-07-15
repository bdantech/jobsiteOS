'use client'

import * as React from 'react'
import { useStore } from 'zustand'
import { canAccessRoute } from '@jobsiteos/core'
import { getTabsStore, type TabsState, type TabsStore } from '@/stores/tabs'

interface TabsContextValue {
  store: TabsStore
  /** False until localStorage has been read. Consumers must not render tabs before this. */
  hydrated: boolean
}

const TabsContext = React.createContext<TabsContextValue | null>(null)

interface TabsStoreProviderProps {
  userId: string
  grantedModuleIds: string[]
  children: React.ReactNode
}

export function TabsStoreProvider({ userId, grantedModuleIds, children }: TabsStoreProviderProps) {
  const store = React.useMemo(() => getTabsStore(userId), [userId])
  const [hydrated, setHydrated] = React.useState(false)

  // `grantedModuleIds` is a fresh array on every render of the server layout, so
  // depending on it directly would re-run this effect forever. The joined key is stable.
  const grantsKey = grantedModuleIds.join(',')

  React.useEffect(() => {
    const granted = grantsKey ? grantsKey.split(',') : []

    const onHydrated = () => {
      // A perfil can lose a module between sessions. Restoring a tab pointing at a
      // route the user can no longer open would hand them a permanent 403 in their
      // own tab bar, so drop those before anyone can click one.
      store.getState().pruneTabs((route: string) => canAccessRoute(route, granted))
      setHydrated(true)
    }

    const unsubscribe = store.persist.onFinishHydration(onHydrated)

    if (store.persist.hasHydrated()) {
      // Store was already hydrated by an earlier mount (it is cached per user id).
      onHydrated()
    } else {
      void store.persist.rehydrate()
    }

    return unsubscribe
  }, [store, grantsKey])

  const value = React.useMemo<TabsContextValue>(() => ({ store, hydrated }), [store, hydrated])

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>
}

function useTabsContext(): TabsContextValue {
  const context = React.useContext(TabsContext)
  if (!context) throw new Error('useTabs* precisa estar dentro de <TabsStoreProvider>.')
  return context
}

/** Subscribe to a slice of the tabs state. Select one value at a time (zustand v5). */
export function useTabsStore<T>(selector: (state: TabsState) => T): T {
  return useStore(useTabsContext().store, selector)
}

/**
 * The raw store, for imperative use inside event handlers — `store.getState().openTab(...)`.
 * Reading state this way does not subscribe the component, which is what you want in a
 * click handler.
 *
 * This is also the entry point for other features: the AI Bar can answer "abre a empresa X"
 * with `store.getState().openTab(route, nome, { activate: true })` followed by a router.push.
 */
export function useTabsStoreApi(): TabsStore {
  return useTabsContext().store
}

export function useTabsHydrated(): boolean {
  return useTabsContext().hydrated
}
