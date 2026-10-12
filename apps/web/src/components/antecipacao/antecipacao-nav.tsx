'use client'

import { ModuloTabs } from '@/components/shell/modulo-tabs'
import { useJanelaNovidades, useResumoNovidades } from './use-novidades'

/**
 * Navegação interna da Antecipação. As abas, a ordem delas e quem vê cada uma
 * estão no catálogo único (components/shell/abas-dos-modulos.ts).
 */
export function AntecipacaoNav() {
  // O contador do Funil (04t): o que entrou desde o último expediente, no recorte que
  // a RLS dá a quem abriu — aqui o funil não é travado numa carteira.
  const { janela } = useJanelaNovidades('expediente')
  const novidades = useResumoNovidades(janela)

  return (
    <ModuloTabs
      moduloId="antecipacao"
      rotulo="Seções da Antecipação"
      contadores={{ novidades_funil: novidades.data?.total ?? 0 }}
    />
  )
}
