'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { ESCOPO_ANALISE_LABELS, formatarNota } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { AnaliseModal } from './analise-modal'
import { buscarSelo, qualidadeKeys, type AlvoSelo } from './queries'

/**
 * A NOTA NUNCA APARECE SOLTA (05C §6).
 *
 * "0,62" sem o porquê é sentença; com o item a item ao alcance de um clique, é conversa.
 * Por isso o badge recebe a análise e abre o detalhe sozinho — quem o coloca numa tela
 * não precisa lembrar de ligar o modal, e não tem como esquecer.
 *
 * Nota NULA é "sem avaliação aplicável", nunca zero: uma conversa em que nenhum item da
 * rubrica se aplicava não foi mal, ela simplesmente não foi julgada. Zero ali seria a
 * nota mais injusta possível, dada pela ausência de pergunta.
 */

/** A escala de cor da nota (0 a 1). Nula é neutra — nem boa nem ruim. */
export function tomDaNota(score: number | null | undefined): 'success' | 'warning' | 'critical' | 'neutral' {
  if (score === null || score === undefined) return 'neutral'
  if (score >= 0.75) return 'success'
  if (score >= 0.5) return 'warning'
  return 'critical'
}

export function rotuloDaNota(score: number | null | undefined): string {
  return score === null || score === undefined ? 'Sem avaliação aplicável' : formatarNota(score)
}

export function NotaBadge({
  score,
  analiseId,
  prefixo,
  className,
  title,
}: {
  score: number | null | undefined
  /** Com a análise, o badge vira botão e abre o item a item. */
  analiseId?: string | null
  /** Texto antes da nota ("Nota", "Reunião"…). */
  prefixo?: string
  className?: string
  title?: string
}) {
  const [aberto, setAberto] = React.useState(false)
  const conteudo = (
    <Badge
      variant={tomDaNota(score)}
      className={cn('gap-1 tabular-nums', analiseId && 'cursor-pointer hover:opacity-80', className)}
    >
      {prefixo ? <span className="font-normal">{prefixo}</span> : null}
      {rotuloDaNota(score)}
    </Badge>
  )

  if (!analiseId) return conteudo

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // O badge mora dentro de cards clicáveis: o clique é dele, não do card.
          e.stopPropagation()
          setAberto(true)
        }}
        className="inline-flex rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={title ?? 'Ver a análise item a item'}
        aria-label={`Nota ${rotuloDaNota(score)} — ver a análise item a item`}
      >
        {conteudo}
      </button>
      {aberto ? <AnaliseModal analiseId={analiseId} aberto={aberto} onOpenChange={setAberto} /> : null}
    </>
  )
}

/**
 * O selo da última análise PUBLICADA de uma empresa, de uma conversa ou de uma reunião —
 * no card da empresa e no histórico da conversa.
 *
 * Não renderiza nada enquanto carrega e quando não há análise: um selo "sem nota" em toda
 * empresa que nunca teve conversa analisada seria ruído na maioria das fichas.
 */
export function SeloNota({
  alvo,
  className,
  moldura,
}: {
  alvo: AlvoSelo
  className?: string
  /** Classe de um invólucro que só existe quando há selo — para não sobrar margem vazia. */
  moldura?: string
}) {
  const selo = useQuery({
    queryKey: qualidadeKeys.selo(alvo),
    queryFn: () => buscarSelo(alvo),
    staleTime: 60_000,
  })
  const s = selo.data
  if (!s) return null

  const quando = new Date(s.analisada_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  const titulo = [
    `${ESCOPO_ANALISE_LABELS[s.escopo]} de ${quando}`,
    s.explicacao,
    'Clique para ver a análise item a item.',
  ]
    .filter(Boolean)
    .join(' — ')

  const badge = (
    <NotaBadge
      score={s.score}
      analiseId={s.analise_id}
      prefixo={`Nota da ${ESCOPO_ANALISE_LABELS[s.escopo].toLowerCase()}`}
      title={titulo}
      className={className}
    />
  )
  return moldura ? <div className={moldura}>{badge}</div> : badge
}
