/// <reference lib="webworker" />
/**
 * JobsiteOS service worker — Web Push only.
 *
 * Deliberately NOT a caching/offline worker: JobsiteOS is an authenticated
 * internal tool, and a SW that caches responses would happily serve one user's
 * cached pages to the next person who logs in on that machine. It intercepts no
 * fetches at all.
 *
 * Payloads are produced by notify() in packages/core, which sends
 * JSON.stringify({ titulo, corpo?, url? }).
 */

// Take over immediately instead of waiting for every tab to close — a push
// subscription attached to an old, idle worker is a subscription that goes
// nowhere.
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  /** @type {{ titulo?: string, corpo?: string, url?: string }} */
  let payload = {}

  if (event.data) {
    try {
      payload = event.data.json()
    } catch {
      // Not JSON (a push service test, a malformed send). Show the raw text
      // rather than dropping it: userVisibleOnly means Chrome will surface a
      // generic "site updated in background" notice if we show nothing at all.
      payload = { titulo: event.data.text() }
    }
  }

  const titulo = payload.titulo || 'JobsiteOS'
  const url = payload.url || '/notificacoes'

  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: payload.corpo || '',
      data: { url },
      // Collapse repeats of the same target: three updates on one company while
      // the user is away should not stack three notifications.
      tag: `jobsiteos:${url}`,
      renotify: true,
      timestamp: Date.now(),
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const destino = (event.notification.data && event.notification.data.url) || '/notificacoes'

  event.waitUntil(
    (async () => {
      const alvo = new URL(destino, self.location.origin)

      // Never navigate away from the app's origin because a payload said so.
      if (alvo.origin !== self.location.origin) return

      const janelas = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })

      for (const janela of janelas) {
        const atual = new URL(janela.url)
        if (atual.origin !== alvo.origin) continue

        // Reuse the open tab. Focus first: a focused tab that then navigates is
        // the behaviour people expect, and some browsers reject navigate() on an
        // unfocused client.
        await janela.focus()

        const mesmaPagina = atual.pathname + atual.search === alvo.pathname + alvo.search
        if (!mesmaPagina && 'navigate' in janela) {
          await janela.navigate(alvo.href)
        }
        return
      }

      await self.clients.openWindow(alvo.href)
    })(),
  )
})

/**
 * Browsers rotate push subscriptions on their own (key rotation, storage
 * pressure). Without this the endpoint we have on file goes dead silently and
 * the user just stops getting notifications with no signal anywhere.
 *
 * Server actions can't be called from a worker, so this re-registers through the
 * route handler. The fetch carries the session cookie (same-origin default), so
 * /api/push/web authenticates it as the logged-in user.
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const anterior = event.oldSubscription || (await self.registration.pushManager.getSubscription())

      const chave =
        (event.oldSubscription && event.oldSubscription.options.applicationServerKey) ||
        (anterior && anterior.options.applicationServerKey)

      if (!chave) return

      const nova = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: chave,
      })

      await fetch('/api/push/web', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inscricao: nova.toJSON(),
          endpointAnterior: anterior ? anterior.endpoint : null,
        }),
      })
    })(),
  )
})
