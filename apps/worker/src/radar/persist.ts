import type {
  TablesInsert,
  TablesUpdate,
} from '../../../../packages/core/src/types/database.js'
import { supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'

/**
 * Escrita das linhas de máquina do Radar (enriquecimentos, lote_itens) via service
 * role. NÃO passa pelos RPCs security-invoker — esses são para mutações do usuário.
 *
 * `enriquecimentos` é a fonte da verdade de custo e TTL: TODA tentativa vira uma
 * linha, inclusive `sem_dados` (cache negativo), senão a próxima seleção re-paga.
 */

export async function registrarEnriquecimento(
  row: TablesInsert<'enriquecimentos'>,
): Promise<void> {
  const { error } = await supabaseAdmin.from('enriquecimentos').insert(row)
  if (error) logger.error({ tipo: row.tipo, erro: error.message }, 'Falha ao registrar enriquecimento.')
}

export async function atualizarItem(id: string, patch: TablesUpdate<'lote_itens'>): Promise<void> {
  const { error } = await supabaseAdmin.from('lote_itens').update(patch).eq('id', id)
  if (error) logger.error({ id, erro: error.message }, 'Falha ao atualizar item do lote.')
}
