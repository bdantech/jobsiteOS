import { createDecipheriv, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'

/**
 * A MÍDIA DO WHATSAPP CHEGA CIFRADA, E NÃO HÁ ENDPOINT QUE A DEVOLVA ABERTA.
 *
 * O webhook manda três coisas: uma `url` num CDN do WhatsApp, uma `mediaKey` e o
 * mimetype. O que está naquela URL é AES-256-CBC — baixar e servir o arquivo como
 * veio produz um player mudo e uma imagem quebrada, que foi exatamente o que a
 * thread mostrou até aqui.
 *
 * O provedor não decifra por nós (a documentação dele é explícita: "you must
 * decrypt locally using the supplied mediaKey"), e é por isso que este arquivo
 * existe em vez de uma chamada a mais.
 *
 * ── POR QUE UMA FUNÇÃO PURA, NO CORE ───────────────────────────────────────
 * Nada aqui toca rede ou banco: entra o blob cifrado e a chave, sai o arquivo.
 * É o que permite testá-la com um vetor conhecido — e criptografia sem teste é
 * criptografia que ninguém percebe estar quebrada, porque o sintoma é um áudio
 * que "não abre" e se atribui ao WhatsApp.
 */

export type TipoMidiaWhatsapp = 'image' | 'video' | 'audio' | 'document' | 'sticker'

/**
 * O `info` do HKDF é diferente por tipo, e trocá-lo não dá erro — dá lixo.
 *
 * Decifrar um áudio com a chave derivada de "WhatsApp Image Keys" produz bytes
 * que passam por bytes: o AES não reclama, o arquivo é gravado, e só o ouvido de
 * quem aperta play descobre. Por isso o mapa é exaustivo e o sticker aponta
 * explicitamente para o de imagem, que é o que o protocolo manda.
 */
const INFO_POR_TIPO: Record<TipoMidiaWhatsapp, string> = {
  image: 'WhatsApp Image Keys',
  video: 'WhatsApp Video Keys',
  audio: 'WhatsApp Audio Keys',
  document: 'WhatsApp Document Keys',
  sticker: 'WhatsApp Image Keys',
}

/** O MAC ocupa os últimos 10 bytes do arquivo cifrado — nunca fazem parte dele. */
const TAMANHO_MAC = 10

export interface MidiaDecifrada {
  bytes: Buffer
  /** O MAC conferiu? Falso significa chave errada ou arquivo corrompido. */
  integro: boolean
}

/**
 * Decifra a mídia. `mediaKey` vem do webhook em base64.
 *
 * O MAC é conferido e o resultado vem no retorno em vez de virar exceção: um
 * áudio que chegou truncado ainda é melhor guardado com a marca de suspeito do
 * que descartado — a mensagem existiu, e apagá-la faria a thread mentir sobre o
 * que foi dito.
 */
export function decifrarMidiaWhatsapp(
  cifrado: Uint8Array,
  mediaKeyBase64: string,
  tipo: TipoMidiaWhatsapp,
): MidiaDecifrada {
  const mediaKey = Buffer.from(mediaKeyBase64, 'base64')
  if (mediaKey.length === 0) throw new Error('mediaKey vazia.')
  if (cifrado.length <= TAMANHO_MAC) throw new Error('Arquivo cifrado curto demais.')

  /*
   * 112 bytes derivados, e a repartição não é arbitrária: 16 de IV, 32 de chave
   * de cifra, 32 de chave de MAC, e o resto é descartado. O salt é o zero de 32
   * bytes que o protocolo especifica — não é omissão.
   */
  const derivado = Buffer.from(
    hkdfSync('sha256', mediaKey, Buffer.alloc(32), INFO_POR_TIPO[tipo], 112),
  )
  const iv = derivado.subarray(0, 16)
  const chaveCifra = derivado.subarray(16, 48)
  const chaveMac = derivado.subarray(48, 80)

  const buf = Buffer.from(cifrado)
  const corpo = buf.subarray(0, buf.length - TAMANHO_MAC)
  const macRecebido = buf.subarray(buf.length - TAMANHO_MAC)

  const macCalculado = createHmac('sha256', chaveMac)
    .update(iv)
    .update(corpo)
    .digest()
    .subarray(0, TAMANHO_MAC)

  const integro =
    macRecebido.length === macCalculado.length && timingSafeEqual(macRecebido, macCalculado)

  const decifrador = createDecipheriv('aes-256-cbc', chaveCifra, iv)
  const bytes = Buffer.concat([decifrador.update(corpo), decifrador.final()])

  return { bytes, integro }
}

/**
 * A extensão que o arquivo deve ter no Storage.
 *
 * Vem do mimetype e não do nome original: o WhatsApp manda áudio de voz sem nome
 * nenhum, e um arquivo sem extensão faz o navegador recusar tocá-lo mesmo quando
 * o `content-type` está certo.
 */
export function extensaoDaMidia(mimetype: string | null | undefined, tipo: TipoMidiaWhatsapp): string {
  const m = (mimetype ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  const mapa: Record<string, string> = {
    'audio/ogg': 'ogg',
    'audio/opus': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/amr': 'amr',
    'audio/wav': 'wav',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'video/quicktime': 'mov',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'text/plain': 'txt',
  }
  if (mapa[m]) return mapa[m]
  const padrao: Record<TipoMidiaWhatsapp, string> = {
    audio: 'ogg',
    image: 'jpg',
    video: 'mp4',
    document: 'bin',
    sticker: 'webp',
  }
  return padrao[tipo]
}

/**
 * Um anexo já resolvido, como ele fica em `comunicacoes.anexos`.
 *
 * `caminho` aponta para o nosso Storage e não para o CDN do WhatsApp: aquela URL
 * expira, e uma thread que perde os áudios depois de algumas semanas é uma thread
 * que não serve de prova de nada.
 */
export interface AnexoComunicacao {
  tipo: TipoMidiaWhatsapp
  caminho: string
  mimetype: string | null
  nome: string | null
  /** Duração em segundos, quando o provedor a informa. Só áudio e vídeo. */
  segundos: number | null
  bytes: number | null
  /** Falso quando o MAC não conferiu — a tela avisa em vez de fingir. */
  integro: boolean
}
