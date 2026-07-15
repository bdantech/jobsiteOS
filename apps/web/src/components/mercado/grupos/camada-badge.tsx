import { CAMADA_LABELS, type Camada } from '@jobsiteos/core'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type Variante = NonNullable<BadgeProps['variant']>

/**
 * Camada é classificação de MERCADO, não estágio de relacionamento — e é uma escala
 * com ORDEM (universo → TAM → SAM → SOM). Por isso ela usa a rampa ordinal do design
 * system (--chart-1..4), a mesma dos gráficos do Mapa e da pirâmide, e não quatro
 * matizes categóricos: a ordem tem que se ler na própria cor. O rótulo acompanha
 * sempre — cor não é o único canal.
 */
const CAMADA_VARIANTE: Record<Camada, Variante> = {
  universo: 'ordinal1',
  tam: 'ordinal2',
  sam: 'ordinal3',
  som: 'ordinal4',
}

function ehCamada(valor: string): valor is Camada {
  return valor in CAMADA_VARIANTE
}

export function CamadaBadge({ camada, className }: { camada: string | null; className?: string }) {
  if (!camada || !ehCamada(camada)) {
    return (
      <Badge variant="outline" className={cn('text-muted-foreground', className)}>
        —
      </Badge>
    )
  }

  return (
    <Badge variant={CAMADA_VARIANTE[camada]} className={cn(className)}>
      {CAMADA_LABELS[camada]}
    </Badge>
  )
}
