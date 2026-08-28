import { FASE_LABELS, SITUACAO_INTERNA_LABELS, type Fase, type SituacaoInterna } from '@jobsiteos/core'

/** Formatações compartilhadas pelas telas do Jurídico. */

export function brl(v: number | string | null | undefined, casas = 0): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—'
  return Number(v).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })
}

export function data(v: string | null | undefined): string {
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

export function faseLabel(f: string | null | undefined): string {
  if (!f) return 'Sem fase detectada'
  return FASE_LABELS[f as Fase] ?? f
}

export function situacaoLabel(s: string | null | undefined): string {
  if (!s) return '—'
  return SITUACAO_INTERNA_LABELS[s as SituacaoInterna] ?? s
}

/** "há 45 dias" / "hoje". Em texto porque a pergunta da lista é de duração, não de data. */
export function haDias(dias: number | null | undefined): string {
  if (dias === null || dias === undefined) return '—'
  if (dias === 0) return 'hoje'
  if (dias === 1) return 'há 1 dia'
  return `há ${dias} dias`
}
