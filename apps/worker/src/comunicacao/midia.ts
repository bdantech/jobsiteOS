import {
  extensaoDaMidia,
  type AnexoComunicacao,
  type MidiaDoWebhook,
} from '../../../../packages/core/src/transportes/index.js'
// A decifragem vive em `server/` porque importa `node:crypto`: o barril do core é
// importado por componente de cliente, e um builtin do Node ali dentro quebra o
// build da web com typecheck limpo.
import { decifrarMidiaWhatsapp } from '../../../../packages/core/src/server/midia-whatsapp.js'
import { supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'

/**
 * O ÁUDIO PASSA A TOCAR (§2 da 0164).
 *
 * O webhook entrega uma URL do CDN do WhatsApp e uma `mediaKey`. O que está
 * naquela URL é AES-256-CBC, e a URL EXPIRA — guardá-la no ledger faria a thread
 * perder os áudios em algumas semanas, que é o mesmo que não os ter.
 *
 * ── POR QUE É SÍNCRONO, E NÃO UMA FILA ─────────────────────────────────────
 * Uma nota de voz tem dezenas de kilobytes; baixar, decifrar e subir custa
 * centenas de milissegundos. Uma fila daria durabilidade que aqui não compensa a
 * complexidade: seriam mais uma tabela, mais um cron e mais um estado "pendente"
 * que a tela precisaria saber renderizar.
 *
 * O que NÃO é negociável é a ordem: a mensagem entra no ledger PRIMEIRO, e a
 * mídia é anexada depois. Se o download falhar, a bolha existe com o texto
 * "(áudio)" e um erro ao lado — e não some junto com o arquivo.
 */

/** Teto por arquivo. O bucket recusa acima disso; parar antes evita o download. */
const LIMITE_BYTES = 25 * 1024 * 1024
const BUCKET = 'comunicacao-midia'

export async function baixarEGuardarMidia(args: {
  midia: MidiaDoWebhook
  conversaId: string | null
  comunicacaoId: string
}): Promise<AnexoComunicacao | null> {
  const { midia, conversaId, comunicacaoId } = args
  if (midia.bytes !== null && midia.bytes > LIMITE_BYTES) {
    logger.warn({ comunicacaoId, bytes: midia.bytes }, 'Mídia acima do teto; não baixada.')
    return null
  }

  try {
    const res = await fetch(midia.url, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) {
      logger.error({ comunicacaoId, status: res.status }, 'Falha ao baixar a mídia do WhatsApp.')
      return null
    }
    const cifrado = new Uint8Array(await res.arrayBuffer())
    if (cifrado.byteLength > LIMITE_BYTES) {
      logger.warn({ comunicacaoId }, 'Mídia baixada acima do teto; descartada.')
      return null
    }

    const { bytes, integro } = decifrarMidiaWhatsapp(cifrado, midia.mediaKey, midia.tipo)
    if (!integro) {
      // Guardar assim mesmo: o MAC quebrado quase sempre é um byte a mais na
      // borda, e um arquivo suspeito é mais útil que nenhum. A tela avisa.
      logger.warn({ comunicacaoId }, 'MAC da mídia não conferiu — guardada como suspeita.')
    }

    /*
     * O caminho começa pelo id da CONVERSA porque é ele que a policy do bucket
     * usa como âncora: a permissão do arquivo passa a ser a mesma da thread, e o
     * áudio deixa de ser um jeito de contornar a regra de carteira por um link.
     */
    const caminho = `${conversaId ?? 'sem-conversa'}/${comunicacaoId}.${extensaoDaMidia(midia.mimetype, midia.tipo)}`
    const up = await supabaseAdmin.storage.from(BUCKET).upload(caminho, bytes, {
      contentType: midia.mimetype ?? 'application/octet-stream',
      upsert: true,
    })
    if (up.error) {
      logger.error({ comunicacaoId, erro: up.error.message }, 'Falha ao guardar a mídia.')
      return null
    }

    return {
      tipo: midia.tipo,
      caminho,
      mimetype: midia.mimetype,
      nome: midia.nome,
      segundos: midia.segundos,
      bytes: bytes.byteLength,
      integro,
    }
  } catch (erro) {
    logger.error({ comunicacaoId, erro: String(erro) }, 'Erro ao processar a mídia do WhatsApp.')
    return null
  }
}

/** Anexa o arquivo à linha do ledger que já existe. */
export async function anexarNoLedger(comunicacaoId: string, anexo: AnexoComunicacao): Promise<void> {
  const { error } = await supabaseAdmin
    .from('comunicacoes')
    .update({ anexos: [anexo] as never })
    .eq('id', comunicacaoId)
  if (error) logger.error({ comunicacaoId, erro: error.message }, 'Falha ao anexar a mídia.')
}

/**
 * O texto que a bolha mostra quando a mensagem é só mídia.
 *
 * Sem isto a conversa vira uma sequência de bolhas vazias, e a lista do inbox
 * mostra "—" no lugar da prévia: a pessoa não sabe se recebeu um áudio ou se a
 * mensagem se perdeu.
 */
export function legendaDaMidia(midia: MidiaDoWebhook, corpo: string | null): string | null {
  if (corpo && corpo.trim() !== '') return corpo
  const rotulo: Record<MidiaDoWebhook['tipo'], string> = {
    audio: midia.segundos ? `(áudio · ${midia.segundos}s)` : '(áudio)',
    image: '(imagem)',
    video: '(vídeo)',
    document: midia.nome ? `(documento · ${midia.nome})` : '(documento)',
    sticker: '(figurinha)',
  }
  return rotulo[midia.tipo]
}
