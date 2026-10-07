import {
  Activity,
  BarChart3,
  Ban,
  Bot,
  Briefcase,
  Building2,
  Calculator,
  CalendarClock,
  CalendarDays,
  ChartPie,
  Circle,
  ClipboardCheck,
  Clock,
  Coins,
  Compass,
  Factory,
  FileSpreadsheet,
  FileStack,
  FileText,
  Gauge,
  Gavel,
  HandCoins,
  HardHat,
  Inbox,
  KanbanSquare,
  Landmark,
  LayoutDashboard,
  Layers,
  Link2Off,
  type LucideIcon,
  MailCheck,
  Megaphone,
  MessageCircle,
  MessageSquareQuote,
  MessageSquareWarning,
  PackageSearch,
  Percent,
  PhoneOutgoing,
  Plug,
  Radio,
  Send,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sigma,
  SlidersHorizontal,
  Sparkles,
  Sunrise,
  Target,
  TrendingDown,
  Users,
  BellRing,
  Wallet,
  Workflow,
} from 'lucide-react'
import { canAccessRoute, getModule } from '@jobsiteos/core'
import { moduleIcon } from '@/components/shell/icons'

/**
 * O CATÁLOGO DAS ABAS DE TODOS OS MÓDULOS.
 *
 * Cada módulo tinha a sua lista dentro do próprio *-nav.tsx, e isso servia enquanto só
 * a barra de abas precisava dela. Agora três lugares precisam: a barra de abas, a seção
 * "Fixados" da sidebar (que tem de dar nome e ícone a "/credito/carteira") e a tela de
 * configurações (que oferece as abas para fixar). Três cópias de uma lista são três
 * listas.
 *
 * NÃO é 'use client' de propósito: a página de configurações é um server component, e
 * um export de módulo client chega ao servidor como referência, não como valor.
 *
 * As regras de visibilidade (`somenteAdmin`, `tipos`, `somenteGestor`...) são as que
 * cada nav já aplicava, trazidas para cá sem mudança. Elas só decidem o que se OFERECE:
 * quem barra de verdade continua sendo a página e a RLS.
 */

export interface Aba {
  href: string
  label: string
  icon: LucideIcon
  /**
   * Aba de AJUSTE, não de trabalho: sai da fileira e vai para o menu "Configurar" à
   * direita. Misturadas, as duas competiam — no Crédito, cinco das oito abas eram de
   * ajuste, e a Esteira, que é onde se trabalha, era uma entre oito.
   */
  config?: boolean
  /**
   * Bloco visual dentro da fileira. Uma troca de bloco desenha um separador. Só o
   * Comercial usa: são quinze abas para o gestor, e sem blocos o olho não acha nada.
   */
  bloco?: string
  /** Rotas que não ficam sob o href mas pertencem à aba. */
  tambem?: readonly string[]
  somenteAdmin?: boolean
  somenteGestor?: boolean
  /**
   * Mais estreito que `somenteGestor` do outro lado: nem um vendedor com perfil de gestão
   * entra. O Relatório mostra o desempenho nominal e a comissão de cada pessoa, e a
   * auxiliar do closer tem perfil "Comercial" — `app_gestor_comercial()` a incluiria.
   * A mesma régua do `app_report_gestor()` no banco.
   */
  somenteGestorNaoVendedor?: boolean
  /** Tipos de vendedor para quem a aba faz sentido. Ausente = todos. */
  tipos?: readonly string[]
  /** Rótulo diferente por tipo, quando a mesma tela responde a perguntas diferentes. */
  labelPorTipo?: Record<string, string>
  /** Aba que carrega contador próprio. Hoje só a fila de identificação tem um. */
  contador?: 'nao_vinculadas'
  /** Exige OUTRO módulo além do dono da aba (os clientes Onepay são dados do Radar). */
  requerModulo?: string
}

/**
 * Quem está olhando. `ehGestor` e `tipo` só existem para o Comercial; quem não sabe
 * respondê-los (a sidebar, que roda em toda página) passa `undefined`, e aí as regras
 * do Comercial não filtram — ver `abasVisiveis`.
 */
export interface VisaoDoUsuario {
  ehAdmin: boolean
  modulos: readonly string[]
  ehGestor?: boolean
  /** Tipo do vendedor (`vendedores.tipo`), ou null para quem não é vendedor. */
  tipo?: string | null
}

export const ABAS_DOS_MODULOS: Record<string, readonly Aba[]> = {
  empresas: [
    { href: '/empresas', label: 'Empresas', icon: Building2 },
    { href: '/empresas?tab=clientes', label: 'Clientes Onepay', icon: Wallet, requerModulo: 'radar' },
    { href: '/empresas?tab=analise', label: 'Análise Onepay', icon: ChartPie, requerModulo: 'radar' },
    { href: '/empresas/certificados', label: 'Gestão de Certificados', icon: ShieldCheck },
  ],

  /*
   * Grupos fica DE FORA de propósito: não existe `/mercado/grupos` (só
   * `/mercado/grupos/[id]`). Um grupo econômico se alcança a partir de uma empresa ou do
   * Explorador, nunca de uma lista solta.
   */
  mercado: [
    { href: '/mercado', label: 'Mapa', icon: BarChart3 },
    { href: '/mercado/explorador', label: 'Explorador', icon: Compass },
    { href: '/mercado/segmentos', label: 'Segmentos', icon: Layers },
    { href: '/mercado/perfil', label: 'Perfil dos Clientes', icon: Users },
    { href: '/mercado/importacoes', label: 'Importações', icon: FileSpreadsheet },
    { href: '/mercado/ingestoes', label: 'Ingestões', icon: Radio },
    // A rota continua /mercado/piramide de propósito: o rótulo mudou, a URL não —
    // links salvos e abas abertas continuam válidos. Camadas redireciona não-admins
    // para /sem-acesso: não a ofereça a eles.
    { href: '/mercado/piramide', label: 'Camadas', icon: Circle, somenteAdmin: true, config: true },
  ],

  // Clientes Onepay saiu daqui: agora vive no menu Empresas (aba Clientes Onepay).
  // Domínios também saiu: continua em /radar/dominios, alcançada por um botão dentro do
  // Enriquecimento — é uma ferramenta de quem já está enriquecendo, não um destino próprio.
  radar: [
    { href: '/radar', label: 'Painel', icon: LayoutDashboard },
    { href: '/radar/lotes', label: 'Enriquecimento', icon: Layers, tambem: ['/radar/dominios'] },
    { href: '/radar/supressao', label: 'Supressão', icon: Ban },
    { href: '/radar/estimador', label: 'Estimador', icon: Sigma },
    { href: '/radar/config', label: 'Configurações', icon: Settings, somenteAdmin: true, config: true },
  ],

  /*
   * Três blocos, na ordem do dia: o trabalho (Meu Dia e os funis), o resultado da
   * pessoa (carteira, comissão, métricas) e a gestão (o que se olha do trabalho dos
   * outros). Cada tipo de vendedor vê o seu conjunto:
   *
   *   SDR         reuniões · calendário · métricas · comissão
   *   Originador  NFs · certificados · cadastro de fornecedores · carteira · comissão
   *   Closer      os funis de quem está abaixo dele (reuniões, NFs, certificados) ·
   *               vendas · calendário · métricas · comissão · passivas
   *
   * O CLOSER VÊ OS FUNIS DOS OUTROS, e é de propósito: ele responde pelo que o time
   * abaixo dele produz. A aba aparece sempre e quem recorta é a RLS.
   *
   * O "Funil de" saiu de todos os rótulos: o bloco já diz que são funis, e o prefixo
   * repetido quatro vezes empurrava a fileira para fora da tela.
   */
  comercial: [
    /*
     * Meu Dia é a PRIMEIRA aba, e vira a home do vendedor. Ela é a única tela do módulo
     * que responde "o que eu faço agora".
     */
    { href: '/comercial/meu-dia', label: 'Meu Dia', icon: Sunrise, bloco: 'dia' },
    /*
     * Feedback (05C §7) ao lado do Meu Dia: é o retorno automático sobre as próprias
     * conversas, e o vendedor só confia nele se o encontrar sem procurar.
     */
    { href: '/comercial/feedback', label: 'Feedback', icon: MessageSquareQuote, bloco: 'dia' },
    { href: '/comercial/sdr', label: 'Reuniões', icon: Target, tipos: ['sdr', 'vendedor'], bloco: 'dia' },
    { href: '/comercial/vendas', label: 'Vendas', icon: Users, tipos: ['vendedor'], bloco: 'dia' },
    /*
     * O mesmo kanban da Antecipação, recortado na carteira — e é por isso que o rótulo
     * diz de QUEM são as notas. "Funil de NFs" ao lado do "Funil" da Antecipação parecia
     * a mesma tela em dois menus.
     */
    {
      href: '/comercial/nfs',
      label: 'NFs da Carteira',
      icon: Inbox,
      tipos: ['originador', 'vendedor'],
      labelPorTipo: { originador: 'Minhas NFs' },
      bloco: 'dia',
    },
    // Do originador pela carteira dele, e do closer pelo time abaixo: capturar
    // certificado é o trabalho que destrava a ingestão das NFs de qualquer um dos dois.
    // (A validade dos que já temos é outra tela: Empresas → Gestão de Certificados.)
    {
      href: '/comercial/certificados',
      label: 'Certificados',
      icon: ShieldCheck,
      tipos: ['originador', 'vendedor'],
      bloco: 'dia',
    },
    { href: '/comercial/calendario', label: 'Calendário', icon: CalendarDays, tipos: ['sdr', 'vendedor'], bloco: 'dia' },
    // O funil de cadastro (04l) é trabalho do dia. Só do ORIGINADOR: a lista é recortada
    // por originador na RLS, e para SDR e closer ela vinha sempre vazia.
    {
      href: '/comercial/fornecedores',
      label: 'Cadastro de Fornecedores',
      icon: PackageSearch,
      tipos: ['originador'],
      bloco: 'dia',
    },

    {
      href: '/comercial/carteira',
      label: 'Carteira',
      icon: Briefcase,
      tipos: ['originador', 'vendedor'],
      labelPorTipo: { originador: 'Empresas da Carteira', vendedor: 'Passivas na Carteira' },
      bloco: 'resultado',
    },
    { href: '/comercial/comissoes', label: 'Comissão', icon: Coins, bloco: 'resultado' },
    // "Métricas", e não "Análise do Funil": é o nome que a casa usa para número de funil
    // (a Antecipação já chamava assim). "Painel" fica para o olhar do gestor.
    { href: '/comercial/analise', label: 'Métricas', icon: TrendingDown, tipos: ['sdr', 'vendedor'], bloco: 'resultado' },

    { href: '/comercial/fila', label: 'Fila sem Dono', icon: Inbox, somenteGestor: true, bloco: 'gestao' },
    { href: '/comercial/painel', label: 'Painel', icon: LayoutDashboard, somenteGestor: true, bloco: 'gestao' },
    // Qualidade (05C §8): a régua das conversas, a calibração e a fila de contestação.
    { href: '/comercial/qualidade', label: 'Qualidade', icon: ClipboardCheck, somenteGestor: true, bloco: 'gestao' },
    /*
     * Relatórios (04q) responde a pergunta do Painel num zoom diferente: o Painel é o mês
     * de UM vendedor, e o Relatório é a semana da casa inteira — com o desempenho nominal
     * e a comissão de cada pessoa. Por isso não aparece para vendedor nenhum.
     */
    {
      href: '/comercial/relatorios',
      label: 'Relatórios',
      icon: FileText,
      somenteGestorNaoVendedor: true,
      bloco: 'gestao',
    },
    /*
     * Leads e Campanhas são só do Admin: as duas decidem como a casa fala com o mercado —
     * um formulário publicado é uma URL na landing page de um cliente, e uma campanha é
     * um disparo em nome da empresa. Isso é política de aquisição, não trabalho de funil.
     */
    { href: '/comercial/leads', label: 'Leads', icon: Sparkles, somenteAdmin: true, bloco: 'gestao' },
    { href: '/comercial/campanhas', label: 'Campanhas', icon: Megaphone, somenteAdmin: true, bloco: 'gestao' },

    { href: '/comercial/admin', label: 'Configurações', icon: Settings, somenteGestor: true, config: true },
  ],

  /*
   * O que é admin-only aqui é o que mexe na RÉGUA (faixas, settings): mudar uma regra de
   * faixa reclassifica o funil de todo mundo. Ver o funil e os sacados é para todo o time.
   */
  antecipacao: [
    { href: '/antecipacao', label: 'Funil', icon: KanbanSquare },
    { href: '/antecipacao/sacados', label: 'Por Sacado', icon: Building2 },
    // Sacados por NF (04r): os sacados dos fornecedores SEGUIDOS, como cards com dono.
    { href: '/antecipacao/sacados-por-nf', label: 'Sacados por NF', icon: Sparkles },
    // A varredura ampla, sem dono: toda construtora que recebe nota e não está na base.
    // O 04r a tinha absorvida na de cima, mas ela responde outra pergunta e voltou.
    { href: '/antecipacao/prospectar-sacados', label: 'Sacados a Prospectar', icon: HardHat },
    // Ao lado da irmã de propósito: são a mesma pergunta pelos dois lados da nota —
    // quem RECEBE e não é nosso, quem EMITE para quem já é.
    { href: '/antecipacao/prospectar-fornecedores', label: 'Fornecedores a Prospectar', icon: Factory },
    { href: '/antecipacao/antecipacoes', label: 'Antecipações', icon: HandCoins },
    { href: '/antecipacao/metricas', label: 'Métricas', icon: ChartPie },
    {
      href: '/antecipacao/faixas',
      label: 'Regras de Faixa',
      icon: SlidersHorizontal,
      somenteAdmin: true,
      config: true,
    },
    { href: '/antecipacao/config', label: 'Configurações', icon: Settings, somenteAdmin: true, config: true },
  ],

  /*
   * A régua, a fila que ela produz e os números que a enviam são comunicação, não
   * antecipação de recebíveis — vieram de lá. Disparos e Contas WhatsApp são admin-only
   * porque decidem como a casa inteira aparece para fora.
   */
  comunicacao: [
    { href: '/comunicacao', label: 'Inbox', icon: Inbox },
    { href: '/comunicacao/nao-vinculadas', label: 'Não vinculadas', icon: Link2Off, contador: 'nao_vinculadas' },
    { href: '/comunicacao/outbox', label: 'Outbox', icon: MailCheck },
    { href: '/comunicacao/ligacoes', label: 'Ligações', icon: PhoneOutgoing },
    { href: '/comunicacao/atividade', label: 'Painel', icon: BarChart3 },
    { href: '/comunicacao/templates', label: 'Templates', icon: FileText, config: true },
    { href: '/comunicacao/playbooks', label: 'Playbooks', icon: Bot, config: true },
    { href: '/comunicacao/disparos', label: 'Disparos', icon: Send, somenteAdmin: true, config: true },
    {
      href: '/comunicacao/whatsapp',
      label: 'Contas WhatsApp',
      icon: MessageCircle,
      somenteAdmin: true,
      config: true,
    },
    { href: '/comunicacao/config', label: 'Configurações', icon: Settings, config: true },
  ],

  // Ao vivo vem primeiro: é a tela que se deixa aberta num monitor.
  agentes: [
    { href: '/agentes', label: 'Ao vivo', icon: Activity },
    { href: '/agentes/mandatos', label: 'Mandatos', icon: KanbanSquare },
    { href: '/agentes/personas', label: 'Personas', icon: Bot },
    { href: '/agentes/materiais', label: 'Materiais', icon: FileStack },
    { href: '/agentes/desempenho', label: 'Painel', icon: BarChart3 },
    { href: '/agentes/config', label: 'Configurações', icon: Settings, config: true },
  ],

  credito: [
    { href: '/credito', label: 'Esteira', icon: Workflow },
    // Antes do Painel de propósito: a carteira é operação (o que está descoberto hoje), o
    // painel é análise. Quem abre o Crédito de manhã precisa ver risco antes de funil.
    { href: '/credito/carteira', label: 'Carteira', icon: ShieldCheck },
    { href: '/credito/painel', label: 'Painel', icon: LayoutDashboard },
    { href: '/credito/scorecard', label: 'Scorecard', icon: SlidersHorizontal, config: true },
    { href: '/credito/parametros', label: 'Parâmetros da Análise', icon: Calculator, config: true },
    // Precificação depois dos Parâmetros: primeiro se decide QUANTO a empresa sustenta,
    // depois por QUANTO ela opera.
    { href: '/credito/precificacao', label: 'Precificação', icon: Percent, config: true },
    { href: '/credito/integracoes', label: 'Integrações', icon: Plug, config: true },
    { href: '/credito/config', label: 'Configurações', icon: Settings, config: true },
  ],

  // O Painel vem primeiro porque é nele que mora o relógio da apólice.
  cobranca: [
    { href: '/cobranca', label: 'Painel', icon: Gauge },
    { href: '/cobranca/cobrancas', label: 'Cobranças', icon: Wallet, tambem: ['/cobranca/nova'] },
    { href: '/cobranca/sinistros', label: 'Sinistros', icon: ShieldAlert },
    { href: '/cobranca/protestos', label: 'Protestos', icon: Landmark },
    { href: '/cobranca/modelos', label: 'Modelos', icon: FileText, config: true },
    { href: '/cobranca/config', label: 'Configurações', icon: Settings, config: true },
  ],

  // Painel depois da lista: quem abre o Jurídico de manhã abre para trabalhar os
  // processos, não para olhar o agregado.
  juridico: [
    { href: '/juridico', label: 'Processos', icon: Gavel },
    { href: '/juridico/painel', label: 'Painel', icon: LayoutDashboard },
    { href: '/juridico/prazos', label: 'Prazos', icon: CalendarClock },
    { href: '/juridico/config', label: 'Configurações', icon: Settings, config: true },
  ],

  // Reports vem antes de Crons: é trabalho diário (alguém está esperando resposta), e
  // Crons é consulta.
  admin: [
    { href: '/admin/usuarios', label: 'Usuários', icon: Users },
    { href: '/admin/perfis', label: 'Perfis', icon: Shield },
    { href: '/admin/reports', label: 'Reports', icon: MessageSquareWarning },
    // Os avisos da plataforma (0262): quem recebe cada um, o texto e o canal.
    { href: '/admin/notificacoes', label: 'Notificações', icon: BellRing },
    { href: '/admin/crons', label: 'Crons', icon: Clock },
    { href: '/admin/configuracoes', label: 'Configurações', icon: Settings, config: true },
  ],
}

/**
 * As abas que esta pessoa vê no módulo, com o rótulo já resolvido para o tipo dela.
 *
 * Sem `ehGestor` (undefined) as regras exclusivas do Comercial — tipos, gestor — não
 * filtram: quem chama assim é a sidebar, que não resolve o contexto comercial em toda
 * página. Ela só desenha atalhos que a própria pessoa fixou numa tela que já filtrava.
 */
export function abasVisiveis(moduloId: string, visao: VisaoDoUsuario): Aba[] {
  const abas = ABAS_DOS_MODULOS[moduloId] ?? []
  const comercialConhecido = visao.ehGestor !== undefined
  const ehGestor = visao.ehGestor === true
  const tipo = visao.tipo ?? null
  // O auxiliar navega como o closer dele. O que ele VÊ dentro de cada tela continua
  // sendo decidido pela RLS, que lhe dá o alcance do superior e nada além.
  const tipoDeVisao = tipo === 'auxiliar' ? 'vendedor' : tipo

  return abas
    .filter((a) => {
      if (a.somenteAdmin && !visao.ehAdmin) return false
      if (a.requerModulo && !visao.modulos.includes(a.requerModulo)) return false
      if (!comercialConhecido) return true
      if (a.somenteGestor && !ehGestor) return false
      if (a.somenteGestorNaoVendedor && !(ehGestor && tipo === null)) return false
      if (!a.tipos) return true
      // Gestor enxerga todos os funis mesmo sem ser vendedor de nenhum tipo.
      return ehGestor || (tipoDeVisao !== null && a.tipos.includes(tipoDeVisao))
    })
    .map((a) => {
      // Sem tipo (gestor puro), o rótulo genérico: "Empresas da carteira" e "Passivas na
      // carteira" são a mesma tela, e prometer uma das duas para quem vê as duas mente.
      const label = (tipoDeVisao && a.labelPorTipo?.[tipoDeVisao]) || a.label
      return label === a.label ? a : { ...a, label }
    })
}

/**
 * A aba está acesa? Por SEGMENTO, não por prefixo de string: com `startsWith` cru,
 * `/antecipacao/prospectar-fornecedores` acendia também uma aba `/antecipacao/prospectar`,
 * e a raiz do módulo acenderia em todas as sub-rotas. A raiz só acende nela mesma.
 */
export function abaEstaAtiva(aba: Aba, pathname: string, raizDoModulo: string): boolean {
  const casa = (href: string) => pathname === href || pathname.startsWith(`${href}/`)
  if (aba.href === raizDoModulo) return pathname === raizDoModulo
  return casa(aba.href) || (aba.tambem ?? []).some(casa)
}

/** O caminho sem a query: é o que o guard de rota entende. */
function caminhoDe(href: string): string {
  const i = href.indexOf('?')
  return i === -1 ? href : href.slice(0, i)
}

export interface Atalho {
  href: string
  label: string
  icon: LucideIcon
  moduloId: string
  moduloNome: string
  /** true quando o atalho é o módulo inteiro, não uma aba dele. */
  ehModulo: boolean
}

/**
 * O que um caminho fixado vira na sidebar — ou null, se esta pessoa não deve vê-lo.
 *
 * O atalho é conferido NA HORA DE DESENHAR, contra os módulos de agora: quem perdeu o
 * módulo perde o atalho sem que ninguém limpe a coluna. E um caminho que o catálogo não
 * conhece mais (aba removida, rota renomeada) também some, em vez de virar link morto.
 */
export function resolverAtalho(href: string, visao: VisaoDoUsuario): Atalho | null {
  const caminho = caminhoDe(href)
  if (!canAccessRoute(caminho, visao.modulos)) return null

  for (const [moduloId, abas] of Object.entries(ABAS_DOS_MODULOS)) {
    const modulo = getModule(moduloId)
    if (!modulo || !visao.modulos.includes(moduloId)) continue

    if (href === modulo.route) {
      return {
        href,
        label: modulo.name,
        icon: moduleIcon(modulo.icon),
        moduloId,
        moduloNome: modulo.name,
        ehModulo: true,
      }
    }

    const aba = abasVisiveis(moduloId, visao).find((a) => a.href === href)
    if (aba) {
      return { href, label: aba.label, icon: aba.icon, moduloId, moduloNome: modulo.name, ehModulo: false }
    }
  }
  return null
}
