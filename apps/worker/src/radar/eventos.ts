import type { EventoTipo } from '../../../../packages/core/src/constants.js'
import { notify, type NotifyPayload } from '../../../../packages/core/src/server/notify.js'
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

/**
 * Notificação COM push (sino + web/expo) para os usuários de certos perfis. Usado
 * nos eventos críticos ("aja agora"). Best-effort: uma falha de push nunca derruba o
 * job. Esses eventos NÃO têm regra de fan-out (senão o sino duplicaria) — o sino vem
 * daqui, do notify().
 */
export async function notificarPerfis(perfis: string[], payload: NotifyPayload): Promise<void> {
  try {
    const { data: ps } = await supabaseAdmin.from('perfis').select('id').in('nome', perfis)
    if (!ps?.length) return
    const { data: us } = await supabaseAdmin
      .from('usuarios')
      .select('id')
      .in('perfil_id', ps.map((p) => p.id))
      .eq('ativo', true)
    const ids = (us ?? []).map((u) => u.id)
    if (ids.length) await notify(supabaseAdmin, ids, payload)
  } catch (e) {
    logger.error({ perfis, erro: String(e) }, 'Falha ao notificar perfis (push).')
  }
}
