import {
  PRIORIDADE_REPORT_LABELS,
  STATUS_REPORT_LABELS,
  TIPO_REPORT_LABELS,
  type PrioridadeReport,
  type StatusReport,
  type TipoReport,
} from '@jobsiteos/core'
import { Bug, Lightbulb } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * A cor de um status de report diz UMA coisa: se ainda há trabalho.
 *
 * Verde é fim bom, cinza é fim sem trabalho (não procede, duplicado), âmbar é
 * "está andando", azul é "chegou". Pintar "não procede" de vermelho seria
 * transformar uma resposta técnica em repreensão a quem reportou.
 */
const VARIANTE_STATUS: Record<StatusReport, 'info' | 'warning' | 'success' | 'neutral'> = {
  aberto: 'info',
  em_analise: 'warning',
  em_correcao: 'warning',
  planejado: 'warning',
  em_desenvolvimento: 'warning',
  resolvido: 'success',
  entregue: 'success',
  nao_procede: 'neutral',
  nao_planejado: 'neutral',
  duplicado: 'neutral',
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = status as StatusReport
  return (
    <Badge variant={VARIANTE_STATUS[s] ?? 'neutral'} className={className}>
      {STATUS_REPORT_LABELS[s] ?? status}
    </Badge>
  )
}

const VARIANTE_PRIORIDADE: Record<PrioridadeReport, 'critical' | 'warning' | 'neutral' | 'outline'> =
  {
    critica: 'critical',
    alta: 'warning',
    media: 'neutral',
    baixa: 'outline',
  }

export function PrioridadeBadge({ prioridade }: { prioridade: string | null }) {
  // Sem prioridade não é "prioridade baixa": é um report que ninguém triou
  // ainda. Um badge "Baixa" ali diria que já foi avaliado e considerado menor.
  if (!prioridade) return null
  const p = prioridade as PrioridadeReport
  return (
    <Badge variant={VARIANTE_PRIORIDADE[p] ?? 'neutral'}>
      {PRIORIDADE_REPORT_LABELS[p] ?? prioridade}
    </Badge>
  )
}

export function TipoIcone({ tipo, className }: { tipo: string; className?: string }) {
  const Icon = tipo === 'bug' ? Bug : Lightbulb
  return (
    <Icon
      className={cn('h-4 w-4 shrink-0', tipo === 'bug' ? 'text-destructive' : 'text-brand', className)}
      aria-label={TIPO_REPORT_LABELS[tipo as TipoReport] ?? tipo}
    />
  )
}

/** "#42" — como as pessoas falam do report em voz alta. */
export function Numero({ numero, className }: { numero: number; className?: string }) {
  return (
    <span className={cn('font-mono text-xs text-muted-foreground', className)}>#{numero}</span>
  )
}
