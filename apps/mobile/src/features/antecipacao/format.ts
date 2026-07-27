import type { Faixa, Tipagem, Urgencia } from '@jobsiteos/core'

/**
 * Formatação e cor do módulo no mobile.
 *
 * As cores são as MESMAS do web (apps/web/src/components/antecipacao/format.ts):
 * faixa alta é âmbar nos dois lados. O mesmo vendedor olha o Kanban no desktop e a
 * lista no celular — dois sistemas de cor seriam dois produtos.
 *
 * Aqui as classes são NativeWind, então os pares light/dark usam o prefixo `dark:`
 * do mesmo jeito.
 */

export function formatarMoeda(valor: number | string | null | undefined): string {
  const n = typeof valor === 'string' ? Number(valor) : valor
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
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

/** "vence em 12d" / "venceu há 3d" — num card de celular o número cru não comunica. */
export function textoPrazo(dias: number | null | undefined): string {
  if (typeof dias !== 'number') return 'sem vencimento'
  if (dias === 0) return 'vence hoje'
  if (dias < 0) return `venceu há ${Math.abs(dias)}d`
  return `vence em ${dias}d`
}

export const FAIXA_CHIP: Record<Faixa, string> = {
  alta: 'bg-amber-100 dark:bg-amber-500/20',
  boa: 'bg-emerald-100 dark:bg-emerald-500/20',
  media: 'bg-sky-100 dark:bg-sky-500/20',
}

export const FAIXA_CHIP_TEXTO: Record<Faixa, string> = {
  alta: 'text-amber-900 dark:text-amber-200',
  boa: 'text-emerald-900 dark:text-emerald-200',
  media: 'text-sky-900 dark:text-sky-200',
}

export const TIPAGEM_CHIP: Record<Tipagem, string> = {
  aquisicao: 'bg-violet-100 dark:bg-violet-500/20',
  ativacao: 'bg-blue-100 dark:bg-blue-500/20',
  recorrencia: 'bg-teal-100 dark:bg-teal-500/20',
}

export const TIPAGEM_CHIP_TEXTO: Record<Tipagem, string> = {
  aquisicao: 'text-violet-900 dark:text-violet-200',
  ativacao: 'text-blue-900 dark:text-blue-200',
  recorrencia: 'text-teal-900 dark:text-teal-200',
}

/** A cor do prazo é o que faz o card ser lido em um segundo, na rua, no sol. */
export const URGENCIA_TEXTO: Record<Urgencia, string> = {
  vencida: 'text-destructive font-semibold',
  critica: 'text-destructive font-semibold',
  atencao: 'text-amber-700 dark:text-amber-300 font-medium',
  confortavel: 'text-muted-foreground',
}

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

export function creditoVariant(status: string | null | undefined): 'success' | 'destructive' | 'secondary' | 'outline' {
  const s = (status ?? '').toUpperCase()
  if (s === 'APPROVED') return 'success'
  if (s === 'DENIED' || s === 'BLOCKED') return 'destructive'
  if (s === '') return 'outline'
  return 'secondary'
}
