import type { Json } from '@jobsiteos/core'

const dataHora = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const inteiro = new Intl.NumberFormat('pt-BR')

export function formatDataHora(iso: string): string {
  return dataHora.format(new Date(iso))
}

/**
 * The counters are nullable: the worker only fills them once it knows. "0 linhas
 * processadas" and "ainda não sei quantas linhas" are different facts, and an
 * admin staring at a stuck job needs to tell them apart.
 */
export function formatContador(valor: number | null): string {
  return valor === null ? '—' : inteiro.format(valor)
}

/**
 * Duration as "2h 14min" / "3min 20s" / "45s".
 *
 * A Receita run takes hours, so seconds-only would be unreadable and a relative
 * "há 3 horas" would answer the wrong question. `fim = null` means the run is
 * still going: the caller passes Date.now() and gets a ticking elapsed time.
 */
export function formatDuracao(inicioIso: string, fimIso: string | null, agoraMs: number): string {
  const inicio = new Date(inicioIso).getTime()
  const fim = fimIso === null ? agoraMs : new Date(fimIso).getTime()

  // Clock skew between the worker's host and the browser can make a just-started
  // run look like it ends before it begins. Never render a negative duration.
  const totalSegundos = Math.max(0, Math.round((fim - inicio) / 1000))

  const horas = Math.floor(totalSegundos / 3600)
  const minutos = Math.floor((totalSegundos % 3600) / 60)
  const segundos = totalSegundos % 60

  if (horas > 0) return `${horas}h ${minutos}min`
  if (minutos > 0) return `${minutos}min ${segundos}s`
  return `${segundos}s`
}

/**
 * `meta` is jsonb, i.e. `Json` — as far as the type system knows it could be a
 * string, an array or null. Pretty-print it for the detail panel, and say so
 * when there is nothing in it.
 */
export function formatMeta(meta: Json): string | null {
  if (meta === null) return null
  if (typeof meta === 'object' && !Array.isArray(meta) && Object.keys(meta).length === 0) {
    return null
  }
  return JSON.stringify(meta, null, 2)
}
