import type { AppModule } from '../types.js'

/**
 * Notifications are also reachable from the bell in the shell on both platforms;
 * registering it as a module gives it a route, an RBAC entry, and a place in the
 * mobile "Mais" grid without special-casing.
 *
 * Fora da sidebar web: lá o sino já é a porta, e o item repetido ocupava a seção
 * "Outros" sozinho ao lado da Administração.
 */
export const notificacoesModule: AppModule = {
  id: 'notificacoes',
  name: 'Notificações',
  icon: 'bell',
  route: '/notificacoes',
  group: 'sistema',
  foraDaSidebar: true,
  tools: [],
}
