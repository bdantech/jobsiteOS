import { CAMADAS, CAMADA_LABELS, type Camada } from '@jobsiteos/core'

import { FiltroSegmentado, type OpcaoFiltro } from '@/components/ui/filtros'

import { UFS } from './format'

/**
 * Os filtros do Explorador.
 *
 * Este arquivo tinha um <Chip> e uma <Linha> próprios, byte a byte iguais aos de
 * @/components/ui/filtros — mesma cápsula, mesmas classes, mesmo comportamento.
 * Não DESTOAVAM na tela; eram só uma segunda cópia do padrão, esperando para
 * divergir na primeira vez que alguém ajustasse um dos dois lados.
 *
 * Viraram segmentado junto com o filtro de estágio de Empresas, e pelo mesmo
 * motivo: a escolha É exclusiva — o Explorador mostra uma camada ou todas, um
 * estado ou o Brasil, nunca dois. Como chips soltos, prometiam uma combinação que
 * não existe, e o "Todas"/"Brasil" convivia com o tocar-no-ativo-para-limpar,
 * dois caminhos para o mesmo estado.
 *
 * `camada` é AJUSTE DE MERCADO, calculado pelas regras versionadas — não é
 * `estagio`, que é histórico de relacionamento e mora em Empresas. Eixos
 * diferentes, e por isso nunca a mesma faixa.
 */

const TODAS = '__todas__'
const BRASIL = '__brasil__'

const OPCOES_CAMADA: readonly OpcaoFiltro<string>[] = [
  { valor: TODAS, label: 'Todas as camadas' },
  ...CAMADAS.map((camada) => ({ valor: camada as string, label: CAMADA_LABELS[camada] })),
]

const OPCOES_UF: readonly OpcaoFiltro<string>[] = [
  { valor: BRASIL, label: 'Brasil' },
  ...UFS.map((uf) => ({ valor: uf, label: uf })),
]

export interface CamadaFiltroProps {
  /** undefined = "Todas". */
  value: Camada | undefined
  onChange: (camada: Camada | undefined) => void
}

export function CamadaFiltro({ value, onChange }: CamadaFiltroProps) {
  return (
    <FiltroSegmentado
      opcoes={OPCOES_CAMADA}
      valor={value ?? TODAS}
      onChange={(v) => onChange(v === TODAS ? undefined : (v as Camada))}
      rotulo={(label) => `Filtrar pela camada ${label}`}
    />
  )
}

export interface UfFiltroProps {
  /** undefined = "Todas". */
  value: string | undefined
  onChange: (uf: string | undefined) => void
}

/** All 27 UFs, with the eight of the seeded SAM rule first — see UFS in format.ts. */
export function UfFiltro({ value, onChange }: UfFiltroProps) {
  return (
    <FiltroSegmentado
      opcoes={OPCOES_UF}
      valor={value ?? BRASIL}
      onChange={(v) => onChange(v === BRASIL ? undefined : v)}
      rotulo={(label) => (label === 'Brasil' ? 'Mostrar todos os estados' : `Filtrar pelo estado ${label}`)}
    />
  )
}
