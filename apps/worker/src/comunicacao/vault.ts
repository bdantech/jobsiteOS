import { supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'

/**
 * A leitura de segredo, e o único lugar do worker que faz isso.
 *
 * `vault.decrypted_secrets` não é alcançável por `authenticated`; a RPC
 * `app__segredo_vault` é SECURITY DEFINER com EXECUTE só para `service_role`
 * (migração 0144). O valor NUNCA é logado — nem truncado, nem com máscara: uma
 * máscara num log é uma decisão que alguém revisa uma vez e um `console.log` de
 * depuração desfaz.
 */
export async function lerSegredo(secretId: string | null | undefined): Promise<string | null> {
  if (!secretId) return null
  const { data, error } = await supabaseAdmin.rpc('app__segredo_vault', { p_id: secretId })
  if (error) {
    logger.error({ erro: error.message }, 'Falha ao ler segredo do Vault.')
    return null
  }
  return (data as string | null) ?? null
}
