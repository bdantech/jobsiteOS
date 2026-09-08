import { ESTAGIOS, ESTAGIO_LABELS, type Estagio } from '@jobsiteos/core'

import { FiltroSegmentado, type OpcaoFiltro } from '@/components/ui/filtros'

export interface EstagioFiltroProps {
  /** undefined = "Todas". */
  value: Estagio | undefined
  onChange: (estagio: Estagio | undefined) => void
}

/**
 * O funil como controle segmentado, no mesmo padrão da Antecipação.
 *
 * ── Por que segmentado, e não os chips que estavam aqui ────────────────────
 * A escolha É exclusiva: a lista mostra um estágio ou mostra todos, nunca dois.
 * Como chips soltos, ela prometia o que não cumpria — chip solto sugere que dá
 * para combinar, e combinar não existia. E o "Todas" convivia com o
 * tocar-no-ativo-para-limpar, dois caminhos para o mesmo estado.
 *
 * O "Todas" continua sendo o primeiro segmento, que é como se diz "sem filtro"
 * num controle onde sempre há um selecionado.
 */
const TODAS = '__todas__'

const OPCOES: readonly OpcaoFiltro<string>[] = [
  { valor: TODAS, label: 'Todas' },
  ...ESTAGIOS.map((estagio) => ({ valor: estagio as string, label: ESTAGIO_LABELS[estagio] })),
]

export function EstagioFiltro({ value, onChange }: EstagioFiltroProps) {
  return (
    <FiltroSegmentado
      opcoes={OPCOES}
      valor={value ?? TODAS}
      onChange={(valor) => onChange(valor === TODAS ? undefined : (valor as Estagio))}
      rotulo={(label) => `Filtrar por ${label}`}
    />
  )
}
