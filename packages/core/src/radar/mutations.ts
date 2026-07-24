import type { Supabase } from '../registry/types.js'
import { parseOuFalhar, traduzirErro } from '../db/shared.js'
import type { Json, Tables } from '../types/database.js'
import { normalizarValorSupressao } from './supressao.js'
import {
  aprovarLoteSchema,
  cancelarLoteSchema,
  criarLoteSchema,
  removerSupressaoSchema,
  salvarRadarConfigSchema,
  suprimirSchema,
  type AprovarLoteInput,
  type CancelarLoteInput,
  type CriarLoteInput,
  type RemoverSupressaoInput,
  type SalvarRadarConfigInput,
  type SuprimirInput,
} from './schemas.js'

/**
 * Write helpers do Radar. Mesmo contrato do resto do core: zod valida, o RPC
 * SECURITY INVOKER (migration 0029) faz escrita + audit_log em UMA transação, e o
 * client passado DEVE ser o do usuário (a RLS decide o que a escrita pode tocar).
 * As escritas de máquina (enriquecimentos, lote_itens, protestos, clientes) são do
 * worker via service role e não passam por aqui.
 */

export async function criarLote(
  supabase: Supabase,
  input: CriarLoteInput | unknown,
): Promise<Tables<'lotes_enriquecimento'>> {
  const dados = parseOuFalhar(criarLoteSchema, input)
  const { data, error } = await supabase.rpc('app_criar_lote', { p: dados as unknown as Json })
  if (error) throw traduzirErro(error)
  return data
}

export async function aprovarLote(
  supabase: Supabase,
  input: AprovarLoteInput | unknown,
): Promise<Tables<'lotes_enriquecimento'>> {
  const dados = parseOuFalhar(aprovarLoteSchema, input)
  const { data, error } = await supabase.rpc('app_aprovar_lote', { p: dados as unknown as Json })
  if (error) throw traduzirErro(error)
  return data
}

export async function cancelarLote(
  supabase: Supabase,
  input: CancelarLoteInput | unknown,
): Promise<Tables<'lotes_enriquecimento'>> {
  const dados = parseOuFalhar(cancelarLoteSchema, input)
  const { data, error } = await supabase.rpc('app_cancelar_lote', { p: dados as unknown as Json })
  if (error) throw traduzirErro(error)
  return data
}

export async function suprimir(
  supabase: Supabase,
  input: SuprimirInput | unknown,
): Promise<Tables<'supressao'>> {
  const dados = parseOuFalhar(suprimirSchema, input)
  // Normaliza o valor com a MESMA função de estaSuprimido, senão o guard não casa.
  const p = { ...dados, valor: normalizarValorSupressao(dados.escopo, dados.valor) }
  const { data, error } = await supabase.rpc('app_suprimir', { p: p as unknown as Json })
  if (error) throw traduzirErro(error)
  return data
}

export async function removerSupressao(
  supabase: Supabase,
  input: RemoverSupressaoInput | unknown,
): Promise<void> {
  const dados = parseOuFalhar(removerSupressaoSchema, input)
  const { error } = await supabase.rpc('app_remover_supressao', { p: dados as unknown as Json })
  if (error) throw traduzirErro(error)
}

export async function salvarRadarConfig(
  supabase: Supabase,
  input: SalvarRadarConfigInput | unknown,
): Promise<Tables<'radar_config'>> {
  const dados = parseOuFalhar(salvarRadarConfigSchema, input)
  const { data, error } = await supabase.rpc('app_salvar_radar_config', { p: dados as unknown as Json })
  if (error) throw traduzirErro(error)
  return data
}
