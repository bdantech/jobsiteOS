import { View } from 'react-native'

import { Avatar } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Text } from '@/components/ui/text'
import { useSession } from '@/lib/auth'

/** Identity, read-only: this phase has no profile editing anywhere. */
export function ContaCard() {
  const { usuario, loading } = useSession()

  return (
    <Card>
      <CardContent className="flex-row items-center gap-4 p-4">
        {loading ? (
          <>
            <Skeleton className="h-14 w-14 rounded-full" />
            <View className="flex-1 gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </View>
          </>
        ) : (
          <>
            <Avatar nome={usuario?.nome ?? '?'} size="lg" />
            <View className="flex-1 gap-1">
              <Text variant="heading">{usuario?.nome ?? 'Usuário'}</Text>
              <Text variant="muted">{usuario?.email ?? '—'}</Text>
            </View>
          </>
        )}
      </CardContent>
    </Card>
  )
}
