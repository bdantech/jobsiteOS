import {
  ESTAGIOS_ABERTOS,
  ESTAGIO_FUNIL_LABELS,
  FAIXAS,
  FAIXA_LABELS,
  TIPAGENS,
  TIPAGEM_LABELS,
} from '@jobsiteos/core'
import { View } from 'react-native'

import { FiltroChip, FiltroFaixa, FiltroSegmentado, type OpcaoFiltro } from '@/components/ui/filtros'

/**
 * Segmented control por estágio + chips rápidos de faixa e tipagem (§9).
 *
 * O estágio é um SEGMENTED CONTROL e não um chip solto: a nota está em exatamente
 * um estágio, e o controle segmentado comunica exclusividade. Faixa e tipagem são
 * chips, porque limpar é tão importante quanto marcar — tocar no chip ativo
 * desmarca.
 *
 * As duas primitivas moram em @/components/ui/filtros desde que este padrão
 * passou a valer para Empresas, Crédito, Jurídico e Comunicação também. Esta tela
 * continua sendo a referência do padrão; ela só deixou de ser a dona do código.
 *
 * Aqui os chips NÃO usam <FiltroChips>: faixa e tipagem são duas dimensões
 * distintas dividindo a mesma faixa rolável, separadas por um traço vertical. É
 * exatamente o caso para o qual <FiltroFaixa> + <FiltroChip> são exportados.
 */

const ESTAGIOS: readonly OpcaoFiltro<string>[] = [
  ...ESTAGIOS_ABERTOS.map((e) => ({ valor: e as string, label: ESTAGIO_FUNIL_LABELS[e] })),
  { valor: 'encerradas', label: 'Encerradas' },
]

export interface FiltrosFunilProps {
  estagio: string
  onEstagio: (v: string) => void
  faixa: string | undefined
  onFaixa: (v: string | undefined) => void
  tipagem: string | undefined
  onTipagem: (v: string | undefined) => void
}

export function FiltrosFunil({
  estagio,
  onEstagio,
  faixa,
  onFaixa,
  tipagem,
  onTipagem,
}: FiltrosFunilProps) {
  return (
    <View className="gap-2">
      <FiltroSegmentado opcoes={ESTAGIOS} valor={estagio} onChange={onEstagio} />

      <FiltroFaixa className="gap-2">
        {FAIXAS.map((f) => (
          <FiltroChip
            key={f}
            label={FAIXA_LABELS[f]}
            ativo={faixa === f}
            accessibilityLabel={`Filtrar pela faixa ${FAIXA_LABELS[f]}`}
            onPress={() => onFaixa(faixa === f ? undefined : f)}
          />
        ))}

        <View className="w-px self-stretch bg-border" />

        {TIPAGENS.map((t) => (
          <FiltroChip
            key={t}
            label={TIPAGEM_LABELS[t]}
            ativo={tipagem === t}
            accessibilityLabel={`Filtrar pela tipagem ${TIPAGEM_LABELS[t]}`}
            onPress={() => onTipagem(tipagem === t ? undefined : t)}
          />
        ))}
      </FiltroFaixa>
    </View>
  )
}
