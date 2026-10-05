/**
 * Formatações da tela de Qualidade.
 *
 * O custo da análise vem em CENTAVOS FRACIONÁRIOS (`numeric(10,4)`): uma análise no Jev
 * custa frações de centavo, e arredondar na borda a cada linha faria o mês somar zero.
 * Por isso o real aparece com duas casas, mas abaixo de R$ 1 ganha mais duas — "R$ 0,00"
 * para um mês com quinhentas análises seria mentir sobre o custo.
 */

export function brlDeCentavos(c: number | string | null | undefined): string {
  if (c === null || c === undefined || c === '' || !Number.isFinite(Number(c))) return '—'
  const reais = Number(c) / 100
  const casas = reais !== 0 && Math.abs(reais) < 1 ? 4 : 2
  return reais.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: casas,
  })
}

/** 0,123 → "12,3%". Nulo continua "—": taxa sem denominador não é zero. */
export function pct(v: number | string | null | undefined, casas = 0): string {
  if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return '—'
  return `${(Number(v) * 100).toLocaleString('pt-BR', { maximumFractionDigits: casas })}%`
}

/** Probabilidade e métricas de calibração: 0,734 → "0,73". */
export function decimal(v: number | string | null | undefined, casas = 2): string {
  if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return '—'
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
}

export function inteiro(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return '—'
  return Number(v).toLocaleString('pt-BR')
}

export function dataCurta(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v.length === 10 ? `${v}T12:00:00` : v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}

export function dataHora(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** "2026-09" → "set/26". */
export function mesCurto(competencia: string): string {
  const [a, m] = competencia.split('-')
  const i = Number(m) - 1
  return MESES[i] ? `${MESES[i]}/${String(a).slice(2)}` : competencia
}

/** "2026-09-14" (segunda-feira da semana) → "14/09". */
export function semanaCurta(semana: string): string {
  const [, m, d] = semana.split('-')
  return d && m ? `${d}/${m}` : semana
}

/** Link da análise na tela do vendedor — a página abre o modal pelo parâmetro. */
export const urlAnalise = (id: string) => `/comercial/feedback?analise=${id}`

/**
 * Lê um número digitado em pt-BR ("0,75", "0.75", "1.234,5"). Vazio ou lixo → null —
 * nunca 0, porque zero é um limiar válido e diferente de "não preenchido".
 */
export function numeroBr(texto: string): number | null {
  const t = texto.trim()
  if (!t) return null
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) ? n : null
}

/** Número → texto editável em pt-BR, sem milhar. */
export function textoDeNumero(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return ''
  return String(n).replace('.', ',')
}
