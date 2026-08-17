import type { Tables } from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'

/** Chaves de cache do módulo Crédito. Mesma convenção do Radar e da Antecipação. */
export const creditoKeys = {
  all: ['credito'] as const,
  esteira: () => [...creditoKeys.all, 'esteira'] as const,
  analise: (id: string) => [...creditoKeys.all, 'analise', id] as const,
  docs: (id: string) => [...creditoKeys.all, 'docs', id] as const,
  score: (cnpj: string) => [...creditoKeys.all, 'score', cnpj] as const,
  scorecards: () => [...creditoKeys.all, 'scorecards'] as const,
  config: () => [...creditoKeys.all, 'config'] as const,
  versao: () => [...creditoKeys.all, 'versao'] as const,
  painel: () => [...creditoKeys.all, 'painel'] as const,
}

export interface AnaliseNaEsteira {
  id: string
  cnpj: string
  empresa_id: string | null
  estagio: string
  limite_solicitado: number | null
  limite_aprovado: number | null
  /** A NOSSA decisão (04j §7). Distinto do aprovado, que é o da seguradora. */
  limite_operacional: number | null
  decisao_interna: string | null
  expira_em: string | null
  motivo: string | null
  origem: string
  atradius_case_id: string | null
  criada_em: string
  atualizada_em: string
  razao_social: string | null
  nome_fantasia: string | null
}

/**
 * A esteira inteira numa consulta. Cabe: são análises abertas mais o histórico recente,
 * não o universo. O teto existe para a tela não morrer calada se um backfill trouxer
 * milhares de linhas da apólice de uma vez.
 */
export const LIMITE_ESTEIRA = 1000

export async function buscarEsteira(): Promise<AnaliseNaEsteira[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('analises_credito')
    .select('id, cnpj, empresa_id, estagio, limite_solicitado, limite_aprovado, limite_operacional, decisao_interna, expira_em, motivo, origem, atradius_case_id, criada_em, atualizada_em, empresas(razao_social, nome_fantasia)')
    .order('atualizada_em', { ascending: false })
    .limit(LIMITE_ESTEIRA)
  if (error) throw new Error(error.message)

  type Raw = Omit<AnaliseNaEsteira, 'razao_social' | 'nome_fantasia'> & {
    empresas: { razao_social: string | null; nome_fantasia: string | null } | null
  }
  return ((data ?? []) as unknown as Raw[]).map((a) => ({
    ...a,
    razao_social: a.empresas?.razao_social ?? null,
    nome_fantasia: a.empresas?.nome_fantasia ?? null,
  }))
}

export async function buscarAnalise(id: string): Promise<AnaliseNaEsteira | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('analises_credito')
    .select('id, cnpj, empresa_id, estagio, limite_solicitado, limite_aprovado, limite_operacional, decisao_interna, expira_em, motivo, origem, atradius_case_id, criada_em, atualizada_em, empresas(razao_social, nome_fantasia)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  type Raw = Omit<AnaliseNaEsteira, 'razao_social' | 'nome_fantasia'> & {
    empresas: { razao_social: string | null; nome_fantasia: string | null } | null
  }
  const a = data as unknown as Raw
  return { ...a, razao_social: a.empresas?.razao_social ?? null, nome_fantasia: a.empresas?.nome_fantasia ?? null }
}

export async function buscarDocs(analiseId: string): Promise<Tables<'analise_docs'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('analise_docs')
    .select('*')
    .eq('analise_id', analiseId)
    .order('enviado_em', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarScore(cnpj: string): Promise<Tables<'empresa_scores'> | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('empresa_scores')
    .select('*')
    .eq('cnpj', cnpj)
    .order('calculado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function buscarScorecards(): Promise<Tables<'scorecard_versoes'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('scorecard_versoes')
    .select('*')
    .order('versao', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarCreditoConfig(): Promise<Record<string, unknown>> {
  const supabase = createClient()
  const { data, error } = await supabase.from('credito_config').select('chave, valor')
  if (error) throw new Error(error.message)
  return Object.fromEntries((data ?? []).map((c) => [c.chave, c.valor]))
}

export async function buscarVersaoCredito(): Promise<Tables<'credito_versoes'> | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('credito_versoes')
    .select('*')
    .eq('ativa', true)
    .order('calibrado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export interface PainelCredito {
  sacados: number
  com_score: number
  dados_insuficientes: number
  com_limite: number
  valor_esperado_total: number
  por_faixa: Record<string, { qtd: number; valor_esperado: number }>
}

/**
 * O painel lê `empresas` diretamente, e não o Explorador: o recorte é de SACADOS
 * (construtora/incorporadora) que já viraram empresa, que é exatamente a população que
 * o scorecard pontua. Passar pelo universo traria 740 mil linhas para contar 8 mil.
 */
export async function buscarPainelCredito(): Promise<PainelCredito> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('empresas')
    .select('score_faixa, limite_potencial, valor_esperado_mensal')
    .in('tipo', ['construtora', 'incorporadora'])
    .limit(20_000)
  if (error) throw new Error(error.message)

  const p: PainelCredito = {
    sacados: 0,
    com_score: 0,
    dados_insuficientes: 0,
    com_limite: 0,
    valor_esperado_total: 0,
    por_faixa: {},
  }

  for (const e of data ?? []) {
    p.sacados++
    const faixa = e.score_faixa ?? 'sem_score'
    if (faixa === 'dados_insuficientes') p.dados_insuficientes++
    else if (e.score_faixa) p.com_score++
    if (e.limite_potencial !== null) p.com_limite++

    const ve = Number(e.valor_esperado_mensal ?? 0)
    p.valor_esperado_total += ve
    const atual = p.por_faixa[faixa] ?? { qtd: 0, valor_esperado: 0 }
    atual.qtd++
    atual.valor_esperado += ve
    p.por_faixa[faixa] = atual
  }

  return p
}
