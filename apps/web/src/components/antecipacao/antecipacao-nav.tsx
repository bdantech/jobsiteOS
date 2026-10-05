'use client'

import { ModuloTabs } from '@/components/shell/modulo-tabs'

/**
 * Navegação interna da Antecipação. As abas, a ordem delas e quem vê cada uma
 * estão no catálogo único (components/shell/abas-dos-modulos.ts).
 */
export function AntecipacaoNav() {
  return <ModuloTabs moduloId="antecipacao" rotulo="Seções da Antecipação" />
}
