import {
  ESTAGIOS_ABERTOS,
  ESTAGIO_FUNIL_LABELS,
  FAIXAS,
  FAIXA_LABELS,
  TIPAGENS,
  TIPAGEM_LABELS,
} from '@jobsiteos/core'
import { Pressable, ScrollView, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

/**
 * Segmented control por estágio + chips rápidos de faixa e tipagem (§9).
 *
 * O estágio é um SEGMENTED CONTROL e não um chip solto: a nota está em exatamente um
 * estágio, e o controle segmentado comunica exclusividade. Faixa e tipagem são
 * chips, porque limpar é tão importante quanto marcar — tocar no chip ativo
 * desmarca.
 */

const ESTAGIOS: readonly { valor: string; label: string }[] = [
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

function Chip({
  label,
  ativo,
  onPress,
  accessibilityLabel,
}: {
  label: string
  ativo: boolean
  onPress: () => void
  accessibilityLabel: string
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: ativo }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      className={cn(
        'rounded-full border px-3 py-1.5 active:opacity-70',
        ativo ? 'border-primary bg-primary' : 'border-border bg-transparent',
      )}
    >
      <Text
        className={cn(
          'text-sm font-medium',
          ativo ? 'text-primary-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
      </Text>
    </Pressable>
  )
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
      {/* Estágio: exclusivo, sempre um selecionado. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-1 px-4"
      >
        <View className="flex-row gap-1 rounded-full border border-border p-1">
          {ESTAGIOS.map((e) => {
            const ativo = estagio === e.valor
            return (
              <Pressable
                key={e.valor}
                accessibilityRole="button"
                accessibilityState={{ selected: ativo }}
                accessibilityLabel={`Ver ${e.label}`}
                onPress={() => onEstagio(e.valor)}
                className={cn('rounded-full px-3 py-1.5 active:opacity-70', ativo && 'bg-primary')}
              >
                <Text
                  className={cn(
                    'text-sm font-medium',
                    ativo ? 'text-primary-foreground' : 'text-muted-foreground',
                  )}
                >
                  {e.label}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </ScrollView>

      {/* Faixa + tipagem: opcionais, tocar no ativo limpa. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-2 px-4"
      >
        {FAIXAS.map((f) => (
          <Chip
            key={f}
            label={FAIXA_LABELS[f]}
            ativo={faixa === f}
            accessibilityLabel={`Filtrar pela faixa ${FAIXA_LABELS[f]}`}
            onPress={() => onFaixa(faixa === f ? undefined : f)}
          />
        ))}

        <View className="w-px self-stretch bg-border" />

        {TIPAGENS.map((t) => (
          <Chip
            key={t}
            label={TIPAGEM_LABELS[t]}
            ativo={tipagem === t}
            accessibilityLabel={`Filtrar pela tipagem ${TIPAGEM_LABELS[t]}`}
            onPress={() => onTipagem(tipagem === t ? undefined : t)}
          />
        ))}
      </ScrollView>
    </View>
  )
}
