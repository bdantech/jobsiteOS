import { z } from 'zod'
import type { Json } from '../types/database.js'
import type { Supabase } from '../registry/types.js'
import { EVENTOS_WEBHOOK } from './api.js'

/**
 * As escritas das Integrações (04n §4). Por RPC, como o resto do módulo: as
 * tabelas não têm policy de insert/update, então nem o client do admin escreve
 * direto nelas.
 *
 * A CHAVE não passa por aqui: o Node gera o segredo, deriva o hash e manda só o
 * hash e o prefixo. O banco nunca vê o valor em claro — o que é a diferença entre
 * "não mostramos de novo" e "não temos como mostrar".
 */

export const criarApiKeySchema = z.object({
  nome: z.string().trim().min(2).max(120),
  escopos: z.array(z.string().trim().min(1)).min(1).default(['credito:write', 'credito:read']),
})
export type CriarApiKeyInput = z.infer<typeof criarApiKeySchema>

export const salvarWebhookSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  nome: z.string().trim().min(2).max(120),
  url: z.string().url().startsWith('https://', 'A URL precisa ser https.'),
  /** Vazio mantém o secret atual: rotacionar é ação deliberada. */
  secret: z.string().trim().min(16).max(200).nullable().optional(),
  eventos: z.array(z.enum(EVENTOS_WEBHOOK)).min(1),
  ativo: z.boolean().default(true),
})
export type SalvarWebhookInput = z.infer<typeof salvarWebhookSchema>

export async function criarApiKey(
  supabase: Supabase,
  dados: { nome: string; escopos: string[]; key_hash: string; prefixo: string },
) {
  const { data, error } = await supabase.rpc('app_criar_api_key', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

export async function revogarApiKey(supabase: Supabase, id: string) {
  const { data, error } = await supabase.rpc('app_revogar_api_key', { p: { id } as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

export async function salvarWebhook(supabase: Supabase, input: unknown) {
  const dados = salvarWebhookSchema.parse(input)
  const { data, error } = await supabase.rpc('app_salvar_webhook', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

export async function reenviarEntrega(supabase: Supabase, id: string) {
  const { data, error } = await supabase.rpc('app_reenviar_entrega', { p: { id } as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

export async function enviarWebhookTeste(supabase: Supabase, webhookId: string) {
  const { data, error } = await supabase.rpc('app_webhook_teste', {
    p: { webhook_id: webhookId } as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data
}
