import { createClient } from '@/lib/supabase/client'
import {
  lerEstadoBeta,
  ordenarPorPrioridade,
  type EstadoBeta,
  type PrioridadeReport,
  type StatusReport,
  type TipoReport,
} from '@jobsiteos/core'

/**
 * Leituras de reports. Todas passam pela RLS — o recorte "meus reports" vs "todos"
 * é do banco, não daqui: `reports_select` entrega ao autor apenas as linhas dele e
 * ao admin todas. Um filtro no cliente esconderia a linha sem impedir a leitura.
 */

export interface Report {
  id: string
  numero: number
  tipo: TipoReport
  titulo: string
  descricao: string
  status: StatusReport
  prioridade: PrioridadeReport | null
  duplicado_de: string | null
  contexto: Record<string, unknown> | null
  anexo_url: string | null
  criado_por: string
  criado_em: string
  atualizado_em: string
  resolvido_em: string | null
  autor_nome: string | null
}

export interface ComentarioReport {
  id: string
  report_id: string
  autor_id: string
  texto: string
  interno: boolean
  criado_em: string
  autor_nome: string | null
}

export interface HistoricoReport {
  id: string
  status_anterior: string | null
  status_novo: string
  alterado_em: string
  alterado_por: string
  autor_nome: string | null
}

export const reportsKeys = {
  todos: ['reports'] as const,
  lista: (filtro: string) => ['reports', 'lista', filtro] as const,
  meus: () => ['reports', 'meus'] as const,
  um: (id: string) => ['reports', 'um', id] as const,
  comentarios: (id: string) => ['reports', 'comentarios', id] as const,
  historico: (id: string) => ['reports', 'historico', id] as const,
  painel: () => ['reports', 'painel'] as const,
  beta: () => ['reports', 'beta'] as const,
}

/*
 * `usuarios!reports_criado_por_fkey (nome)` — o embed do PostgREST pela chave
 * estrangeira. Funciona para qualquer leitor porque `usuarios_select` libera a
 * linha de qualquer colega ativo, e o grant de coluna entrega só `nome` e o
 * básico (migração 0005). Sem isso o painel de triagem mostraria uuid no lugar
 * de gente.
 */
const CAMPOS = `
  id, numero, tipo, titulo, descricao, status, prioridade, duplicado_de,
  contexto, anexo_url, criado_por, criado_em, atualizado_em, resolvido_em,
  usuarios!reports_criado_por_fkey ( nome )
`

type LinhaComAutor = Record<string, unknown> & { usuarios?: { nome: string } | null }

function comAutor(linha: LinhaComAutor): Report {
  const { usuarios, ...resto } = linha
  return { ...(resto as unknown as Report), autor_nome: usuarios?.nome ?? null }
}

export interface FiltroReports {
  tipo: TipoReport | 'todos'
  status: StatusReport | 'todos' | 'abertos_e_andamento'
  prioridade: PrioridadeReport | 'todas'
  autorId: string | 'todos'
  termo: string
  /** `prioridade` ordena pela urgência que o admin definiu; `data`, pela chegada. */
  ordem: 'data' | 'prioridade'
}

export const FILTRO_REPORTS_PADRAO: FiltroReports = {
  tipo: 'todos',
  // A triagem abre no que ainda pede ação. Abrir em "todos" enterraria os cinco
  // abertos sob duzentos resolvidos já no primeiro dia de uso.
  status: 'abertos_e_andamento',
  prioridade: 'todas',
  autorId: 'todos',
  termo: '',
  ordem: 'data',
}

export async function buscarReports(filtro: FiltroReports): Promise<Report[]> {
  const supabase = createClient()
  let q = supabase.from('reports').select(CAMPOS).limit(500)

  if (filtro.tipo !== 'todos') q = q.eq('tipo', filtro.tipo)

  if (filtro.status === 'abertos_e_andamento') {
    q = q.in('status', ['aberto', 'em_analise', 'em_correcao', 'planejado', 'em_desenvolvimento'])
  } else if (filtro.status !== 'todos') {
    q = q.eq('status', filtro.status)
  }

  if (filtro.prioridade !== 'todas') q = q.eq('prioridade', filtro.prioridade)
  if (filtro.autorId !== 'todos') q = q.eq('criado_por', filtro.autorId)

  const termo = filtro.termo.trim()
  if (termo) {
    const numero = Number(termo.replace(/^#/, ''))
    if (Number.isInteger(numero) && numero > 0) {
      // "#42" é como as pessoas falam do report. Buscar isso no título não
      // acharia nada — o número não está lá.
      q = q.eq('numero', numero)
    } else {
      const t = termo.replace(/[%,()]/g, '')
      q = q.or(`titulo.ilike.%${t}%,descricao.ilike.%${t}%`)
    }
  }

  q = q.order('criado_em', { ascending: false })

  const { data, error } = await q
  if (error) throw new Error(error.message)
  const linhas = (data ?? []).map((l) => comAutor(l as LinhaComAutor))

  /*
   * A ordem por prioridade é feita AQUI, não no `order()` do PostgREST.
   *
   * `prioridade` é texto, e ordenar texto dá alta < baixa < critica < media — a
   * ordem do dicionário, que numa fila de triagem coloca "baixa" acima de
   * "crítica". A ordem que importa é semântica, e `ordenarPorPrioridade` é a
   * única que a conhece. `sort` é estável, então dentro da mesma prioridade
   * continua valendo o `criado_em desc` que o banco já aplicou.
   */
  return filtro.ordem === 'prioridade'
    ? linhas.sort((a, b) => ordenarPorPrioridade(a.prioridade, b.prioridade))
    : linhas
}

/** "Meus reports" (§2). O `eq` é redundante com a RLS para um não-admin — e não é
 *  para o admin, que veria a fila inteira na aba que promete ser a dele. */
export async function buscarMeusReports(usuarioId: string): Promise<Report[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('reports')
    .select(CAMPOS)
    .eq('criado_por', usuarioId)
    .order('criado_em', { ascending: false })
    .limit(100)
  if (error) throw new Error(error.message)
  return (data ?? []).map((l) => comAutor(l as LinhaComAutor))
}

export async function buscarReport(id: string): Promise<Report | null> {
  const supabase = createClient()
  const { data, error } = await supabase.from('reports').select(CAMPOS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? comAutor(data as LinhaComAutor) : null
}

export async function buscarComentarios(reportId: string): Promise<ComentarioReport[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('report_comentarios')
    .select('id, report_id, autor_id, texto, interno, criado_em, usuarios!report_comentarios_autor_id_fkey ( nome )')
    .eq('report_id', reportId)
    .order('criado_em', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((c) => {
    const { usuarios, ...resto } = c as LinhaComAutor
    return { ...(resto as unknown as ComentarioReport), autor_nome: usuarios?.nome ?? null }
  })
}

export async function buscarHistorico(reportId: string): Promise<HistoricoReport[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('report_historico')
    .select('id, status_anterior, status_novo, alterado_em, alterado_por, usuarios!report_historico_alterado_por_fkey ( nome )')
    .eq('report_id', reportId)
    .order('alterado_em', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((h) => {
    const { usuarios, ...resto } = h as LinhaComAutor
    return { ...(resto as unknown as HistoricoReport), autor_nome: usuarios?.nome ?? null }
  })
}

export interface PainelReports {
  tem_acesso: boolean
  abertos?: number
  em_andamento?: number
  resolvidos_mes?: number
  bugs_abertos?: number
  melhorias_abertas?: number
  total?: number
}

export async function buscarPainelReports(): Promise<PainelReports> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('reports_painel')
  if (error) throw new Error(error.message)
  return (data ?? { tem_acesso: false }) as unknown as PainelReports
}

export async function buscarEstadoBeta(): Promise<EstadoBeta> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('app_config')
    .select('valor')
    .eq('chave', 'beta')
    .maybeSingle()
  if (error) throw new Error(error.message)
  return lerEstadoBeta(data?.valor)
}

/**
 * O report pelo NÚMERO curto.
 *
 * "Marcar como duplicado" pede o original, e o admin conhece o original por
 * "#42" — foi assim que ele apareceu no sino, no toast e na conversa. Um seletor
 * com a lista inteira seria uma lista de centenas para escolher um item que a
 * pessoa já sabe qual é.
 */
export async function buscarReportPorNumero(numero: number): Promise<Report | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('reports')
    .select(CAMPOS)
    .eq('numero', numero)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? comAutor(data as LinhaComAutor) : null
}

/** Autores que já reportaram — alimenta o filtro "por autor" do painel (§3). */
export async function buscarAutoresDeReports(): Promise<{ id: string; nome: string }[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('reports')
    .select('criado_por, usuarios!reports_criado_por_fkey ( nome )')
    .limit(1000)
  if (error) throw new Error(error.message)
  const porId = new Map<string, string>()
  for (const l of (data ?? []) as LinhaComAutor[]) {
    const id = l.criado_por as string
    if (id && !porId.has(id)) porId.set(id, l.usuarios?.nome ?? 'Sem nome')
  }
  return [...porId].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}
