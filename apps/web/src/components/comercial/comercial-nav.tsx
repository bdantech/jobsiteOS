'use client'

import { ModuloTabs } from '@/components/shell/modulo-tabs'

/**
 * Navegação interna do Comercial. As abas, os blocos (o dia, o resultado, a gestão) e a
 * regra de quem vê cada uma estão no catálogo único
 * (components/shell/abas-dos-modulos.ts) — inclusive o porquê de cada tipo de vendedor
 * ver o conjunto que vê.
 *
 * O tipo e a gestão chegam resolvidos do servidor (comercial/layout.tsx): resolvê-los
 * no cliente faria a barra piscar entre dois conjuntos de abas em toda troca de página.
 */
export function ComercialNav({ tipo, ehGestor }: { tipo: string | null; ehGestor: boolean }) {
  return <ModuloTabs moduloId="comercial" rotulo="Seções do Comercial" tipo={tipo} ehGestor={ehGestor} />
}
