import {
  MAX_TENTATIVAS_WEBHOOK,
  proximaTentativaWebhook,
  type EventoWebhook,
} from '../../../../../packages/core/src/credito/api.js'
import {
  assinarWebhook,
  montarPayloadCredito,
} from '../../../../../packages/core/src/server/credito-api.js'
import { notify } from '../../../../../packages/core/src/server/notify.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'

/**
 * A FILA DE WEBHOOKS (04n §3.4).
 *
 * ── POR QUE A FILA, E NÃO UM POST NA TRANSAÇÃO ─────────────────────────────
 * O estágio muda dentro de uma transação de banco. Um POST ali dentro amarraria
 * o commit ao tempo de resposta de um servidor de terceiro — e um endpoint lento
 * do outro lado viraria lentidão na nossa esteira, ou pior, um rollback por
 * timeout de algo que já foi decidido. O gatilho enfileira; este job entrega.
 *
 * ── O PAYLOAD É MONTADO NA HORA DA ENTREGA ─────────────────────────────────
 * A linha nasce com uma semente (o que o gatilho sabia: o estágio de antes) e o
 * corpo completo é construído aqui, pelo `montarPayloadCredito` — o mesmo que o
 * `GET` usa. Montar no gatilho exigiria reescrever aquilo em SQL, e duas
 * montagens divergem na primeira mudança feita em só uma.
 *
 * Depois de entregue, `payload` guarda EXATAMENTE o que foi enviado: é o que
 * permite responder "o que exatamente eles receberam?" seis meses depois.
 *
 * ── ASSINATURA SOBRE OS BYTES ──────────────────────────────────────────────
 * O corpo é serializado UMA vez e a mesma string é assinada e enviada. Assinar o
 * objeto e serializar de novo assinaria outra coisa.
 */

const TIMEOUT_MS = 10_000

export interface ResultadoEntrega {
  candidatas: number
  entregues: number
  reagendadas: number
  falhadas: number
}

interface LinhaEntrega {
  id: string
  webhook_id: string
  evento: string
  evento_id: string
  analise_id: string | null
  payload: Record<string, unknown>
  tentativas: number
}

export async function entregarWebhooks(limite = 50): Promise<ResultadoEntrega> {
  const agora = new Date()
  const acc: ResultadoEntrega = { candidatas: 0, entregues: 0, reagendadas: 0, falhadas: 0 }

  const { data, error } = await supabaseAdmin
    .from('webhook_entregas')
    .select('id, webhook_id, evento, evento_id, analise_id, payload, tentativas')
    .eq('status', 'pendente')
    .lte('proxima_tentativa_em', agora.toISOString())
    .order('criado_em', { ascending: true })
    .limit(limite)

  if (error) {
    logger.error({ erro: error.message }, 'Falha ao ler a fila de webhooks.')
    return acc
  }

  const fila = (data ?? []) as unknown as LinhaEntrega[]
  acc.candidatas = fila.length

  for (const linha of fila) {
    try {
      const desfecho = await entregarUma(linha)
      acc[desfecho] += 1
    } catch (erro) {
      logger.error({ id: linha.id, erro: String(erro) }, 'Falha inesperada ao entregar webhook.')
      acc.falhadas += 1
    }
  }

  if (acc.candidatas > 0) logger.info(acc, 'Fila de webhooks processada.')
  return acc
}

async function entregarUma(linha: LinhaEntrega): Promise<'entregues' | 'reagendadas' | 'falhadas'> {
  const { data: webhook } = await supabaseAdmin
    .from('webhooks_saida')
    .select('id, nome, url, secret, ativo')
    .eq('id', linha.webhook_id)
    .maybeSingle()

  // Webhook desativado depois do enfileiramento: a entrega morre sem tentativa.
  // Insistir mandaria evento para um destino que alguém desligou de propósito.
  if (!webhook || !webhook.ativo) {
    await supabaseAdmin
      .from('webhook_entregas')
      .update({ status: 'falhou', ultimo_erro: 'Webhook desativado ou removido.' })
      .eq('id', linha.id)
    return 'falhadas'
  }

  const corpo = await montarCorpo(linha)
  const texto = JSON.stringify(corpo)
  const assinatura = assinarWebhook(webhook.secret, texto)
  const timestamp = Math.floor(Date.now() / 1000).toString()

  let status = 0
  let resposta = ''
  let erro: string | null = null

  try {
    const r = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-jobsiteos-signature': assinatura,
        'x-jobsiteos-event-id': linha.evento_id,
        'x-jobsiteos-timestamp': timestamp,
        'user-agent': 'JobsiteOS-Webhook/1',
      },
      body: texto,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    status = r.status
    // Só o começo: a resposta de erro de um servidor pode ser uma página HTML
    // inteira, e o log de entrega não é lugar para guardá-la.
    resposta = (await r.text().catch(() => '')).slice(0, 1000)
  } catch (e) {
    erro = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
  }

  const ok = status >= 200 && status < 300
  const tentativas = linha.tentativas + 1

  if (ok) {
    await supabaseAdmin
      .from('webhook_entregas')
      .update({
        status: 'entregue',
        tentativas,
        ultimo_status_http: status,
        ultima_resposta: resposta,
        ultimo_erro: null,
        entregue_em: new Date().toISOString(),
        // Guarda o que foi de fato enviado.
        payload: corpo as never,
      })
      .eq('id', linha.id)
    return 'entregues'
  }

  const proxima = proximaTentativaWebhook(tentativas)
  await supabaseAdmin
    .from('webhook_entregas')
    .update({
      status: proxima ? 'pendente' : 'falhou',
      tentativas,
      ultimo_status_http: status || null,
      ultima_resposta: resposta || null,
      ultimo_erro: erro,
      proxima_tentativa_em: (proxima ?? new Date()).toISOString(),
      payload: corpo as never,
    })
    .eq('id', linha.id)

  if (!proxima) {
    logger.error(
      { id: linha.id, evento: linha.evento, webhook: webhook.nome, tentativas },
      'Webhook esgotou as tentativas.',
    )
    await avisarFalha(webhook.nome, linha.evento, tentativas)
    return 'falhadas'
  }
  return 'reagendadas'
}

/**
 * O corpo. Evento de teste não tem análise: manda uma amostra reconhecível, para
 * que o "enviar evento de teste" da UI exercite assinatura, rede e o receptor do
 * outro lado sem inventar uma análise de mentira no banco.
 */
async function montarCorpo(linha: LinhaEntrega): Promise<Record<string, unknown>> {
  const semente = (linha.payload?._semente ?? null) as { estagio_anterior?: string | null } | null

  if (linha.analise_id) {
    const payload = await montarPayloadCredito(supabaseAdmin, linha.analise_id, {
      evento: linha.evento as EventoWebhook,
      eventoId: linha.evento_id,
      semente,
    })
    if (payload) return payload as unknown as Record<string, unknown>
  }

  return {
    evento: linha.evento,
    evento_id: linha.evento_id,
    ocorrido_em: new Date().toISOString(),
    teste: linha.evento === 'webhook.teste',
    detalhe: semente,
  }
}

/**
 * Esgotar as tentativas avisa os ADMINS. Uma integração que parou de receber é
 * um problema de operação, não de quem mexeu no card — e ninguém descobre isso
 * olhando um log que só se abre quando já se desconfia.
 */
async function avisarFalha(nome: string, evento: string, tentativas: number): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from('usuarios')
      .select('id, perfis!inner(nome)')
      .eq('ativo', true)
      .eq('perfis.nome', 'Admin')
      .limit(20)
    const ids = (data ?? []).map((u) => u.id)
    if (ids.length === 0) return
    await notify(supabaseAdmin, ids, {
      titulo: 'Webhook não entregue',
      corpo: `${tentativas} tentativas para "${nome}" (${evento}) e nenhuma resposta 2xx. Reenvie pela tela de Integrações.`,
      url: '/credito/integracoes',
    })
  } catch (erro) {
    logger.error({ erro: String(erro) }, 'Falha ao avisar admins sobre webhook.')
  }
}
