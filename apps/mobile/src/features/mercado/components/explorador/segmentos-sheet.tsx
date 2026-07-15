import { Check } from 'lucide-react-native'
import { Pressable, ScrollView, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Sheet } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import { descreverArvore, segmentoArvore, useSegmentosQuery } from './queries'
import type { FiltroComposto, Segmento } from './types'

export interface SegmentosSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The segmento currently applied, so the sheet can mark it and allow clearing. */
  ativo: FiltroComposto | undefined
  onSelect: (filtro: FiltroComposto | undefined) => void
}

function SegmentoItem({
  segmento,
  ativo,
  onSelect,
}: {
  segmento: Segmento
  ativo: boolean
  onSelect: (filtro: FiltroComposto | undefined) => void
}) {
  const { colors } = useTheme()

  // A segment saved against an older variable catalog no longer parses. It cannot
  // be applied — say so, instead of letting the tap throw inside the compiler.
  const arvore = segmentoArvore(segmento)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: ativo, disabled: arvore === null }}
      accessibilityLabel={`Aplicar o segmento ${segmento.nome}`}
      disabled={arvore === null}
      onPress={() => {
        if (!arvore) return
        // Re-tapping the applied segment clears it.
        onSelect(
          ativo
            ? undefined
            : { arvore, origem: { tipo: 'segmento', id: segmento.id, nome: segmento.nome } },
        )
      }}
      className={cn(
        'flex-row items-start gap-3 rounded-lg border px-3 py-3 active:opacity-70',
        ativo ? 'border-primary bg-primary/10' : 'border-border bg-transparent',
        arvore === null && 'opacity-50',
      )}
    >
      <View className="flex-1 gap-1">
        <Text variant="label" numberOfLines={1}>
          {segmento.nome}
        </Text>

        {segmento.descricao ? (
          <Text variant="muted" className="text-xs" numberOfLines={2}>
            {segmento.descricao}
          </Text>
        ) : null}

        {arvore ? (
          <Text variant="muted" className="text-xs" numberOfLines={3}>
            {descreverArvore(arvore)}
          </Text>
        ) : (
          <Text variant="destructive" className="text-xs">
            Este segmento usa variáveis que não existem mais. Refaça-o na web.
          </Text>
        )}

        {segmento.contagem_cache !== null ? (
          <Text variant="muted" className="text-xs">
            {segmento.contagem_cache.toLocaleString('pt-BR')} empresas na última contagem
          </Text>
        ) : null}
      </View>

      {ativo ? <Check size={18} color={colors.primary} /> : null}
    </Pressable>
  )
}

function SegmentosSkeleton() {
  return (
    <View className="gap-2" accessibilityLabel="Carregando segmentos">
      {[0, 1, 2].map((key) => (
        <Skeleton key={key} className="h-20 rounded-lg" />
      ))}
    </View>
  )
}

/**
 * Mobile is query-only (§5.3): it does not build filter trees, it consumes the
 * ones saved on the web. Tapping a segmento applies its tree to the list.
 */
export function SegmentosSheet({ open, onOpenChange, ativo, onSelect }: SegmentosSheetProps) {
  // Only fetched while the sheet is open — most sessions never open it.
  const { data: segmentos, isPending, isError, refetch } = useSegmentosQuery(open)

  const idAtivo = ativo?.origem.tipo === 'segmento' ? ativo.origem.id : null

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Segmentos"
      description="Filtros salvos. Toque para aplicar sobre a lista."
    >
      {/* No height cap here: <Sheet> already bounds the panel at 90% and lets the
          body shrink, so the ScrollView inherits a bounded box and scrolls. */}
      <ScrollView contentContainerClassName="gap-2 pb-2">
        {isPending ? (
          <SegmentosSkeleton />
        ) : isError ? (
          <ErrorState
            description="Não foi possível carregar os segmentos."
            onRetry={() => void refetch()}
            className="py-8"
          />
        ) : segmentos.length === 0 ? (
          <EmptyState
            title="Nenhum segmento salvo"
            description="Segmentos são criados no Explorador da web ou pela IA. Assim que existir um, ele aparece aqui."
            className="py-8"
          />
        ) : (
          segmentos.map((segmento) => (
            <SegmentoItem
              key={segmento.id}
              segmento={segmento}
              ativo={idAtivo === segmento.id}
              onSelect={(filtro) => {
                onSelect(filtro)
                onOpenChange(false)
              }}
            />
          ))
        )}
      </ScrollView>
    </Sheet>
  )
}
