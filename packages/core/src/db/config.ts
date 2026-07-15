import { z } from 'zod'
import { parseOuFalhar, traduzirErro } from './shared.js'
import type { Supabase } from '../registry/types.js'
import type { Json, Tables } from '../types/database.js'

/**
 * App-wide configuration (migration 0016).
 *
 * This exists because the Pirâmide needs a promotion threshold and there was
 * nowhere durable and *authorized* to keep it. The first attempt event-sourced it
 * out of audit_log, which is durable but not authorized: audit_log's insert
 * policy lets any active user append a row, so the read had to re-derive "was
 * the author an admin?" in application code. That is a permission check
 * reimplemented outside the database — precisely what RLS is for.
 *
 * app_config is admin-write, everyone-read, enforced by policy.
 */

export const CONFIG_CHAVES = {
  /** Camada at or above which a universe row is auto-promoted into `empresas`. */
  MERCADO_PROMOCAO_CAMADA: 'mercado.promocao_camada',
} as const

/** 'manual' disables auto-promotion: only a human promotes. */
export const promocaoCamadaSchema = z.enum(['tam', 'sam', 'som', 'manual'])
export type PromocaoCamada = z.infer<typeof promocaoCamadaSchema>

export const PROMOCAO_CAMADA_LABELS: Record<PromocaoCamada, string> = {
  tam: 'TAM ou acima',
  sam: 'SAM ou acima',
  som: 'Apenas SOM',
  manual: 'Somente manual',
}

export const definirConfigSchema = z.object({
  chave: z.string().min(1).max(120),
  valor: z.unknown(),
})
export type DefinirConfigInput = z.infer<typeof definirConfigSchema>

export async function definirConfig(
  supabase: Supabase,
  input: DefinirConfigInput | unknown,
): Promise<Tables<'app_config'>> {
  const dados = parseOuFalhar(definirConfigSchema, input)
  const { data, error } = await supabase.rpc('app_definir_config', {
    p: dados as unknown as Json,
  })
  if (error) throw traduzirErro(error)
  return data
}

export async function lerConfig<T>(
  supabase: Supabase,
  chave: string,
  padrao: T,
): Promise<T> {
  const { data, error } = await supabase
    .from('app_config')
    .select('valor')
    .eq('chave', chave)
    .maybeSingle()

  // A missing row is not an error — it means "never configured", which is what
  // the default is for. A real error (network, RLS) also falls back rather than
  // exploding a page over a setting.
  if (error || !data) return padrao
  return data.valor as T
}

/** The promotion threshold, with the seeded default as the fallback. */
export async function lerCamadaPromocao(supabase: Supabase): Promise<PromocaoCamada> {
  const valor = await lerConfig<string>(supabase, CONFIG_CHAVES.MERCADO_PROMOCAO_CAMADA, 'sam')
  const r = promocaoCamadaSchema.safeParse(valor)
  return r.success ? r.data : 'sam'
}
