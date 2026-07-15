import type { Camada } from '@jobsiteos/core'
import { ORDINAL_BADGE } from '@/components/ui/badge'

/**
 * Shared visuals and formatting for the layer settings page.
 *
 * The promotion vocabulary (values, labels, schema) is NOT here: it lives in
 * core (`CONFIG_CHAVES`, `promocaoCamadaSchema`, `PROMOCAO_CAMADA_LABELS`),
 * next to the `app_config` row it describes, so the UI, the server action and the
 * database agree on one list.
 *
 * The SVG fills that used to live here left with the pyramid drawing: the figure is
 * now `camadas/circulos-camadas.tsx`, and it carries its own ramp.
 */

// ─── A ordem das camadas ────────────────────────────────────────────────────

/** Bottom → top. The index IS the height: `universo` = 0, `som` = 3. */
export const CAMADAS_ORDENADAS: readonly Camada[] = ['universo', 'tam', 'sam', 'som']

/** The dry-run needs it: "above X" and "below X" are questions about this order. */
export function alturaDaCamada(camada: Camada): number {
  return CAMADAS_ORDENADAS.indexOf(camada)
}

/** A mesma rampa da badge (ui/badge.tsx), para o degrau ser idêntico em toda parte. */
export const CAMADA_BADGE: Record<Camada, string> = {
  universo: ORDINAL_BADGE[1],
  tam: ORDINAL_BADGE[2],
  sam: ORDINAL_BADGE[3],
  som: ORDINAL_BADGE[4],
}

// ─── Formatação ─────────────────────────────────────────────────────────────

const inteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const percentual = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

export function formatInteiro(valor: number): string {
  return inteiro.format(valor)
}

/** `total` of 0 has no share — 0% would claim we know the answer is zero. */
export function formatParticipacao(parte: number, total: number): string {
  if (total <= 0) return '—'
  return percentual.format(parte / total)
}

export function formatDataHora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

/** "12.400 empresas" / "1 empresa". */
export function plural(total: number, singular: string, pluralForma: string): string {
  return `${formatInteiro(total)} ${total === 1 ? singular : pluralForma}`
}
