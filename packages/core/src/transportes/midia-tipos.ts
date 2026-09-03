/**
 * Os TIPOS da mídia do WhatsApp, e o que é puro.
 *
 * ── POR QUE ISTO NÃO MORA JUNTO DA DECIFRAGEM ───────────────────────────────
 * `server/midia-whatsapp.ts` importa `node:crypto`, e o barril do core é
 * importado por componente de cliente. Um `export *` da decifragem a partir daqui
 * arrasta `node:crypto` para dentro do bundle do browser, e o webpack do Next
 * falha com `UnhandledSchemeError` — que foi exatamente como o deploy da Vercel
 * quebrou em 02/09/2026.
 *
 * `tsc --noEmit` passa nos dois casos, e é por isso que a separação precisa ser
 * uma CONVENÇÃO e não um cuidado: o que toca builtin do Node mora em
 * `src/server/`, que o barril não reexporta. `scripts/checar-barril.mjs` recusa a
 * volta.
 */

export type TipoMidiaWhatsapp = 'image' | 'video' | 'audio' | 'document' | 'sticker'

export interface MidiaDecifrada {
  bytes: Buffer
  /** O MAC conferiu? Falso significa chave errada ou arquivo corrompido. */
  integro: boolean
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
