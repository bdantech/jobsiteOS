import { canAccessRoute, grantedMobileModules, moduleForRoute } from '@jobsiteos/core'

/**
 * Where an authenticated user should land: their first granted mobile module,
 * or the "Mais" tab when their perfil grants nothing (or grants web-only modules
 * such as admin). Never returns a route the user can't open.
 */
export function landingRoute(grantedModuleIds: readonly string[]): string {
  const first = grantedMobileModules(grantedModuleIds)[0]
  return first ? first.route : '/mais'
}

/**
 * Notification rows carry a *web* route in `url` (e.g. "/empresas/<uuid>"), and
 * the mobile file tree mirrors those routes inside the (tabs) group — Expo Router
 * ignores group segments when matching, so the same string is a valid mobile href.
 *
 * What it is NOT allowed to be: a route into a module the user doesn't have, or
 * into a webOnly module (admin). A push payload is attacker-influenced input in
 * the general case, so it gets validated against the registry like any other
 * navigation, and falls back to the landing route.
 */
export function resolveNotificationHref(
  url: string | null | undefined,
  grantedModuleIds: readonly string[],
): string {
  if (!url) return landingRoute(grantedModuleIds)

  // Absolute URLs and scheme links are not routes: only accept in-app paths.
  if (!url.startsWith('/')) return landingRoute(grantedModuleIds)

  const module = moduleForRoute(url)
  if (module?.webOnly) return landingRoute(grantedModuleIds)
  if (!canAccessRoute(url, grantedModuleIds)) return landingRoute(grantedModuleIds)

  return url
}

/** Guard for the current screen. Same rules, expressed as a predicate. */
export function canOpenOnMobile(route: string, grantedModuleIds: readonly string[]): boolean {
  const module = moduleForRoute(route)
  if (!module) return true // login, /configuracoes, /mais — not the registry's business
  if (module.webOnly) return false
  return grantedModuleIds.includes(module.id)
}
