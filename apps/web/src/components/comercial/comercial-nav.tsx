'use client'

import { useJanelaNovidades, useResumoNovidades } from '@/components/antecipacao/use-novidades'
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
export function ComercialNav({
  tipo,
  ehGestor,
  vendedorId,
  temAntecipacao,
}: {
  tipo: string | null
  ehGestor: boolean
  vendedorId: string | null
  /** As notas vivem sob a RLS da Antecipação: sem o módulo não há o que contar. */
  temAntecipacao: boolean
}) {
  /*
   * O contador da aba de NFs (04t): o que entrou desde o último expediente.
   *
   * No MESMO recorte da tela que a aba abre — o originador é travado na própria
   * carteira (`vendedor_id`), o gestor vê tudo, o closer vê o que a RLS lhe dá. Um
   * contador que fala de uma fila diferente da que o clique abre ensina a não olhar.
   */
  const { janela } = useJanelaNovidades('expediente')
  const novidades = useResumoNovidades(janela, tipo === 'originador' ? vendedorId : null, temAntecipacao)

  return (
    <ModuloTabs
      moduloId="comercial"
      rotulo="Seções do Comercial"
      tipo={tipo}
      ehGestor={ehGestor}
      contadores={{ novidades_funil: novidades.data?.total ?? 0 }}
    />
  )
}
