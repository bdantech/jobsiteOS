import { View } from 'react-native'

import { Skeleton } from '@/components/ui/skeleton'

/** Shaped like the group screen: title, head card, metrics, chart, member list. */
export function GrupoSkeleton() {
  return (
    <View className="gap-4 p-4" accessibilityLabel="Carregando grupo econômico">
      <View className="gap-2">
        <Skeleton className="h-8 w-3/4 rounded-md" />
        <Skeleton className="h-4 w-1/2 rounded-md" />
      </View>

      <Skeleton className="h-36 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />

      {[0, 1, 2].map((key) => (
        <View key={key} className="gap-2 rounded-xl border border-border bg-card p-4">
          <View className="flex-row items-start justify-between gap-3">
            <Skeleton className="h-5 flex-1 rounded-md" />
            <Skeleton className="h-5 w-16 rounded-md" />
          </View>
          <Skeleton className="h-4 w-40 rounded-md" />
          <Skeleton className="h-3 w-28 rounded-md" />
        </View>
      ))}
    </View>
  )
}

/** Shaped like the "Grupo" card on the Company 360, so the 360 doesn't jump. */
export function GrupoSectionSkeleton() {
  return (
    <View
      className="gap-3 rounded-xl border border-border bg-card p-4"
      accessibilityLabel="Carregando grupo econômico"
    >
      <Skeleton className="h-5 w-24 rounded-md" />
      <Skeleton className="h-6 w-2/3 rounded-md" />
      <View className="flex-row gap-3">
        <Skeleton className="h-10 flex-1 rounded-md" />
        <Skeleton className="h-10 flex-1 rounded-md" />
        <Skeleton className="h-10 flex-1 rounded-md" />
      </View>
    </View>
  )
}
