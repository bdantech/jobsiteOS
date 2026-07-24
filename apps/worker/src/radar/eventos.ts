import type { EventoTipo } from '../../../../packages/core/src/constants.js'
import { supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'

/**
 * Emite um evento em empresa_eventos. O trigger de fan-out (migração 0003/0014)
 * transforma cada linha em notificações para quem casar uma notificacao_regras.
 *
 * - empresaId != null → evento DE empresa (aparece na timeline da Company 360).
 * - empresaId == null → evento de SISTEMA; usa payload.titulo/url (o trigger os
 *   prefere ao título derivado da empresa).
 */
export async function emitirEvento(
  empresaId: string | null,
  tipo: EventoTipo,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('empresa_eventos')
    .insert({ empresa_id: empresaId, tipo, payload: payload as never, ator_usuario_id: null })
  if (error) logger.error({ tipo, erro: error.message }, 'Falha ao emitir evento do Radar.')
}
