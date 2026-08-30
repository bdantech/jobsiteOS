import {
  LIMITES_PADRAO,
  lerLimites,
  type LimitesCampanhas,
} from '../../../../packages/core/src/campanhas/schemas.js'
import { supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'

/**
 * Os tetos de massa e os limiares de saúde, lidos do banco com o padrão de
 * fábrica por baixo. Mesmo desenho de `lerConfigComunicacao`, e pela mesma
 * razão: mexer num teto tem de valer no minuto seguinte, não no próximo deploy.
 */

let cache: { valor: LimitesCampanhas; em: number } | null = null
const TTL_MS = 60_000

export async function lerLimitesCampanhas(forcar = false): Promise<LimitesCampanhas> {
  if (!forcar && cache && Date.now() - cache.em < TTL_MS) return cache.valor

  const { data, error } = await supabaseAdmin
    .from('campanhas_config')
    .select('valor')
    .eq('chave', 'limites')
    .maybeSingle()

  if (error) {
    logger.error({ erro: error.message }, 'Falha ao ler campanhas_config; usando o padrão.')
    return LIMITES_PADRAO
  }

  const valor = lerLimites(data?.valor ?? null)
  cache = { valor, em: Date.now() }
  return valor
}
