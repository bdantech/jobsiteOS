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
 *   SDR         funil de reuniões · calendário · comissão
 *   Originador  funil de NFs · funil de certificados · carteira · comissão
 *   Closer      funil de vendas · calendário · comissão · passivas na carteira
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
  /** Rótulo diferente por tipo, quando a mesma tela responde a perguntas diferentes. */
  labelPorTipo?: Record<string, string>
}

const ITENS: readonly ItemNav[] = [
  { href: '/comercial/sdr', label: 'Funil de Reuniões', icon: Target, tipos: ['sdr'] },
  { href: '/comercial/vendas', label: 'Funil de Vendas', icon: Users, tipos: ['vendedor'] },
  { href: '/comercial/nfs', label: 'Funil de NFs', icon: Inbox, tipos: ['originador'] },
  // Do originador: a carteira dele é o recorte, e capturar certificado é o trabalho
  // que destrava a ingestão das NFs que ele origina.
  { href: '/comercial/certificados', label: 'Funil de Certificados', icon: ShieldCheck, tipos: ['originador'] },
  // Análise fica logo depois dos funis e antes do calendário: ela lê os mesmos cards, e
  // quem termina de mexer no funil é quem pergunta onde ele trava.
  { href: '/comercial/analise', label: 'Análise do Funil', icon: TrendingDown, tipos: ['sdr', 'vendedor'] },
  { href: '/comercial/calendario', label: 'Calendário', icon: CalendarDays, tipos: ['sdr', 'vendedor'] },
  // O funil de cadastro (04l) vem ANTES da comissão: é trabalho do dia, e comissão é
  // consulta. Visível para todos os tipos porque a lista já é recortada por originador
  // pela RLS — quem não tem fornecedor atribuído vê a tela vazia, que é uma resposta,
  // e não um item de menu que some sem explicação.
  { href: '/comercial/fornecedores', label: 'Cadastro de Fornecedores', icon: PackageSearch },
  { href: '/comercial/comissoes', label: 'Comissão', icon: Coins },
  {
    href: '/comercial/carteira',
    label: 'Carteira',
    icon: Briefcase,
    tipos: ['originador', 'vendedor'],
    labelPorTipo: { originador: 'Empresas da Carteira', vendedor: 'Passivas na Carteira' },
  },
  // Leads é do time todo (o SDR precisa ver de onde veio o que chegou na fila dele),
  // mas só o gestor cria formulário — a página resolve isso por dentro.
  { href: '/comercial/leads', label: 'Leads', icon: Sparkles },
  // Campanhas ao lado de Leads porque as duas respondem "de onde vem quem chega":
  // uma é o que entra sozinho, a outra é o que a gente foi buscar. Visível para o
  // time todo — quem não é gestor lê o placar e não vê o botão de criar, e saber
  // que a conta recebeu um disparo hoje é informação de quem vai ligar amanhã.
  { href: '/comercial/campanhas', label: 'Campanhas', icon: Megaphone },
  { href: '/comercial/fila', label: 'Fila sem Dono', icon: Inbox, somenteGestor: true },
  { href: '/comercial/painel', label: 'Painel', icon: LayoutDashboard, somenteGestor: true },
  { href: '/comercial/admin', label: 'Configurações', icon: Settings, somenteGestor: true },
]

export function ComercialNav({ tipo, ehGestor }: { tipo: string | null; ehGestor: boolean }) {
  const pathname = usePathname()
  const itens = ITENS.filter((i) => {
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
