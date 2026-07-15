import type { AppModule } from '../types.js'

/**
 * Notifications are also reachable from the bell in the shell on both platforms;
 * registering it as a module gives it a route, an RBAC entry, and a place in the
 * mobile "Mais" grid without special-casing.
 */
export const notificacoesModule: AppModule = {
  id: 'notificacoes',
  name: 'Notificações',
  icon: 'bell',
  route: '/notificacoes',
  tools: [],
}
