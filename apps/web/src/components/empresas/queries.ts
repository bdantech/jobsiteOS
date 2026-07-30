import type { Estagio, Json, Tables, TipoEmpresa } from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'
import { resumoDoEvento } from './format'

/**
 * Reads for the Empresas module.
 *
 * These run in the BROWSER against the anon key + the user's session, so every
 * one of them is filtered by RLS (`app_tem_modulo('empresas')`): a user without
 * the module gets zero rows, never an error and never someone else's data.
 * Mutations do NOT go through here — they are server actions (src/actions/empresas.ts),
 * because only the server may run the write helpers.
 */

export interface FiltrosEmpresas {
  termo: string
  estagio: Estagio | null
  tipo: TipoEmpresa | null
  uf: string | null
}

export const FILTROS_VAZIOS: FiltrosEmpresas = {
  termo: '',
  estagio: null,
  tipo: null,
  uf: null,
}

export function temFiltroAtivo(filtros: FiltrosEmpresas): boolean {
  return (
    filtros.termo.trim().length > 0 ||
    filtros.estagio !== null ||
    filtros.tipo !== null ||
    filtros.uf !== null
  )
}

export type EmpresaLista = Pick<
  Tables<'empresas'>,
  'id' | 'cnpj' | 'razao_social' | 'nome_fantasia' | 'tipo' | 'estagio' | 'uf' | 'erp_atual' | 'erp_mrr'
>

const COLUNAS_LISTA =
  'id, cnpj, razao_social, nome_fantasia, tipo, estagio, uf, erp_atual, erp_mrr' as const

/** A list this size is a signal to filter, not to paginate. Keep it honest in the UI. */
export const LIMITE_LISTA = 100

export interface NotaComAutor {
  id: string
  conteudo: string
  criado_em: string
  autor_usuario_id: string
  autor_nome: string | null
}

export interface EventoComAtor {
  id: string
  tipo: string
  criado_em: string
  /** payload.resumo, already narrowed out of the untyped jsonb. */
  resumo: string | null
  ator_nome: string | null
}

export const empresasKeys = {
  all: ['empresas'] as const,
  lista: (filtros: FiltrosEmpresas) => ['empresas', 'lista', filtros] as const,
  detalhe: (id: string) => ['empresas', 'detalhe', id] as const,
  notas: (id: string) => ['empresas', 'notas', id] as const,
  eventos: (id: string) => ['empresas', 'eventos', id] as const,
  contatos: (id: string) => ['empresas', 'contatos', id] as const,
  analiseFinanceira: (id: string) => ['empresas', 'analise-financeira', id] as const,
  grupoProtestos: (id: string) => ['empresas', 'analise-financeira', id, 'grupo-protestos'] as const,
  previaProtestos: (id: string, incluirSpes: boolean, anoMin: number | null) =>
    ['empresas', 'analise-financeira', id, 'previa-protestos', incluirSpes, anoMin] as const,
  onepayAnalytics: () => ['empresas', 'onepay-analytics'] as const,
  metricas: (cnpj: string) => ['empresas', 'metricas', cnpj] as const,
  onepayClientesFiltrados: (dimensao: string, valor: string) =>
    ['empresas', 'onepay-clientes', dimensao, valor] as const,
}

/** Um cliente Onepay dentro de um recorte da Análise (região/camada/faixa de capital). */
export interface ClienteOnepayFiltrado {
  cnpj: string
  nome: string | null
  empresa_id: string | null
  uf: string | null
  camada: string | null
  capital_social: number | null
}

export async function buscarClientesOnepayFiltrados(
  dimensao: string,
  valor: string,
): Promise<ClienteOnepayFiltrado[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('radar_onepay_clientes' as never, {
    p_dimensao: dimensao,
    p_valor: valor,
  } as never)
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as { clientes?: ClienteOnepayFiltrado[] }
  return r.clientes ?? []
}

/**
 * Agregados dos clientes Onepay (região, camada, faixa de capital) para a aba Análise.
 * Do RPC radar_onepay_analytics (SECURITY DEFINER, gate no Radar). `tem_acesso:false`
 * quando falta o módulo. Chaves cruas (região/faixa) — os rótulos/ordem moram na UI.
 */
export interface OnepayAnalytics {
  tem_acesso: boolean
  total: number
  por_regiao: Record<string, number>
  por_camada: Record<string, number>
  por_capital: Record<string, number>
}

export async function buscarOnepayAnalytics(): Promise<OnepayAnalytics> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('radar_onepay_analytics' as never)
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as Partial<OnepayAnalytics>
  return {
    tem_acesso: r.tem_acesso ?? false,
    total: r.total ?? 0,
    por_regiao: r.por_regiao ?? {},
    por_camada: r.por_camada ?? {},
    por_capital: r.por_capital ?? {},
  }
}

/** Snapshot atual de protesto de um CNPJ (último registro append-only). */
export interface ProtestoAtual {
  tem_protesto: boolean | null
  qtd_protestos: number | null
  valor_total: number | null
  consultado_em: string
  fonte: string
  cartorios: Json | null
}

/** Soma dos últimos snapshots de cada CNPJ do grupo econômico. */
export interface ProtestoGrupo {
  valor_total: number
  qtd_protestos: number
  qtd_empresas_com_protesto: number
  qtd_empresas_consultadas: number
}

export interface ProtestoHistoricoItem {
  consultado_em: string
  fonte: string
  tem_protesto: boolean | null
  qtd_protestos: number | null
  valor_total: number | null
  cartorios: Json | null
}

/**
 * Análise financeira da ficha: protesto atual da empresa, total somado do grupo e o
 * histórico de consultas. Vem do RPC empresa_analise_financeira (0036), SECURITY DEFINER
 * com gate no módulo Radar — sem o módulo, `tem_acesso: false` (a aba mostra um estado
 * amigável em vez de erro). O RPC ainda não está nos tipos gerados; cast localizado.
 */
export interface AnaliseFinanceira {
  tem_acesso: boolean
  cnpj?: string
  atual: ProtestoAtual | null
  grupo: ProtestoGrupo | null
  historico: ProtestoHistoricoItem[]
}

/** Prévia de custo para rodar protestos (empresa + SPEs). Do RPC radar_protestos_empresa_previa. */
export interface PreviaProtestos {
  tem_acesso: boolean
  qtd: number
  custo_estimado: number
}

export async function buscarPreviaProtestos(
  empresaId: string,
  incluirSpes: boolean,
  anoMin: number | null,
): Promise<PreviaProtestos> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('radar_protestos_empresa_previa' as never, {
    p_empresa_id: empresaId,
    p_incluir_spes: incluirSpes,
    p_ano_min: anoMin,
  } as never)
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as Partial<PreviaProtestos>
  return { tem_acesso: r.tem_acesso ?? false, qtd: r.qtd ?? 0, custo_estimado: r.custo_estimado ?? 0 }
}

/** Snapshot de protesto de uma empresa do grupo (com cartorios) para o diálogo do grupo. */
export interface GrupoEmpresaProtesto {
  cnpj: string
  empresa_id: string | null
  nome: string
  valor_total: number | null
  qtd_protestos: number | null
  consultado_em: string
  fonte: string
  cartorios: Json | null
}

export interface GrupoProtestos {
  tem_acesso: boolean
  empresas: GrupoEmpresaProtesto[]
}

export async function buscarGrupoProtestos(empresaId: string): Promise<GrupoProtestos> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('empresa_grupo_protestos' as never, {
    p_empresa_id: empresaId,
  } as never)
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as Partial<GrupoProtestos>
  return { tem_acesso: r.tem_acesso ?? false, empresas: r.empresas ?? [] }
}

export async function buscarAnaliseFinanceira(empresaId: string): Promise<AnaliseFinanceira> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('empresa_analise_financeira' as never, {
    p_empresa_id: empresaId,
  } as never)
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as Partial<AnaliseFinanceira>
  return {
    tem_acesso: r.tem_acesso ?? false,
    cnpj: r.cnpj,
    atual: r.atual ?? null,
    grupo: r.grupo ?? null,
    historico: r.historico ?? [],
  }
}

/**
 * PostgREST's `or=` filter is a comma-separated list, and the value is not
 * quoted — a comma or a parenthesis inside the term would be read as syntax and
 * inject an extra condition. `%` would silently become a wildcard. Strip all of
 * them before the term ever reaches the query string.
 */
function sanitizarTermo(termo: string): string {
  return termo.replace(/[,()%*\\]/g, ' ').trim()
}

export async function buscarEmpresas(filtros: FiltrosEmpresas): Promise<EmpresaLista[]> {
  const supabase = createClient()

  let query = supabase
    .from('empresas')
    .select(COLUNAS_LISTA)
    .order('razao_social', { ascending: true, nullsFirst: false })
    .limit(LIMITE_LISTA)

  const termo = sanitizarTermo(filtros.termo)
  if (termo) {
    const condicoes = [`razao_social.ilike.%${termo}%`, `nome_fantasia.ilike.%${termo}%`]
    // CNPJ is stored as 14 bare digits, so "11.222" only matches if we strip the
    // punctuation the user naturally types. Two digits is enough to be a search
    // and not a full-table scan of every row containing a "1".
    const digitos = termo.replace(/\D/g, '')
    if (digitos.length >= 2) condicoes.push(`cnpj.ilike.%${digitos}%`)
    query = query.or(condicoes.join(','))
  }

  if (filtros.estagio) query = query.eq('estagio', filtros.estagio)
  if (filtros.tipo) query = query.eq('tipo', filtros.tipo)
  if (filtros.uf) query = query.eq('uf', filtros.uf)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarEmpresa(id: string): Promise<Tables<'empresas'> | null> {
  const supabase = createClient()

  const { data, error } = await supabase.from('empresas').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

/**
 * empresa_notas.autor_usuario_id and empresa_eventos.ator_usuario_id are plain
 * uuid columns with NO foreign key to `usuarios` (migration 0001) — deliberately,
 * so an event survives the user who caused it. PostgREST can only embed across a
 * declared FK, so `select('*, usuarios(nome)')` is not available to us: the join
 * is done here, in one extra round trip.
 *
 * `usuarios` is readable by any active user (migration 0005 grants exactly
 * id, nome, email, perfil_id, ativo, must_change_password, criado_em), so this
 * needs no service-role escalation.
 */
async function nomesDeUsuarios(ids: readonly string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids)]
  if (unicos.length === 0) return new Map()

  const supabase = createClient()
  const { data, error } = await supabase.from('usuarios').select('id, nome').in('id', unicos)
  if (error) throw new Error(error.message)

  return new Map((data ?? []).map((u) => [u.id, u.nome]))
}

export async function buscarNotas(empresaId: string): Promise<NotaComAutor[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('empresa_notas')
    .select('id, conteudo, criado_em, autor_usuario_id')
    .eq('empresa_id', empresaId)
    .order('criado_em', { ascending: false })
    .limit(200)

  if (error) throw new Error(error.message)
  const notas = data ?? []

  const nomes = await nomesDeUsuarios(notas.map((n) => n.autor_usuario_id))

  return notas.map((nota) => ({
    ...nota,
    autor_nome: nomes.get(nota.autor_usuario_id) ?? null,
  }))
}

/**
 * Contatos da empresa, com o PONTO FOCAL primeiro.
 *
 * A ordenação não é cosmética: toda escolha de destinatário no sistema (a outbox
 * da Antecipação, os botões de contato no mobile) segue a hierarquia "ponto focal
 * → melhor contato disponível". A lista mostrar a mesma ordem que o código usa é o
 * que faz alguém entender por que uma mensagem foi para quem foi.
 */
/**
 * A série de métricas de um CNPJ (04c §2). Chaveada por CNPJ, não por empresa_id:
 * o snapshot pode ter nascido antes de a empresa existir (backfill do universo), e
 * filtrar por empresa perderia justamente os pontos mais antigos da série — os que
 * dão o crescimento.
 */
export async function buscarMetricas(cnpj: string): Promise<Tables<'empresa_metricas'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('empresa_metricas')
    .select('*')
    .eq('cnpj', cnpj)
    .order('capturado_em', { ascending: false })
    .limit(200)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarContatos(empresaId: string): Promise<Tables<'contatos'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('contatos')
    .select('*')
    .eq('empresa_id', empresaId)
    .order('ponto_focal', { ascending: false })
    .order('nome', { ascending: true, nullsFirst: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarEventos(empresaId: string): Promise<EventoComAtor[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('empresa_eventos')
    .select('id, tipo, payload, criado_em, ator_usuario_id')
    .eq('empresa_id', empresaId)
    .order('criado_em', { ascending: false })
    .limit(100)

  if (error) throw new Error(error.message)
  const eventos = data ?? []

  // ator_usuario_id is null for system/cron events — they have no name to fetch.
  const atores = eventos.map((e) => e.ator_usuario_id).filter((id): id is string => id !== null)
  const nomes = await nomesDeUsuarios(atores)

  return eventos.map((evento) => ({
    id: evento.id,
    tipo: evento.tipo,
    criado_em: evento.criado_em,
    resumo: resumoDoEvento(evento.payload),
    ator_nome: evento.ator_usuario_id ? (nomes.get(evento.ator_usuario_id) ?? null) : null,
  }))
}
