import { useQuery } from '@tanstack/react-query'
import type { Href } from 'expo-router'
import {
  Coins,
  FileText,
  Inbox,
  Sunrise,
  Target,
  Users,
  type LucideIcon,
} from 'lucide-react-native'

import { useSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

/**
 * O MENU DO COMERCIAL no celular — a mesma régua da barra de abas da web
 * (`apps/web/src/components/comercial/comercial-nav.tsx`), item por item.
 *
 * ── QUEM VÊ O QUÊ ───────────────────────────────────────────────────────────
 *   Meu Dia             todos
 *   Funil de Reuniões   SDR e closer (e o auxiliar, que navega como o closer)
 *   Funil de Vendas     closer
 *   Funil de NFs        originador e closer
 *   Relatórios          só o gestor que NÃO é vendedor
 *   Comissão            todos
 * O gestor (perfil Admin ou Comercial) vê todos os funis, mesmo sem ser vendedor de
 * tipo nenhum.
 *
 * ── O MENU ESCONDE, QUEM PROÍBE É O BANCO ───────────────────────────────────
 * Esconder um item é para ninguém abrir uma tela que não responde a ele — não é o
 * que impede alguém de ver o que não deve. Isso é a RLS e as RPCs: um SDR que
 * digitasse a rota do funil de vendas veria só o que `vendas` lhe devolve. Por isso
 * a régua aqui pode ser a da web, sem uma terceira versão das permissões no app.
 */

export interface ContextoComercial {
  /** O cadastro de vendedor ATIVO de quem entrou. `null` para o gestor puro. */
  vendedor: { id: string; tipo: string } | null
  /** Perfil Admin ou Comercial — `app_gestor_comercial()`. */
  ehGestor: boolean
  /**
   * Gestor sem cadastro de vendedor nenhum — `app_report_gestor()`, a mesma função
   * que o relatório usa para recusar. Perguntar a ELA, e não recompor a regra aqui,
   * é o que impede o menu de oferecer um relatório que a RPC vai negar.
   */
  ehGestorDeRelatorio: boolean
}

export function useContextoComercial() {
  const { usuario } = useSession()

  return useQuery({
    queryKey: ['comercial', 'contexto', usuario?.id ?? null] as const,
    enabled: Boolean(usuario?.id),
    queryFn: async (): Promise<ContextoComercial> => {
      const [vendedorRes, gestorRes, relatorioRes] = await Promise.all([
        supabase
          .from('vendedores')
          .select('id, tipo')
          .eq('usuario_id', usuario!.id)
          .eq('ativo', true)
          .maybeSingle(),
        supabase.rpc('app_gestor_comercial'),
        supabase.rpc('app_report_gestor'),
      ])
      if (vendedorRes.error) throw new Error(vendedorRes.error.message)
      if (gestorRes.error) throw new Error(gestorRes.error.message)
      if (relatorioRes.error) throw new Error(relatorioRes.error.message)

      return {
        vendedor: vendedorRes.data ?? null,
        ehGestor: gestorRes.data === true,
        ehGestorDeRelatorio: relatorioRes.data === true,
      }
    },
    // O tipo do vendedor e o perfil mudam por decisão de um admin, não durante o uso.
    staleTime: 10 * 60 * 1000,
  })
}

export interface ItemMenuComercial {
  href: Href
  titulo: string
  /** A pergunta que a tela responde, numa linha. */
  descricao: string
  icone: LucideIcon
  /** Tipos de vendedor para quem o item faz sentido. Ausente = todos. */
  tipos?: readonly string[]
  somenteGestorDeRelatorio?: boolean
}

/**
 * A ordem é a da web, e pelo mesmo motivo: Meu Dia primeiro porque é a única tela
 * que responde "o que eu faço agora"; os funis em seguida; relatório e comissão por
 * último, porque são consulta.
 */
const ITENS: readonly ItemMenuComercial[] = [
  {
    href: '/comercial/meu-dia',
    titulo: 'Meu Dia',
    descricao: 'O que fazer agora',
    icone: Sunrise,
  },
  {
    href: '/comercial/sdr',
    titulo: 'Funil de Reuniões',
    descricao: 'Do contato à reunião',
    icone: Target,
    tipos: ['sdr', 'vendedor'],
  },
  {
    href: '/comercial/vendas',
    titulo: 'Funil de Vendas',
    descricao: 'Da reunião à operação',
    icone: Users,
    tipos: ['vendedor'],
  },
  {
    href: '/comercial/nfs',
    titulo: 'Funil de NFs',
    descricao: 'As notas da carteira',
    icone: Inbox,
    tipos: ['originador', 'vendedor'],
  },
  {
    href: '/comercial/relatorios',
    titulo: 'Relatórios',
    descricao: 'A semana da casa',
    icone: FileText,
    somenteGestorDeRelatorio: true,
  },
  {
    href: '/comercial/comissoes',
    titulo: 'Comissão',
    descricao: 'Mês, histórico e extrato',
    icone: Coins,
  },
]

export function itensDoMenu(contexto: ContextoComercial): ItemMenuComercial[] {
  // O auxiliar navega como o closer dele. O que ele VÊ dentro de cada tela continua
  // sendo decidido pela RLS, que lhe dá o alcance do superior e nada além.
  const tipo = contexto.vendedor?.tipo === 'auxiliar' ? 'vendedor' : (contexto.vendedor?.tipo ?? null)

  return ITENS.filter((item) => {
    if (item.somenteGestorDeRelatorio) return contexto.ehGestorDeRelatorio
    if (!item.tipos) return true
    return contexto.ehGestor || (tipo !== null && item.tipos.includes(tipo))
  })
}
