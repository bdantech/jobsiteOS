import {
  ativarScorecardSchema,
  moverAnaliseSchema,
  registrarDocSchema,
  salvarCreditoConfigSchema,
  salvarScorecardSchema,
  solicitarAnaliseSchema,
  type AtivarScorecardInput,
  type MoverAnaliseInput,
  type RegistrarDocInput,
  type SalvarCreditoConfigInput,
  type SalvarScorecardInput,
  type SolicitarAnaliseInput,
} from './schemas.js'
import { parseOuFalhar, traduzirErro } from '../db/shared.js'

import type { Supabase } from '../registry/types.js'
import type { Json, Tables } from '../types/database.js'

/**
 * Escritas do módulo Crédito, todas por RPC SECURITY DEFINER (migração 0073).
 *
 * Nenhuma delas escreve decisão de seguradora: aprovar, negar e expirar são do worker,
 * com service role. Um atalho de tela para "aprovada" produziria um limite que a apólice
 * não conhece — e é o tipo de número que ninguém questiona porque está na tela.
 */

export async function solicitarAnalise(
  supabase: Supabase,
  input: SolicitarAnaliseInput | unknown,
): Promise<Tables<'analises_credito'>> {
  const dados = parseOuFalhar(solicitarAnaliseSchema, input)
  const { data, error } = await supabase.rpc('app_solicitar_analise', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data as Tables<'analises_credito'>
}

export async function moverAnalise(
  supabase: Supabase,
  input: MoverAnaliseInput | unknown,
): Promise<Tables<'analises_credito'>> {
  const dados = parseOuFalhar(moverAnaliseSchema, input)
  const { data, error } = await supabase.rpc('app_mover_analise', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data as Tables<'analises_credito'>
}

export async function registrarDocAnalise(
  supabase: Supabase,
  input: RegistrarDocInput | unknown,
): Promise<Tables<'analise_docs'>> {
  const dados = parseOuFalhar(registrarDocSchema, input)
  const { data, error } = await supabase.rpc('app_registrar_doc_analise', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data as Tables<'analise_docs'>
}

export async function salvarScorecardVersao(
  supabase: Supabase,
  input: SalvarScorecardInput | unknown,
): Promise<Tables<'scorecard_versoes'>> {
  const dados = parseOuFalhar(salvarScorecardSchema, input)
  const { data, error } = await supabase.rpc('app_salvar_scorecard_versao', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data as Tables<'scorecard_versoes'>
}

export async function ativarScorecardVersao(
  supabase: Supabase,
  input: AtivarScorecardInput | unknown,
): Promise<Tables<'scorecard_versoes'>> {
  const dados = parseOuFalhar(ativarScorecardSchema, input)
  const { data, error } = await supabase.rpc('app_ativar_scorecard_versao', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data as Tables<'scorecard_versoes'>
}

export async function salvarCreditoConfig(
  supabase: Supabase,
  input: SalvarCreditoConfigInput | unknown,
): Promise<Tables<'credito_config'>> {
  const dados = parseOuFalhar(salvarCreditoConfigSchema, input)
  const { data, error } = await supabase.rpc('app_salvar_credito_config', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data as Tables<'credito_config'>
}
