import { ESTAGIOS, ESTAGIO_LABELS, type Estagio } from '@jobsiteos/core'
import { Pressable, ScrollView, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

export interface EstagioFiltroProps {
  /** undefined = "Todas". */
  value: Estagio | undefined
  onChange: (estagio: Estagio | undefined) => void
}

interface Chip {
  key: string
  label: string
  estagio: Estagio | undefined
}

const CHIPS: Chip[] = [
  { key: 'todas', label: 'Todas', estagio: undefined },
  ...ESTAGIOS.map((estagio) => ({
    key: estagio,
    label: ESTAGIO_LABELS[estagio],
    estagio,
  })),
]

/** The funnel as a row of toggles. Tapping the active chip clears the filter. */
export function EstagioFiltro({ value, onChange }: EstagioFiltroProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerClassName="gap-2 px-4"
    >
      {CHIPS.map((chip) => {
        const active = chip.estagio === value

        return (
          <Pressable
            key={chip.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Filtrar por ${chip.label}`}
            // Re-tapping the active chip resets to "Todas"; "Todas" itself is idempotent.
            onPress={() => onChange(active ? undefined : chip.estagio)}
            className={cn(
              'rounded-full border px-3 py-1.5 active:opacity-70',
              active ? 'border-primary bg-primary' : 'border-border bg-transparent',
            )}
          >
            <View>
              <Text
                className={cn(
                  'text-sm font-medium',
                  active ? 'text-primary-foreground' : 'text-muted-foreground',
                )}
              >
                {chip.label}
              </Text>
            </View>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}
