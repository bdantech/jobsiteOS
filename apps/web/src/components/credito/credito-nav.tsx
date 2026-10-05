'use client'

import { ModuloTabs } from '@/components/shell/modulo-tabs'

/**
 * Navegação interna do Crédito. As abas, a ordem delas e quem vê cada uma
 * estão no catálogo único (components/shell/abas-dos-modulos.ts).
 */
export function CreditoNav() {
  return <ModuloTabs moduloId="credito" rotulo="Seções do Crédito" />
}
