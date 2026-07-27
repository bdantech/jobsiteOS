import {
  CONFIG_DISPARO_PADRAO,
  CONFIG_ECONOMIA_PADRAO,
  CONFIG_FUNIL_PADRAO,
  CONFIG_LOOKUP_PADRAO,
  CONFIG_SUPRESSAO_PADRAO,
  CONFIG_SYNC_PADRAO,
  type ConfigDisparo,
  type ConfigEconomia,
  type ConfigFunil,
  type ConfigLookup,
  type ConfigSupressao,
  type ConfigSync,
} from '../../../../packages/core/src/antecipacao/schemas.js'
import { supabaseAdmin } from '../db.js'

/**
 * Settings da Antecipação, lidas de `antecipacao_config` (migration 0048). Cada
 * leitor faz merge com o default do core — se a linha sumir ou vier pela metade,
 * o job roda com o padrão da spec em vez de quebrar no meio de um sync.
 */
async function ler<T extends object>(chave: string, padrao: T): Promise<T> {
  const { data } = await supabaseAdmin
    .from('antecipacao_config')
    .select('valor')
    .eq('chave', chave)
    .maybeSingle()
  const valor = data?.valor
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return padrao
  return { ...padrao, ...(valor as Partial<T>) }
}

export const lerConfigFunil = (): Promise<ConfigFunil> => ler('funil', CONFIG_FUNIL_PADRAO)
export const lerConfigEconomia = (): Promise<ConfigEconomia> => ler('economia', CONFIG_ECONOMIA_PADRAO)
export const lerConfigDisparo = (): Promise<ConfigDisparo> => ler('disparo', CONFIG_DISPARO_PADRAO)
export const lerConfigSupressao = (): Promise<ConfigSupressao> =>
  ler('supressao', CONFIG_SUPRESSAO_PADRAO)
export const lerConfigSync = (): Promise<ConfigSync> => ler('sync', CONFIG_SYNC_PADRAO)
export const lerConfigLookup = (): Promise<ConfigLookup> => ler('lookup_cadastral', CONFIG_LOOKUP_PADRAO)
