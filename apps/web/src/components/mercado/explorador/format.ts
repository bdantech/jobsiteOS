import type { Json } from '@jobsiteos/core'

/**
 * Formatting for the Mercado surfaces. Deliberately separate from
 * components/empresas/format.ts: that one formats a company record, this one
 * formats market data (m², capital social, counts in the millions) and is what
 * the Explorador's column catalog renders through.
 */

const moeda = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

const moedaExata = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const inteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

const decimal = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const percentual = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 0,
})

const dataCurta = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const dataHora = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** Every cell in the Explorador can be null — the universe is incomplete by nature. */
export const VAZIO = '—'

export function formatNumero(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return VAZIO
  return inteiro.format(valor)
}

export function formatDecimal(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return VAZIO
  return decimal.format(valor)
}

/** Capital social e MRR do ERP: 0 é um valor, null é ausência de dado. */
export function formatMoeda(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return VAZIO
  return moeda.format(valor)
}

export function formatMoedaExata(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return VAZIO
  return moedaExata.format(valor)
}

export function formatM2(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return VAZIO
  return `${decimal.format(valor)} m²`
}

/** ratio_usuarios_ativos vem como fração (0.42) — nunca como 42. */
export function formatRatio(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return VAZIO
  return percentual.format(valor)
}

export function formatBooleano(valor: boolean | null | undefined): string {
  if (valor === null || valor === undefined) return VAZIO
  return valor ? 'Sim' : 'Não'
}

/**
 * Datas do Postgres chegam como 'YYYY-MM-DD'. `new Date('2020-03-01')` é parseado
 * como UTC e, em BRT (UTC-3), renderiza 29/02 — um dia a menos. Montar a data em
 * horário local evita o off-by-one.
 */
export function formatDataISO(valor: string | null | undefined): string {
  if (!valor) return VAZIO
  const partes = valor.slice(0, 10).split('-')
  const [ano, mes, dia] = partes
  if (!ano || !mes || !dia) return VAZIO
  return dataCurta.format(new Date(Number(ano), Number(mes) - 1, Number(dia)))
}

export function formatDataHora(iso: string | null | undefined): string {
  if (!iso) return VAZIO
  return dataHora.format(new Date(iso))
}

/** Anos desde o início de atividade — o que a variável derivada `idade_anos` mede. */
export function idadeEmAnos(dataInicio: string | null | undefined): number | null {
  if (!dataInicio) return null
  const partes = dataInicio.slice(0, 10).split('-')
  const [ano, mes, dia] = partes
  if (!ano || !mes || !dia) return null

  const inicio = new Date(Number(ano), Number(mes) - 1, Number(dia))
  const hoje = new Date()
  let idade = hoje.getFullYear() - inicio.getFullYear()
  const passouAniversario =
    hoje.getMonth() > inicio.getMonth() ||
    (hoje.getMonth() === inicio.getMonth() && hoje.getDate() >= inicio.getDate())
  if (!passouAniversario) idade -= 1
  return idade < 0 ? null : idade
}

export function formatLista(valores: readonly string[] | null | undefined, maximo = 4): string {
  if (!valores || valores.length === 0) return VAZIO
  if (valores.length <= maximo) return valores.join(', ')
  return `${valores.slice(0, maximo).join(', ')} +${valores.length - maximo}`
}

/** CNAE 7 dígitos → 4110-7/00, como a Receita escreve. */
export function formatCnae(cnae: string | null | undefined): string {
  if (!cnae) return VAZIO
  const d = cnae.replace(/\D/g, '')
  if (d.length !== 7) return cnae
  return `${d.slice(0, 4)}-${d.slice(4, 5)}/${d.slice(5, 7)}`
}

/** CPF mascarado / CNPJ do sócio — a Receita já entrega o CPF ofuscado. */
export function formatDocumentoSocio(doc: string | null | undefined): string {
  if (!doc) return VAZIO
  const d = doc.replace(/\D/g, '')
  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  }
  return doc
}

/**
 * `erp_detalhes` é jsonb — pode ser qualquer coisa para o compilador. Lê um campo
 * escalar sem `any` e sem quebrar numa linha gravada por um import futuro.
 */
export function campoJson(payload: Json | null, campo: string): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
  const valor = payload[campo]
  if (valor === null || valor === undefined) return null
  if (typeof valor === 'object') return null
  return String(valor)
}
