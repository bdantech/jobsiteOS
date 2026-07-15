import { Skeleton } from '@/components/ui/skeleton'

export default function CarregandoSegmentos() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-10 w-44" />
      </div>

      <div className="space-y-px rounded-lg border p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="my-3 h-8 w-full" />
        ))}
      </div>
    </div>
  )
}
