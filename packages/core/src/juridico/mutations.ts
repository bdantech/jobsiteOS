import { parseOuFalhar, traduzirErro } from '../db/shared.js'
import {
  atualizarProcessoSchema,
  concluirPrazoSchema,
  editarParecerJuridicoSchema,
  registrarCustoSchema,
  registrarRecuperacaoSchema,
  removerOperacaoSchema,
  salvarAdvogadoSchema,
  salvarIndicesSchema,
  salvarJuridicoConfigSchema,
  salvarOperacaoSchema,
  salvarPrazoSchema,
  type AtualizarProcessoInput,
  type ConcluirPrazoInput,
  type EditarParecerJuridicoInput,
  type RegistrarCustoInput,
  type RegistrarRecuperacaoInput,
  type RemoverOperacaoInput,
  type SalvarAdvogadoInput,
  type SalvarIndicesInput,
  type SalvarJuridicoConfigInput,
  type SalvarOperacaoInput,
  type SalvarPrazoInput,
} from './schemas.js'
import type { Supabase } from '../registry/types.js'
import type { Json, Tables } from '../types/database.js'

/**
 * Escritas do módulo Jurídico, todas por RPC SECURITY DEFINER (migração 0143).
 *
 * NENHUMA delas escreve capa, movimentação ou envolvido: esses vêm do Escavador, com
 * service role, no worker. Um atalho de tela para "corrigir a data da citação" produziria
 * um cronograma que a próxima sincronização desfaz em silêncio — e o cronograma é o que
 * dispara alerta de lentidão e notificação ao advogado.
 *
 * O que é escrito daqui é o que é NOSSO: gestão do processo, operações cobradas, custos,
 * recuperações, prazos e o parecer editado.
 */

export async function salvarAdvogado(
  supabase: Supabase,
  input: SalvarAdvogadoInput | unknown,
): Promise<Tables<'advogados'>> {
  const dados = parseOuFalhar(salvarAdvogadoSchema, input)
  const { data, error } = await supabase.rpc('app_juridico_salvar_advogado', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data as Tables<'advogados'>
}

export async function atualizarProcesso(
  supabase: Supabase,
  input: AtualizarProcessoInput | unknown,
): Promise<Tables<'processos'>> {
  const dados = parseOuFalhar(atualizarProcessoSchema, input)
  const { data, error } = await supabase.rpc('app_juridico_atualizar_processo', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data as Tables<'processos'>
}

export async function salvarOperacao(
  supabase: Supabase,
  input: SalvarOperacaoInput | unknown,
): Promise<Tables<'processo_operacoes'>> {
  const dados = parseOuFalhar(salvarOperacaoSchema, input)
  const { data, error } = await supabase.rpc('app_juridico_salvar_operacao', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data as Tables<'processo_operacoes'>
}

export async function removerOperacao(
  supabase: Supabase,
  input: RemoverOperacaoInput | unknown,
): Promise<{ ok: true }> {
  const dados = parseOuFalhar(removerOperacaoSchema, input)
  const { error } = await supabase.rpc('app_juridico_remover_operacao', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return { ok: true }
}

export async function registrarCusto(
  supabase: Supabase,
  input: RegistrarCustoInput | unknown,
): Promise<Tables<'processo_custos'>> {
  const dados = parseOuFalhar(registrarCustoSchema, input)
  const { data, error } = await supabase.rpc('app_juridico_registrar_custo', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data as Tables<'processo_custos'>
}

export async function registrarRecuperacao(
  supabase: Supabase,
  input: RegistrarRecuperacaoInput | unknown,
): Promise<Tables<'processo_recuperacoes'>> {
  const dados = parseOuFalhar(registrarRecuperacaoSchema, input)
  const { data, error } = await supabase.rpc('app_juridico_registrar_recuperacao', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data as Tables<'processo_recuperacoes'>
}

export async function salvarPrazo(
  supabase: Supabase,
  input: SalvarPrazoInput | unknown,
): Promise<Tables<'processo_prazos'>> {
  const dados = parseOuFalhar(salvarPrazoSchema, input)
  const { data, error } = await supabase.rpc('app_juridico_salvar_prazo', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data as Tables<'processo_prazos'>
}

export async function concluirPrazo(
  supabase: Supabase,
  input: ConcluirPrazoInput | unknown,
): Promise<Tables<'processo_prazos'>> {
  const dados = parseOuFalhar(concluirPrazoSchema, input)
  const { data, error } = await supabase.rpc('app_juridico_concluir_prazo', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data as Tables<'processo_prazos'>
}

/**
 * Editar o parecer grava uma LINHA NOVA em `processo_pareceres`, nunca um update.
 *
 * O parecer é versionado porque ele registra o que se sabia e o que se recomendou numa
 * data — e essa recomendação é usada para decidir se vale continuar gastando com a ação.
 * Sobrescrever apagaria a versão que sustentou a decisão anterior, que é justamente a
 * que alguém vai querer reler quando a decisão for questionada.
 */
export async function editarParecerJuridico(
  supabase: Supabase,
  input: EditarParecerJuridicoInput | unknown,
): Promise<Tables<'processo_pareceres'>> {
  const dados = parseOuFalhar(editarParecerJuridicoSchema, input)
  const { data, error } = await supabase.rpc('app_juridico_editar_parecer', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data as Tables<'processo_pareceres'>
}

export async function salvarJuridicoConfig(
  supabase: Supabase,
  input: SalvarJuridicoConfigInput | unknown,
): Promise<Tables<'juridico_config'>> {
  const dados = parseOuFalhar(salvarJuridicoConfigSchema, input)
  const { data, error } = await supabase.rpc('app_juridico_definir_config', {
    p: dados as unknown as Json,
  })
  if (error) throw traduzirErro(error)
  return data as Tables<'juridico_config'>
}

export async function salvarIndices(
  supabase: Supabase,
  input: SalvarIndicesInput | unknown,
): Promise<{ gravadas: number }> {
  const dados = parseOuFalhar(salvarIndicesSchema, input)
  const { data, error } = await supabase.rpc('app_juridico_salvar_indices', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return (data as { gravadas: number }) ?? { gravadas: 0 }
}
