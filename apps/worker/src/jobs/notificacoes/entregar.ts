import {
  entregarEnvios,
  entregarResumos,
  type ResultadoEntrega,
} from '../../../../../packages/core/src/server/notify.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { emailInterno } from '../../radar/eventos.js'

/**
 * A VARREDURA da fila de push e e-mail (0262), a cada cinco minutos.
 *
 * Quem emite pelo Node entrega o próprio push na hora; a varredura existe para o
 * resto: os avisos que nascem no banco (o trigger de `empresa_eventos` não fala
 * HTTP) e os que o horário de silêncio segurou até as 8h. A reivindicação da linha
 * em `entregarEnvios` é que deixa as duas rodarem juntas sem push em dobro.
 */
export async function varrerEnvios(): Promise<ResultadoEntrega> {
  const total: ResultadoEntrega = { push: 0, email: 0, ignorados: 0, falhas: 0 }
  // Em lotes, até esvaziar ou até dez lotes — um backlog de manhã (o que o silêncio
  // segurou) não pode ficar para a próxima varredura inteiro.
  for (let i = 0; i < 10; i++) {
    const r = await entregarEnvios(supabaseAdmin, { limite: 200, email: emailInterno() })
    total.push += r.push
    total.email += r.email
    total.ignorados += r.ignorados
    total.falhas += r.falhas
    if (r.push + r.email + r.ignorados + r.falhas < 200) break
  }
  if (total.push + total.email + total.falhas > 0) logger.info(total, 'Fila de avisos entregue.')
  return total
}

/** O resumo diário: um aviso por pessoa com o que as regras mandaram para ele. */
export async function entregarResumoDiario(): Promise<{ pessoas: number; itens: number }> {
  const r = await entregarResumos(supabaseAdmin, { email: emailInterno() })
  logger.info(r, 'Resumo diário de avisos entregue.')
  return r
}
