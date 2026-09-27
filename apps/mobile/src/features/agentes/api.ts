import type { EstadoAgenteAoVivo, EstadoMandato, PlanoMandato, ProximaAcaoPlano, Tables } from '@jobsiteos/core'

import { supabase } from '@/lib/supabase'

/**
 * Leituras dos Agentes no celular (09 §11 Mobile: Ao vivo e Mandatos, só leitura).
 *
 * Todas sob RLS: quem não é gestor só vê os agentes de que é o closer designado (titular
 * ou substituto) — `app_agentes_visiveis()` na política de `mandatos` e `mandato_acoes`.
 * Nenhuma escrita: pausar, assumir, encerrar, reatribuir e configurar ficam na web. O
 * agente fala com clientes em nome da casa, e isso não se decide com o polegar.
 */

export const agentesKeys = {
  all: ['agentes'] as const,
  aoVivo: () => [...agentesKeys.all, 'ao-vivo'] as const,
  cards: () => [...agentesKeys.aoVivo(), 'cards'] as const,
  feed: () => [...agentesKeys.aoVivo(), 'feed'] as const,
  killSwitch: () => [...agentesKeys.aoVivo(), 'kill-switch'] as const,
  mandatos: (filtro: FiltroMandatos) => [...agentesKeys.all, 'mandatos', filtro] as const,
  mandato: (id: string) => [...agentesKeys.all, 'mandato', id] as const,
  acoes: (id: string) => [...agentesKeys.all, 'acoes', id] as const,
  ligacoes: (id: string) => [...agentesKeys.all, 'ligacoes', id] as const,
}

/**
 * "Ativo" é o que ainda está nas mãos do agente, pausado incluído — a MESMA régua da
 * tool `agentes.mandatos` da barra de IA, para o número do cartão bater com a resposta dela.
 */
const ESTADOS_EM_CURSO: readonly EstadoMandato[] = ['aberto', 'em_andamento', 'aguardando_externo', 'pausado']

/** O agente conta como "operando" se agiu nestes últimos minutos (§11.1). */
const JANELA_OPERANDO_MS = 15 * 60_000

/**
 * A página do PostgREST. O `max_rows` do projeto é o padrão do Supabase (1000): pedir
 * mais numa página devolveria 1000 e o laço acharia que acabou.
 */
const PAGINA = 1000
/** Um teto para o laço de soma — 20 mil ações pagas num dia é um agente com defeito, não um número a somar. */
const PAGINAS_MAX = 20

/**
 * Meia-noite de hoje em São Paulo, em ISO. O Brasil não tem horário de verão desde 2019:
 * São Paulo é UTC−3 o ano todo, e a conta fixa evita depender do Intl com fuso no Hermes.
 */
function inicioDoDiaSaoPaulo(agora: number = Date.now()): string {
  const dia = new Date(agora - 3 * 3_600_000).toISOString().slice(0, 10)
  return `${dia}T03:00:00.000Z`
}

// ─── Ao vivo: os cartões dos agentes ────────────────────────────────────────

export interface AgenteAoVivo {
  id: string
  nome: string
  persona: unknown
  tipo: string
  estado: EstadoAgenteAoVivo
  disjuntorMotivo: string | null
  mandatosAtivos: number
  gastoHojeCentavos: number
}

type AgenteLinha = Pick<
  Tables<'vendedores'>,
  'id' | 'nome' | 'tipo' | 'persona' | 'ativo' | 'autonomo' | 'pausado_em' | 'whatsapp_conta_id'
>

/**
 * O estado do cartão, na ordem da spec (§11.1): o disjuntor aberto manda sobre tudo —
 * é o agente que se parou sozinho e espera uma pessoa reabrir. Depois o que uma pessoa
 * desligou (pausa, autonomia, cadastro inativo), depois a falta de linha. Só então a
 * atividade decide entre operando e ocioso.
 */
export function estadoDoAgente(
  a: Pick<AgenteLinha, 'ativo' | 'autonomo' | 'pausado_em' | 'whatsapp_conta_id'>,
  disjuntorAberto: boolean,
  agiuAgora: boolean,
): EstadoAgenteAoVivo {
  if (disjuntorAberto) return 'disjuntor_aberto'
  if (a.pausado_em || !a.autonomo || !a.ativo) return 'pausado'
  if (!a.whatsapp_conta_id) return 'sem_linha'
  return agiuAgora ? 'operando' : 'ocioso'
}

/**
 * O gasto de hoje do agente: a soma de `custo_centavos` das ações desde a meia-noite.
 * INCLUI as linhas `ciclo` — são elas que carregam o custo dos tokens do modelo, e sem
 * elas o gasto do dia seria só o das ferramentas pagas.
 *
 * Paginado porque um agente ativo passa de mil linhas num dia; `custo > 0` porque as
 * leituras grátis são a maioria delas e não mudam a soma.
 */
async function gastoDoDia(agenteId: string, desde: string): Promise<number> {
  let total = 0
  for (let pagina = 0; pagina < PAGINAS_MAX; pagina++) {
    const { data, error } = await supabase
      .from('mandato_acoes')
      .select('custo_centavos')
      .eq('agente_id', agenteId)
      .gte('executada_em', desde)
      .gt('custo_centavos', 0)
      .order('id', { ascending: true })
      .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1)
    if (error) throw new Error(error.message)
    for (const linha of data ?? []) total += linha.custo_centavos
    if ((data ?? []).length < PAGINA) break
  }
  return total
}

async function mandatosAtivosDoAgente(agenteId: string): Promise<number> {
  const { count, error } = await supabase
    .from('mandatos')
    .select('id', { count: 'exact', head: true })
    .eq('agente_id', agenteId)
    .in('estado', ESTADOS_EM_CURSO)
  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function buscarAgentesAoVivo(): Promise<AgenteAoVivo[]> {
  const agora = Date.now()
  const [visiveis, agentes, disjuntores, recentes] = await Promise.all([
    supabase.rpc('app_agentes_visiveis'),
    supabase
      .from('vendedores')
      .select('id, nome, tipo, persona, ativo, autonomo, pausado_em, whatsapp_conta_id')
      .eq('is_ia', true)
      .order('nome', { ascending: true }),
    supabase.from('agentes_disjuntor').select('agente_id, estado, aberto_motivo'),
    supabase
      .from('mandato_acoes')
      .select('agente_id')
      .gte('executada_em', new Date(agora - JANELA_OPERANDO_MS).toISOString())
      .limit(PAGINA),
  ])
  if (visiveis.error) throw new Error(visiveis.error.message)
  if (agentes.error) throw new Error(agentes.error.message)
  if (disjuntores.error) throw new Error(disjuntores.error.message)
  if (recentes.error) throw new Error(recentes.error.message)

  /*
   * A RLS de `vendedores` é a do Comercial, mais larga que a dos Agentes: um closer vê
   * o cadastro de todo agente. Os cartões seguem a régua dos AGENTES — a mesma que já
   * filtra mandatos e ações —, senão ele veria um cartão de agente cujos mandatos a
   * tela inteira esconde dele, sempre "ocioso" e com gasto zero.
   */
  const alcance = new Set(visiveis.data ?? [])
  const meus = (agentes.data ?? []).filter((a) => alcance.has(a.id))
  const disjuntorPor = new Map((disjuntores.data ?? []).map((d) => [d.agente_id, d]))
  const agiram = new Set((recentes.data ?? []).map((r) => r.agente_id))
  const desde = inicioDoDiaSaoPaulo(agora)

  return Promise.all(
    meus.map(async (a): Promise<AgenteAoVivo> => {
      const [mandatosAtivos, gastoHojeCentavos] = await Promise.all([
        mandatosAtivosDoAgente(a.id),
        gastoDoDia(a.id, desde),
      ])
      const disjuntor = disjuntorPor.get(a.id)
      const aberto = disjuntor?.estado === 'aberto'
      return {
        id: a.id,
        nome: a.nome,
        persona: a.persona,
        tipo: a.tipo,
        estado: estadoDoAgente(a, aberto, agiram.has(a.id)),
        disjuntorMotivo: aberto ? (disjuntor?.aberto_motivo ?? null) : null,
        mandatosAtivos,
        gastoHojeCentavos,
      }
    }),
  )
}

/**
 * O kill switch único (§9.2). Ligado, NADA automático roda — e quem abre o Ao vivo tem
 * de saber disso antes de estranhar um feed parado.
 */
export async function buscarKillSwitch(): Promise<boolean> {
  const { data, error } = await supabase.from('agentes_config').select('valor').eq('chave', 'geral').maybeSingle()
  if (error) throw new Error(error.message)
  const valor = data?.valor as { kill_switch?: boolean } | null | undefined
  return valor?.kill_switch === true
}

// ─── Ao vivo: o feed ────────────────────────────────────────────────────────

/**
 * As últimas ações dos agentes. Sem as linhas `ciclo`: são a contabilidade do ciclo
 * (tokens, duração), não algo que o agente FEZ — no feed seriam uma linha em cada três
 * dizendo "pensou".
 */
export async function buscarFeedAoVivo() {
  const { data, error } = await supabase
    .from('mandato_acoes')
    .select(
      'id, mandato_id, ferramenta, intencao, sucesso, erro, executada_em, agente:vendedores(nome, persona), empresa:empresas(razao_social)',
    )
    .neq('ferramenta', 'ciclo')
    .order('executada_em', { ascending: false })
    .limit(60)
  if (error) throw new Error(error.message)
  return data ?? []
}

export type AcaoDoFeed = Awaited<ReturnType<typeof buscarFeedAoVivo>>[number]

// ─── Mandatos ───────────────────────────────────────────────────────────────

export type FiltroMandatos = 'ativos' | 'concluidos' | 'escalados' | 'encerrados'

const ESTADOS_DO_FILTRO: Record<FiltroMandatos, readonly EstadoMandato[]> = {
  ativos: ESTADOS_EM_CURSO,
  concluidos: ['concluido'],
  escalados: ['escalado'],
  encerrados: ['encerrado_sem_sucesso'],
}

/**
 * Os mandatos de um recorte. Os ativos vêm pela PRÓXIMA AÇÃO — o que o agente vai fazer
 * primeiro está no topo, e um atrasado sobe sozinho. Os encerrados, pelo mais recente.
 */
export async function buscarMandatos(filtro: FiltroMandatos) {
  let q = supabase
    .from('mandatos')
    .select(
      'id, codigo, tipo, estado, objetivo, proxima_acao_em, encerrado_em, atualizado_em, pausado_motivo, agente:vendedores(nome, persona), empresa:empresas(razao_social)',
    )
    .in('estado', ESTADOS_DO_FILTRO[filtro])
  q =
    filtro === 'ativos'
      ? q.order('proxima_acao_em', { ascending: true, nullsFirst: false })
      : q.order('encerrado_em', { ascending: false, nullsFirst: false }).order('atualizado_em', { ascending: false })
  const { data, error } = await q.limit(200)
  if (error) throw new Error(error.message)
  return data ?? []
}

export type MandatoDaLista = Awaited<ReturnType<typeof buscarMandatos>>[number]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `/agentes/personas`, `/agentes/config`… caem em `[id]` no celular; não são mandatos. */
export function ehIdDeMandato(id: string): boolean {
  return UUID_RE.test(id)
}

export async function buscarMandato(id: string) {
  if (!ehIdDeMandato(id)) return null
  const { data, error } = await supabase
    .from('mandatos')
    .select('*, agente:vendedores(nome, persona), empresa:empresas(razao_social)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export type MandatoDetalhe = NonNullable<Awaited<ReturnType<typeof buscarMandato>>>

/** A linha do tempo do mandato: o que o agente fez e com que intenção, sem as linhas `ciclo`. */
export async function buscarAcoesDoMandato(id: string) {
  const { data, error } = await supabase
    .from('mandato_acoes')
    .select('id, ferramenta, intencao, sucesso, erro, executada_em, custo_centavos')
    .eq('mandato_id', id)
    .neq('ferramenta', 'ciclo')
    .order('executada_em', { ascending: false })
    .limit(150)
  if (error) throw new Error(error.message)
  return data ?? []
}

export type AcaoDoMandato = Awaited<ReturnType<typeof buscarAcoesDoMandato>>[number]

/** As ligações da Ana pedidas por este mandato. Transcrição e gravação ficam na web. */
export async function buscarLigacoesDoMandato(id: string) {
  const { data, error } = await supabase
    .from('voz_ligacoes')
    .select('id, status, outcome, resumo, objetivo, criada_em, encerrada_em, duracao_s, erro, motivo_recusa')
    .eq('mandato_id', id)
    .order('criada_em', { ascending: false })
    .limit(30)
  if (error) throw new Error(error.message)
  return data ?? []
}

export type LigacaoDoMandato = Awaited<ReturnType<typeof buscarLigacoesDoMandato>>[number]

// ─── O plano ────────────────────────────────────────────────────────────────

/**
 * O plano como veio do banco, lido com TOLERÂNCIA. O `planoSchema` do core é a régua de
 * ESCRITA (o agente não grava um plano fora dela); aqui, um campo acima do limite ou um
 * `bloqueios` ausente não pode esconder o plano inteiro — é justamente a tela que
 * responde "o que ele está tentando?".
 */
export function lerPlano(bruto: unknown): PlanoMandato | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null
  const p = bruto as Record<string, unknown>
  const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
  const objetivo = texto(p.objetivo_atual)
  if (!objetivo) return null

  const proximas: ProximaAcaoPlano[] = Array.isArray(p.proximas_acoes)
    ? p.proximas_acoes
        .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
        .map((a) => ({
          acao: texto(a.acao) ?? '—',
          quando: texto(a.quando) ?? '—',
          contato: texto(a.contato),
          por_que: texto(a.por_que) ?? '',
          condicao: texto(a.condicao),
        }))
    : []

  return {
    objetivo_atual: objetivo,
    hipotese: texto(p.hipotese),
    proximas_acoes: proximas,
    bloqueios: Array.isArray(p.bloqueios) ? p.bloqueios.filter((b): b is string => typeof b === 'string') : [],
    confianca: typeof p.confianca === 'number' ? Math.min(1, Math.max(0, p.confianca)) : 0,
  }
}
