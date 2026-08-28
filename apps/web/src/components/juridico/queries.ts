import type { Tables, Views } from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'

/** Chaves de cache do módulo Jurídico. Mesma convenção do Crédito e do Radar. */
export const juridicoKeys = {
  all: ['juridico'] as const,
  carteira: () => [...juridicoKeys.all, 'carteira'] as const,
  processo: (cnj: string) => [...juridicoKeys.all, 'processo', cnj] as const,
  movimentacoes: (cnj: string) => [...juridicoKeys.all, 'movimentacoes', cnj] as const,
  envolvidos: (cnj: string) => [...juridicoKeys.all, 'envolvidos', cnj] as const,
  operacoes: (cnj: string) => [...juridicoKeys.all, 'operacoes', cnj] as const,
  calculos: (cnj: string) => [...juridicoKeys.all, 'calculos', cnj] as const,
  custos: (cnj: string) => [...juridicoKeys.all, 'custos', cnj] as const,
  recuperacoes: (cnj: string) => [...juridicoKeys.all, 'recuperacoes', cnj] as const,
  prazos: (cnj: string) => [...juridicoKeys.all, 'prazos', cnj] as const,
  pareceres: (cnj: string) => [...juridicoKeys.all, 'pareceres', cnj] as const,
  advogados: () => [...juridicoKeys.all, 'advogados'] as const,
  config: () => [...juridicoKeys.all, 'config'] as const,
  indices: (indice: string) => [...juridicoKeys.all, 'indices', indice] as const,
  syncLog: () => [...juridicoKeys.all, 'sync-log'] as const,
  daEmpresa: (empresaId: string) => [...juridicoKeys.all, 'empresa', empresaId] as const,
  agenda: () => [...juridicoKeys.all, 'agenda'] as const,
}

export type LinhaCarteira = Views<'juridico_carteira'>

/**
 * A carteira inteira numa consulta. Cabe: uma casa com trezentos processos é uma casa
 * com muito litígio, e o teto existe para a tela não morrer calada se um backfill
 * trouxer o histórico de dez anos de uma vez.
 */
export const LIMITE_CARTEIRA = 2000

export async function buscarCarteira(): Promise<LinhaCarteira[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('juridico_carteira')
    .select('*')
    // Sem movimentação há mais tempo primeiro dentro da mesma situação seria melhor
    // ainda, mas a ordenação primária é o valor: a lista do jurídico é uma lista de
    // decisão, e a decisão que mais paga é a que não pode esperar.
    .order('valor_atualizado', { ascending: false, nullsFirst: false })
    .order('valor_causa', { ascending: false, nullsFirst: false })
    .limit(LIMITE_CARTEIRA)
  if (error) throw new Error(error.message)
  return (data ?? []) as LinhaCarteira[]
}

export async function buscarProcesso(numeroCnj: string): Promise<LinhaCarteira | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('juridico_carteira')
    .select('*')
    .eq('numero_cnj', numeroCnj)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as LinhaCarteira | null) ?? null
}

/** A capa crua, para as observações e o `raw` que a carteira não carrega. */
export async function buscarProcessoBruto(numeroCnj: string): Promise<Tables<'processos'> | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('processos')
    .select('*')
    .eq('numero_cnj', numeroCnj)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export type Movimentacao = Tables<'processo_movimentacoes'>

/**
 * A timeline. Teto de 500 e ordem decrescente: um processo de dez anos tem milhares
 * de andamentos, e o que se lê são os últimos. As relevantes ficam destacadas na
 * tela — e o cronograma, que precisa da série inteira, é calculado no worker.
 */
export async function buscarMovimentacoes(numeroCnj: string): Promise<Movimentacao[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('processo_movimentacoes')
    .select('*')
    .eq('numero_cnj', numeroCnj)
    .order('data', { ascending: false })
    .limit(500)
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Só as classificadas, em ordem crescente: é o insumo do cronograma na tela. */
export async function buscarFasesDetectadas(
  numeroCnj: string,
): Promise<{ data: string; fase_detectada: string | null }[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('processo_movimentacoes')
    .select('data, fase_detectada')
    .eq('numero_cnj', numeroCnj)
    .not('fase_detectada', 'is', null)
    .order('data')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarEnvolvidos(numeroCnj: string): Promise<Tables<'processo_envolvidos'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('processo_envolvidos')
    .select('*')
    .eq('numero_cnj', numeroCnj)
    .order('polo')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarOperacoes(numeroCnj: string): Promise<Tables<'processo_operacoes'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('processo_operacoes')
    .select('*')
    .eq('numero_cnj', numeroCnj)
    .order('vencimento')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarCalculos(numeroCnj: string): Promise<Tables<'processo_calculos'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('processo_calculos')
    .select('*')
    .eq('numero_cnj', numeroCnj)
    .order('criado_em', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarCustos(numeroCnj: string): Promise<Tables<'processo_custos'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('processo_custos')
    .select('*')
    .eq('numero_cnj', numeroCnj)
    .order('data', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarRecuperacoes(numeroCnj: string): Promise<Tables<'processo_recuperacoes'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('processo_recuperacoes')
    .select('*')
    .eq('numero_cnj', numeroCnj)
    .order('data', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarPrazos(numeroCnj: string): Promise<Tables<'processo_prazos'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('processo_prazos')
    .select('*')
    .eq('numero_cnj', numeroCnj)
    .order('data')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarPareceres(numeroCnj: string): Promise<Tables<'processo_pareceres'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('processo_pareceres')
    .select('*')
    .eq('numero_cnj', numeroCnj)
    .order('criado_em', { ascending: false })
    .limit(20)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarAdvogados(): Promise<Tables<'advogados'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase.from('advogados').select('*').order('nome')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarJuridicoConfig(): Promise<Record<string, unknown>> {
  const supabase = createClient()
  const { data, error } = await supabase.from('juridico_config').select('chave, valor')
  if (error) throw new Error(error.message)
  return Object.fromEntries((data ?? []).map((c) => [c.chave, c.valor]))
}

export async function buscarIndices(
  indice: string,
): Promise<{ competencia: string; valor: number }[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('juridico_indices')
    .select('competencia, valor')
    .eq('indice', indice)
    .order('competencia', { ascending: false })
    .limit(240)
  if (error) throw new Error(error.message)
  return (data ?? []).map((i) => ({ competencia: i.competencia, valor: Number(i.valor) }))
}

export interface GastoEscavador {
  creditos_30d: number
  chamadas_30d: number
  erros_30d: number
  ultima_execucao: string | null
  por_tipo: { tipo: string; chamadas: number; creditos: number }[]
}

/**
 * O gasto acumulado do Escavador (§3).
 *
 * A janela é de 30 dias porque a pergunta é "quanto este módulo está custando por
 * mês?", e o total desde sempre não responde isso — ele só cresce, e um número que
 * só cresce para de ser lido.
 */
export async function buscarGastoEscavador(): Promise<GastoEscavador> {
  const supabase = createClient()
  const desde = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('juridico_sync_log')
    .select('tipo, creditos_utilizados, status, executado_em')
    .gte('executado_em', desde)
    .order('executado_em', { ascending: false })
    .limit(20_000)
  if (error) throw new Error(error.message)

  const linhas = data ?? []
  const porTipo = new Map<string, { chamadas: number; creditos: number }>()
  for (const l of linhas) {
    const t = porTipo.get(l.tipo) ?? { chamadas: 0, creditos: 0 }
    t.chamadas++
    t.creditos += l.creditos_utilizados ?? 0
    porTipo.set(l.tipo, t)
  }

  return {
    creditos_30d: linhas.reduce((s, l) => s + (l.creditos_utilizados ?? 0), 0),
    chamadas_30d: linhas.length,
    erros_30d: linhas.filter((l) => l.status === 'erro').length,
    ultima_execucao: linhas[0]?.executado_em ?? null,
    por_tipo: [...porTipo.entries()].map(([tipo, v]) => ({ tipo, ...v })),
  }
}

/** Os processos de UMA empresa. É o que a seção Jurídico da Company 360 lê. */
export async function buscarProcessosDaEmpresa(empresaId: string): Promise<LinhaCarteira[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('juridico_carteira')
    .select('*')
    .eq('empresa_devedora_id', empresaId)
    .order('data_distribuicao', { ascending: false, nullsFirst: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as LinhaCarteira[]
}

export type EventoAgendaJuridica = Views<'juridico_agenda'>

/**
 * A agenda jurídica das próximas semanas, para o calendário do 04g.
 *
 * A janela começa 7 dias atrás, igual à do comercial: um prazo de ontem que ninguém
 * marcou como concluído é justamente o que precisa aparecer.
 */
export async function buscarAgendaJuridica(): Promise<EventoAgendaJuridica[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('juridico_agenda')
    .select('*')
    .eq('concluido', false)
    .gte('inicio_em', new Date(Date.now() - 7 * 86_400_000).toISOString())
    .order('inicio_em')
    .limit(300)
  if (error) throw new Error(error.message)
  return (data ?? []) as EventoAgendaJuridica[]
}
