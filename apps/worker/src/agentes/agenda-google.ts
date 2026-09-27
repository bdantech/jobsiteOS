import type { Intervalo } from '../../../../packages/core/src/agentes/agenda.js'
import { CalendarioGoogle } from '../../../../packages/core/src/transportes/index.js'
import { accessTokenGmail, contaGmailDoUsuario } from '../comunicacao/transportes.js'
import { supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'

/**
 * O que ocupa a agenda do closer (Prompt 09 §7.1): as reuniões que o JobsiteOS já marcou
 * (`vendedor_eventos`) + o Google Agenda dele, quando conectado.
 *
 * Sem Google conectado, só o que está no sistema conta — e isso é dito no log, não
 * escondido: o agente vai oferecer horários que talvez colidam com um compromisso pessoal
 * que só existe no Google. A tela de Personas avisa quando o closer não tem a agenda
 * conectada.
 */
export async function ocupadosDoCloser(closerId: string, agora: Date, dias: number): Promise<Intervalo[]> {
  const ate = new Date(agora.getTime() + dias * 86_400_000)
  const { data: eventos } = await supabaseAdmin
    .from('vendedor_eventos')
    .select('inicio_em, duracao_min')
    .eq('vendedor_id', closerId)
    .is('cancelado_em', null)
    .gte('inicio_em', new Date(agora.getTime() - 86_400_000).toISOString())
    .lte('inicio_em', ate.toISOString())
  const ocupados: Intervalo[] = (eventos ?? []).map((e) => ({
    inicio: new Date(e.inicio_em),
    fim: new Date(new Date(e.inicio_em).getTime() + (e.duracao_min ?? 30) * 60_000),
  }))

  const { data: closer } = await supabaseAdmin.from('vendedores').select('usuario_id').eq('id', closerId).maybeSingle()
  const conta = closer?.usuario_id ? await contaGmailDoUsuario(closer.usuario_id) : null
  if (!conta || !(conta.escopos ?? []).some((e) => e.includes('calendar'))) {
    logger.info({ closerId }, 'Closer sem Google Agenda conectado: janelas calculadas só com as reuniões do sistema.')
    return ocupados
  }
  const token = await accessTokenGmail(conta)
  if (!token) return ocupados
  const r = await new CalendarioGoogle({ accessToken: token }).ocupados(agora, ate)
  if (!r.ok) {
    logger.warn({ closerId, erro: r.erro }, 'Não foi possível ler o Google Agenda do closer.')
    return ocupados
  }
  return [...ocupados, ...r.intervalos]
}
