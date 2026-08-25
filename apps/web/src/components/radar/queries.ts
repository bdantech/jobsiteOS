import {
  resolverParaJson,
  type Camada,
  type Grupo,
  type Json,
  type Tables,
  type Views,
} from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'

/**
 * Reads do módulo Radar + a query-key factory que ele compartilha. Tudo roda no
 * BROWSER com a sessão do usuário — a RLS (app_tem_modulo('radar')) decide as linhas.
 * Escritas são server actions sobre os RPCs do core (radar/mutations), nunca aqui.
 */

export const radarKeys = {
  all: ['radar'] as const,
  cobertura: () => ['radar', 'cobertura'] as const,
  gastoMes: () => ['radar', 'gasto-mes'] as const,
  orcamento: () => ['radar', 'orcamento'] as const,
  lotes: () => ['radar', 'lotes'] as const,
  lote: (id: string) => ['radar', 'lote', id] as const,
  loteItens: (id: string) => ['radar', 'lote', id, 'itens'] as const,
  loteItensPorStatus: (id: string, status: string) =>
    ['radar', 'lote', id, 'itens', status] as const,
  clientes: () => ['radar', 'clientes'] as const,
  exClientes: () => ['radar', 'ex-clientes'] as const,
  exCliente: (empresaId: string) => ['radar', 'ex-clientes', empresaId] as const,
  exClientesMotivos: (meses: number) => ['radar', 'ex-clientes', 'motivos', meses] as const,
  analisesSemCadastro: () => ['radar', 'analises-sem-cadastro'] as const,
  motivosSaida: () => ['radar', 'motivos-saida'] as const,
  supressao: () => ['radar', 'supressao'] as const,
  config: () => ['radar', 'config'] as const,
  spesMonitoramento: (grupoId: string) => ['radar', 'monitoramento', grupoId] as const,
}

/** Uma SPE do grupo e se está no monitoramento periódico de protesto (afiançada). */
export interface SpeMonitoramento {
  cnpj: string
  razao_social: string | null
  situacao_cadastral: string | null
  data_inicio_atividade: string | null
  capital_social: number | null
  empresa_id: string | null
  monitorada: boolean
}

export async function buscarSpesMonitoramento(
  grupoId: string,
): Promise<{ tem_acesso: boolean; spes: SpeMonitoramento[] }> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('radar_grupo_spes_monitoramento' as never, {
    p_grupo_id: grupoId,
  } as never)
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as { tem_acesso?: boolean; spes?: SpeMonitoramento[] }
  return { tem_acesso: r.tem_acesso ?? false, spes: r.spes ?? [] }
}

export interface CoberturaCamada {
  camada: Camada
  total: number
  com_dominio: number
  com_contato: number
  com_protesto: number
  /** 04c: cobertura do cache em `empresas` — é ele que o filtro do Explorador lê. */
  com_funcionarios: number
  com_faturamento: number
}

export async function buscarCobertura(): Promise<CoberturaCamada[]> {
  const supabase = createClient()
  // radar_cobertura ainda não está nos tipos gerados; cast localizado.
  const { data, error } = await supabase.rpc('radar_cobertura' as never)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as CoberturaCamada[]
}

function inicioDoMesUtc(): string {
  const h = new Date()
  return new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth(), 1)).toISOString()
}

export async function buscarGastoMes(): Promise<number> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('enriquecimentos')
    .select('custo_real')
    .gte('executado_em', inicioDoMesUtc())
  if (error) throw new Error(error.message)
  return (data ?? []).reduce((s, r) => s + (Number(r.custo_real) || 0), 0)
}

export interface OrcamentoConfig {
  teto_mensal_total: number
  alerta_percentual: number
  max_itens_por_lote: number
}

export async function buscarOrcamento(): Promise<OrcamentoConfig | null> {
  const supabase = createClient()
  const { data } = await supabase.from('radar_config').select('valor').eq('chave', 'orcamento').maybeSingle()
  return (data?.valor as OrcamentoConfig | undefined) ?? null
}

export async function buscarLotesRecentes(limite = 10): Promise<Tables<'lotes_enriquecimento'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('lotes_enriquecimento')
    .select('*')
    .order('criado_em', { ascending: false })
    .limit(limite)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarLote(id: string): Promise<Tables<'lotes_enriquecimento'> | null> {
  const supabase = createClient()
  const { data, error } = await supabase.from('lotes_enriquecimento').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export interface ContagemItens {
  total: number
  porStatus: Record<string, number>
}

export async function contarItensDoLote(id: string): Promise<ContagemItens> {
  const supabase = createClient()
  const { data, error } = await supabase.from('lote_itens').select('status').eq('lote_id', id)
  if (error) throw new Error(error.message)
  const porStatus: Record<string, number> = {}
  for (const r of data ?? []) porStatus[r.status] = (porStatus[r.status] ?? 0) + 1
  return { total: (data ?? []).length, porStatus }
}

/** Uma empresa do lote num dado status — para a lista que abre ao clicar no status. */
export interface LoteItemDetalhe {
  id: string
  cnpj: string | null
  empresa_id: string | null
  erro: string | null
  atualizado_em: string
  razao_social: string | null
  nome_fantasia: string | null
  /**
   * O domínio DESTE item: o que a cascata resolveu (lote de domínio) ou o que foi usado
   * na consulta (contatos, funcionários). Sem ele, a lista de "Sucesso" de um lote de
   * domínio dizia apenas que deu certo, e conferir o que foi atribuído a 200 empresas
   * exigia abrir 200 fichas — na prática, ninguém confere.
   */
  dominio: string | null
  dominio_origem: string | null
  dominio_confianca: string | null
}

export async function buscarItensPorStatus(loteId: string, status: string): Promise<LoteItemDetalhe[]> {
  const supabase = createClient()
  // Embed empresas(...) pela FK empresa_id → nome sem um segundo round-trip. A RLS de
  // empresas decide se o nome vem (null para quem não tem o módulo Empresas — o CNPJ fica).
  const { data, error } = await supabase
    .from('lote_itens')
    .select(
      'id, cnpj, empresa_id, erro, resultado, dominio, atualizado_em, empresas(razao_social, nome_fantasia)',
    )
    .eq('lote_id', loteId)
    .eq('status', status)
    .order('atualizado_em', { ascending: false })
    .limit(1000)
  if (error) throw new Error(error.message)
  type Achado = { dominio?: string | null; origem?: string | null; confianca?: string | null }
  type Raw = {
    id: string
    cnpj: string | null
    empresa_id: string | null
    erro: string | null
    resultado: unknown
    dominio: string | null
    atualizado_em: string
    empresas: { razao_social: string | null; nome_fantasia: string | null } | null
  }
  return ((data ?? []) as unknown as Raw[]).map((r) => {
    // `resultado` é o achado do item (lote de domínio); `lote_itens.dominio` é o que foi
    // materializado do universo e é o que os lotes de contatos/funcionários consultaram.
    // O achado vence: num lote de domínio a coluna materializada estava vazia.
    const achado = (r.resultado ?? null) as Achado | null
    return {
      id: r.id,
      cnpj: r.cnpj,
      empresa_id: r.empresa_id,
      erro: r.erro,
      atualizado_em: r.atualizado_em,
      razao_social: r.empresas?.razao_social ?? null,
      nome_fantasia: r.empresas?.nome_fantasia ?? null,
      dominio: achado?.dominio ?? r.dominio ?? null,
      dominio_origem: achado?.origem ?? null,
      dominio_confianca: achado?.confianca ?? null,
    }
  })
}

export type ClienteOnepay = Views<'clientes_onepay_lista'>

/**
 * A view (0102), e não a tabela: protesto do GRUPO, faturamento e gestão vivem em
 * `empresas`/`protestos_atual`, e resolver isso em três consultas separadas na tela
 * daria três momentos diferentes do mesmo cliente.
 */
export async function buscarClientesOnepay(): Promise<ClienteOnepay[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('clientes_onepay_lista')
    .select('*')
    .order('days_without_anticipation', { ascending: false, nullsFirst: false })
    .limit(500)
  if (error) throw new Error(error.message)
  return (data ?? []) as ClienteOnepay[]
}

// ─── Ex-clientes (04h) ──────────────────────────────────────────────────────

export type ExCliente = Views<'ex_clientes'>
export type AnaliseSemCadastro = Views<'analises_sem_cadastro'>

/**
 * Quem foi cliente e saiu. Ordenado por data de saída DESC, e não por limite: quem
 * saiu semana passada ainda lembra do nosso nome, e é com ele que uma tentativa de
 * reativação tem chance. O maior limite de 2023 é uma saudade, não um lead.
 */
export async function buscarExClientes(): Promise<ExCliente[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('ex_clientes')
    .select('*')
    .order('ex_cliente_desde', { ascending: false, nullsFirst: false })
    .limit(1000)
  if (error) throw new Error(error.message)
  return (data ?? []) as ExCliente[]
}

/**
 * Análise aprovada e nunca cadastrada: alguém pagou a análise, o crédito saiu e a
 * empresa nunca operou. Ordenado por limite — aqui o tamanho É a temperatura, porque
 * não há relação passada para pesar, só a oportunidade.
 */
export async function buscarAnalisesSemCadastro(): Promise<AnaliseSemCadastro[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('analises_sem_cadastro')
    .select('*')
    .order('credit_limit', { ascending: false, nullsFirst: false })
    .limit(1000)
  if (error) throw new Error(error.message)
  return (data ?? []) as AnaliseSemCadastro[]
}

/** A linha de UM ex-cliente — o que a ficha (Company 360) precisa, com a sugestão. */
export async function buscarExCliente(empresaId: string): Promise<ExCliente | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('ex_clientes')
    .select('*')
    .eq('empresa_id', empresaId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as ExCliente | null) ?? null
}

export interface MotivoSaida {
  motivo: string
  total: number
}

export async function buscarExClientesPorMotivo(meses: number): Promise<MotivoSaida[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('ex_clientes_por_motivo', { p_meses: meses })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as MotivoSaida[]
}

/** A lista fechada de motivos de saída, para o dropdown inline. */
export async function buscarMotivosSaida(): Promise<Tables<'motivos_perda'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('motivos_perda')
    .select('*')
    .eq('contexto', 'ex_cliente')
    .eq('ativo', true)
    .order('ordem', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarSupressao(): Promise<Tables<'supressao'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase.from('supressao').select('*').order('criado_em', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export interface CustosConfig {
  dominio_claude: number
  contato_apollo: number
  protesto_sp: number
  protesto_nacional: number
}

export async function buscarCustos(): Promise<CustosConfig> {
  const supabase = createClient()
  const { data } = await supabase.from('radar_config').select('valor').eq('chave', 'custos').maybeSingle()
  return (
    (data?.valor as CustosConfig | undefined) ?? {
      dominio_claude: 0.1,
      contato_apollo: 1.2,
      protesto_sp: 0.36,
      protesto_nacional: 3.5,
    }
  )
}

/** Estimativa de itens elegíveis: reusa a contagem exata do universo (mercado_contar_exato). */
export async function estimarItens(arvore: Grupo): Promise<number> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('mercado_contar_exato', {
    p_termo: undefined,
    p_arvore: resolverParaJson(arvore) as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return (data as number | null) ?? 0
}

export async function buscarRadarConfig(): Promise<Tables<'radar_config'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase.from('radar_config').select('*').order('chave')
  if (error) throw new Error(error.message)
  return data ?? []
}
