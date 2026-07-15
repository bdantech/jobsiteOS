import type { Supabase } from '../registry/types.js'
import { parseOuFalhar, traduzirErro } from '../db/shared.js'
import type { Json, Tables } from '../types/database.js'
import {
  ativarCamadaRegraSchema,
  criarSegmentoSchema,
  promoverEmpresaSchema,
  salvarCamadaRegraSchema,
  type AtivarCamadaRegraInput,
  type CriarSegmentoInput,
  type PromoverEmpresaInput,
  type SalvarCamadaRegraInput,
} from './schemas.js'

/**
 * Mercado's write helpers. Same contract as db/mutations.ts: zod validates, the
 * SECURITY INVOKER RPC (migration 0013) does entity + event + audit in ONE
 * transaction, and the client passed in MUST be the user-scoped one.
 */

export async function promoverEmpresa(
  supabase: Supabase,
  input: PromoverEmpresaInput | unknown,
): Promise<Tables<'empresas'>> {
  const dados = parseOuFalhar(promoverEmpresaSchema, input)
  const { data, error } = await supabase.rpc('app_promover_empresa', { p: dados as unknown as Json })
  if (error) throw traduzirErro(error)
  return data
}

export async function criarSegmento(
  supabase: Supabase,
  input: CriarSegmentoInput | unknown,
): Promise<Tables<'segmentos'>> {
  const dados = parseOuFalhar(criarSegmentoSchema, input)
  const { data, error } = await supabase.rpc('app_criar_segmento', { p: dados as unknown as Json })
  if (error) throw traduzirErro(error)
  return data
}

export async function salvarCamadaRegra(
  supabase: Supabase,
  input: SalvarCamadaRegraInput | unknown,
): Promise<Tables<'camada_regras'>> {
  const dados = parseOuFalhar(salvarCamadaRegraSchema, input)
  const { data, error } = await supabase.rpc('app_salvar_camada_regra', { p: dados as unknown as Json })
  if (error) throw traduzirErro(error)
  return data
}

export async function ativarCamadaRegra(
  supabase: Supabase,
  input: AtivarCamadaRegraInput | unknown,
): Promise<Tables<'camada_regras'>> {
  const dados = parseOuFalhar(ativarCamadaRegraSchema, input)
  const { data, error } = await supabase.rpc('app_ativar_camada_regra', { p: dados as unknown as Json })
  if (error) throw traduzirErro(error)
  return data
}

