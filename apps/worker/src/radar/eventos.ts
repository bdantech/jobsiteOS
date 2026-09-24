import type { EventoTipo } from '../../../../packages/core/src/constants.js'
import {
  emitirNotificacao,
  entregarEnvios,
  type ConfigEmailInterno,
} from '../../../../packages/core/src/server/notify.js'
import { supabaseAdmin } from '../db.js'
import { env } from '../env.js'
import { logger } from '../logger.js'

/**
 * Emite um evento em empresa_eventos. O trigger passa cada linha pelo motor de
 * avisos (0262): as regras do tipo, no painel de Admin, decidem quem recebe.
 *
 * - empresaId != null → evento DE empresa (aparece na timeline da Company 360).
 * - empresaId == null → evento de SISTEMA; usa payload.titulo/url.
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

/** O remetente interno, se configurado. Sem ele o canal e-mail é ignorado. */
export function emailInterno(): ConfigEmailInterno | null {
  const remetente = env.RESEND_REMETENTE_INTERNO ?? env.RESEND_REMETENTE
  if (!env.RESEND_API_KEY || !remetente) return null
  return { apiKey: env.RESEND_API_KEY, remetente, urlBase: env.WEB_URL ?? null }
}

/**
 * UM AVISO que não é fato de uma empresa — o resumo da manhã, o prazo do processo,
 * o webhook que não entregou. Passa pelo mesmo motor dos eventos: quem recebe, o
 * texto e o canal são das regras do tipo no painel; o `payload` leva o texto
 * padrão e os dados de que os papéis precisam (`destinatarios`, `vendedor_id`…).
 *
 * O push dos avisos criados sai em seguida, sem esperar a varredura de cinco
 * minutos. Best-effort de ponta a ponta: um aviso que falha nunca derruba o job
 * que acabou de gravar o fato.
 */
export async function avisar(
  tipo: string,
  payload: Record<string, unknown>,
  opcoes: { empresaId?: string | null } = {},
): Promise<void> {
  try {
    const ids = await emitirNotificacao(supabaseAdmin, tipo, payload, { empresaId: opcoes.empresaId ?? null })
    if (ids.length) await entregarEnvios(supabaseAdmin, { notificacaoIds: ids, email: emailInterno() })
  } catch (e) {
    logger.error({ tipo, erro: String(e) }, 'Falha ao emitir aviso.')
  }
}

/** O usuário de um vendedor — os avisos nominais falam de pessoa, a carteira fala de vendedor. */
export async function usuarioDoVendedor(vendedorId: string | null | undefined): Promise<string | null> {
  if (!vendedorId) return null
  const { data } = await supabaseAdmin.from('vendedores').select('usuario_id').eq('id', vendedorId).maybeSingle()
  return data?.usuario_id ?? null
}
