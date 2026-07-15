import { moduleForRoute } from '@jobsiteos/core'

/**
 * A tab's title is whatever the page calls itself. Two sources, in order:
 *
 *  1. `titleForRoute()` — an immediate, synchronous guess from the registry, used the
 *     instant a tab is created (a cmd+clicked tab that has never been rendered has no
 *     document title to read).
 *  2. the live `document.title`, once the page has actually rendered — see RouteSync.
 *
 * (2) is what makes "Empresas" become "Construtora Alfa" on a detail page, and it costs
 * the other agents' pages exactly nothing: they set `metadata.title` like any Next page
 * and the tab follows. No page has to know that tabs exist.
 */

const SUFFIX = ' · JobsiteOS'

/** Routes the registry knows nothing about (they belong to no module). */
const STATIC_TITLES: Record<string, string> = {
  '/': 'Início',
  '/settings': 'Configurações',
  '/sem-acesso': 'Sem acesso',
}

export function titleForRoute(route: string): string {
  const staticTitle = STATIC_TITLES[route]
  if (staticTitle) return staticTitle

  // Not named `module`: Next's linter reserves that identifier (no-assign-module-variable).
  const appModule = moduleForRoute(route)
  if (appModule) return appModule.name

  // Unknown route: humanise the last segment rather than showing a raw path.
  const segment = route.split('/').filter(Boolean).pop()
  if (!segment) return 'JobsiteOS'

  const words = decodeURIComponent(segment).replace(/[-_]/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * `document.title` is "Empresas · JobsiteOS" (root layout's template). Strip the brand
 * suffix — repeating it on every tab is noise. Returns null when there is nothing left,
 * so the caller keeps the title it already had instead of blanking the tab.
 */
export function cleanDocumentTitle(title: string): string | null {
  const trimmed = title.endsWith(SUFFIX) ? title.slice(0, -SUFFIX.length) : title
  const cleaned = trimmed.trim()
  if (!cleaned || cleaned === 'JobsiteOS') return null
  return cleaned
}
