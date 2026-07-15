import { Skeleton } from '@/components/ui/skeleton'

/** Shown while the RSC guard (session + module) resolves, before the table mounts. */
export default function CarregandoEmpresas() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-10 w-36" />
      </div>

      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-10 flex-1 min-w-64" />
        <Skeleton className="h-10 w-44" />
        <Skeleton className="h-10 w-44" />
        <Skeleton className="h-10 w-28" />
      </div>

      <div className="space-y-px rounded-lg border p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="my-3 h-8 w-full" />
        ))}
      </div>
    </div>
  )
}
