'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart3,
  Bot,
  FileText,
  Inbox,
  Link2Off,
  MailCheck,
  MessageCircle,
  Send,
  Settings,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { contarNaoVinculadas } from './queries'

/**
 * Navegação interna da Comunicação. Mesmo padrão do Jurídico, do Crédito e do Radar.
 *
 * As três últimas vieram do menu da Antecipação, onde estavam por ordem de
 * chegada e não por assunto: a régua, a fila que ela produz e os números que a
 * enviam são comunicação, não antecipação de recebíveis. Elas são admin-only
 * (menos a Outbox) porque decidem como a casa inteira aparece para fora — e o
 * gate de verdade continua no RPC, este aqui só evita oferecer o que erraria ao
 * salvar.
 */
interface ItemNav {
  href: string
  label: string
  icon: typeof Inbox
  somenteAdmin?: boolean
  /** Item que carrega contador próprio. Hoje só a fila de identificação tem um. */
  contador?: 'nao_vinculadas'
}

const ITENS: readonly ItemNav[] = [
  { href: '/comunicacao', label: 'Inbox', icon: Inbox },
  {
    href: '/comunicacao/nao-vinculadas',
    label: 'Não vinculadas',
    icon: Link2Off,
    contador: 'nao_vinculadas',
  },
  { href: '/comunicacao/outbox', label: 'Outbox', icon: MailCheck },
  { href: '/comunicacao/templates', label: 'Templates', icon: FileText },
  { href: '/comunicacao/playbooks', label: 'Playbooks', icon: Bot },
  { href: '/comunicacao/atividade', label: 'Atividade', icon: BarChart3 },
  { href: '/comunicacao/disparos', label: 'Disparos', icon: Send, somenteAdmin: true },
  { href: '/comunicacao/whatsapp', label: 'Contas WhatsApp', icon: MessageCircle, somenteAdmin: true },
  { href: '/comunicacao/config', label: 'Configurações', icon: Settings },
]

export function ComunicacaoNav({ ehAdmin }: { ehAdmin: boolean }) {
  const pathname = usePathname()
  const itens = ITENS.filter((i) => !i.somenteAdmin || ehAdmin)

  /*
   * O CONTADOR VIVE COLADO NO DESTINO.
   *
   * Ele estava na barra do topo, ao lado do sino, e competia com as notificações
   * sem ser uma delas — dois números diferentes lado a lado é como se ensina a
   * não olhar nenhum. Aqui o número e o clique são a mesma coisa: quem vê "3"
   * sabe exatamente onde estão os três.
   */
  const naoVinculadas = useQuery({
    queryKey: ['comunicacao', 'nao-vinculadas', 'contagem'],
    queryFn: contarNaoVinculadas,
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  })

  return (
    <nav
      aria-label="Seções da Comunicação"
      className="mb-6 flex gap-1 overflow-x-auto border-b border-border pb-px"
    >
      {itens.map((item) => {
        // Por SEGMENTO, não por prefixo de string: com `startsWith` cru a thread
        // `/comunicacao/<uuid>` não acenderia aba nenhuma e `/comunicacao` acenderia
        // todas. A barra no fim é o que separa "rota filha" de "nome parecido".
        const ativo =
          item.href === '/comunicacao'
            ? pathname === '/comunicacao'
            : pathname === item.href || pathname.startsWith(`${item.href}/`)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-2 whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors',
              ativo
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
            {item.label}
            {item.contador === 'nao_vinculadas' && (naoVinculadas.data ?? 0) > 0 ? (
              <span
                className={cn(
                  'flex h-4 min-w-4 items-center justify-center rounded-full px-1',
                  'bg-amber-500 text-[10px] font-medium leading-none text-white',
                )}
              >
                {(naoVinculadas.data ?? 0) > 99 ? '99+' : naoVinculadas.data}
              </span>
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}
