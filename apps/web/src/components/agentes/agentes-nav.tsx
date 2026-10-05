'use client'

import { ModuloTabs } from '@/components/shell/modulo-tabs'

/**
 * Navegação interna dos Agentes (§ Localização do Prompt 09). As abas, a ordem delas e quem vê cada uma
 * estão no catálogo único (components/shell/abas-dos-modulos.ts).
 */
export function AgentesNav() {
  return <ModuloTabs moduloId="agentes" rotulo="Seções dos Agentes" />
}
