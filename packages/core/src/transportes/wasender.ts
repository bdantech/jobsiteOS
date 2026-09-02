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

/**
 * O JID sem o domínio. `5511999998888@s.whatsapp.net` → `5511999998888`.
 * Aceita também o número solto com "+" que alguns eventos mandam.
 */
function numeroDoJid(jid: string | null | undefined): string | null {
  if (!jid) return null
  const antes = String(jid).split('@')[0] ?? ''
  const d = antes.replace(/\D/g, '')
  return d === '' ? null : d
}

/** `@lid` é o endereçamento por identificador de privacidade — nunca um telefone. */
function ehLid(jid: string | null | undefined): boolean {
  return typeof jid === 'string' && jid.endsWith('@lid')
}

/**
 * O TELEFONE de verdade, quando o provedor endereça por LID.
 *
 * Desde que o WhatsApp passou a usar LIDs, `key.remoteJid` chega como
 * `98711384416410@lid` — quinze dígitos que não são telefone nenhum. O número real
 * vem AO LADO, e a documentação do Wasender é explícita: use `cleanedSenderPn`, e
 * não `remoteJid`, para gravar em banco.
 *
 * Sem isto o estrago é triplo, e foi exatamente o que aconteceu aqui: a thread do
 * que ENTRA fica chaveada pelo LID enquanto a do que SAI usa o telefone (duas
 * conversas para a mesma pessoa), `telefoneLegivel` não tem o que formatar, e a
 * resolução de remetente não encontra o LID em `contatos.whatsapp` — de modo que
 * toda conversa recebida cai na fila de identificação.
 */
function telefoneDoRemetente(chave: Record<string, any>, dados: Record<string, any>): string | null {
  return (
    numeroDoJid(chave.cleanedSenderPn) ??
    numeroDoJid(chave.senderPn) ??
    numeroDoJid(chave.cleanedParticipantPn) ??
    numeroDoJid(chave.participantPn) ??
    numeroDoJid(chave.remoteJidAlt) ??
    numeroDoJid(dados.senderPn) ??
    (ehLid(chave.remoteJid) ? null : numeroDoJid(chave.remoteJid))
  )
}

function lidDoRemetente(chave: Record<string, any>): string | null {
  if (ehLid(chave.remoteJid)) return numeroDoJid(chave.remoteJid)
  return numeroDoJid(chave.senderLid) ?? numeroDoJid(chave.participantLid)
}

/** O texto de uma mensagem, onde quer que o provedor o tenha posto. */
function corpoDaMensagem(dados: Record<string, any>): string | null {
  const m = dados.message ?? {}
  const c =
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    dados.messageBody ??
    dados.text ??
    dados.body ??
    null
  return c ? String(c) : null
}

function temMidiaNa(dados: Record<string, any>): boolean {
  const m = dados.message ?? {}
  return Boolean(
    m.imageMessage || m.videoMessage || m.audioMessage || m.documentMessage || m.stickerMessage,
  )
}

/** O provedor manda segundos; alguns eventos vêm em milissegundos. */
function instanteDe(dados: Record<string, any>): Date {
  const ts = Number(dados.messageTimestamp ?? dados.timestamp ?? 0)
  return ts > 0 ? new Date(ts > 1e12 ? ts : ts * 1000) : new Date()
}

/** O envelope da mensagem dentro do payload, seja qual for o formato do evento. */
function dadosDaMensagem(p: Record<string, any>): Record<string, any> | null {
  const d = p.data?.messages ?? p.data ?? p.message ?? p
  return d && typeof d === 'object' ? (d as Record<string, any>) : null
}

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
  /**
   * O identificador de privacidade do remetente, quando existe. Guardá-lo é o que
   * permite reencontrar a thread quando um evento futuro trouxer SÓ o LID — e
   * absorver a thread que já ficou presa a ele.
   */
  lid: string | null
}

/**
 * Normaliza o payload do webhook de ENTRADA.
 *
 * Mensagem de GRUPO é descartada aqui, e não mais adiante: uma thread por grupo
 * criaria uma "pessoa" que é dezenas de pessoas, e o portão passaria a raciocinar
 * sobre supressão de um coletivo.
 *
 * Devolve `null` para o que não é mensagem de entrada de uma pessoa — status de
 * entrega, evento de conexão, e o que nós mesmos enviamos (que tem leitor
 * próprio, `lerEnvioWasender`).
 */
export function lerWebhookWasender(payload: unknown): MensagemRecebidaWasender | null {
  const p = payload as Record<string, any> | null
  if (!p) return null

  const evento = p.event ?? p.type
  if (evento && !String(evento).includes('message')) return null

  const dados = dadosDaMensagem(p)
  if (!dados) return null

  const chave = dados.key ?? {}
  // `fromMe` é o que SAIU pelo aparelho. Deixou de ser descartado: agora tem
  // leitor próprio, porque o inbox mostrava só metade do diálogo.
  if (chave.fromMe === true) return null

  const jid: string = chave.remoteJid ?? dados.from ?? dados.remoteJid ?? ''
  if (!jid || jid.endsWith('@g.us')) return null

  const de = telefoneDoRemetente(chave, dados)
  const lid = lidDoRemetente(chave)
  // Sem telefone e sem LID não há a quem atribuir a mensagem. Com LID e sem
  // telefone ainda dá: o LID vira a chave provisória e o worker reencontra a
  // thread quando o número aparecer.
  if (!de && !lid) return null

  const idExterno: string = chave.id ?? dados.id ?? dados.msgId ?? ''
  if (!idExterno) return null

  return {
    idExterno: String(idExterno),
    de: de ?? lid!,
    para: String(p.sessionId ?? p.instanceId ?? dados.to ?? ''),
    corpo: corpoDaMensagem(dados),
    nomeSugerido: dados.pushName ? String(dados.pushName) : null,
    temMidia: temMidiaNa(dados),
    recebidaEm: instanteDe(dados),
    lid,
  }
}

export interface MensagemEnviadaWasender {
  idExterno: string
  /** O DESTINATÁRIO. Numa mensagem nossa, é ele quem define a thread. */
  para: string
  corpo: string | null
  temMidia: boolean
  enviadaEm: Date
  lid: string | null
}

/**
 * O que a EQUIPE mandou — inclusive pelo aparelho, fora da plataforma (§2).
 *
 * Era descartado duas vezes: `lerWebhookWasender` recusa `fromMe` para não
 * duplicar o que o envio já gravou, e `lerStatusWasender` só olha eventos de
 * status. O resultado é que o vendedor que respondia pelo celular via, no inbox,
 * a pergunta do cliente sem a própria resposta ao lado.
 *
 * A duplicata continua impossível, mas por outro caminho: o `(provedor,
 * id_externo)` é o mesmo que o envio gravou, e quem consome esta função só
 * INSERE quando aquele par ainda não existe.
 */
export function lerEnvioWasender(payload: unknown): MensagemEnviadaWasender | null {
  const p = payload as Record<string, any> | null
  if (!p) return null

  const evento = String(p.event ?? p.type ?? '')
  if (evento && !evento.includes('message')) return null

  const dados = dadosDaMensagem(p)
  if (!dados) return null

  const chave = dados.key ?? {}
  if (chave.fromMe !== true) return null

  const jid: string = chave.remoteJid ?? dados.to ?? dados.remoteJid ?? ''
  if (jid.endsWith('@g.us')) return null

  /*
   * Aqui o LID e o telefone trocam de papel em relação à entrada: numa mensagem
   * nossa quem está do outro lado é o DESTINATÁRIO, então é o `remoteJid` que
   * pode vir como LID — e `senderPn` seria o nosso próprio número, que não serve
   * para achar a thread.
   */
  const para =
    numeroDoJid(chave.cleanedRemoteJidPn) ??
    numeroDoJid(chave.remoteJidAlt) ??
    (ehLid(jid) ? null : numeroDoJid(jid))
  const lid = ehLid(jid) ? numeroDoJid(jid) : (numeroDoJid(chave.remoteJidLid) ?? null)
  if (!para && !lid) return null

  const idExterno: string = chave.id ?? dados.id ?? dados.msgId ?? ''
  if (!idExterno) return null

  return {
    idExterno: String(idExterno),
    para: para ?? lid!,
    corpo: corpoDaMensagem(dados),
    temMidia: temMidiaNa(dados),
    enviadaEm: instanteDe(dados),
    lid,
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
