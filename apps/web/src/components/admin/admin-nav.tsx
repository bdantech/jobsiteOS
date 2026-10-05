'use client'

import { ModuloTabs } from '@/components/shell/modulo-tabs'

/**
 * Tab-styled links rather than <Tabs>: each tab is a distinct route, so it must be a real
 * navigation (shareable URL, back button, RSC streaming) and not client-side panel
 * switching. As abas estão no catálogo único (components/shell/abas-dos-modulos.ts).
 *
 * Sem `mb-6`: o layout da Administração já espaça os filhos com `gap-6`.
 */
export function AdminNav() {
  return <ModuloTabs moduloId="admin" rotulo="Seções da administração" className="mb-0" />
}
