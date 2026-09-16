import {
  CONFIG_VOZ_PADRAO,
  type ConfigVoz,
} from '../../../../packages/core/src/voz/schemas.js'
import { supabaseAdmin } from '../db.js'

/**
 * Settings da voz, na mesma `antecipacao_config` do resto do módulo (chave
 * `voz`). Merge com o default do core: linha ausente ou pela metade faz o job
 * rodar com o padrão da spec — e o padrão é DESLIGADA.
 *
 * Config de negócio não é variável de ambiente: ligar e desligar a Ana é decisão
 * de operação, feita no banco, sem redeploy e sem alguém com acesso ao Railway.
 */
export async function lerConfigVoz(): Promise<ConfigVoz> {
  const { data } = await supabaseAdmin
    .from('antecipacao_config')
    .select('valor')
    .eq('chave', 'voz')
    .maybeSingle()
  const valor = data?.valor
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return CONFIG_VOZ_PADRAO
  return { ...CONFIG_VOZ_PADRAO, ...(valor as Partial<ConfigVoz>) }
}
