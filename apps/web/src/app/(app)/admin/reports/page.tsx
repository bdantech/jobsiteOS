import { Suspense } from 'react'
import type { Metadata } from 'next'
import { PainelReports } from '@/components/admin/reports/painel'
import { Skeleton } from '@/components/ui/skeleton'

export const metadata: Metadata = { title: 'Reports' }

/**
 * A triagem de bugs e melhorias (04m §3).
 *
 * O guard é o layout de /admin (admin-only), e a RLS é a segunda tranca: quem não
 * é admin lê apenas os próprios reports, então mesmo uma rota aberta por engano
 * não mostraria a fila da empresa.
 *
 * <Suspense> porque o painel lê `useSearchParams()` — o `?r=<id>` do sino —, e no
 * App Router isso obriga a página inteira a virar client-side render sem ele.
 */
export default function AdminReportsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <PainelReports />
    </Suspense>
  )
}
