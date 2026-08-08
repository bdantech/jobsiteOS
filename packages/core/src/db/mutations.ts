import {
  atualizarEmpresaSchema,
  criarEmpresaSchema,
  criarNotaSchema,
  declararMetricaSchema,
  registrarMetricaImportadaSchema,
  type AtualizarEmpresaInput,
  type CriarEmpresaInput,
  type CriarNotaInput,
  type DeclararMetricaInput,
  type RegistrarMetricaImportadaInput,
} from '../schemas/index.js'
import { parseOuFalhar, traduzirErro } from './shared.js'

import type { Supabase } from '../registry/types.js'
import type { Json, Tables } from '../types/database.js'

/**
 * The write helper the spec mandates: validate (zod) → write → emit event →
 * audit, in ONE transaction.
 *
 * The transaction lives in Postgres (migration 0008), because three sequential
 * supabase-js inserts are three transactions and cannot be rolled back as one.
 * This layer owns validation and error translation; the database owns atomicity.
 */

// Each call names its RPC literally rather than going through a generic wrapper:
// supabase-js infers the function signature from the literal, and a generic
// `fn: T extends WriteRpc` defeats that inference entirely.
//
// All three take the user-scoped client. They are SECURITY INVOKER, so handing
// them a service-role client would silently disable every RLS check.

export async function criarEmpresa(
  supabase: Supabase,
  input: CriarEmpresaInput | unknown,
): Promise<Tables<'empresas'>> {
  const dados = parseOuFalhar(criarEmpresaSchema, input)
  const { data, error } = await supabase.rpc('app_criar_empresa', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data
}

export async function atualizarEmpresa(
  supabase: Supabase,
  input: AtualizarEmpresaInput | unknown,
): Promise<Tables<'empresas'>> {
  const dados = parseOuFalhar(atualizarEmpresaSchema, input)
  const { data, error } = await supabase.rpc('app_atualizar_empresa', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data
}

export async function criarNota(
  supabase: Supabase,
  input: CriarNotaInput | unknown,
): Promise<Tables<'empresa_notas'>> {
  const dados = parseOuFalhar(criarNotaSchema, input)
  const { data, error } = await supabase.rpc('app_criar_nota', { p: dados as Json })
  if (error) throw traduzirErro(error)
  return data
}

// Re-exported so existing imports from '@jobsiteos/core' keep working.
export { MutationError, type FieldErrors } from './shared.js'

/**
 * Declara faturamento ou headcount informado pelo cliente (04c §5).
 *
 * O RPC (0069) grava snapshot + cache + evento + audit numa transação, e `empresa_metricas`
 * NÃO tem grant de insert para `authenticated` — este é o único caminho de escrita humana.
 * "Gravar métrica sem passar pela hierarquia de origem" fica inexprimível.
 */
export async function declararMetrica(
  supabase: Supabase,
  input: DeclararMetricaInput | unknown,
): Promise<Tables<'empresa_metricas'>> {
  const dados = parseOuFalhar(declararMetricaSchema, input)
  const { data, error } = await supabase.rpc('app_declarar_metrica', { p: dados as unknown as Json })
  if (error) throw traduzirErro(error)
  return data
}

/**
 * Registra faturamento, headcount ou patrimônio líquido vindos de uma LISTA (0081).
 *
 * Mesmo desenho do irmão acima e pelo mesmo motivo — só que datado pelo ANO DO DADO,
 * não pela data do upload: é isso que faz "Receita 2023" e "Receita 2024" virarem dois
 * pontos reais da série em vez de dois snapshots de hoje que o cálculo de variação
 * leria como um só.
 */
export async function registrarMetricaImportada(
  supabase: Supabase,
  input: RegistrarMetricaImportadaInput | unknown,
): Promise<Tables<'empresa_metricas'>> {
  const dados = parseOuFalhar(registrarMetricaImportadaSchema, input)
  const { data, error } = await supabase.rpc('app_registrar_metrica_importada', {
    p: dados as unknown as Json,
  })
  if (error) throw traduzirErro(error)
  return data
}
