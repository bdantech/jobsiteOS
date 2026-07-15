import { CAMADA_LABELS, type Camada } from '@jobsiteos/core'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type Variante = NonNullable<BadgeProps['variant']>

/**
 * Camada é classificação de MERCADO (o quanto a empresa se encaixa), calculada por
 * regra. Estágio é histórico de RELACIONAMENTO, movido por gente. São eixos diferentes
 * e esta badge nunca mostra os dois.
 *
 * A camada é ORDINAL: universo ⊃ TAM ⊃ SAM ⊃ SOM. Então ela usa a rampa ordinal do
 * design system (--chart-1..4), a MESMA dos gráficos do Mapa — o degrau é o mesmo na
 * tabela e na barra empilhada. Nada de verde, e nada de quatro matizes diferentes:
 * quatro cores gastariam o canal de identidade para recodificar uma ordem que a
 * luminosidade já mostra. O rótulo vai sempre junto: cor nunca é o único canal.
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
    return <span className="text-muted-foreground">—</span>
  }

  return (
    <Badge variant={CAMADA_VARIANTE[camada]} className={cn(className)}>
      {CAMADA_LABELS[camada]}
    </Badge>
  )
}

/**
 * Situação cadastral é STATUS, não ordem: verde/âmbar/vermelho, reservados para isto
 * e para mais nada. Reaproveitar aqui a rampa da pirâmide misturaria dois canais que
 * significam coisas diferentes.
 */
const SITUACAO_VARIANTE: Record<string, Variante> = {
  ativa: 'success',
  suspensa: 'warning',
  inapta: 'warning',
  baixada: 'critical',
  nula: 'critical',
}

const SITUACAO_LABELS: Record<string, string> = {
  ativa: 'Ativa',
  suspensa: 'Suspensa',
  inapta: 'Inapta',
  baixada: 'Baixada',
  nula: 'Nula',
}

export function SituacaoBadge({ situacao }: { situacao: string | null }) {
  if (!situacao) return <span className="text-muted-foreground">—</span>

  const variante = SITUACAO_VARIANTE[situacao]
  if (!variante) return <span>{situacao}</span>

  return <Badge variant={variante}>{SITUACAO_LABELS[situacao] ?? situacao}</Badge>
}
