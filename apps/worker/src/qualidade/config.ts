import { montarConfigQualidade, type ConfigQualidade } from '../../../../packages/core/src/analise/tipos.js'
import { supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'

/**
 * Config e credenciais da Inteligência de Conversas (05C §13).
 *
 * As credenciais (Fireflies, Jev) moram no Vault e são cadastradas pela tela de
 * settings — não em env. Quem gira a chave é o gestor, sem deploy. O cache é curto
 * (1 min): uma chave trocada na tela vale na próxima rodada, não no próximo restart.
 */

export type ChaveSegredo = 'fireflies_api_key' | 'fireflies_webhook_secret' | 'jev_api_key'

const TTL_MS = 60_000
const cacheSegredo = new Map<ChaveSegredo, { valor: string | null; em: number }>()

export async function segredoQualidade(chave: ChaveSegredo): Promise<string | null> {
  const c = cacheSegredo.get(chave)
  if (c && Date.now() - c.em < TTL_MS) return c.valor
  const { data, error } = await supabaseAdmin.rpc('app__qualidade_segredo', { p_chave: chave })
  if (error) {
    logger.error({ chave, erro: error.message }, 'Falha ao ler segredo da qualidade.')
    return c?.valor ?? null
  }
  const valor = typeof data === 'string' && data.trim() ? data.trim() : null
  cacheSegredo.set(chave, { valor, em: Date.now() })
  return valor
}

export async function carregarConfigQualidade(): Promise<ConfigQualidade> {
  const { data, error } = await supabaseAdmin.from('qualidade_config').select('chave, valor')
  if (error) logger.error({ erro: error.message }, 'Falha ao ler qualidade_config; usando padrões.')
  return montarConfigQualidade(data ?? [])
}
