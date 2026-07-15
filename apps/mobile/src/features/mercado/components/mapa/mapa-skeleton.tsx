import { View } from 'react-native'

import { Skeleton } from '@/components/ui/skeleton'

/** Shaped like the Mapa — total, pyramid, four layer cards — so nothing jumps on load. */
export function MapaSkeleton() {
  return (
    <View className="gap-6 p-4" accessibilityLabel="Carregando o mapa do mercado">
      <View className="gap-2">
        <Skeleton className="h-4 w-32 rounded-md" />
        <Skeleton className="h-8 w-40 rounded-md" />
      </View>

      <Skeleton className="h-56 rounded-xl" />

      <View className="gap-3">
        {[0, 1, 2, 3].map((key) => (
          <View key={key} className="gap-3 rounded-xl border border-border bg-card p-4">
            <View className="flex-row items-start justify-between gap-3">
              <Skeleton className="h-6 w-24 rounded-md" />
              <Skeleton className="h-6 w-16 rounded-md" />
            </View>
            <Skeleton className="h-1.5 w-full rounded-full" />
            <View className="flex-row flex-wrap gap-3">
              <Skeleton className="h-10 w-[47%] rounded-md" />
              <Skeleton className="h-10 w-[47%] rounded-md" />
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}
