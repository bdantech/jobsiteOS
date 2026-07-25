import type { Camada, Tables } from '@jobsiteos/core'
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
  clientes: () => ['radar', 'clientes'] as const,
  supressao: () => ['radar', 'supressao'] as const,
  config: () => ['radar', 'config'] as const,
}

export interface CoberturaCamada {
  camada: Camada
  total: number
  com_dominio: number
  com_contato: number
  com_protesto: number
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

export async function buscarClientesOnepay(): Promise<Tables<'clientes_onepay'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('clientes_onepay')
    .select('*')
    .order('days_without_anticipation', { ascending: false, nullsFirst: false })
    .limit(500)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarSupressao(): Promise<Tables<'supressao'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase.from('supressao').select('*').order('criado_em', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarRadarConfig(): Promise<Tables<'radar_config'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase.from('radar_config').select('*').order('chave')
  if (error) throw new Error(error.message)
  return data ?? []
}
