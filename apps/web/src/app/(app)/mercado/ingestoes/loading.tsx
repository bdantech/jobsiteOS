import { Skeleton } from '@/components/ui/skeleton'

/** Shown while the RSC guard (session + módulo) resolves, before the table mounts. */
export default function CarregandoIngestoes() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-4 w-[32rem] max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-10 w-40" />
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-10 w-48" />
      </div>

      <div className="space-y-px rounded-lg border p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="my-3 h-8 w-full" />
        ))}
      </div>
    </div>
  )
}
