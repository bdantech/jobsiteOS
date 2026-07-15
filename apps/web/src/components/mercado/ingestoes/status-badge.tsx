import {
  FONTE_INGESTAO_LABELS,
  STATUS_INGESTAO_LABELS,
  type FonteIngestao,
  type StatusIngestao,
} from '@jobsiteos/core'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { isFonteIngestao, isStatusIngestao } from './queries'

/**
 * Canal de STATUS, e só ele. `concluida` pintava de `bg-brand` — o navy da marca
 * fazendo papel de "deu certo". São canais diferentes: a marca identifica o produto,
 * o status descreve o estado de uma execução. Com a marca nesse papel, "concluída" e
 * "é da ONE OS" viram a mesma cor, e o próximo rebrand repinta em silêncio o
 * significado de um estado. Verde/âmbar/azul/vermelho são reservados a este canal e
 * moram em ui/badge.tsx — nenhuma cor crua aqui.
 *
 * A cor nunca vai sozinha: a badge sempre carrega o rótulo textual.
 */

type Variante = NonNullable<BadgeProps['variant']>

const VARIANTE_INGESTAO: Record<StatusIngestao, Variante> = {
  executando: 'info',
  concluida: 'success',
  falhou: 'critical',
}

export function labelStatus(valor: string): string {
  return isStatusIngestao(valor) ? STATUS_INGESTAO_LABELS[valor] : valor
}

export function labelFonte(valor: string): string {
  return isFonteIngestao(valor) ? FONTE_INGESTAO_LABELS[valor] : valor
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const conhecido = isStatusIngestao(status)

  return (
    <Badge
      variant={conhecido ? VARIANTE_INGESTAO[status as StatusIngestao] : 'neutral'}
      className={cn('gap-1.5', className)}
    >
      {status === 'executando' && (
        // The one thing an admin looks for from across the room: is it alive?
        // `bg-current`: o ponto herda a tinta da própria badge, então acompanha o tom
        // de status em vez de fixar um azul por fora dele.
        <span className="relative flex h-1.5 w-1.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {labelStatus(status)}
    </Badge>
  )
}

export function FonteBadge({ fonte }: { fonte: FonteIngestao | string }) {
  return (
    <Badge variant="outline" className="border-border font-normal text-foreground">
      {labelFonte(fonte)}
    </Badge>
  )
}
