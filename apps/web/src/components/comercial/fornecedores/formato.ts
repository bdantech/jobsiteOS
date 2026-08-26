import {
  CONFIANCA_LABELS,
  ESTAGIO_FORNECEDOR_LABELS,
  FONTE_CONTATO_LABELS,
  TIPO_CONTATO_LABELS,
  type Confianca,
  type EstagioFornecedor,
  type FonteContato,
  type TipoContatoDescoberto,
} from '@jobsiteos/core'

/** Formatação do módulo, num lugar só — a mesma regra na lista, no card e no CSV. */

export const brl = (n: number | string | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '—'
    : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

export const brlExato = (n: number | string | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '—'
    : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export const dia = (d: string | null | undefined): string =>
  d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('pt-BR') : '—'

export const cnpjFormatado = (c: string): string =>
  c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')

export const rotuloEstagio = (e: string): string =>
  ESTAGIO_FORNECEDOR_LABELS[e as EstagioFornecedor] ?? e

export const rotuloFonte = (f: string): string => FONTE_CONTATO_LABELS[f as FonteContato] ?? f

export const rotuloTipo = (t: string): string => TIPO_CONTATO_LABELS[t as TipoContatoDescoberto] ?? t

export const rotuloConfianca = (c: string | null): string =>
  c ? (CONFIANCA_LABELS[c as Confianca] ?? c) : '—'

/**
 * A cor da confiança. Alta é a única em cor de destaque, e isso é o ponto: se as três
 * fossem coloridas, a tela diria "temos contato" quando o que ela tem é um palpite.
 */
export function varianteConfianca(c: string | null): 'default' | 'secondary' | 'outline' {
  if (c === 'alta') return 'default'
  if (c === 'media') return 'secondary'
  return 'outline'
}

/**
 * O link do canal. `tel:` e `mailto:` funcionam no desktop; `https://wa.me/` é o que
 * abre o WhatsApp Web sem depender de app instalado.
 */
export function linkDoContato(tipo: string, valor: string): string | null {
  if (tipo === 'telefone') return `tel:${valor}`
  if (tipo === 'email') return `mailto:${valor}`
  if (tipo === 'whatsapp') return `https://wa.me/${valor.replace(/\D/g, '')}`
  if (tipo === 'site') return `https://${valor}`
  if (tipo === 'instagram') return `https://instagram.com/${valor}`
  return null
}

/** O telefone canônico é E.164; ninguém lê `+5511987654321`. */
export function exibirValor(tipo: string, valor: string): string {
  if (tipo !== 'telefone' && tipo !== 'whatsapp') return valor
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(valor)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : valor
}

/**
 * O que dizer sobre um descarte, e onde ele se desfaz.
 *
 * Três estados que se pareciam na tela e não são a mesma coisa. "Definitivo" sobre algo
 * que se desfaz com um clique noutra tela é a pior das três confusões possíveis aqui —
 * ela faz a pessoa desistir de um lead que está a um botão de voltar.
 */
export function rotuloDescarte(
  ate: string | null | undefined,
  origem: string | null | undefined,
): string {
  if (ate) return `Volta em ${dia(ate)}`
  if (origem === 'antecipacao') return 'Descartado na Antecipação'
  if (origem === 'supressao') return 'Suprimido em outro módulo'
  return 'Definitivo'
}
