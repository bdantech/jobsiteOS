import {
  ROTULO_STATUS_SESSAO,
  TransporteWasender,
  sessaoCaiu,
} from '../../../../packages/core/src/transportes/index.js'
import { supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'
import { avisar } from '../radar/eventos.js'
import { contasAtivas, transporteWhatsapp, type ContaWhatsapp } from './transportes.js'

/**
 * O NÚMERO QUE CAI (0277).
 *
 * Um WhatsApp desconectado do Wasender não dá erro em lugar nenhum: o webhook para
 * de chegar, e o envio pela API responde 200 sem id. Em 02/10/2026 o Rodrigo e a
 * Ana caíram de manhã e o time só percebeu à tarde, pelo volume.
 *
 * Três caminhos percebem a queda, e todos passam por `registrarSessao`:
 *   • o envio que volta sem id (`enviar-fila`), confirmado aqui no `/api/status`;
 *   • o evento `session.status` do webhook, quando o painel do Wasender o manda;
 *   • a consulta periódica de cada número (`verificarSessoes`) — a que pega a
 *     queda de quem não está enviando nada pela plataforma, que é o caso comum.
 *
 * O aviso vai a quem responde pelo número e ao Admin (regras da 0277). A chave é
 * por conta, e a janela de 4 h da regra é o que impede um aviso a cada consulta.
 */

type ContaDaSessao = Pick<ContaWhatsapp, 'id' | 'numero' | 'apelido'>

export type OrigemDaSessao = 'monitor' | 'webhook' | 'envio'

export async function registrarSessao(
  conta: ContaDaSessao,
  status: string,
  origem: OrigemDaSessao,
): Promise<void> {
  const caiu = sessaoCaiu(status)
  const agora = new Date()

  const { data: antes } = await supabaseAdmin
    .from('whatsapp_contas')
    .select('sessao_caiu_em')
    .eq('id', conta.id)
    .maybeSingle()
  const caiuEm = caiu ? (antes?.sessao_caiu_em ? new Date(antes.sessao_caiu_em) : agora) : null

  const { error } = await supabaseAdmin
    .from('whatsapp_contas')
    .update({
      sessao_status: status,
      sessao_verificada_em: agora.toISOString(),
      sessao_caiu_em: caiuEm?.toISOString() ?? null,
    })
    .eq('id', conta.id)
  if (error) logger.error({ conta: conta.apelido, erro: error.message }, 'Falha ao gravar o estado da sessão.')

  if (!caiu) {
    if (antes?.sessao_caiu_em) logger.info({ conta: conta.apelido, status, origem }, 'Número de WhatsApp reconectado.')
    return
  }

  logger.warn({ conta: conta.apelido, status, origem }, 'Número de WhatsApp desconectado.')
  const desde = caiuEm!.toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  })
  await avisar('whatsapp.numero_desconectado', {
    titulo: `WhatsApp de ${conta.apelido} desconectado`,
    resumo:
      `O número ${conta.numero} está ${ROTULO_STATUS_SESSAO[status] ?? status} desde ${desde}. ` +
      'Nada entra nem sai por ele até reconectar: no painel do Wasender, abra a sessão e leia o QR code com o celular do número. ' +
      'O que for enviado pela plataforma até lá volta como falha e precisa ser reenviado.',
    url: '/comunicacao',
    // `dono_do_numero` resolve quem responde pelo número por aqui.
    conta_recebedora: conta.numero,
    chave: `whatsapp.numero_desconectado:${conta.id}`,
    apelido: conta.apelido,
    status,
    origem,
  })
}

/**
 * O envio voltou sem id. Antes de avisar, pergunta ao Wasender: se ele diz que o
 * número está conectado (acabou de voltar, por exemplo), a falha fica só com quem
 * escreveu — `comunicacao.falhou` já cuida dela. Se a consulta não responde, o
 * próprio envio sem id é a evidência.
 */
export async function confirmarQuedaNoEnvio(conta: ContaWhatsapp): Promise<void> {
  try {
    const { transporte } = await transporteWhatsapp(conta)
    const consulta =
      transporte instanceof TransporteWasender ? await transporte.statusSessao() : { status: null, erro: null }
    if (consulta.status && !sessaoCaiu(consulta.status)) {
      logger.warn(
        { conta: conta.apelido, status: consulta.status },
        'Envio voltou sem id, mas o Wasender diz que a sessão está de pé.',
      )
      return
    }
    await registrarSessao(conta, consulta.status ?? 'envio_sem_id', 'envio')
  } catch (erro) {
    logger.error({ conta: conta.apelido, erro: String(erro) }, 'Falha ao confirmar a queda do número.')
  }
}

export interface ResultadoVerificacaoSessoes {
  verificadas: number
  caidas: number
  semResposta: number
}

/**
 * Pergunta a cada número ligado como está a sessão. Sem resposta (rede, token
 * recusado) não vira aviso de queda: o número pode estar perfeito, e um alarme
 * falso aqui ensina o time a ignorar o verdadeiro. Fica no log.
 */
export async function verificarSessoes(): Promise<ResultadoVerificacaoSessoes> {
  const acc: ResultadoVerificacaoSessoes = { verificadas: 0, caidas: 0, semResposta: 0 }
  for (const conta of await contasAtivas()) {
    const { transporte, motivo } = await transporteWhatsapp(conta)
    if (!(transporte instanceof TransporteWasender)) {
      logger.warn({ conta: conta.apelido, motivo }, 'Sessão não verificada: número sem transporte.')
      acc.semResposta += 1
      continue
    }
    const { status, erro } = await transporte.statusSessao()
    if (!status) {
      logger.warn({ conta: conta.apelido, erro }, 'O Wasender não respondeu o status da sessão.')
      acc.semResposta += 1
      continue
    }
    acc.verificadas += 1
    if (sessaoCaiu(status)) acc.caidas += 1
    await registrarSessao(conta, status, 'monitor')
  }
  logger.info(acc, 'Sessões de WhatsApp verificadas.')
  return acc
}
