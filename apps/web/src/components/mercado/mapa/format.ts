const inteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

const compacto = new Intl.NumberFormat('pt-BR', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const moeda = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

const moedaCompacta = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
})

const umaCasa = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

/** 1.482.310 — para o número exato (contagens vindas do count do PostgREST). */
export function formatNumero(valor: number): string {
  return inteiro.format(valor)
}

/** 1,5 mi — para eixos e rótulos dentro de barras, onde não cabe o número inteiro. */
export function formatCompacto(valor: number): string {
  return compacto.format(valor)
}

/** Valores nulos NÃO viram zero: "sem dado" e "R$ 0" são coisas diferentes. */
export function formatMoeda(valor: number | null): string {
  if (valor === null) return '—'
  return Math.abs(valor) >= 1_000_000 ? moedaCompacta.format(valor) : moeda.format(valor)
}

export function formatAnos(valor: number | null): string {
  if (valor === null) return '—'
  return `${umaCasa.format(valor)} anos`
}

export function formatPct(valor: number | null): string {
  if (valor === null) return '—'
  return `${umaCasa.format(valor * 100)}%`
}

export function formatM2(valor: number): string {
  return `${compacto.format(valor)} m²`
}

export function formatDecimal(valor: number | null): string {
  if (valor === null) return '—'
  return umaCasa.format(valor)
}
