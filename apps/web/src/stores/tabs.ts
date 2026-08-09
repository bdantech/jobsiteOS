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

/** Where this tab was before its current route — what "voltar" should mean. */
export interface RotaAnterior {
  route: string
  title: string
}

export interface Tab {
  id: string
  /** Follows the page's <title>; falls back to the module name from the registry. */
  title: string
  /** Pathname. The single thing an inactive tab remembers. */
  route: string
  /**
   * A rota de onde esta aba veio, para o "voltar" das fichas.
   *
   * Vive AQUI, e não num sessionStorage global, porque o usuário pode ter várias abas do
   * app dentro da mesma aba do navegador: um "anterior" global viraria "a última aba em
   * que eu cliquei", e voltar levaria para outro lugar do app. Cada aba lembra o próprio
   * caminho, que é o que a palavra "voltar" promete.
   */
  anterior?: RotaAnterior
  /**
   * O href COMPLETO da rota atual (com query), quando a página se dá ao trabalho de
   * dizer qual é.
   *
   * Existe para o "voltar", e só para ele. `route` continua sendo pathname puro — a
   * regra do topo deste arquivo não se dobra: `useSearchParams` forçaria Suspense em
   * toda página, e uma aba cujo route discorda da barra de endereço dessincroniza a cada
   * filtro. Mas uma tela com abas internas (Empresas → Clientes Onepay) é um LUGAR
   * diferente para quem navegou, e voltar para a primeira aba é voltar para outro lugar.
   * Quem tem esse problema se anuncia; ninguém mais paga por ele.
   *
   * Traz o título junto porque `<title>` não muda com aba interna: sem ele o botão diria
   * "Empresas" e levaria a "Clientes Onepay" — um voltar que mente sobre o destino.
   */
  rotaCompleta?: RotaAnterior
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
  /** A página diz qual é o href (e o nome) do lugar exato onde a pessoa está agora. */
  marcarRotaCompleta: (href: string, titulo: string) => void
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

/**
 * `anterior` vira um href. localStorage é gravável pelo usuário, então um `route` que não
 * começa com '/' (um `javascript:` , por exemplo) tem de ser recusado aqui — é o único
 * ponto entre o disco e um <Link>.
 */
function isRotaAnterior(value: unknown): value is RotaAnterior {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.title === 'string' &&
    typeof candidate.route === 'string' &&
    candidate.route.startsWith('/') &&
    !candidate.route.startsWith('//') // '//host' é uma URL absoluta disfarçada de caminho
  )
}

function isTab(value: unknown): value is Tab {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.route === 'string' &&
    candidate.route.startsWith('/') &&
    (candidate.anterior === undefined || isRotaAnterior(candidate.anterior)) &&
    (candidate.rotaCompleta === undefined || isRotaAnterior(candidate.rotaCompleta))
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

          // O título guardado é o que a página ANTERIOR realmente se chamava (já
          // renomeado pelo <title> dela), não o palpite do registry — é o que faz o
          // botão dizer "Sacados a prospectar" em vez de "Antecipação".
          //
          // E o href guardado é o completo, quando a página anterior o declarou: voltar
          // para /empresas depois de sair de /empresas?tab=clientes cai na aba errada, e
          // "voltar" que aterrissa noutro lugar é pior que voltar nenhum.
          const anterior: RotaAnterior =
            active.rotaCompleta ?? { route: active.route, title: active.title }

          /*
           * `rotaCompleta` morre com a rota que a declarou — mantê-la faria o voltar da
           * PRÓXIMA página apontar para a query da anterior.
           *
           * Exceto quando ela já fala do destino: a página que se anuncia faz isso num
           * efeito, e efeito de filho roda antes de efeito de pai. Se o RouteSync
           * (que mora na casca) sincronizasse depois, ele apagaria a marca que a página
           * acabou de pôr — e o voltar voltaria a mentir, de forma intermitente.
           */
          const marcaEhDoDestino = active.rotaCompleta?.route.split('?')[0] === route

          set({
            tabs: tabs.map((tab) =>
              tab.id === active.id
                ? {
                    ...tab,
                    route,
                    title: fallbackTitle,
                    anterior,
                    rotaCompleta: marcaEhDoDestino ? tab.rotaCompleta : undefined,
                  }
                : tab,
            ),
          })
        },

        marcarRotaCompleta: (href, titulo) => {
          if (!href.startsWith('/') || href.startsWith('//')) return
          set((state) => ({
            tabs: state.tabs.map((tab) =>
              tab.id === state.activeTabId && tab.rotaCompleta?.route !== href
                ? { ...tab, rotaCompleta: { route: href, title: titulo } }
                : tab,
            ),
          }))
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
