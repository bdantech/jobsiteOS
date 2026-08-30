import { paraE164Brasil } from '../comunicacao/identificador.js'
import { statusRetryavel, type MensagemParaEnviar, type ResultadoEnvio, type Transporte } from './tipos.js'

/**
 * Cliente do Wasender (§3.1).
 *
 * ─── O TOKEN NÃO ESTÁ AQUI, E NÃO ESTÁ NA TABELA ────────────────────────────
 * `whatsapp_contas` guarda só um PONTEIRO para o Vault (0045/0052). Quem constrói
 * este cliente já leu o segredo com service role (`app__segredo_vault`), e é por
 * isso que o token chega por parâmetro em vez de o cliente ir buscá-lo: um
 * cliente que sabe ler segredo é um cliente que pode ser importado num bundle de
 * browser por engano.
 *
 * ─── O MESMO CLIENTE, CONTAS DIFERENTES ─────────────────────────────────────
 * O envio individual do vendedor e o envio da IA usam esta classe. O que muda é a
 * CONTA — e `whatsapp_contas.tipo` garante que o número da IA nunca seja o de
 * relacionamento humano (§1.3). A separação é de dado, não de código: dois
 * clientes quase iguais divergiriam no primeiro ajuste de retry.
 */

export interface ConfigWasender {
  baseUrl: string
  /** Já lido do Vault pelo chamador. */
  token: string
  /** Número da conta, E.164 sem "+". Vai no log, nunca o token. */
  numero: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

interface RespostaWasender {
  success?: boolean
  data?: { msgId?: string | number; id?: string | number }
  message?: string
  error?: string
}

export class TransporteWasender implements Transporte {
  readonly nome = 'wasender' as const
  readonly canal = 'whatsapp' as const

  // Campo declarado e atribuído à mão: o `--experimental-strip-types` do Node,
  // que é como os testes deste repo rodam, não implementa parameter properties.
  private readonly cfg: ConfigWasender

  constructor(cfg: ConfigWasender) {
    this.cfg = cfg
  }

  async enviar(msg: MensagemParaEnviar): Promise<ResultadoEnvio> {
    const destino = paraE164Brasil(msg.destino)
    if (!destino) {
      // Número que não vira E.164 não é falha de rede: insistir nele gasta a
      // reputação da conta sem nunca entregar.
      return { ok: false, erro: 'Número de destino inválido.', retryavel: false }
    }

    const f = this.cfg.fetchImpl ?? fetch
    try {
      const res = await f(`${this.cfg.baseUrl.replace(/\/$/, '')}/api/send-message`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.cfg.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          to: destino,
          text: msg.corpo,
          ...(msg.anexos?.length ? { documentUrl: msg.anexos[0]!.url } : {}),
        }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 20_000),
      })

      const texto = await res.text()
      const corpo = (texto ? safeJson(texto) : {}) as RespostaWasender

      if (!res.ok) {
        return {
          ok: false,
          erro: corpo.message ?? corpo.error ?? `HTTP ${res.status}`,
          retryavel: statusRetryavel(res.status),
        }
      }

      const id = corpo.data?.msgId ?? corpo.data?.id
      return { ok: true, idExterno: id !== undefined ? String(id) : null }
    } catch (erro) {
      // Rede e timeout SEMPRE valem retry: a mensagem pode ter saído, e é o
      // `id_externo` do webhook que resolve a duplicata do outro lado.
      return { ok: false, erro: String(erro), retryavel: true }
    }
  }
}

function safeJson(texto: string): unknown {
  try {
    return JSON.parse(texto)
  } catch {
    return {}
  }
}

// ─── Webhook de recebimento ─────────────────────────────────────────────────

export interface MensagemRecebidaWasender {
  idExterno: string
  de: string
  /** O número da NOSSA conta que recebeu. Resolve de quem é a thread. */
  para: string
  corpo: string | null
  /** pushName: pré-preenche o nome na tela de vinculação (§4). */
  nomeSugerido: string | null
  temMidia: boolean
  recebidaEm: Date
}

/**
 * Normaliza o payload do webhook.
 *
 * O Wasender manda o `remoteJid` no formato `5511999998888@s.whatsapp.net`, e
 * `@g.us` para GRUPO. Mensagem de grupo é descartada aqui, e não mais adiante:
 * uma thread por grupo criaria uma "pessoa" que é dezenas de pessoas, e o portão
 * passaria a raciocinar sobre supressão de um coletivo.
 *
 * Devolve `null` para o que não é mensagem de entrada de uma pessoa — status de
 * entrega, evento de conexão, mensagem que nós mesmos enviamos.
 */
export function lerWebhookWasender(payload: unknown): MensagemRecebidaWasender | null {
  const p = payload as Record<string, any> | null
  if (!p) return null

  const evento = p.event ?? p.type
  if (evento && !String(evento).includes('message')) return null

  const dados = p.data?.messages ?? p.data ?? p.message ?? p
  if (!dados || typeof dados !== 'object') return null

  const chave = dados.key ?? {}
  // `fromMe` é nossa própria mensagem voltando pelo webhook. Gravá-la duplicaria
  // a linha que o envio já escreveu no ledger.
  if (chave.fromMe === true) return null

  const jid: string = chave.remoteJid ?? dados.from ?? dados.remoteJid ?? ''
  if (!jid || jid.endsWith('@g.us')) return null

  const de = jid.split('@')[0] ?? ''
  if (!de) return null

  const idExterno: string = chave.id ?? dados.id ?? dados.msgId ?? ''
  if (!idExterno) return null

  const m = dados.message ?? {}
  const corpo: string | null =
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    dados.text ??
    dados.body ??
    null

  const temMidia = Boolean(
    m.imageMessage || m.videoMessage || m.audioMessage || m.documentMessage || m.stickerMessage,
  )

  const ts = Number(dados.messageTimestamp ?? dados.timestamp ?? 0)
  return {
    idExterno: String(idExterno),
    de,
    para: String(p.sessionId ?? p.instanceId ?? dados.to ?? ''),
    corpo: corpo ? String(corpo) : null,
    nomeSugerido: dados.pushName ? String(dados.pushName) : null,
    temMidia,
    // O provedor manda segundos; alguns eventos vêm em milissegundos.
    recebidaEm: ts > 0 ? new Date(ts > 1e12 ? ts : ts * 1000) : new Date(),
  }
}

/** Status de entrega/leitura, quando o provedor os manda. */
export function lerStatusWasender(
  payload: unknown,
): { idExterno: string; status: 'enviada' | 'entregue' | 'lida' | 'falhou' } | null {
  const p = payload as Record<string, any> | null
  if (!p) return null
  const evento = String(p.event ?? p.type ?? '')
  if (!evento.includes('status') && !evento.includes('ack') && !evento.includes('update')) return null

  const dados = p.data ?? p
  const id = dados.key?.id ?? dados.id ?? dados.msgId
  if (!id) return null

  const bruto = String(dados.status ?? dados.ack ?? '').toLowerCase()
  const mapa: Record<string, 'enviada' | 'entregue' | 'lida' | 'falhou'> = {
    '1': 'enviada',
    '2': 'entregue',
    '3': 'lida',
    '4': 'lida',
    sent: 'enviada',
    server_ack: 'enviada',
    delivered: 'entregue',
    delivery_ack: 'entregue',
    read: 'lida',
    played: 'lida',
    failed: 'falhou',
    error: 'falhou',
  }
  const status = mapa[bruto]
  return status ? { idExterno: String(id), status } : null
}
