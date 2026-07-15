/**
 * Formatação local do Grupo econômico. Dinheiro reusa `formatMrr` de
 * components/empresas/format (mesma moeda, mesmo locale) — aqui ficam só os
 * formatos que o Mercado precisa e Empresas não tem.
 */

const inteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

const compacto = new Intl.NumberFormat('pt-BR', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const moedaCompacta = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatInteiro(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '—'
  return inteiro.format(valor)
}

/** m² em execução chega na casa dos milhões: 1.240.000 → "1,2 mi m²". */
export function formatM2(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '—'
  if (valor === 0) return '0 m²'
  return `${compacto.format(valor)} m²`
}

/** Capital agregado de um grupo com 200 SPEs não cabe por extenso num card. */
export function formatCapital(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '—'
  return moedaCompacta.format(valor)
}

/** `data_inicio_atividade` é uma date ISO ("2019-03-04"); só o ano interessa. */
export function anoDe(iso: string | null): number | null {
  if (!iso) return null
  const ano = Number(iso.slice(0, 4))
  return Number.isFinite(ano) && ano > 1900 ? ano : null
}
