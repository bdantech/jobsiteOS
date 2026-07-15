import {
  STATUS_IMPORTACAO_LABELS,
  STATUS_LINHA_LABELS,
  type StatusImportacao,
  type StatusLinha,
} from '@jobsiteos/core'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { isStatusImportacao, isStatusLinha } from './queries'

/**
 * `status` chega do banco como `text` (CHECK, não enum), então o que vem pela rede
 * é `string`. Um valor desconhecido — gravado por uma versão futura — é renderizado
 * como ele mesmo, em cinza, em vez de derrubar a tabela.
 *
 * Isto aqui é o canal de STATUS, e só ele: verde = deu certo, âmbar = precisa de
 * gente, azul = está rodando, cinza = inerte. É um canal DIFERENTE da rampa ordinal
 * da pirâmide (universo → TAM → SAM → SOM), e misturar os dois é o erro clássico:
 * "concluída" não é um degrau de mercado, e SOM não é um estado de execução. A cor
 * nunca vai sozinha — a badge sempre carrega o rótulo.
 */

type Variante = NonNullable<BadgeProps['variant']>

const VARIANTE_IMPORTACAO: Record<StatusImportacao, Variante> = {
  mapeando: 'neutral',
  processando: 'info',
  revisao: 'warning',
  concluida: 'success',
}

const VARIANTE_LINHA: Record<StatusLinha, Variante> = {
  pendente: 'neutral',
  resolvida: 'success',
  ambigua: 'warning',
  ignorada: 'neutral',
}

export function labelStatusImportacao(valor: string): string {
  return isStatusImportacao(valor) ? STATUS_IMPORTACAO_LABELS[valor] : valor
}

export function labelStatusLinha(valor: string): string {
  return isStatusLinha(valor) ? STATUS_LINHA_LABELS[valor] : valor
}

export function StatusImportacaoBadge({
  status,
  className,
}: {
  status: string
  className?: string
}) {
  const conhecido = isStatusImportacao(status)

  return (
    <Badge
      variant={conhecido ? VARIANTE_IMPORTACAO[status as StatusImportacao] : 'neutral'}
      className={cn('gap-1.5', className)}
    >
      {status === 'processando' && (
        // `bg-current`: o ponto pulsante herda a tinta da própria badge, então ele
        // acompanha o tom de status em vez de fixar uma cor por fora dele.
        <span className="relative flex h-1.5 w-1.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {labelStatusImportacao(status)}
    </Badge>
  )
}

export function StatusLinhaBadge({ status }: { status: string }) {
  const conhecido = isStatusLinha(status)

  return (
    <Badge variant={conhecido ? VARIANTE_LINHA[status as StatusLinha] : 'neutral'}>
      {labelStatusLinha(status)}
    </Badge>
  )
}
