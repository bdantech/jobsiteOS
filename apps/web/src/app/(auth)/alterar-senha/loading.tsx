import { Skeleton } from '@/components/ui/skeleton'

/** The (auth) layout already centers and constrains this — just fill the card. */
export default function Loading() {
  return (
    <div className="w-full space-y-4 rounded-lg border bg-card p-6">
      <Skeleton className="h-10 w-10 rounded-lg" />
      <Skeleton className="h-6 w-44" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  )
}
