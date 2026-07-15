import { type Camada } from '@jobsiteos/core'
import { cn } from '@/lib/utils'

/**
 * Camada is ORDINAL — universo ⊃ TAM ⊃ SAM ⊃ SOM is a pyramid, and swapping two
 * layers would change the meaning. So it does NOT get a set of categorical hues: it
 * gets the design system's one-hue ramp (`--chart-1..4`, navy 220°, monotone in
 * lightness), where the reader sees the order in the colour itself. Spending four
 * different hues here would burn the identity channel to re-encode an order that
 * lightness already shows.
 *
 * There is no local palette any more, and there must not be one: the ramp lives in
 * globals.css, is validated there against both surfaces, and INVERTS its anchor in
 * dark mode (universo dark → SOM bright), which a hardcoded hex could never do.
 *
 * The ramp's first step sits below 3:1 against the surface on purpose — universo is
 * the layer that matters least. That is legal only because nothing here is encoded by
 * colour alone: every chart ships a legend, a direct numeric label on every row, the
 * layer's name in the tooltip, and a "Ver tabela" view of the exact numbers.
 */

/** camada → step of the ordinal ramp. The index IS the height in the pyramid. */
export const CAMADA_FUNDO: Record<Camada, string> = {
  universo: 'bg-chart-1',
  tam: 'bg-chart-2',
  sam: 'bg-chart-3',
  som: 'bg-chart-4',
}

/** The single-series colour: the anchor of the ramp — the most salient step in both themes. */
export const FUNDO_SERIE_UNICA = 'bg-chart-4'

/** A 12px colour chip. Never alone: it always sits beside its label. */
export function ChipCamada({ camada, className }: { camada: Camada; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block h-3 w-3 shrink-0 rounded-sm', CAMADA_FUNDO[camada], className)}
    />
  )
}
