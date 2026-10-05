'use client'

import { ModuloTabs } from '@/components/shell/modulo-tabs'

/**
 * Navegação interna do Jurídico. As abas, a ordem delas e quem vê cada uma
 * estão no catálogo único (components/shell/abas-dos-modulos.ts).
 */
export function JuridicoNav() {
  return <ModuloTabs moduloId="juridico" rotulo="Seções do Jurídico" />
}
