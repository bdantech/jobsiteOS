'use client'

import { ModuloTabs } from '@/components/shell/modulo-tabs'

/**
 * Navegação interna do módulo Radar. As abas, a ordem delas e quem vê cada uma
 * estão no catálogo único (components/shell/abas-dos-modulos.ts).
 */
export function RadarNav() {
  return <ModuloTabs moduloId="radar" rotulo="Seções do Radar" />
}
