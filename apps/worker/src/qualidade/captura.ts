import type { ConvidadoGoogle } from '../../../../packages/core/src/transportes/index.js'
import { supabaseAdmin } from '../db.js'
import { carregarConfigQualidade } from './config.js'

/**
 * Os dois convidados da captura (05C §1.1), anexados no ÚNICO lugar que escreve a reunião
 * no Google.
 *
 * - a conta central (`admin@oneos.com.br`) põe a reunião no calendário conectado ao
 *   Fireflies e vira DONA do transcript — é para reuniões da dona que o webhook sai;
 * - o `fred@fireflies.ai` é o que dispara o join, com o auto-join da conta central em
 *   "só quando eu convidar o fred".
 *
 * Reunião dispensada (não gravar, sem link, pessoa com captura desligada) não recebe
 * nenhum dos dois — e remarcar uma reunião dispensada TIRA os dois do convite.
 */
export async function convidadosDaCaptura(eventoId: string): Promise<ConvidadoGoogle[]> {
  const { data: r } = await supabaseAdmin.from('reunioes').select('captura_status').eq('evento_id', eventoId).maybeSingle()
  if (!r || r.captura_status === 'dispensada' || r.captura_status === 'transcrita') return []
  const cfg = await carregarConfigQualidade()
  if (!cfg.captura.ligada) return []
  return [
    { email: cfg.captura.email_conta_central.toLowerCase(), nome: 'OneOS (gravação)', interno: true },
    { email: cfg.captura.email_notetaker.toLowerCase(), nome: 'Fireflies Notetaker', interno: true },
  ]
}
