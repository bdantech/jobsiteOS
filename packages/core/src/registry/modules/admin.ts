import type { AppModule } from '../types.js'

/**
 * Admin is web-only this phase. Mobile navigation must skip it (webOnly) and the
 * mobile route guard must refuse it even when a deep link points at /admin.
 *
 * No AI tools: creating users and granting modules are privilege operations that
 * run on the service role. Exposing them to the model — even behind a
 * confirmation — would put privilege escalation one hallucinated tool call away.
 */
export const adminModule: AppModule = {
  id: 'admin',
  name: 'Administração',
  icon: 'shield',
  route: '/admin',
  webOnly: true,
  tools: [],
}
