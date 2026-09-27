import {
  CONFIG_AGENTES_PADRAO,
  montarConfigAgentes,
  type ConfigAgentes,
} from '../../../../packages/core/src/agentes/schemas.js'
import { supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'

/**
 * Settings dos Agentes (`agentes_config`), com merge por chave sobre o default do core.
 *
 * Linha ausente = padrão da spec, e o padrão é conservador de propósito: orçamento
 * mensal zero (nada pago roda), kill switch desligado mas nenhum agente autônomo
 * cadastrado. Ligar a operação é decisão de gestor na tela, não efeito colateral de um
 * deploy.
 *
 * Lida A CADA ciclo, sem cache: o kill switch precisa valer no ciclo seguinte ao clique,
 * e um cache de cinco minutos seria exatamente o intervalo em que alguém percebe o erro
 * e não consegue parar.
 */
export async function lerConfigAgentes(): Promise<ConfigAgentes> {
  const { data, error } = await supabaseAdmin.from('agentes_config').select('chave, valor')
  if (error) {
    // Tabela inexistente (migração não aplicada) ou falha de rede: o default é o
    // lado seguro, e o erro fica no log em vez de derrubar quem chamou.
    logger.warn({ erro: error.message }, 'agentes_config ilegível; usando o padrão.')
    return CONFIG_AGENTES_PADRAO
  }
  return montarConfigAgentes((data ?? []) as Array<{ chave: string; valor: unknown }>)
}
