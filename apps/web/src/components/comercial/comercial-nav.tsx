'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Briefcase, CalendarDays, Coins, Inbox, LayoutDashboard, Megaphone, PackageSearch,
  Settings, ShieldCheck, Sparkles, Target, TrendingDown, Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Os rótulos seguem título: toda palavra em maiúscula menos preposição ("Funil de
 * Reuniões", "Fila sem Dono"). É uma barra de navegação, não uma frase.
 *
 * Navegação do Comercial. Ao contrário dos outros módulos, o que aparece aqui depende
 * do TIPO do vendedor logado — e a ORDEM também: o funil é sempre a primeira aba.
 *
 * A ordem não é estética. Estas abas são o dia de trabalho de alguém, e o dia começa no
 * funil: é lá que está a próxima ação. Calendário, comissão e carteira são consulta —
 * abrir o módulo neles seria abrir o trabalho pela contabilidade dele.
 *
 * Cada tipo vê o seu conjunto:
 *   SDR         funil de reuniões · análise · calendário · comissão
 *   Originador  funil de NFs · funil de certificados · cadastro de fornecedores ·
 *               carteira · comissão
 *   Closer      os funis de quem está abaixo dele (reuniões, NFs, certificados) ·
 *               funil de vendas · análise · calendário · comissão · passivas
 *
 * O CLOSER VÊ OS FUNIS DOS OUTROS, e é de propósito: ele responde pelo que o time
 * abaixo dele produz. A aba aparece sempre e quem recorta é a RLS — ele enxerga o
 * funil de quem `vendedor_acessos` lhe deu, e mais ninguém. Uma aba que só aparece
 * quando há alguém abaixo some e volta conforme o cadastro muda, e aí ninguém sabe
 * se a tela sumiu ou se o time encolheu.
 *
 * Gestor (Admin/Comercial) vê tudo — é ele quem atribui a fila e aprova a comissão — e
 * ganha "Painel" no fim, que é a tela de olhar o trabalho dos outros.
 */

interface ItemNav {
  href: string
  label: string
  icon: typeof Target
  /** Tipos de vendedor para quem o item faz sentido. Vazio = todos. */
  tipos?: readonly string[]
  somenteGestor?: boolean
  /**
   * Mais estreito que `somenteGestor`: nem a gestora do Comercial entra. É para a
   * tela que decide como a casa aparece para FORA, não como ela trabalha por dentro.
   */
  somenteAdmin?: boolean
  /** Rótulo diferente por tipo, quando a mesma tela responde a perguntas diferentes. */
  labelPorTipo?: Record<string, string>
}

const ITENS: readonly ItemNav[] = [
  { href: '/comercial/sdr', label: 'Funil de Reuniões', icon: Target, tipos: ['sdr', 'vendedor'] },
  { href: '/comercial/vendas', label: 'Funil de Vendas', icon: Users, tipos: ['vendedor'] },
  { href: '/comercial/nfs', label: 'Funil de NFs', icon: Inbox, tipos: ['originador', 'vendedor'] },
  // Do originador pela carteira dele, e do closer pelo time abaixo: capturar
  // certificado é o trabalho que destrava a ingestão das NFs de qualquer um dos dois.
  {
    href: '/comercial/certificados',
    label: 'Funil de Certificados',
    icon: ShieldCheck,
    tipos: ['originador', 'vendedor'],
  },
  // Análise fica logo depois dos funis e antes do calendário: ela lê os mesmos cards, e
  // quem termina de mexer no funil é quem pergunta onde ele trava.
  { href: '/comercial/analise', label: 'Análise do Funil', icon: TrendingDown, tipos: ['sdr', 'vendedor'] },
  { href: '/comercial/calendario', label: 'Calendário', icon: CalendarDays, tipos: ['sdr', 'vendedor'] },
  // O funil de cadastro (04l) vem ANTES da comissão: é trabalho do dia, e comissão é
  // consulta. Só do ORIGINADOR: a lista é recortada por originador na RLS, e para SDR
  // e closer ela vinha sempre vazia. Uma aba que nunca tem nada não é uma resposta —
  // é um item de menu que ensina a não clicar.
  {
    href: '/comercial/fornecedores',
    label: 'Cadastro de Fornecedores',
    icon: PackageSearch,
    tipos: ['originador'],
  },
  { href: '/comercial/comissoes', label: 'Comissão', icon: Coins },
  {
    href: '/comercial/carteira',
    label: 'Carteira',
    icon: Briefcase,
    tipos: ['originador', 'vendedor'],
    labelPorTipo: { originador: 'Empresas da Carteira', vendedor: 'Passivas na Carteira' },
  },
  /*
   * Leads e Campanhas saíram do menu do time e ficaram só com o Admin.
   *
   * As duas respondem "de onde vem quem chega" — uma é o que entra sozinho, a outra é
   * o que a gente foi buscar — e as duas são decisões sobre como a casa fala com o
   * mercado: um formulário publicado é uma URL na landing page de um cliente, e uma
   * campanha é um disparo em nome da empresa. Isso não é trabalho de funil, é política
   * de aquisição. Quem trabalha o lead continua vendo a origem dele no card.
   */
  { href: '/comercial/leads', label: 'Leads', icon: Sparkles, somenteAdmin: true },
  { href: '/comercial/campanhas', label: 'Campanhas', icon: Megaphone, somenteAdmin: true },
  { href: '/comercial/fila', label: 'Fila sem Dono', icon: Inbox, somenteGestor: true },
  { href: '/comercial/painel', label: 'Painel', icon: LayoutDashboard, somenteGestor: true },
  { href: '/comercial/admin', label: 'Configurações', icon: Settings, somenteGestor: true },
]

export function ComercialNav({
  tipo,
  ehGestor,
  ehAdmin,
}: {
  tipo: string | null
  ehGestor: boolean
  ehAdmin: boolean
}) {
  const pathname = usePathname()
  const itens = ITENS.filter((i) => {
    if (i.somenteAdmin && !ehAdmin) return false
    if (i.somenteGestor && !ehGestor) return false
    if (!i.tipos) return true
    // Gestor enxerga todos os funis mesmo sem ser vendedor de nenhum tipo.
    return ehGestor || (tipo !== null && i.tipos.includes(tipo))
  })

  return (
    <nav aria-label="Seções do Comercial" className="mb-6 flex gap-1 overflow-x-auto border-b border-border pb-px">
      {itens.map((item) => {
        const ativo = pathname === item.href || pathname.startsWith(`${item.href}/`)
        const Icon = item.icon
        // Sem tipo (gestor puro), o rótulo genérico: "Empresas da carteira" e "Passivas na
        // carteira" são a mesma tela, e prometer uma das duas para quem vê as duas mente.
        const label = (tipo && item.labelPorTipo?.[tipo]) || item.label
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
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
