import { paraE164Brasil } from '../comunicacao/identificador.js'
import type { TipoMidiaWhatsapp } from './midia-whatsapp.js'
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

/**
 * O descritor da mídia: o bastante para baixá-la e decifrá-la depois.
 *
 * A `url` é de um CDN do WhatsApp e EXPIRA. Guardá-la no ledger no lugar do
 * arquivo faria a thread perder os áudios em algumas semanas — por isso este tipo
 * é insumo de um download imediato, e não o que fica gravado.
 */
export interface MidiaDoWebhook {
  tipo: TipoMidiaWhatsapp
  url: string
  mediaKey: string
  mimetype: string | null
  nome: string | null
  segundos: number | null
  bytes: number | null
}

const CAMPOS_MIDIA: ReadonlyArray<[string, TipoMidiaWhatsapp]> = [
  ['audioMessage', 'audio'],
  ['imageMessage', 'image'],
  ['videoMessage', 'video'],
  ['documentMessage', 'document'],
  ['stickerMessage', 'sticker'],
]

function midiaDaMensagem(dados: Record<string, any>): MidiaDoWebhook | null {
  const m = dados.message ?? {}
  for (const [campo, tipo] of CAMPOS_MIDIA) {
    const n = m[campo]
    // Sem `url` ou sem `mediaKey` não há o que baixar nem como abrir: um
    // descritor pela metade viraria uma tentativa de download por mensagem, para
    // sempre.
    if (n?.url && n?.mediaKey) {
      return {
        tipo,
        url: String(n.url),
        mediaKey: String(n.mediaKey),
        mimetype: n.mimetype ? String(n.mimetype) : null,
        nome: n.fileName ? String(n.fileName) : null,
        segundos: Number.isFinite(Number(n.seconds)) ? Number(n.seconds) : null,
        bytes: Number.isFinite(Number(n.fileLength)) ? Number(n.fileLength) : null,
      }
    }
  }
  return null
}

function temMidiaNa(dados: Record<string, any>): boolean {
  const m = dados.message ?? {}
  return CAMPOS_MIDIA.some(([campo]) => Boolean(m[campo]))
}

/** O provedor manda segundos; alguns eventos vêm em milissegundos. */
function instanteDe(dados: Record<string, any>): Date {
  const ts = Number(dados.messageTimestamp ?? dados.timestamp ?? 0)
  return ts > 0 ? new Date(ts > 1e12 ? ts : ts * 1000) : new Date()
}

/**
 * AS MENSAGENS DO PAYLOAD — no plural, e essa é a correção que faltava.
 *
 * `messages.received` manda UM objeto em `data.messages`; `messages.upsert` manda
 * um ARRAY. O leitor antigo fazia `p.data?.messages ?? p.data` e seguia como se
 * fosse sempre objeto: com o array, `dados.key` era `undefined` e a mensagem era
 * descartada em silêncio.
 *
 * Isso importa mais do que parece, porque `messages.upsert` é o único evento que
 * cobre o que a equipe digita NO APARELHO — `message.sent` só confirma o que saiu
 * pela API. Ligar o evento certo no painel e continuar perdendo tudo por causa da
 * forma do payload seria o pior dos dois mundos.
 */
function mensagensDoPayload(p: Record<string, any>): Record<string, any>[] {
  // `data.message` NÃO entra nesta cadeia: em `message.sent` esse campo é o
  // CONTEÚDO (`{conversation: "..."}`), não o envelope, e pegá-lo faria o leitor
  // procurar `key` dentro do texto da mensagem.
  const bruto = p.data?.messages ?? p.data ?? p.message ?? p
  const lista = Array.isArray(bruto) ? bruto : [bruto]
  return lista.filter((d): d is Record<string, any> => Boolean(d) && typeof d === 'object')
}

/** Eventos que carregam mensagem. `chats.*`, `session.*` e afins não entram. */
function ehEventoDeMensagem(p: Record<string, any>): boolean {
  const evento = p.event ?? p.type
  return !evento || String(evento).includes('message')
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
  midia: MidiaDoWebhook | null
  recebidaEm: Date
  /**
   * O identificador de privacidade do remetente, quando existe. Guardá-lo é o que
   * permite reencontrar a thread quando um evento futuro trouxer SÓ o LID — e
   * absorver a thread que já ficou presa a ele.
   */
  lid: string | null
}

function lerEntrada(p: Record<string, any>, dados: Record<string, any>): MensagemRecebidaWasender | null {
  const chave = dados.key ?? {}
  // `fromMe` é o que SAIU pelo aparelho. Tem leitor próprio, `lerEnviosWasender`.
  if (chave.fromMe === true) return null

  const jid: string = chave.remoteJid ?? dados.from ?? dados.remoteJid ?? ''
  // Mensagem de GRUPO é descartada aqui, e não mais adiante: uma thread por grupo
  // criaria uma "pessoa" que é dezenas de pessoas, e o portão passaria a
  // raciocinar sobre supressão de um coletivo.
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
    midia: midiaDaMensagem(dados),
    recebidaEm: instanteDe(dados),
    lid,
  }
}

/**
 * Normaliza o payload de ENTRADA. Devolve TODAS as mensagens dele.
 *
 * Devolve lista vazia para o que não é mensagem de entrada de uma pessoa — status
 * de entrega, evento de conexão, e o que nós mesmos enviamos.
 */
export function lerEntradasWasender(payload: unknown): MensagemRecebidaWasender[] {
  const p = payload as Record<string, any> | null
  if (!p || !ehEventoDeMensagem(p)) return []
  return mensagensDoPayload(p)
    .map((d) => lerEntrada(p, d))
    .filter((m): m is MensagemRecebidaWasender => m !== null)
}

export interface MensagemEnviadaWasender {
  idExterno: string
  /** O DESTINATÁRIO. Numa mensagem nossa, é ele quem define a thread. */
  para: string
  corpo: string | null
  temMidia: boolean
  midia: MidiaDoWebhook | null
  enviadaEm: Date
  lid: string | null
}

function lerEnvio(dados: Record<string, any>): MensagemEnviadaWasender | null {
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
    midia: midiaDaMensagem(dados),
    enviadaEm: instanteDe(dados),
    lid,
  }
}

/**
 * O que a EQUIPE mandou — inclusive pelo aparelho, fora da plataforma.
 *
 * ── O EVENTO CERTO É `messages.upsert`, NÃO `message.sent` ──────────────────
 * `message.sent` confirma o que saiu pela API: ele NÃO cobre a mensagem que o
 * vendedor digita no celular, que é justamente a que faltava. Quem cobre as duas
 * é `messages.upsert` — "all messages in your session, both incoming and
 * outgoing". Esta função aceita os dois formatos porque a diferença é do painel
 * do provedor, e um leitor que só entendesse um deles quebraria no dia em que
 * alguém trocasse a configuração.
 *
 * A duplicata continua impossível: o `(provedor, id_externo)` é o mesmo que o
 * envio gravou, e quem consome esta função só INSERE quando aquele par ainda não
 * existe.
 */
export function lerEnviosWasender(payload: unknown): MensagemEnviadaWasender[] {
  const p = payload as Record<string, any> | null
  if (!p || !ehEventoDeMensagem(p)) return []
  return mensagensDoPayload(p)
    .map((d) => lerEnvio(d))
    .filter((m): m is MensagemEnviadaWasender => m !== null)
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
