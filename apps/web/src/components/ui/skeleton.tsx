import { cn } from '@/lib/utils'

/** Loading placeholder. Every page and screen must render one — see the spec. */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />
}

export { Skeleton }
