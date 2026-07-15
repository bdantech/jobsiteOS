import { Skeleton } from '@/components/ui/skeleton'

/**
 * Shown while the RSC guard runs and the promotion setting is read. The layout
 * matches the real page — one column: the layer diagram, then the rule, then the
 * promotion card — so nothing jumps when the content lands.
 */
export default function PiramideLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>

      <div className="rounded-lg border p-6">
        <div className="flex flex-col items-center gap-6 lg:flex-row lg:items-start lg:gap-8">
          {/* Round, like the figure it stands in for. */}
          <Skeleton className="aspect-square w-full max-w-[280px] shrink-0 rounded-full" />
          <Skeleton className="h-[220px] w-full lg:max-w-sm" />
        </div>
      </div>

      <div className="space-y-4 rounded-lg border p-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-48 w-full" />
      </div>

      <div className="space-y-4 rounded-lg border p-6">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-full max-w-xl" />
        <Skeleton className="h-9 w-full max-w-md" />
      </div>
    </div>
  )
}
