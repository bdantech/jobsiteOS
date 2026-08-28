import { notify, type NotifyPayload } from '../../../../../packages/core/src/server/notify.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'

/**
 * Notificação COM push para o advogado responsável por UM processo (§9).
 *
 * ── POR QUE NÃO É UMA REGRA DE `notificacao_regras` ─────────────────────────
 * O fan-out da 0003 roteia evento → PERFIL. Aqui o destinatário é calculado por
 * linha: quem responde por este CNJ. Uma regra de perfil mandaria as trezentas
 * movimentações relevantes do mês para todo mundo do Jurídico, e o segundo dia
 * disso é o dia em que ninguém abre mais o sino.
 *
 * ── ADVOGADO EXTERNO NÃO RECEBE, E ISSO É CORRETO ──────────────────────────
 * `advogados.usuario_id` é nulo para o escritório contratado — ele não tem (nem
 * deve ter) sessão na plataforma. Nesse caso o aviso vai para o GESTOR do módulo,
 * que é quem fala com o escritório. Cair no silêncio seria pior: o processo com
 * advogado externo é justamente o que ninguém daqui está olhando todo dia.
 */

async function usuariosDoPerfil(nomes: readonly string[]): Promise<string[]> {
  const { data: perfis } = await supabaseAdmin.from('perfis').select('id').in('nome', nomes as string[])
  if (!perfis?.length) return []
  const { data: usuarios } = await supabaseAdmin
    .from('usuarios')
    .select('id')
    .in('perfil_id', perfis.map((p) => p.id))
    .eq('ativo', true)
  return (usuarios ?? []).map((u) => u.id)
}

export async function notificarAdvogado(numeroCnj: string, payload: NotifyPayload): Promise<void> {
  try {
    const { data: processo } = await supabaseAdmin
      .from('processos')
      .select('advogado_id, advogados(usuario_id)')
      .eq('numero_cnj', numeroCnj)
      .maybeSingle()

    const usuarioAdvogado = (processo as { advogados?: { usuario_id: string | null } | null } | null)
      ?.advogados?.usuario_id

    const destinatarios = usuarioAdvogado
      ? [usuarioAdvogado]
      : await usuariosDoPerfil(['Jurídico', 'Admin'])

    if (destinatarios.length === 0) return
    await notify(supabaseAdmin, destinatarios, payload)
  } catch (e) {
    // Push é best-effort: uma falha aqui nunca pode derrubar a sincronização que
    // acabou de gravar as movimentações.
    logger.error({ cnj: numeroCnj, erro: String(e) }, 'Falha ao notificar advogado.')
  }
}

/** Gestores + jurídico. Usado por "novo processo detectado" (callback). */
export async function notificarGestores(payload: NotifyPayload): Promise<void> {
  try {
    const ids = await usuariosDoPerfil(['Admin', 'Jurídico'])
    if (ids.length) await notify(supabaseAdmin, ids, payload)
  } catch (e) {
    logger.error({ erro: String(e) }, 'Falha ao notificar gestores do Jurídico.')
  }
}
