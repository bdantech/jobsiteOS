import { createDecipheriv, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import type { MidiaDecifrada, TipoMidiaWhatsapp } from '../transportes/midia-tipos.js'

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
 * ── POR QUE EM `server/`, E NÃO JUNTO DOS OUTROS TRANSPORTES ────────────────
 * `node:crypto`. O barril do core é importado por componente de cliente, e
 * qualquer caminho de import que leve daqui até ele põe um builtin do Node no
 * bundle do browser — o webpack do Next para com `UnhandledSchemeError` e o
 * deploy da Vercel falha, mesmo com typecheck e lint limpos. `src/server/` não é
 * reexportado pelo barril, e é essa a única garantia.
 *
 * ── E POR QUE UMA FUNÇÃO PURA ──────────────────────────────────────────────
 * Nada aqui toca rede ou banco: entra o blob cifrado e a chave, sai o arquivo.
 * É o que permite testá-la com um vetor conhecido — e criptografia sem teste é
 * criptografia que ninguém percebe estar quebrada, porque o sintoma é um áudio
 * que "não abre" e se atribui ao WhatsApp.
 */

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
