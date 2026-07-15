import { createWriteStream } from 'node:fs'
import { mkdir, rename, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { fetch } from 'undici'
import { env } from '../env.js'
import { logger } from '../logger.js'

/**
 * The Receita's file server is slow and unstable — a 700 MB part routinely dies
 * halfway through. Two defences, and they are different problems:
 *
 *   RESUME  — a dropped connection must not throw away the 600 MB already on
 *             disk. The partial file stays as `<nome>.parcial` and the next
 *             attempt asks for `Range: bytes=<tamanho>-`.
 *
 *   BACKOFF — retries are spread over HOURS, not seconds. When the server is
 *             saturated (which is most of the first week of the month), hammering
 *             it every 5 seconds burns the 5 attempts in under a minute and
 *             fails a run that would have worked at 3am.
 */

export class DownloadError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly tentativas: number,
  ) {
    super(message)
    this.name = 'DownloadError'
  }
}

export interface ProgressoDownload {
  /** Called once per attempt, BEFORE it runs. `tentativa` is 1-based. */
  onTentativa?: (tentativa: number, url: string) => Promise<void> | void
}

const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function atrasoDe(tentativa: number): number {
  // 15min → 45min → 2h15 → 6h45, plus jitter so parallel parts don't retry in lockstep.
  const base = env.RETRY_BASE_MS * env.RETRY_FATOR ** (tentativa - 1)
  return Math.round(base * (0.85 + Math.random() * 0.3))
}

async function tamanhoLocal(caminho: string): Promise<number> {
  try {
    const s = await stat(caminho)
    return s.size
  } catch {
    return 0
  }
}

/**
 * Downloads `url` into DOWNLOAD_DIR/<destino>, resuming and retrying. Returns the
 * final path. If the file is already fully downloaded (a `.parcial` that the
 * server says is complete, or a finished file), it is reused — that is what makes
 * a re-run after a crash cheap.
 */
export async function baixarComRetentativa(
  url: string,
  destino: string,
  progresso: ProgressoDownload = {},
): Promise<string> {
  const final = join(env.DOWNLOAD_DIR, destino)
  const parcial = `${final}.parcial`
  await mkdir(dirname(final), { recursive: true })

  if ((await tamanhoLocal(final)) > 0) {
    logger.info({ destino }, 'Arquivo já baixado, reutilizando.')
    return final
  }

  let ultimoErro: unknown = null

  for (let tentativa = 1; tentativa <= env.RETRY_TENTATIVAS; tentativa++) {
    if (tentativa > 1) {
      const atraso = atrasoDe(tentativa - 1)
      logger.warn(
        { url, tentativa, atraso_min: Math.round(atraso / 60000) },
        'Download falhou. Aguardando antes da próxima tentativa.',
      )
      await dormir(atraso)
    }

    await progresso.onTentativa?.(tentativa, url)

    try {
      const jaBaixado = await tamanhoLocal(parcial)
      const headers: Record<string, string> = { 'user-agent': 'JobsiteOS-Worker/1.0' }
      if (jaBaixado > 0) headers.range = `bytes=${jaBaixado}-`

      // undici's fetch (not http.get): it follows redirects — the RFB server
      // bounces /dados/... through a CDN — and gives a streaming body, so a 700 MB
      // part never lands in memory.
      const res = await fetch(url, { method: 'GET', headers, redirect: 'follow' })

      if (res.status === 416) {
        // "Range not satisfiable": we already hold the whole file.
        await res.body?.cancel()
        await rename(parcial, final)
        return final
      }
      if (res.status !== 200 && res.status !== 206) {
        await res.body?.cancel()
        throw new Error(`HTTP ${res.status}`)
      }
      if (!res.body) throw new Error('Resposta sem corpo.')

      // Asked to resume and got 200 → the server ignored Range and is sending the
      // whole file. Appending would corrupt it; start over.
      const retomando = res.status === 206 && jaBaixado > 0
      const saida = createWriteStream(parcial, retomando ? { flags: 'a' } : { flags: 'w' })

      await pipeline(Readable.fromWeb(res.body as never), saida)
      await rename(parcial, final)

      logger.info({ destino, tentativa, bytes: await tamanhoLocal(final) }, 'Download concluído.')
      return final
    } catch (erro) {
      ultimoErro = erro
      logger.error({ url, tentativa, erro: String(erro) }, 'Falha no download.')
    }
  }

  throw new DownloadError(
    `Não foi possível baixar ${url} após ${env.RETRY_TENTATIVAS} tentativas: ${String(ultimoErro)}`,
    url,
    env.RETRY_TENTATIVAS,
  )
}
