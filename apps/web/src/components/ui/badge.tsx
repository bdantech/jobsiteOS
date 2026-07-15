import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Two colour CHANNELS live here, and they never mix.
 *
 * 1. STATUS — `success` / `warning` / `critical` / `info` / `neutral`. The state of
 *    a thing: concluída, falhou, processando. Green/amber/red are RESERVED for this
 *    and nothing else. Always shipped with a label — colour is never the only channel.
 *
 * 2. ORDINAL — `ordinal1..ordinal4`. One step of a scale that has an ORDER (the
 *    pyramid: universo → TAM → SAM → SOM). It comes out of the `--chart-1..4` ramp,
 *    the same one the charts use, so a badge in a table and a segment in a stacked
 *    bar speak the same language.
 *
 *    The ink follows the STEP, not the theme: `--chart-1/2` are light in the light
 *    theme and dark in the dark one, so they take `text-foreground`; `--chart-3/4`
 *    are the opposite and take `text-background`. Both tokens already invert with the
 *    theme, so one class is correct in both.
 *
 * Status is the ONE place in the app where a raw Tailwind colour is allowed: there is
 * no status token in globals.css, and concentrating it here — in the design-system
 * layer — is what stops it from leaking back into feature components.
 */

/** The ordinal ramp as badge classes, so the pyramid's own constants can reuse the
 *  exact same steps instead of restating them. */
export const ORDINAL_BADGE = {
  1: 'border-transparent bg-chart-1 text-foreground',
  2: 'border-transparent bg-chart-2 text-foreground',
  3: 'border-transparent bg-chart-3 text-background',
  4: 'border-transparent bg-chart-4 text-background',
} as const satisfies Record<1 | 2 | 3 | 4, string>

/** The status channel outside a badge: a highlighted number, a callout surface. */
export type TomStatus = 'success' | 'warning' | 'critical' | 'info'

export const STATUS_TEXTO = {
  success: 'text-emerald-700 dark:text-emerald-400',
  warning: 'text-amber-700 dark:text-amber-400',
  critical: 'text-red-700 dark:text-red-400',
  info: 'text-sky-700 dark:text-sky-400',
} as const satisfies Record<TomStatus, string>

export const STATUS_SUPERFICIE = {
  success:
    'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  warning:
    'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  critical:
    'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200',
  info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200',
} as const satisfies Record<TomStatus, string>

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
        outline: 'text-foreground',

        // ── canal de STATUS ───────────────────────────────────────────────────
        success:
          'border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
        warning:
          'border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
        critical: 'border-transparent bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
        info: 'border-transparent bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
        neutral: 'border-transparent bg-muted text-muted-foreground',

        // ── canal ORDINAL: a rampa da pirâmide (--chart-1..4) ─────────────────
        ordinal1: ORDINAL_BADGE[1],
        ordinal2: ORDINAL_BADGE[2],
        ordinal3: ORDINAL_BADGE[3],
        ordinal4: ORDINAL_BADGE[4],
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
