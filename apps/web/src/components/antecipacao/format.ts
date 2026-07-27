import type { Faixa, Tipagem, Urgencia } from '@jobsiteos/core'

/**
 * Formatação e cor do módulo. As cores dos badges são as MESMAS em web e mobile
 * (apps/mobile/src/features/antecipacao/format.ts): faixa alta é âmbar nos dois
 * lados, senão o vendedor que olha o Kanban no desktop e a lista no celular vê
 * dois sistemas diferentes.
 */

export function formatarMoeda(valor: number | string | null | undefined): string {
  const n = typeof valor === 'string' ? Number(valor) : valor
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

export function formatarMoedaExata(valor: number | string | null | undefined): string {
  const n = typeof valor === 'string' ? Number(valor) : valor
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function formatarInteiro(valor: number | null | undefined): string {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return '—'
  return valor.toLocaleString('pt-BR')
}

export function formatarData(valor: string | null | undefined): string {
  if (!valor) return '—'
  const d = new Date(valor.length <= 10 ? `${valor}T00:00:00` : valor)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR')
}

export function formatarDataHora(valor: string | null | undefined): string {
  if (!valor) return '—'
  const d = new Date(valor)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

/** "vence em 12 dias" / "venceu há 3 dias" — mais legível que o número cru. */
export function textoPrazo(dias: number | null | undefined): string {
  if (typeof dias !== 'number') return 'sem vencimento'
  if (dias === 0) return 'vence hoje'
  if (dias < 0) return `venceu há ${Math.abs(dias)}d`
  return `vence em ${dias}d`
}

export function formatarPercentual(parte: number, total: number): string {
  if (!total) return '—'
  return `${((parte / total) * 100).toFixed(1).replace('.', ',')}%`
}

// ─── Cores ──────────────────────────────────────────────────────────────────
// Tailwind com par light/dark explícito, como o resto do app (STATUS_SUPERFICIE
// em components/ui/badge.tsx). Nada de cor só clara.

export const FAIXA_BADGE: Record<Faixa, string> = {
  alta: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  boa: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200',
  media: 'bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200',
}

export const TIPAGEM_BADGE: Record<Tipagem, string> = {
  aquisicao: 'bg-violet-100 text-violet-900 dark:bg-violet-500/20 dark:text-violet-200',
  ativacao: 'bg-blue-100 text-blue-900 dark:bg-blue-500/20 dark:text-blue-200',
  recorrencia: 'bg-teal-100 text-teal-900 dark:bg-teal-500/20 dark:text-teal-200',
}

/** A cor de urgência do prazo. É o sinal que faz o card ser lido em um segundo. */
export const URGENCIA_TEXTO: Record<Urgencia, string> = {
  vencida: 'text-destructive font-medium',
  critica: 'text-destructive font-medium',
  atencao: 'text-amber-700 dark:text-amber-300',
  confortavel: 'text-muted-foreground',
}

/** O status de crédito do sacado vem cru da API (APPROVED, PENDING…). */
export function labelCredito(status: string | null | undefined): string {
  if (!status) return 'Sem análise'
  const mapa: Record<string, string> = {
    APPROVED: 'Aprovado',
    PENDING: 'Pendente',
    DENIED: 'Recusado',
    EXPIRED: 'Expirado',
    IN_ANALYSIS: 'Em análise',
    BLOCKED: 'Bloqueado',
  }
  return mapa[status.toUpperCase()] ?? status
}

export function creditoBadge(status: string | null | undefined): string {
  const s = (status ?? '').toUpperCase()
  if (s === 'APPROVED') return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200'
  if (s === 'DENIED' || s === 'BLOCKED') return 'bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-200'
  if (s === '') return 'bg-muted text-muted-foreground'
  return 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200'
}
