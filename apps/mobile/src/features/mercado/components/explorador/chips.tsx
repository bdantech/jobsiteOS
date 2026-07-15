import { CAMADAS, CAMADA_LABELS, type Camada } from '@jobsiteos/core'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import { UFS } from './format'

interface ChipProps {
  label: string
  active: boolean
  onPress: () => void
  accessibilityLabel: string
}

function Chip({ label, active, onPress, accessibilityLabel }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
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
          {label}
        </Text>
      </View>
    </Pressable>
  )
}

function Linha({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Without this a tap on a chip only dismisses the keyboard and is swallowed.
      keyboardShouldPersistTaps="handled"
      contentContainerClassName="gap-2 px-4"
    >
      {children}
    </ScrollView>
  )
}

export interface CamadaFiltroProps {
  /** undefined = "Todas". */
  value: Camada | undefined
  onChange: (camada: Camada | undefined) => void
}

/**
 * The pyramid as a row of toggles. This is `camada` — market fit, computed by the
 * versioned rules — NOT `estagio`, which is relationship history and lives in the
 * Empresas module. Different axes, never the same chip row.
 */
export function CamadaFiltro({ value, onChange }: CamadaFiltroProps) {
  return (
    <Linha>
      <Chip
        label="Todas as camadas"
        active={value === undefined}
        accessibilityLabel="Mostrar todas as camadas"
        onPress={() => onChange(undefined)}
      />
      {CAMADAS.map((camada) => {
        const active = camada === value
        return (
          <Chip
            key={camada}
            label={CAMADA_LABELS[camada]}
            active={active}
            accessibilityLabel={`Filtrar pela camada ${CAMADA_LABELS[camada]}`}
            // Re-tapping the active chip clears the filter.
            onPress={() => onChange(active ? undefined : camada)}
          />
        )
      })}
    </Linha>
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
    <Linha>
      <Chip
        label="Brasil"
        active={value === undefined}
        accessibilityLabel="Mostrar todos os estados"
        onPress={() => onChange(undefined)}
      />
      {UFS.map((uf) => {
        const active = uf === value
        return (
          <Chip
            key={uf}
            label={uf}
            active={active}
            accessibilityLabel={`Filtrar pelo estado ${uf}`}
            onPress={() => onChange(active ? undefined : uf)}
          />
        )
      })}
    </Linha>
  )
}
