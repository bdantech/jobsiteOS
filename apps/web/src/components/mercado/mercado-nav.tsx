'use client'

import { ModuloTabs } from '@/components/shell/modulo-tabs'

/**
 * Navegação interna do módulo Mercado. As abas, a ordem delas e quem vê cada uma
 * estão no catálogo único (components/shell/abas-dos-modulos.ts).
 */
export function MercadoNav() {
  return <ModuloTabs moduloId="mercado" rotulo="Seções do Mercado" />
}
