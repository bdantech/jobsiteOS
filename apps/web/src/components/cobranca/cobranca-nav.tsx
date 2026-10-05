'use client'

import { ModuloTabs } from '@/components/shell/modulo-tabs'

/**
 * Navegação interna da Cobrança (§ Localização do Prompt 07). As abas, a ordem delas e quem vê cada uma
 * estão no catálogo único (components/shell/abas-dos-modulos.ts).
 */
export function CobrancaNav() {
  return <ModuloTabs moduloId="cobranca" rotulo="Seções da Cobrança" />
}
