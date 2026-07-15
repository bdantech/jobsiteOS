import express, { type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { arvoreSchema } from '../../../packages/core/src/mercado/filters.js'
import { camadaComRegraSchema } from '../../../packages/core/src/mercado/schemas.js'
import { exigirSegredo } from './auth.js'
import { pingDb, pool } from './db.js'
import { env } from './env.js'
import { logger } from './logger.js'
import { previewRegra } from './derivadas/reclassificar.js'
import {
  dispararCno,
  dispararMetricas,
  dispararReceita,
  dispararReclassificacao,
  statusJob,
  JobEmExecucaoError,
} from './jobs/index.js'

/**
 * The worker's HTTP surface. Small on purpose: it starts jobs and reports health.
 * It is called by a monthly Vercel Cron (/api/cron/mercado-receita) and, for the
 * manual fallback and the rule preview, by the Next.js server — never by a browser.
 *
 * compileToSql() lives behind these routes and MUST stay there: it is the only
 * compiler that emits SQL, and the whole reason the browser gets
 * compileToPostgrest() instead. `/jobs/preview-regra` takes a filter TREE, which
 * zod validates against the catalog before any compiler sees it — never SQL.
 */

const app = express()
app.use(express.json({ limit: '256kb' }))

// ─── /health (público: é o probe do Railway) ────────────────────────────────

app.get('/health', async (_req: Request, res: Response) => {
  const db = await pingDb()
  res.status(db ? 200 : 503).json({ ok: db, db: db ? 'ok' : 'indisponível', versao: '0.1.0' })
})

app.use(exigirSegredo)

// ─── Jobs de ingestão ───────────────────────────────────────────────────────

const opcoesJobSchema = z.object({
  sample: z.boolean().optional(),
  /**
   * The mirror. NEVER automatic (§3.1): an admin decides, from the Ingestões page,
   * that a third-party copy of the government's data is good enough this month.
   */
  fallback: z.boolean().optional(),
})

/**
 * 202, always. A Receita run downloads gigabytes from a server that regularly
 * takes hours; returning it as an HTTP response is not a thing that can work.
 * The caller polls `mercado_ingestoes`.
 */
app.post('/jobs/receita', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const opcoes = opcoesJobSchema.parse(req.body ?? {})
    const id = await dispararReceita(opcoes)
    res.status(202).json({ ingestao_id: id, status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/cno', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const opcoes = opcoesJobSchema.parse(req.body ?? {})
    const id = await dispararCno(opcoes)
    res.status(202).json({ ingestao_id: id, status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

// ─── Jobs derivados ─────────────────────────────────────────────────────────

const reclassificarSchema = z.object({ camada: camadaComRegraSchema.optional() })

app.post('/jobs/reclassificar', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { camada } = reclassificarSchema.parse(req.body ?? {})
    const id = dispararReclassificacao(camada)
    res.status(202).json({ job_id: id, status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/metricas', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const id = dispararMetricas()
    res.status(202).json({ job_id: id, status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.get('/jobs/:id', (req: Request, res: Response) => {
  const job = statusJob(req.params.id ?? '')
  if (!job) {
    res.status(404).json({ erro: 'Job não encontrado.' })
    return
  }
  res.json(job)
})

// ─── Dry-run da regra (§5.1) ────────────────────────────────────────────────

const previewSchema = z.object({
  camada: camadaComRegraSchema,
  definicao: arvoreSchema,
})

/**
 * Synchronous, and it must be: this is what the confirmation card in the Pirâmide
 * shows before someone reclassifies the whole market. It runs on the POOL, not on
 * a dedicated session — it creates nothing and writes nothing.
 */
app.post('/jobs/preview-regra', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { camada, definicao } = previewSchema.parse(req.body ?? {})
    const previa = await previewRegra(pool, camada, definicao)
    res.json(previa)
  } catch (erro) {
    next(erro)
  }
})

// ─── Erros ──────────────────────────────────────────────────────────────────

app.use((erro: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (erro instanceof z.ZodError) {
    res.status(400).json({ erro: 'Requisição inválida.', detalhes: erro.issues.map((i) => i.message) })
    return
  }
  if (erro instanceof JobEmExecucaoError) {
    res.status(409).json({ erro: erro.message })
    return
  }

  const mensagem = erro instanceof Error ? erro.message : 'Erro interno.'
  logger.error({ erro: mensagem }, 'Erro na requisição.')
  res.status(500).json({ erro: mensagem })
})

// ─── Boot ───────────────────────────────────────────────────────────────────

const servidor = app.listen(env.PORT, () => {
  logger.info({ porta: env.PORT, ambiente: env.NODE_ENV }, 'Worker do Mercado no ar.')
})

// Railway sends SIGTERM on every deploy. Stop accepting requests, but let an
// in-flight ingestion finish its current statement — killing a COPY mid-stream
// leaves a half-loaded staging table and a run stuck in `executando` forever.
for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sinal, () => {
    logger.info({ sinal }, 'Encerrando.')
    servidor.close(() => {
      void pool.end().finally(() => process.exit(0))
    })
  })
}
