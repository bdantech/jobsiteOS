import {
  CONFIG_COMUNICACAO_PADRAO,
  type ConfigComunicacao,
} from '../../../../packages/core/src/comunicacao/schemas.js'
import { supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'

/**
 * A config do módulo, lida do banco com o padrão de fábrica do core por baixo.
 *
 * O merge é por CHAVE e não por objeto inteiro: uma chave que alguém apagou ou
 * que ainda não foi semeada cai no padrão, e o worker segue. O contrário — a
 * janela vindo `undefined` — faz o portão achar que está sempre fora da janela
 * (ou, pior, sempre dentro) e o erro aparece como mensagens de madrugada.
 *
 * Cache curto de propósito: mexer no kill switch tem de valer no minuto seguinte,
 * não no próximo deploy.
 */

let cache: { valor: ConfigComunicacao; em: number } | null = null
const TTL_MS = 60_000

export async function lerConfigComunicacao(forcar = false): Promise<ConfigComunicacao> {
  if (!forcar && cache && Date.now() - cache.em < TTL_MS) return cache.valor

  const { data, error } = await supabaseAdmin.from('comunicacao_config').select('chave, valor')
  if (error) {
    logger.error({ erro: error.message }, 'Falha ao ler comunicacao_config; usando o padrão de fábrica.')
    return CONFIG_COMUNICACAO_PADRAO
  }

  const bruto = new Map((data ?? []).map((l) => [l.chave, l.valor as unknown]))
  const valor: ConfigComunicacao = {
    janela: { ...CONFIG_COMUNICACAO_PADRAO.janela, ...(bruto.get('janela') as object | undefined) },
    cooldown_dias: numero(bruto.get('cooldown_dias'), CONFIG_COMUNICACAO_PADRAO.cooldown_dias),
    teto_diario_por_thread: numero(
      bruto.get('teto_diario_por_thread'),
      CONFIG_COMUNICACAO_PADRAO.teto_diario_por_thread,
    ),
    warmup: { ...CONFIG_COMUNICACAO_PADRAO.warmup, ...(bruto.get('warmup') as object | undefined) },
    inatividade_horas: numero(
      bruto.get('inatividade_horas'),
      CONFIG_COMUNICACAO_PADRAO.inatividade_horas,
    ),
    agente: { ...CONFIG_COMUNICACAO_PADRAO.agente, ...(bruto.get('agente') as object | undefined) },
    plantao: { ...CONFIG_COMUNICACAO_PADRAO.plantao, ...(bruto.get('plantao') as object | undefined) },
  }

  cache = { valor, em: Date.now() }
  return valor
}

function numero(bruto: unknown, padrao: number): number {
  const n = Number(bruto)
  return Number.isFinite(n) ? n : padrao
}
