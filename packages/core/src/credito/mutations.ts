import {
  ativarMatrizPrecificacaoSchema,
  ativarScorecardSchema,
  definirExClienteMotivoSchema,
  editarParecerSchema,
  moverAnaliseSchema,
  publicarCondicoesSchema,
  registrarDecisaoCreditoSchema,
  registrarDocSchema,
  revisarExtracaoSchema,
  rodarAnalisePropriaSchema,
  salvarCondicoesSchema,
  salvarCreditoConfigSchema,
  salvarMatrizPrecificacaoSchema,
  salvarParametrosAnaliseSchema,
  salvarScorecardSchema,
  solicitarAnaliseSchema,
  type AtivarMatrizPrecificacaoInput,
  type AtivarScorecardInput,
  type DefinirExClienteMotivoInput,
  type EditarParecerInput,
  type MoverAnaliseInput,
  type PublicarCondicoesInput,
  type RegistrarDecisaoCreditoInput,
  type RegistrarDocInput,
  type RevisarExtracaoInput,
  type RodarAnalisePropriaInput,
  type SalvarCondicoesInput,
  type SalvarCreditoConfigInput,
  type SalvarMatrizPrecificacaoInput,
  type SalvarParametrosAnaliseInput,
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

/**
 * POR QUE o cliente saiu (04h §2). O sync detecta o fato e grava "Motivo
 * desconhecido"; isto é a parte humana — e é a única parte que responde a pergunta
 * que a lista de ex-clientes existe para fazer.
 */
export async function definirExClienteMotivo(
  supabase: Supabase,
  input: DefinirExClienteMotivoInput | unknown,
): Promise<Tables<'empresas'>> {
  const dados = parseOuFalhar(definirExClienteMotivoSchema, input)
  const { data, error } = await supabase.rpc('app_definir_ex_cliente_motivo', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data as Tables<'empresas'>
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

// ─── Análise proprietária (04j) ─────────────────────────────────────────────
//
// Nenhuma destas decide crédito. `rodarAnalisePropria` abre o registro e o worker faz o
// trabalho; `registrarDecisaoCredito` grava a decisão de um humano do perfil Crédito, e
// o RPC recusa a divergência sem motivo escrito.

export async function rodarAnalisePropria(
  supabase: Supabase,
  input: RodarAnalisePropriaInput | unknown,
): Promise<Tables<'analises_proprietarias'>> {
  const dados = parseOuFalhar(rodarAnalisePropriaSchema, input)
  const { data, error } = await supabase.rpc('app_rodar_analise_propria', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data as Tables<'analises_proprietarias'>
}

export async function revisarExtracao(
  supabase: Supabase,
  input: RevisarExtracaoInput | unknown,
): Promise<Tables<'analises_proprietarias'>> {
  const dados = parseOuFalhar(revisarExtracaoSchema, input)
  const { data, error } = await supabase.rpc('app_revisar_extracao', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data as Tables<'analises_proprietarias'>
}

export async function editarParecer(
  supabase: Supabase,
  input: EditarParecerInput | unknown,
): Promise<Tables<'analises_proprietarias'>> {
  const dados = parseOuFalhar(editarParecerSchema, input)
  const { data, error } = await supabase.rpc('app_editar_parecer', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data as Tables<'analises_proprietarias'>
}

export async function registrarDecisaoCredito(
  supabase: Supabase,
  input: RegistrarDecisaoCreditoInput | unknown,
): Promise<Tables<'analises_proprietarias'>> {
  const dados = parseOuFalhar(registrarDecisaoCreditoSchema, input)
  const { data, error } = await supabase.rpc('app_registrar_decisao_credito', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data as Tables<'analises_proprietarias'>
}

export async function salvarParametrosAnalise(
  supabase: Supabase,
  input: SalvarParametrosAnaliseInput | unknown,
): Promise<Tables<'analise_parametros'>> {
  const dados = parseOuFalhar(salvarParametrosAnaliseSchema, input)
  const { data, error } = await supabase.rpc('app_salvar_parametros_analise', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data as Tables<'analise_parametros'>
}

// ─── Condições comerciais e precificação (04o) ──────────────────────────────
//
// Nenhuma delas calcula preço: o motor é `sugerirCondicoes`, no core, e roda antes,
// na tela. Aqui só se grava o que uma pessoa decidiu — e `publicarCondicoes` é a
// única que faz o webhook sair.

/** Rascunho: guarda a sugestão e os ajustes sem publicar nada para a produção. */
export async function salvarCondicoes(
  supabase: Supabase,
  input: SalvarCondicoesInput | unknown,
): Promise<Tables<'condicoes_comerciais'>> {
  const dados = parseOuFalhar(salvarCondicoesSchema, input)
  const { data, error } = await supabase.rpc('app_salvar_condicoes', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data as Tables<'condicoes_comerciais'>
}

/**
 * A publicação (04o §6). Grava a versão, aposenta a anterior e ENFILEIRA o
 * `credito.condicoes_definidas` — o único evento do contrato que vira um POST do
 * outro lado.
 *
 * Com `erro_validacao` preenchido, a linha nasce `falha_validacao` e nada é
 * enfileirado: a tentativa recusada fica registrada, mas não sai daqui.
 */
export async function publicarCondicoes(
  supabase: Supabase,
  input: PublicarCondicoesInput | unknown,
): Promise<Tables<'condicoes_comerciais'>> {
  const dados = parseOuFalhar(publicarCondicoesSchema, input)
  const { data, error } = await supabase.rpc('app_publicar_condicoes', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data as Tables<'condicoes_comerciais'>
}

/** Nova versão da matriz. Nunca update: as condições já publicadas apontam para a sua. */
export async function salvarMatrizPrecificacao(
  supabase: Supabase,
  input: SalvarMatrizPrecificacaoInput | unknown,
): Promise<Tables<'precificacao_matriz'>> {
  const dados = parseOuFalhar(salvarMatrizPrecificacaoSchema, input)
  const { data, error } = await supabase.rpc('app_salvar_matriz_precificacao', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data as Tables<'precificacao_matriz'>
}

export async function ativarMatrizPrecificacao(
  supabase: Supabase,
  input: AtivarMatrizPrecificacaoInput | unknown,
): Promise<Tables<'precificacao_matriz'>> {
  const dados = parseOuFalhar(ativarMatrizPrecificacaoSchema, input)
  const { data, error } = await supabase.rpc('app_ativar_matriz_precificacao', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data as Tables<'precificacao_matriz'>
}
