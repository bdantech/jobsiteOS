import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { RealtimeChannel } from '@supabase/supabase-js'
import {
  ESTADOS_ATIVOS,
  ESTADOS_MANDATO,
  ESTADOS_TERMINAIS,
  personaSchema,
  planoSchema,
  type EstadoMandato,
  type Json,
  type PlanoMandato,
} from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'
import {
  listarAgentesAction,
  permissoesAgentesAction,
  type AgenteVisivel,
  type PermissoesAgentes,
} from '@/actions/agentes-mandatos'
import { inicioDoDiaSp, mesCorrenteSp } from './format'

/**
 * Leituras das telas de OPERAÇÃO dos Agentes — Ao vivo, Mandatos e o modal do mandato.
 *
 * Mesma convenção da Cobrança: React Query com o client do navegador, e a RLS da 0270c
 * decide o que volta. O gestor vê todos os agentes; o closer vê os agentes de que é o
 * closer designado (titular ou substituto) — e isso vale igual para `mandatos`,
 * `mandato_acoes`, `mandato_propostas` e para o Realtime, que respeita a mesma política.
 *
 * Nenhuma escrita aqui — toda escrita é RPC, por `actions/agentes-mandatos.ts`.
 *
 * As leituras de Personas/Materiais/Desempenho/Config moram em `queries-gestao.ts`, de
 * outra frente; as chaves ficam sob `['agentes', 'operacao']` para não colidir.
 */

export const agentesOpKeys = {
  all: ['agentes', 'operacao'] as const,
  permissoes: () => ['agentes', 'permissoes'] as const,
  agentes: () => [...agentesOpKeys.all, 'agentes'] as const,
  fotos: (paths: string) => [...agentesOpKeys.all, 'fotos', paths] as const,
  disjuntores: () => [...agentesOpKeys.all, 'disjuntores'] as const,
  feed: () => [...agentesOpKeys.all, 'feed'] as const,
  acoesHoje: () => [...agentesOpKeys.all, 'acoes-hoje'] as const,
  ativos: () => [...agentesOpKeys.all, 'ativos'] as const,
  ligacoesNaFila: () => [...agentesOpKeys.all, 'ligacoes-na-fila'] as const,
  termometro: () => [...agentesOpKeys.all, 'termometro'] as const,
  config: () => [...agentesOpKeys.all, 'config'] as const,
  kanban: () => [...agentesOpKeys.all, 'kanban'] as const,
  propostas: () => [...agentesOpKeys.all, 'propostas'] as const,
  mandato: (id: string) => [...agentesOpKeys.all, 'mandato', id] as const,
  acoesDoMandato: (id: string) => [...agentesOpKeys.all, 'mandato', id, 'acoes'] as const,
  versoes: (id: string) => [...agentesOpKeys.all, 'mandato', id, 'versoes'] as const,
  historico: (id: string) => [...agentesOpKeys.all, 'mandato', id, 'historico'] as const,
}

// ─── Permissões e agentes ───────────────────────────────────────────────────

/** Módulo + gestor, uma vez por sessão. Ver `permissoesAgentesAction`. */
export function usePermissoesAgentes() {
  return useQuery<PermissoesAgentes>({
    queryKey: agentesOpKeys.permissoes(),
    queryFn: () => permissoesAgentesAction(),
    staleTime: Infinity,
  })
}

export type { AgenteVisivel }

/** `enabled` existe para o diálogo de delegar, montado em cada card de NF: só busca ao abrir. */
export function useAgentes(enabled = true) {
  return useQuery({
    queryKey: agentesOpKeys.agentes(),
    queryFn: () => listarAgentesAction(),
    staleTime: 60_000,
    enabled,
  })
}

/** A persona lida com tolerância: JSON pela metade não derruba o cartão do agente. */
export function personaDoAgente(a: Pick<AgenteVisivel, 'nome' | 'persona'>): {
  nome: string
  fotoPath: string | null
  bio: string | null
} {
  const r = personaSchema.safeParse(a.persona ?? {})
  return {
    nome: r.success ? r.data.nome_exibicao : a.nome,
    fotoPath: r.success ? (r.data.foto_path ?? null) : null,
    bio: r.success ? (r.data.bio_curta ?? null) : null,
  }
}

/**
 * URLs assinadas das fotos das personas. O bucket `agentes-materiais` é privado (0270c):
 * a política de leitura é "tem o módulo", e a URL dura uma hora — o Ao vivo fica aberto
 * o dia inteiro, então a consulta renova antes de a URL vencer.
 */
export function useFotosDosAgentes(paths: string[]) {
  const chave = [...paths].sort().join('|')
  return useQuery({
    queryKey: agentesOpKeys.fotos(chave),
    enabled: paths.length > 0,
    staleTime: 50 * 60_000,
    refetchInterval: 50 * 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await createClient().storage.from('agentes-materiais').createSignedUrls(paths, 3600)
      if (error) throw new Error(error.message)
      const mapa: Record<string, string> = {}
      for (const d of data ?? []) if (d.path && d.signedUrl) mapa[d.path] = d.signedUrl
      return mapa
    },
  })
}

export async function buscarDisjuntores() {
  const { data, error } = await createClient()
    .from('agentes_disjuntor')
    .select('agente_id, estado, aberto_em, aberto_motivo')
  if (error) throw new Error(error.message)
  return data ?? []
}

// ─── O feed e as ações do dia ───────────────────────────────────────────────

/**
 * As últimas ações, mais recente primeiro, SEM as linhas `ciclo` — essas são o custo de
 * decidir, não algo que o agente fez no mundo, e num monitor encheriam o feed de "Ciclo
 * de decisão (6 passos)" a cada cinco minutos por mandato.
 */
export async function buscarFeed(limite = 80) {
  // prettier-ignore
  const { data, error } = await createClient()
    .from('mandato_acoes')
    .select('id, mandato_id, agente_id, empresa_id, contato_id, ferramenta, intencao, sucesso, erro, executada_em, custo_centavos, argumentos, empresas(razao_social, nome_fantasia), contatos(nome)')
    .neq('ferramenta', 'ciclo')
    .order('executada_em', { ascending: false })
    .limit(limite)
  if (error) throw new Error(error.message)
  return data ?? []
}
export type AcaoDoFeed = Awaited<ReturnType<typeof buscarFeed>>[number]

/**
 * Tudo que os agentes fizeram HOJE (dia de São Paulo), inclusive os ciclos: o consumo do
 * dia é a soma de `custo_centavos` de todas as linhas, e o custo do modelo mora justamente
 * nas linhas `ciclo`. As cotas contam só as de sucesso, pela mesma régua do worker.
 */
export async function buscarAcoesDeHoje() {
  const { data, error } = await createClient()
    .from('mandato_acoes')
    .select('agente_id, ferramenta, argumentos, sucesso, custo_centavos, executada_em')
    .gte('executada_em', inicioDoDiaSp())
    .order('executada_em', { ascending: false })
    .limit(10000)
  if (error) throw new Error(error.message)
  return data ?? []
}
export type AcaoDeHoje = Awaited<ReturnType<typeof buscarAcoesDeHoje>>[number]

export interface CotasUsadas {
  ligacoes: number
  mensagens: number
  emails: number
}

/**
 * O que cada agente já gastou das cotas diárias (§9.1). Cópia fiel de `cotasUsadasHoje`
 * do worker (`apps/worker/src/agentes/contexto.ts`): se a tela contasse diferente, a
 * barra mostraria folga enquanto o agente já se recusa a mandar.
 */
export function cotasUsadas(acoes: readonly AcaoDeHoje[], agenteId: string): CotasUsadas {
  const acc: CotasUsadas = { ligacoes: 0, mensagens: 0, emails: 0 }
  for (const a of acoes) {
    if (a.agente_id !== agenteId || a.sucesso !== true) continue
    const canal = (a.argumentos as { canal?: string } | null)?.canal
    if (a.ferramenta === 'ligar') acc.ligacoes++
    else if (a.ferramenta === 'enviar_whatsapp' || (a.ferramenta === 'enviar_material' && canal === 'whatsapp')) {
      acc.mensagens++
    } else if (a.ferramenta === 'enviar_email' || (a.ferramenta === 'enviar_material' && canal === 'email')) {
      acc.emails++
    }
  }
  return acc
}

// ─── Mandatos ativos, fila de ligações e termômetro ─────────────────────────

export async function buscarMandatosAtivos() {
  // prettier-ignore
  const { data, error } = await createClient()
    .from('mandatos')
    .select('id, codigo, tipo, objetivo, estado, agente_id, empresa_id, prioridade, proxima_acao_em, plano, empresas(razao_social, nome_fantasia)')
    .in('estado', [...ESTADOS_ATIVOS])
    .order('proxima_acao_em', { ascending: true, nullsFirst: false })
    .limit(2000)
  if (error) throw new Error(error.message)
  return data ?? []
}
export type MandatoAtivo = Awaited<ReturnType<typeof buscarMandatosAtivos>>[number]

/** Ligações de mandato que ainda não saíram para a Ana — as que a linha do tempo destaca. */
export async function buscarLigacoesNaFila() {
  // prettier-ignore
  const { data, error } = await createClient()
    .from('voz_ligacoes')
    .select('id, mandato_id, status, objetivo, agendada_para, criada_em, telefone, contatos(nome)')
    .eq('status', 'a_enviar')
    .not('mandato_id', 'is', null)
    .order('criada_em', { ascending: true })
    .limit(500)
  if (error) throw new Error(error.message)
  return data ?? []
}
export type LigacaoNaFila = Awaited<ReturnType<typeof buscarLigacoesNaFila>>[number]

export interface Termometro {
  porEstado: Record<EstadoMandato, number>
  reunioesHoje: number
  nfsConvertidasHoje: number
}

/**
 * Contagens por estado com `head: true` — uma ida por estado, sem trazer linha nenhuma.
 * Trazer os mandatos para contar no navegador funcionaria no primeiro mês e ficaria mais
 * lento a cada mandato encerrado, que nunca sai da tabela.
 */
export async function buscarTermometro(): Promise<Termometro> {
  const supabase = createClient()
  const hoje = inicioDoDiaSp()
  const contagens = await Promise.all(
    ESTADOS_MANDATO.map(async (estado) => {
      const { count, error } = await supabase
        .from('mandatos')
        .select('id', { count: 'exact', head: true })
        .eq('estado', estado)
      if (error) throw new Error(error.message)
      return [estado, count ?? 0] as const
    }),
  )
  const [reunioes, nfs] = await Promise.all([
    supabase
      .from('mandato_acoes')
      .select('id', { count: 'exact', head: true })
      .eq('ferramenta', 'agendar_reuniao')
      .eq('sucesso', true)
      .gte('executada_em', hoje),
    supabase
      .from('mandatos')
      .select('id', { count: 'exact', head: true })
      .eq('tipo', 'originacao_nf')
      .eq('estado', 'concluido')
      .gte('encerrado_em', hoje),
  ])
  if (reunioes.error) throw new Error(reunioes.error.message)
  if (nfs.error) throw new Error(nfs.error.message)
  return {
    porEstado: Object.fromEntries(contagens) as Record<EstadoMandato, number>,
    reunioesHoje: reunioes.count ?? 0,
    nfsConvertidasHoje: nfs.count ?? 0,
  }
}

export interface ConfigAoVivo {
  killSwitch: boolean
  versaoVoz: string | null
  orcamentoMes: { teto: number; consumido: number; reservado: number; temLinhaDoMes: boolean }
}

/**
 * O que o Ao vivo precisa da configuração: o kill switch (que para TUDO e tem de gritar),
 * a versão da Ana (que decide o que a voz consegue fazer) e o consumo do mês contra o teto.
 *
 * O teto vem da linha do mês em `agentes_orcamento`; antes da primeira reserva do mês ela
 * não existe, e o teto é o da config (`orcamento.teto_mensal_centavos`) — o mesmo que o
 * worker usa para criá-la.
 */
export async function buscarConfigAoVivo(): Promise<ConfigAoVivo> {
  const supabase = createClient()
  const [cfg, orc] = await Promise.all([
    supabase.from('agentes_config').select('chave, valor').in('chave', ['geral', 'orcamento', 'voz_status']),
    supabase
      .from('agentes_orcamento')
      .select('teto_centavos, consumido_centavos, reservado_centavos')
      .eq('mes', mesCorrenteSp())
      .maybeSingle(),
  ])
  if (cfg.error) throw new Error(cfg.error.message)
  if (orc.error) throw new Error(orc.error.message)
  const por = new Map((cfg.data ?? []).map((l) => [l.chave, l.valor as Record<string, unknown> | null]))
  const tetoConfig = Number(por.get('orcamento')?.teto_mensal_centavos ?? 0)
  const versao = por.get('voz_status')?.versao
  return {
    killSwitch: por.get('geral')?.kill_switch === true,
    versaoVoz: typeof versao === 'string' ? versao : null,
    orcamentoMes: orc.data
      ? {
          teto: orc.data.teto_centavos,
          consumido: orc.data.consumido_centavos,
          reservado: orc.data.reservado_centavos,
          temLinhaDoMes: true,
        }
      : { teto: Number.isFinite(tetoConfig) ? tetoConfig : 0, consumido: 0, reservado: 0, temLinhaDoMes: false },
  }
}

// ─── Kanban e propostas ─────────────────────────────────────────────────────

const ESTADOS_EM_CURSO = ESTADOS_MANDATO.filter((e) => !ESTADOS_TERMINAIS.includes(e))

/** Quantos mandatos terminados cada coluna terminal mostra. */
export const LIMITE_TERMINAIS = 30

/**
 * O kanban: tudo que está em curso, e os 30 mais recentes de cada estado terminal. Os
 * terminados só crescem — sem teto, a coluna "Encerrado sem sucesso" viraria o grosso da
 * consulta em poucos meses, para mostrar coisa que ninguém vai reabrir.
 */
export async function buscarMandatosKanban() {
  const supabase = createClient()
  // prettier-ignore
  const consulta = () => supabase
    .from('mandatos')
    .select('id, codigo, tipo, objetivo, estado, agente_id, empresa_id, prioridade, proxima_acao_em, ultima_acao_em, gasto_centavos, orcamento_centavos, acoes_executadas, max_acoes, expira_em, motivo_encerramento, pausado_motivo, encerrado_em, criado_em, origem, empresas(razao_social, nome_fantasia)')

  const [emCurso, ...terminais] = await Promise.all([
    consulta().in('estado', ESTADOS_EM_CURSO).order('prioridade', { ascending: false }).limit(1500),
    ...ESTADOS_TERMINAIS.map((estado) =>
      consulta()
        .eq('estado', estado)
        .order('encerrado_em', { ascending: false, nullsFirst: false })
        .limit(LIMITE_TERMINAIS),
    ),
  ])
  for (const r of [emCurso, ...terminais]) if (r.error) throw new Error(r.error.message)
  return [...(emCurso.data ?? []), ...terminais.flatMap((r) => r.data ?? [])]
}
export type MandatoDoKanban = Awaited<ReturnType<typeof buscarMandatosKanban>>[number]

export async function buscarPropostasPendentes() {
  // prettier-ignore
  const { data, error } = await createClient()
    .from('mandato_propostas')
    .select('id, tipo, objetivo, justificativa, agente_id, empresa_id, mandato_origem_id, criado_em, empresas(razao_social, nome_fantasia), origem:mandatos!mandato_propostas_mandato_origem_id_fkey(codigo, objetivo)')
    .eq('estado', 'pendente')
    .order('criado_em', { ascending: true })
    .limit(200)
  if (error) throw new Error(error.message)
  return data ?? []
}
export type PropostaPendente = Awaited<ReturnType<typeof buscarPropostasPendentes>>[number]

// ─── O modal do mandato ─────────────────────────────────────────────────────

export async function buscarMandato(id: string) {
  const { data, error } = await createClient()
    .from('mandatos')
    .select('*, empresas(id, razao_social, nome_fantasia, cnpj)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}
export type MandatoCompleto = NonNullable<Awaited<ReturnType<typeof buscarMandato>>>

export async function buscarAcoesDoMandato(id: string) {
  // prettier-ignore
  const { data, error } = await createClient()
    .from('mandato_acoes')
    .select('id, sequencia, ferramenta, intencao, argumentos, resultado, sucesso, erro, custo_centavos, tokens_entrada, tokens_saida, duracao_ms, executada_em, agente_id, contato_id, contatos(nome)')
    .eq('mandato_id', id)
    .order('sequencia', { ascending: false })
    .limit(1000)
  if (error) throw new Error(error.message)
  return data ?? []
}
export type AcaoDoMandato = Awaited<ReturnType<typeof buscarAcoesDoMandato>>[number]

export async function buscarVersoesDoPlano(id: string) {
  const { data, error } = await createClient()
    .from('mandato_plano_versoes')
    .select('id, versao, motivo, criado_em, plano')
    .eq('mandato_id', id)
    .order('versao', { ascending: false })
    .limit(200)
  if (error) throw new Error(error.message)
  return data ?? []
}

export type ItemDoHistorico =
  | {
      tipo: 'mensagem'
      id: string
      em: string
      canal: string
      direcao: string
      texto: string | null
      assunto: string | null
      porIa: boolean
      contato: string | null
      status: string | null
      erro: string | null
    }
  | {
      tipo: 'ligacao'
      id: string
      em: string
      status: string
      outcome: string | null
      resumo: string | null
      objetivo: string
      contato: string | null
      duracaoS: number | null
      erro: string | null
    }

/**
 * TODAS as conversas e ligações do mandato num histórico só (§11.2).
 *
 * O mandato atravessa conversas — ligou para a Marcia, ela indicou o Carlos, mandou e-mail
 * para o Carlos. Cada conversa é presa a um contato; o mandato não. Por isso o histórico
 * é montado pelas conversas VINCULADAS (`mandato_conversas`) mais as ligações que carregam
 * `mandato_id`, e ordenado pelo relógio — não agrupado por conversa, que esconderia a
 * ordem em que as coisas aconteceram.
 *
 * `comunicacoes` segue a RLS do módulo Comunicação: quem acompanha o agente sem esse
 * módulo vê as ligações e não as mensagens, e a tela diz isso em vez de fingir silêncio.
 */
export async function buscarHistoricoDoMandato(id: string): Promise<ItemDoHistorico[]> {
  const supabase = createClient()
  const [vinculos, ligacoes] = await Promise.all([
    supabase.from('mandato_conversas').select('conversa_id').eq('mandato_id', id),
    // prettier-ignore
    supabase
      .from('voz_ligacoes')
      .select('id, status, outcome, resumo, objetivo, criada_em, encerrada_em, duracao_s, erro, motivo_recusa, contatos(nome)')
      .eq('mandato_id', id)
      .order('criada_em', { ascending: true })
      .limit(200),
  ])
  if (vinculos.error) throw new Error(vinculos.error.message)
  if (ligacoes.error) throw new Error(ligacoes.error.message)

  const conversas = (vinculos.data ?? []).map((v) => v.conversa_id)
  let mensagens: ItemDoHistorico[] = []
  if (conversas.length > 0) {
    // prettier-ignore
    const { data, error } = await supabase
      .from('comunicacoes')
      .select('id, canal, direcao, corpo, preview, assunto, criado_em, enviado_em, por_ia, status_envio, erro, contatos(nome)')
      .in('conversa_id', conversas)
      .order('criado_em', { ascending: true })
      .limit(1000)
    if (error) throw new Error(error.message)
    mensagens = (data ?? []).map((c) => ({
      tipo: 'mensagem' as const,
      id: c.id,
      em: c.enviado_em ?? c.criado_em,
      canal: c.canal,
      direcao: c.direcao,
      texto: c.corpo ?? c.preview,
      assunto: c.assunto,
      porIa: c.por_ia,
      contato: c.contatos?.nome ?? null,
      status: c.status_envio,
      erro: c.erro,
    }))
  }

  const chamadas: ItemDoHistorico[] = (ligacoes.data ?? []).map((l) => ({
    tipo: 'ligacao' as const,
    id: l.id,
    em: l.encerrada_em ?? l.criada_em,
    status: l.status,
    outcome: l.outcome,
    resumo: l.resumo,
    objetivo: l.objetivo,
    contato: l.contatos?.nome ?? null,
    duracaoS: l.duracao_s,
    erro: l.erro ?? l.motivo_recusa,
  }))

  return [...mensagens, ...chamadas].sort((a, b) => b.em.localeCompare(a.em))
}

// ─── Helpers de leitura do JSON ─────────────────────────────────────────────

export function lerPlano(bruto: Json | null | undefined): PlanoMandato | null {
  if (!bruto) return null
  const r = planoSchema.safeParse(bruto)
  return r.success ? r.data : null
}

export interface ContatoTentado {
  contato_id: string
  nome: string | null
  canal: string
  tentativas: number
  ultimo_resultado: string | null
  ultima_em: string
}

/** `contatos_tentados` como o worker grava (`ContatoTentado` em `agentes/contexto.ts`). */
export function lerContatosTentados(bruto: Json | null | undefined): ContatoTentado[] {
  if (!Array.isArray(bruto)) return []
  return bruto.filter(
    (c): c is Json & ContatoTentado =>
      typeof c === 'object' && c !== null && !Array.isArray(c) && typeof (c as { contato_id?: unknown }).contato_id === 'string',
  ) as ContatoTentado[]
}

export function nomeDaEmpresa(e: { razao_social: string | null; nome_fantasia: string | null } | null): string {
  return e?.nome_fantasia || e?.razao_social || 'Empresa sem nome'
}

// ─── Realtime ───────────────────────────────────────────────────────────────

/**
 * O Ao vivo e o kanban ouvem `mandato_acoes` (INSERT) e `mandatos` (qualquer mudança),
 * que estão na publicação `supabase_realtime` (0270c). O Realtime aplica a RLS com o JWT
 * do SOCKET — cada um recebe só os eventos dos agentes que leria.
 *
 * O evento não é empurrado para dentro do cache: a linha do Realtime vem crua, sem a
 * empresa e o contato que o feed mostra. Ele INVALIDA as consultas, com um respiro de
 * 400 ms — um ciclo grava várias ações em rajada, e cinco refetches seguidos do mesmo
 * feed não mostram nada que um só não mostre.
 *
 * O resto (reconectar, reautenticar quando o token gira, refazer a leitura quando o
 * canal fica SUBSCRIBED) é o mesmo desenho do sino de notificações
 * (`components/notifications/use-notificacoes.ts`), pelos mesmos motivos.
 */
export function useAgentesRealtime(nome: string) {
  const queryClient = useQueryClient()
  const [conectado, setConectado] = React.useState(false)

  React.useEffect(() => {
    const supabase = createClient()
    let canal: RealtimeChannel | null = null
    let cancelado = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const pendentes = new Set<string>()

    const agendar = (...grupos: string[]) => {
      for (const g of grupos) pendentes.add(g)
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        const lista = [...pendentes]
        pendentes.clear()
        for (const g of lista) {
          if (g === 'acoes') {
            void queryClient.invalidateQueries({ queryKey: agentesOpKeys.feed() })
            void queryClient.invalidateQueries({ queryKey: agentesOpKeys.acoesHoje() })
            void queryClient.invalidateQueries({ queryKey: agentesOpKeys.termometro() })
          } else if (g === 'mandatos') {
            void queryClient.invalidateQueries({ queryKey: agentesOpKeys.ativos() })
            void queryClient.invalidateQueries({ queryKey: agentesOpKeys.kanban() })
            void queryClient.invalidateQueries({ queryKey: agentesOpKeys.termometro() })
            void queryClient.invalidateQueries({ queryKey: agentesOpKeys.ligacoesNaFila() })
          } else {
            // Um mandato específico: o modal aberto nele se atualiza sozinho.
            void queryClient.invalidateQueries({ queryKey: agentesOpKeys.mandato(g) })
          }
        }
      }, 400)
    }

    const conectar = async () => {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (token === undefined || cancelado) return
      supabase.realtime.setAuth(token)

      canal = supabase
        .channel(`agentes:${nome}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mandato_acoes' }, (payload) => {
          const mandatoId = (payload.new as { mandato_id?: string } | null)?.mandato_id
          agendar('acoes', ...(mandatoId ? [mandatoId] : []))
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'mandatos' }, (payload) => {
          const id = (payload.new as { id?: string } | null)?.id ?? (payload.old as { id?: string } | null)?.id
          agendar('mandatos', ...(id ? [id] : []))
        })
        .subscribe((status) => {
          if (cancelado) return
          setConectado(status === 'SUBSCRIBED')
          if (status === 'SUBSCRIBED') agendar('acoes', 'mandatos')
        })
    }

    void conectar()

    const { data: listener } = supabase.auth.onAuthStateChange((_evento, sessao) => {
      if (sessao?.access_token !== undefined) supabase.realtime.setAuth(sessao.access_token)
    })

    return () => {
      cancelado = true
      if (timer) clearTimeout(timer)
      listener.subscription.unsubscribe()
      if (canal !== null) void supabase.removeChannel(canal)
    }
  }, [nome, queryClient])

  return conectado
}
