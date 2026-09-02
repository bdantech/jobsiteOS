'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCheck,
  Clock,
  Mail,
  MessageCircle,
  Phone,
  Smartphone,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { buscarThread, buscarThreadDaEmpresa, type MensagemThread } from './queries'
import { dataHora, intencaoLabel } from './format'

/**
 * A thread, e é a mesma em todos os lugares: no inbox, na aba "Mensagens" do card
 * e na Company 360.
 *
 * ── O DESTAQUE DO CARD NÃO É UM FILTRO ─────────────────────────────────────
 * Quando ela é aberta a partir de um card, as mensagens que PARTIRAM daquele card
 * ganham uma marca — e as outras continuam visíveis. Filtrar recriaria o
 * histórico paralelo por card que o §1 existe para impedir: o vendedor abriria o
 * card de vendas sem enxergar o que o SDR combinou na semana passada.
 */

const ICONE_CANAL = {
  whatsapp: MessageCircle,
  email: Mail,
  ligacao: Phone,
  reuniao: Clock,
  interno: AlertTriangle,
} as const

function IconeStatus({ status }: { status: string | null }) {
  if (status === 'lida') return <CheckCheck className="h-3 w-3 text-primary" aria-label="Lida" />
  if (status === 'entregue') return <CheckCheck className="h-3 w-3" aria-label="Entregue" />
  if (status === 'enviada') return <Check className="h-3 w-3" aria-label="Enviada" />
  if (status === 'falhou') return <AlertTriangle className="h-3 w-3 text-destructive" aria-label="Falhou" />
  if (status === 'pendente') return <Clock className="h-3 w-3" aria-label="Na fila" />
  return null
}

function Bolha({ m, destacada }: { m: MensagemThread; destacada: boolean }) {
  const entrada = m.direcao === 'entrada'
  const Icone = ICONE_CANAL[(m.canal ?? 'whatsapp') as keyof typeof ICONE_CANAL] ?? MessageCircle
  const intencao = intencaoLabel(m.triagem)

  /*
   * A mensagem digitada no APARELHO não tem autor: o provedor não diz qual das
   * pessoas com acesso ao número escreveu, e carimbar o dono da carteira seria
   * atribuir a alguém uma frase que talvez não seja dele. A bolha diz "pelo
   * celular" e para por aí — é o máximo que sabemos, e inventar o resto faria a
   * thread mentir num lugar onde ela é prova.
   */
  const peloCelular = m.origem === 'celular'
  const quem = entrada
    ? (m.contato_nome ?? 'Contato')
    : peloCelular
      ? 'Equipe (pelo celular)'
      : m.por_ia
        ? `${m.vendedor_nome ?? 'IA'} (IA)`
        : (m.vendedor_nome ?? m.usuario_nome ?? 'Equipe')

  return (
    <li className={cn('flex', entrada ? 'justify-start' : 'justify-end')}>
      <div
        className={cn(
          'max-w-[80%] rounded-lg border px-3 py-2 text-sm',
          entrada ? 'bg-muted/50' : 'bg-primary/5',
          // A marca do card: uma borda, não um filtro.
          destacada && 'ring-1 ring-primary/40',
          m.status_envio === 'falhou' && 'border-destructive/50',
        )}
      >
        <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Icone className="h-3 w-3" aria-hidden />
          <span className="font-medium text-foreground">{quem}</span>
          {m.por_ia ? <Bot className="h-3 w-3" aria-label="Enviada pela IA" /> : null}
          {peloCelular ? (
            <Smartphone className="h-3 w-3" aria-label="Enviada pelo aparelho, fora da plataforma" />
          ) : null}
          <span>·</span>
          <span>{dataHora(m.criado_em)}</span>
          {!entrada ? <IconeStatus status={m.status_envio} /> : null}
          {intencao ? (
            <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px]">
              {intencao}
            </Badge>
          ) : null}
        </div>

        {m.assunto ? <p className="mb-1 font-medium">{m.assunto}</p> : null}
        {/*
          `whitespace-pre-wrap`: quebras de linha são conteúdo numa mensagem, e um
          e-mail renderizado como parágrafo único vira ilegível.
        */}
        <p className="whitespace-pre-wrap break-words">
          {m.corpo ?? m.preview ?? <span className="italic text-muted-foreground">(sem texto)</span>}
        </p>

        {m.origem === 'app_toque' ? (
          <p className="mt-1 text-[11px] italic text-muted-foreground">
            Registro de que o app foi aberto — não sabemos se a mensagem saiu.
          </p>
        ) : null}
        {m.erro ? <p className="mt-1 text-[11px] text-destructive">{m.erro}</p> : null}
      </div>
    </li>
  )
}

export function Thread({
  conversaId,
  empresaId,
  funilCardId,
  alturaClasse = 'max-h-[50vh]',
}: {
  conversaId?: string | null
  /** Usado pela aba do card e pela Company 360: a conversa da EMPRESA inteira. */
  empresaId?: string | null
  /** Quando presente, marca (não filtra) o que partiu deste card. */
  funilCardId?: string | null
  alturaClasse?: string
}) {
  const consulta = useQuery({
    queryKey: ['comunicacao', 'thread', conversaId ?? null, empresaId ?? null],
    queryFn: () =>
      conversaId ? buscarThread(conversaId) : empresaId ? buscarThreadDaEmpresa(empresaId) : Promise.resolve([]),
    enabled: Boolean(conversaId || empresaId),
  })

  const fim = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    // A conversa é lida de baixo para cima: abrir no topo obriga a rolar até o
    // que interessa em toda abertura.
    fim.current?.scrollIntoView({ block: 'end' })
  }, [consulta.data])

  if (consulta.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="ml-auto h-12 w-1/2" />
        <Skeleton className="h-12 w-3/5" />
      </div>
    )
  }

  const mensagens = consulta.data ?? []
  if (mensagens.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Nenhuma mensagem ainda.</p>
        <p className="mt-1">O que for enviado e recebido aparece aqui.</p>
      </div>
    )
  }

  return (
    <div className={cn('overflow-y-auto pr-1', alturaClasse)}>
      <ul className="space-y-3">
        {mensagens.map((m) => (
          <Bolha key={m.id} m={m} destacada={Boolean(funilCardId && m.funil_card_id === funilCardId)} />
        ))}
      </ul>
      <div ref={fim} />
    </div>
  )
}
