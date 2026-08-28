import type { Tables, Views } from '@jobsiteos/core'
import { supabase } from '@/lib/supabase'

/** Leituras do Jurídico no celular. Todas sob RLS — o app nunca vê service role. */

export const juridicoKeys = {
  all: ['juridico'] as const,
  carteira: () => [...juridicoKeys.all, 'carteira'] as const,
  processo: (cnj: string) => [...juridicoKeys.all, 'processo', cnj] as const,
  movimentacoes: (cnj: string) => [...juridicoKeys.all, 'movimentacoes', cnj] as const,
  fases: (cnj: string) => [...juridicoKeys.all, 'fases', cnj] as const,
  prazos: (cnj: string) => [...juridicoKeys.all, 'prazos', cnj] as const,
  parecer: (cnj: string) => [...juridicoKeys.all, 'parecer', cnj] as const,
  custos: (cnj: string) => [...juridicoKeys.all, 'custos', cnj] as const,
  config: () => [...juridicoKeys.all, 'config'] as const,
  agenda: () => [...juridicoKeys.all, 'agenda'] as const,
}

export type LinhaCarteira = Views<'juridico_carteira'>

export async function buscarCarteira(): Promise<LinhaCarteira[]> {
  const { data, error } = await supabase
    .from('juridico_carteira')
    .select('*')
    .order('valor_atualizado', { ascending: false, nullsFirst: false })
    .order('valor_causa', { ascending: false, nullsFirst: false })
    .limit(500)
  if (error) throw new Error(error.message)
  return (data ?? []) as LinhaCarteira[]
}

export async function buscarProcesso(numeroCnj: string): Promise<LinhaCarteira | null> {
  const { data, error } = await supabase
    .from('juridico_carteira')
    .select('*')
    .eq('numero_cnj', numeroCnj)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as LinhaCarteira | null) ?? null
}

/**
 * A timeline no celular vem CURTA — 60 andamentos.
 *
 * Não é limitação de tela: é de rede. Um processo de dez anos tem milhares de
 * movimentações, e puxar tudo numa conexão de canteiro de obra é uma tela que nunca
 * carrega. Quem precisa da série inteira abre na web.
 */
export async function buscarMovimentacoes(numeroCnj: string): Promise<Tables<'processo_movimentacoes'>[]> {
  const { data, error } = await supabase
    .from('processo_movimentacoes')
    .select('*')
    .eq('numero_cnj', numeroCnj)
    .order('data', { ascending: false })
    .limit(60)
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Só as classificadas, em ordem crescente: insumo do cronograma. */
export async function buscarFases(numeroCnj: string): Promise<{ data: string; fase_detectada: string | null }[]> {
  const { data, error } = await supabase
    .from('processo_movimentacoes')
    .select('data, fase_detectada')
    .eq('numero_cnj', numeroCnj)
    .not('fase_detectada', 'is', null)
    .order('data')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarPrazos(numeroCnj: string): Promise<Tables<'processo_prazos'>[]> {
  const { data, error } = await supabase
    .from('processo_prazos')
    .select('*')
    .eq('numero_cnj', numeroCnj)
    .order('data')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarParecer(numeroCnj: string): Promise<Tables<'processo_pareceres'> | null> {
  const { data, error } = await supabase
    .from('processo_pareceres')
    .select('*')
    .eq('numero_cnj', numeroCnj)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function buscarCustos(numeroCnj: string): Promise<Tables<'processo_custos'>[]> {
  const { data, error } = await supabase
    .from('processo_custos')
    .select('*')
    .eq('numero_cnj', numeroCnj)
    .order('data', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarConfig(): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.from('juridico_config').select('chave, valor')
  if (error) throw new Error(error.message)
  return Object.fromEntries((data ?? []).map((c) => [c.chave, c.valor]))
}

export type EventoAgenda = Views<'juridico_agenda'>

export async function buscarAgenda(): Promise<EventoAgenda[]> {
  const { data, error } = await supabase
    .from('juridico_agenda')
    .select('*')
    .eq('concluido', false)
    .gte('inicio_em', new Date(Date.now() - 7 * 86_400_000).toISOString())
    .order('inicio_em')
    .limit(100)
  if (error) throw new Error(error.message)
  return (data ?? []) as EventoAgenda[]
}

/**
 * Registrar custo COM foto do comprovante (08 §8).
 *
 * A foto sobe para o bucket privado antes do RPC, e o caminho começa pelo CNJ — é a
 * âncora que a checagem do RPC exige. Escrever direto na tabela não é possível: não
 * há grant de INSERT, e é assim que o `audit_log` nunca fica sem a linha.
 */
export async function registrarCustoComFoto(input: {
  numeroCnj: string
  tipo: string
  valor: number
  data: string
  descricao: string | null
  fotoUri: string | null
}): Promise<void> {
  let caminho: string | null = null

  if (input.fotoUri) {
    const resposta = await fetch(input.fotoUri)
    const bytes = await resposta.arrayBuffer()
    caminho = `${input.numeroCnj}/comprovante-${Date.now()}.jpg`
    const { error } = await supabase.storage
      .from('juridico-comprovantes')
      .upload(caminho, bytes, { contentType: 'image/jpeg', upsert: false })
    if (error) throw new Error(error.message)
  }

  const { error } = await supabase.rpc('app_juridico_registrar_custo' as never, {
    p: {
      numero_cnj: input.numeroCnj,
      tipo: input.tipo,
      valor: input.valor,
      data: input.data,
      descricao: input.descricao,
      comprovante_url: caminho,
    },
  } as never)
  if (error) throw new Error(error.message)
}

export async function concluirPrazo(id: string): Promise<void> {
  const { error } = await supabase.rpc('app_juridico_concluir_prazo' as never, {
    p: { id, concluido: true },
  } as never)
  if (error) throw new Error(error.message)
}
