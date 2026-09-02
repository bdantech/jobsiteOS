import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'

/**
 * Traz para o nosso bucket o documento que a plataforma de produção declarou por
 * URL (04n §2.2).
 *
 * ── POR QUE NÃO GUARDAR O LINK ─────────────────────────────────────────────
 * O documento é a base de uma decisão de crédito. Uma URL externa vira 404 no dia
 * em que o outro lado faz uma limpeza, e aí a análise perde o que a sustentava —
 * inclusive para uma auditoria, que acontece justamente muito depois. O §2.2 é
 * explícito: o documento tem que viver conosco.
 *
 * ── O QUE ESTE JOB RECUSA ──────────────────────────────────────────────────
 * Tipo fora da lista e tamanho acima do teto, e recusa ANTES de escrever no
 * bucket: um HTML de página de erro tem 200 e `content-type: text/html`, e
 * gravá-lo como se fosse o balanço só adia a descoberta para o dia em que alguém
 * abrir o arquivo.
 *
 * A URL de origem fica registrada no erro quando falha — sem ela, "documento não
 * baixou" não diz de onde ele deveria ter vindo.
 */

const TIMEOUT_MS = 30_000
const TETO_PADRAO_MB = 20

const EXTENSAO_POR_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
}

export interface ResultadoDownload {
  ok: boolean
  doc_id: string
  motivo?: string
  bytes?: number
}

export async function baixarDocumentoExterno(docId: string): Promise<ResultadoDownload> {
  const { data: doc } = await supabaseAdmin
    .from('analise_docs')
    .select('id, analise_id, tipo, nome_arquivo, arquivo_url, origem')
    .eq('id', docId)
    .maybeSingle()

  if (!doc) return { ok: false, doc_id: docId, motivo: 'Documento não encontrado.' }

  const url = doc.arquivo_url ?? ''
  // Já é caminho do bucket (não começa com http): nada a fazer. Torna o job
  // idempotente — reprocessar não baixa de novo.
  if (!/^https?:\/\//i.test(url)) {
    return { ok: true, doc_id: docId, motivo: 'Já está no bucket.' }
  }

  const teto = (await lerTetoMb()) * 1024 * 1024

  let resposta: Response
  try {
    resposta = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (e) {
    return await falhar(docId, url, e instanceof Error ? e.message : String(e))
  }

  if (!resposta.ok) {
    return await falhar(docId, url, `A origem respondeu ${resposta.status}.`)
  }

  const mime = (resposta.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  const ext = EXTENSAO_POR_MIME[mime]
  if (!ext) {
    return await falhar(docId, url, `Tipo não aceito: ${mime || 'desconhecido'}.`)
  }

  const buffer = Buffer.from(await resposta.arrayBuffer())
  if (buffer.byteLength > teto) {
    return await falhar(docId, url, `Arquivo de ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB passa do teto.`)
  }

  const nome = (doc.nome_arquivo ?? `${doc.tipo}.${ext}`).replace(/[^\w.\-]/g, '_')
  const caminho = `${doc.analise_id}/${doc.tipo}-${Date.now()}-${nome}`

  const up = await supabaseAdmin.storage
    .from('analise-docs')
    .upload(caminho, buffer, { contentType: mime, upsert: false })
  if (up.error) return await falhar(docId, url, `Falha ao gravar no bucket: ${up.error.message}`)

  await supabaseAdmin.from('analise_docs').update({ arquivo_url: caminho }).eq('id', docId)

  logger.info({ docId, bytes: buffer.byteLength, caminho }, 'Documento externo baixado.')
  return { ok: true, doc_id: docId, bytes: buffer.byteLength }
}

async function lerTetoMb(): Promise<number> {
  const { data } = await supabaseAdmin
    .from('credito_config')
    .select('valor')
    .eq('chave', 'api')
    .maybeSingle()
  const cfg = (data?.valor ?? {}) as { documento_max_mb?: number }
  return cfg.documento_max_mb ?? TETO_PADRAO_MB
}

/**
 * A linha FICA, com o motivo no nome do arquivo.
 *
 * Apagá-la esconderia do Crédito que a produção mandou um documento — e o
 * checklist passaria a dizer "faltando" sobre algo que alguém jurou ter enviado.
 * A discussão que se quer ter é "por que não baixou", não "você mandou mesmo?".
 */
async function falhar(docId: string, url: string, motivo: string): Promise<ResultadoDownload> {
  logger.warn({ docId, url, motivo }, 'Não foi possível baixar o documento externo.')
  await supabaseAdmin
    .from('analise_docs')
    .update({ nome_arquivo: `[falha ao baixar] ${motivo}` })
    .eq('id', docId)
  return { ok: false, doc_id: docId, motivo }
}
