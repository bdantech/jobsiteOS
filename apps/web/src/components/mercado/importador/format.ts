const dataHora = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const inteiro = new Intl.NumberFormat('pt-BR')

const moeda = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
})

const percentual = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 0,
})

export function formatDataHora(iso: string): string {
  return dataHora.format(new Date(iso))
}

export function formatNumero(valor: number): string {
  return inteiro.format(valor)
}

/**
 * O MRR do ERP: o valor MENSAL que a empresa paga pelo ERP que usa HOJE. É o
 * tamanho do contrato do CONCORRENTE — inteligência competitiva, não receita da
 * ONE OS. Nunca rotule isto como "MRR Brik".
 */
export function formatMrrErp(valor: number | null): string {
  return valor === null ? '—' : moeda.format(valor)
}

/** O score do pg_trgm, 0–1, como % — o revisor precisa saber o quanto confiar. */
export function formatScore(score: number): string {
  return percentual.format(score)
}
