import type { Json } from '../types/database.js'
import type { Supabase } from '../registry/types.js'
import {
  atribuirNfSchema,
  definirCarteiraSchema,
  definirGestaoSchema,
  moverLeadSchema,
  moverVendaSchema,
  mudarStatusComissaoSchema,
} from './schemas.js'

/**
 * As escritas do Comercial. Todas por RPC, e nenhuma tabela do módulo tem grant de
 * insert/update para `authenticated` — a mesma disciplina do resto do sistema.
 *
 * Aqui não é preciosismo de arquitetura: "agendar reunião" grava lead + card do closer +
 * dois eventos de calendário + evento da empresa. Deixar isso a cargo de quem chama é
 * aceitar meia reunião agendada como estado possível do banco.
 */

export async function definirGestaoOperacao(supabase: Supabase, input: unknown) {
  const dados = definirGestaoSchema.parse(input)
  const { data, error } = await supabase.rpc('app_definir_gestao_operacao', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

export async function definirCarteira(supabase: Supabase, input: unknown) {
  const dados = definirCarteiraSchema.parse(input)
  const { data, error } = await supabase.rpc('app_definir_carteira', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

export async function moverLeadSdr(supabase: Supabase, input: unknown) {
  const dados = moverLeadSchema.parse(input)
  const { data, error } = await supabase.rpc('app_mover_lead_sdr', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

export async function moverVenda(supabase: Supabase, input: unknown) {
  const dados = moverVendaSchema.parse(input)
  const { data, error } = await supabase.rpc('app_mover_venda', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

export async function atribuirNf(supabase: Supabase, input: unknown) {
  const dados = atribuirNfSchema.parse(input)
  const { error } = await supabase.rpc('app_atribuir_nf', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
}

export async function mudarStatusComissao(supabase: Supabase, input: unknown) {
  const dados = mudarStatusComissaoSchema.parse(input)
  const { data, error } = await supabase.rpc('app_mudar_status_comissao', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data as unknown as number
}

export async function gerarTokenIcs(supabase: Supabase, vendedorId?: string) {
  const { data, error } = await supabase.rpc('app_gerar_token_ics', {
    p: { vendedor_id: vendedorId ?? null } as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data as unknown as string
}
