import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { NotificacoesSkeleton } from '@/components/notifications/notificacoes-lista'

/**
 * Covers the RSC wait (session + RBAC check) before NotificacoesPagina mounts.
 * Mirrors that page's layout so the swap doesn't shift the viewport.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-28" />
      </header>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <NotificacoesSkeleton itens={6} />
        </CardContent>
      </Card>
    </div>
  )
}
