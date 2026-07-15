import type { Json } from '@jobsiteos/core'

const moeda = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const dataHora = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const data = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

/**
 * `erp_mrr` — what the company pays for the ERP it uses TODAY (`erp_atual`), NOT
 * ONE OS revenue. It is numeric(12,2) and nullable: "sem MRR do ERP" is not "R$ 0,00".
 */
export function formatMrr(valor: number | null): string | null {
  if (valor === null) return null
  return moeda.format(valor)
}

export function formatDataHora(iso: string): string {
  return dataHora.format(new Date(iso))
}

export function formatData(iso: string): string {
  return data.format(new Date(iso))
}

/** "há 3 dias" para a timeline. Absoluto abaixo de 1 min, relativo acima. */
export function formatRelativo(iso: string): string {
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })
  const diffMs = new Date(iso).getTime() - Date.now()
  const diffMin = Math.round(diffMs / 60_000)

  if (Math.abs(diffMin) < 1) return 'agora'
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute')

  const diffH = Math.round(diffMin / 60)
  if (Math.abs(diffH) < 24) return rtf.format(diffH, 'hour')

  const diffD = Math.round(diffH / 24)
  if (Math.abs(diffD) < 30) return rtf.format(diffD, 'day')

  const diffM = Math.round(diffD / 30)
  if (Math.abs(diffM) < 12) return rtf.format(diffM, 'month')

  return rtf.format(Math.round(diffM / 12), 'year')
}

/**
 * empresa_eventos.payload is jsonb, i.e. `Json` — it could be a string, an array
 * or null as far as the type system knows. The write helpers always put a
 * `resumo` string in it, but the timeline must not crash on a row written by a
 * future module that doesn't.
 */
export function resumoDoEvento(payload: Json): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
  const resumo = payload.resumo
  return typeof resumo === 'string' && resumo.length > 0 ? resumo : null
}

/**
 * Progressive CNPJ mask for the input: "11222333" -> "11.222.333".
 * Only ever cosmetic — cnpjSchema normalizes back to the 14 bare digits the
 * `empresas_cnpj_check` constraint requires, so what we store is never masked.
 */
export function maskCnpj(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 14)
  let out = d.slice(0, 2)
  if (d.length > 2) out += `.${d.slice(2, 5)}`
  if (d.length > 5) out += `.${d.slice(5, 8)}`
  if (d.length > 8) out += `/${d.slice(8, 12)}`
  if (d.length > 12) out += `-${d.slice(12, 14)}`
  return out
}

/** Iniciais para o avatar do autor da nota / ator do evento. */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  const primeiro = partes[0]
  const ultimo = partes[partes.length - 1]

  if (!primeiro || !ultimo) return '?'
  if (partes.length === 1) return primeiro.slice(0, 2).toUpperCase()
  return `${primeiro.slice(0, 1)}${ultimo.slice(0, 1)}`.toUpperCase()
}
