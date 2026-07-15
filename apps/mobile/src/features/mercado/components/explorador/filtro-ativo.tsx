import { X } from 'lucide-react-native'
import { Pressable, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Text } from '@/components/ui/text'
import { descreverArvore } from './queries'
import type { FiltroComposto } from './types'

export interface FiltroAtivoProps {
  filtro: FiltroComposto
  onClear: () => void
}

/**
 * The composite filter, made visible.
 *
 * A tree applied from a segmento or arriving from a Mapa deep link is invisible
 * in the chips — the user would see a short list and no reason for it. `descrever()`
 * renders the same tree the compiler consumed, in pt-BR, so what is filtering the
 * list is always readable and always removable.
 */
export function FiltroAtivo({ filtro, onClear }: FiltroAtivoProps) {
  const { colors } = useTheme()

  const titulo =
    filtro.origem.tipo === 'segmento' ? `Segmento: ${filtro.origem.nome}` : 'Filtro do Mapa'

  return (
    <View className="mx-4 flex-row items-start gap-3 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2">
      <View className="flex-1 gap-0.5">
        <Text variant="label" className="text-primary" numberOfLines={1}>
          {titulo}
        </Text>
        <Text variant="muted" className="text-xs" numberOfLines={3}>
          {descreverArvore(filtro.arvore)}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Remover filtro"
        onPress={onClear}
        // Small target on screen, generous target for the thumb.
        hitSlop={10}
        className="pt-0.5 active:opacity-60"
      >
        <X size={18} color={colors.mutedForeground} />
      </Pressable>
    </View>
  )
}
