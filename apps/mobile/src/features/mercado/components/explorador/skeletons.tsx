import { View } from 'react-native'

import { Skeleton } from '@/components/ui/skeleton'

/** Shaped like ExploradorCard, so the list doesn't jump when the data lands. */
export function ExploradorListSkeleton() {
  return (
    <View className="gap-3 p-4" accessibilityLabel="Carregando empresas do universo">
      {[0, 1, 2, 3, 4, 5].map((key) => (
        <View key={key} className="gap-2 rounded-xl border border-border bg-card p-4">
          <View className="flex-row items-start justify-between gap-3">
            <Skeleton className="h-5 flex-1 rounded-md" />
            <Skeleton className="h-5 w-16 rounded-md" />
          </View>
          <Skeleton className="h-4 w-44 rounded-md" />
          <Skeleton className="h-3 w-32 rounded-md" />
          <Skeleton className="h-3 w-52 rounded-md" />
        </View>
      ))}
    </View>
  )
}

/** Shaped like the universe sheet: header, promote action, cadastro, sócios, obras. */
export function UniversoDetalheSkeleton() {
  return (
    <View className="gap-4 p-4" accessibilityLabel="Carregando registro do universo">
      <View className="gap-2">
        <Skeleton className="h-8 w-3/4 rounded-md" />
        <Skeleton className="h-4 w-1/2 rounded-md" />
        <View className="mt-1 flex-row gap-2">
          <Skeleton className="h-6 w-20 rounded-md" />
          <Skeleton className="h-6 w-24 rounded-md" />
        </View>
      </View>

      <Skeleton className="h-12 rounded-lg" />
      <Skeleton className="h-56 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </View>
  )
}
