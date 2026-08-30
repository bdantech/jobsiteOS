import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json, Tables } from '../types/database.js'
import {
  criarCampanhaSchema,
  idCampanhaSchema,
  metricasCampanhaSchema,
  pausarCampanhaSchema,
} from './schemas.js'

type Supabase = SupabaseClient<Database>

/**
 * Toda escrita de campanha passa por RPC. Nenhuma das três tabelas aceita
 * INSERT/UPDATE de `authenticated` — o que torna "aprovar sem simular"
 * inexprimível em vez de desencorajado.
 */

function falhar(mensagem: string): never {
  throw new Error(mensagem)
}

export async function salvarCampanha(
  supabase: Supabase,
  input: unknown,
): Promise<Tables<'campanhas'>> {
  const r = criarCampanhaSchema.safeParse(input)
  if (!r.success) falhar(r.error.issues[0]?.message ?? 'Dados inválidos.')
  const { data, error } = await supabase.rpc('app_salvar_campanha', {
    p: r.data as unknown as Json,
  })
  if (error) falhar(error.message)
  return data as Tables<'campanhas'>
}

export async function aprovarCampanha(
  supabase: Supabase,
  input: unknown,
): Promise<Tables<'campanhas'>> {
  const dados = idCampanhaSchema.parse(input)
  const { data, error } = await supabase.rpc('app_aprovar_campanha', {
    p: dados as unknown as Json,
  })
  if (error) falhar(error.message)
  return data as Tables<'campanhas'>
}

export async function pausarCampanha(
  supabase: Supabase,
  input: unknown,
): Promise<Tables<'campanhas'>> {
  const dados = pausarCampanhaSchema.parse(input)
  const { data, error } = await supabase.rpc('app_pausar_campanha', {
    p: dados as unknown as Json,
  })
  if (error) falhar(error.message)
  return data as Tables<'campanhas'>
}

export async function retomarCampanha(
  supabase: Supabase,
  input: unknown,
): Promise<Tables<'campanhas'>> {
  const dados = idCampanhaSchema.parse(input)
  const { data, error } = await supabase.rpc('app_retomar_campanha', {
    p: dados as unknown as Json,
  })
  if (error) falhar(error.message)
  return data as Tables<'campanhas'>
}

export async function cancelarCampanha(
  supabase: Supabase,
  input: unknown,
): Promise<Tables<'campanhas'>> {
  const dados = pausarCampanhaSchema.parse(input)
  const { data, error } = await supabase.rpc('app_cancelar_campanha', {
    p: dados as unknown as Json,
  })
  if (error) falhar(error.message)
  return data as Tables<'campanhas'>
}

export async function metricasDaCampanha(
  supabase: Supabase,
  input: unknown,
): Promise<Record<string, unknown>> {
  const dados = metricasCampanhaSchema.parse(input)
  const { data, error } = await supabase.rpc('app_campanha_metricas', {
    p: dados as unknown as Json,
  })
  if (error) falhar(error.message)
  return (data ?? {}) as Record<string, unknown>
}
