import {
  CONFIG_FUNIL_OPORTUNIDADES_PADRAO,
  type ConfigFunilOportunidades,
} from '../../../../packages/core/src/funil/schemas.js'
import { supabaseAdmin } from '../db.js'

/**
 * A config do funil de oportunidades (04s), em `antecipacao_config`.
 *
 * Mesma tabela e mesma forma dos outros blocos do módulo — merge com o default do
 * core, para que uma linha ausente ou pela metade faça o job rodar com o padrão da
 * spec em vez de quebrar no meio de um sync.
 */
export async function lerConfigFunilOportunidades(): Promise<ConfigFunilOportunidades> {
  const { data } = await supabaseAdmin
    .from('antecipacao_config')
    .select('valor')
    .eq('chave', 'funil_oportunidades')
    .maybeSingle()

  const valor = data?.valor
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    return CONFIG_FUNIL_OPORTUNIDADES_PADRAO
  }
  return {
    ...CONFIG_FUNIL_OPORTUNIDADES_PADRAO,
    ...(valor as Partial<ConfigFunilOportunidades>),
  }
}
