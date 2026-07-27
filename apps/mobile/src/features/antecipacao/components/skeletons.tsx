import { View } from 'react-native'

import { Skeleton } from '@/components/ui/skeleton'

/**
 * O esqueleto desenha a MESMA forma do card real. Um esqueleto que mostra um
 * layout e entrega outro faz a lista saltar na cara de quem estava esperando.
 */
export function FunilSkeleton() {
  return (
    <View className="gap-3 px-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <View key={i} className="gap-2 rounded-xl border border-border bg-card p-3">
          <Skeleton className="h-4 w-2/3" />
          <View className="flex-row gap-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </View>
          <View className="flex-row justify-between">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-24" />
          </View>
          <Skeleton className="h-4 w-full" />
        </View>
      ))}
    </View>
  )
}

export function ListaSkeleton() {
  return (
    <View className="gap-3 px-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <View key={i} className="gap-2 rounded-xl border border-border bg-card p-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-2 w-full rounded-full" />
        </View>
      ))}
    </View>
  )
}

export function DetalheSkeleton() {
  return (
    <View className="gap-4 p-4">
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-12 w-full rounded-lg" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </View>
  )
}
