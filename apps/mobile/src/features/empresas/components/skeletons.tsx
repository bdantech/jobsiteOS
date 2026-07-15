import { View } from 'react-native'

import { Skeleton } from '@/components/ui/skeleton'

/** Shaped like EmpresaCard, so the list doesn't jump when the data lands. */
export function EmpresasListSkeleton() {
  return (
    <View className="gap-3 p-4" accessibilityLabel="Carregando empresas">
      {[0, 1, 2, 3, 4, 5].map((key) => (
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

/** Shaped like the 360: header, ERP card, notes card, timeline card. */
export function Empresa360Skeleton() {
  return (
    <View className="gap-4 p-4" accessibilityLabel="Carregando empresa">
      <View className="gap-2">
        <Skeleton className="h-8 w-3/4 rounded-md" />
        <Skeleton className="h-4 w-1/2 rounded-md" />
        <View className="mt-1 flex-row gap-2">
          <Skeleton className="h-6 w-20 rounded-md" />
          <Skeleton className="h-6 w-24 rounded-md" />
        </View>
      </View>

      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-56 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </View>
  )
}
