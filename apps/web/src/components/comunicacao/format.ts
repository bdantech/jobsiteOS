import {
  ACAO_LABELS,
  CANAL_COMUNICACAO_LABELS,
  INTENCAO_TRIAGEM_LABELS,
  type AcaoAgente,
  type CanalComunicacao,
  type IntencaoTriagem,
} from '@jobsiteos/core'

/** Formatação da Comunicação. Um arquivo, como no Jurídico. */

export function canalLabel(c: string | null | undefined): string {
  return c ? (CANAL_COMUNICACAO_LABELS[c as CanalComunicacao] ?? c) : '—'
}

export function acaoLabel(a: string | null | undefined): string {
  return a ? (ACAO_LABELS[a as AcaoAgente] ?? a) : '—'
}

export function intencaoLabel(triagem: unknown): string | null {
  const t = triagem as { intencao?: string } | null
  if (!t?.intencao) return null
  return INTENCAO_TRIAGEM_LABELS[t.intencao as IntencaoTriagem] ?? t.intencao
}

export function resumoDaTriagem(triagem: unknown): string | null {
  const t = triagem as { resumo_curto?: string } | null
  return t?.resumo_curto ?? null
}

export function dataHora(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * "há 3 min", "há 2 h", "ontem", "12/08". É o relógio de uma lista de conversas:
 * o que importa é a distância, não a data absoluta — e a data absoluta volta a
 * importar quando a distância deixa de ser legível.
 */
export function desde(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'ontem'
  if (d < 7) return `há ${d} dias`
  return new Date(iso).toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
  })
}

export function telefoneLegivel(valor: string): string {
  const d = valor.replace(/\D/g, '')
  const semDdi = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d
  if (semDdi.length === 11) return `(${semDdi.slice(0, 2)}) ${semDdi.slice(2, 7)}-${semDdi.slice(7)}`
  if (semDdi.length === 10) return `(${semDdi.slice(0, 2)}) ${semDdi.slice(2, 6)}-${semDdi.slice(6)}`
  return valor
}

export function identificadorLegivel(canal: string, valor: string): string {
  return canal === 'email' ? valor : telefoneLegivel(valor)
}
