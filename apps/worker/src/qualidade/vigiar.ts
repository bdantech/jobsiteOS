import { supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'
import { enviarResgates, reprocessarWebhooks, type ResultadoResgates } from './fireflies.js'

/**
 * O VIGIA DA CAPTURA (05C §1.4), a cada 5 minutos. Três coisas, na ordem:
 *
 *  1. Reunião que começou há mais de N minutos sem bot → alerta ao condutor; reunião que
 *     acabou há horas sem transcrição → `sem_captura`. (No banco: `app__qualidade_vigiar`.)
 *  2. Resgates na fila → `addToLiveMeeting`, respeitando 3 a cada 20 minutos.
 *  3. Webhooks que não fecharam → de novo (transcrição que ainda não estava pronta,
 *     bot que entrou antes de a reunião ser encontrada).
 */
export interface ResultadoVigia {
  alertas: number
  sem_captura: number
  canceladas: number
  resgates: ResultadoResgates
  webhooks_reprocessados: number
}

export async function vigiarCaptura(): Promise<ResultadoVigia> {
  const { data, error } = await supabaseAdmin.rpc('app__qualidade_vigiar')
  if (error) throw new Error(error.message)
  const v = (data ?? {}) as { alertas?: number; sem_captura?: number; canceladas?: number }

  let resgates: ResultadoResgates = { enviados: 0, falhas: 0, aguardando_vaga: 0 }
  try {
    resgates = await enviarResgates()
  } catch (erro) {
    logger.error({ erro: String(erro) }, 'Envio de resgates do Fireflies falhou.')
  }
  let reprocessados = 0
  try {
    reprocessados = await reprocessarWebhooks()
  } catch (erro) {
    logger.error({ erro: String(erro) }, 'Reprocessamento de webhooks do Fireflies falhou.')
  }

  const res = {
    alertas: v.alertas ?? 0,
    sem_captura: v.sem_captura ?? 0,
    canceladas: v.canceladas ?? 0,
    resgates,
    webhooks_reprocessados: reprocessados,
  }
  logger.info(res, 'Vigia da captura.')
  return res
}
