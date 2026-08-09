import express, { type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { arvoreSchema } from '../../../packages/core/src/mercado/filters.js'
import { camadaComRegraSchema } from '../../../packages/core/src/mercado/schemas.js'
import { exigirSegredo } from './auth.js'
import { pingDb, pool } from './db.js'
import { env } from './env.js'
import { logger } from './logger.js'
import { previewRegra } from './derivadas/reclassificar.js'
import { processarWebhookApollo, segredoWebhookValido } from './radar/apollo-webhook.js'
import {
  dispararCno,
  dispararMetricas,
  dispararPromocao,
  dispararReceita,
  dispararReclassificacao,
  dispararSincronizarOnepay,
  dispararSincronizarCertificados,
  dispararLoteRadar,
  motivoLoteNaoExecutavel,
  dispararAvisoCustoProtestos,
  dispararProtestosClientesMensal,
  dispararProtestosEmpresa,
  dispararContatosEmpresa,
  dispararSyncNfs,
  dispararSyncAntecipacoes,
  dispararPerfilRecalcular,
  dispararCalibrarEconomia,
  dispararAntecipacaoDiario,
  dispararReclassificacaoFunil,
  dispararOutbox,
  dispararContatosNf,
  dispararBackfillFuncionarios,
  dispararEstimadorMensal,
  dispararEstimativaFaturamento,
  dispararBackfillAtradius,
  dispararCreditoMensal,
  dispararDominioEmpresa,
  dispararEnviarAnalises,
  dispararEstimarPotencial,
  dispararExpirarAnalises,
  dispararPollDecisoes,
  dispararRecalcularScores,
  dispararSyncAtradius,
  dispararFuncionariosEmpresa,
  dispararFuncionariosLote,
  dispararLookupCadastral,
  dispararProtestoFornecedor,
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

// ─── Webhook do Apollo (público: o Apollo não manda o WORKER_SECRET) ─────────
// Registrado ANTES do exigirSegredo; autenticado pelo APOLLO_WEBHOOK_SECRET no
// header/query. Responde 200 sempre que autenticado (idempotente) para não provocar
// tempestade de reenvio do Apollo.
app.post('/webhooks/apollo', async (req: Request, res: Response) => {
  const recebido =
    (typeof req.query.secret === 'string' ? req.query.secret : undefined) ??
    (typeof req.headers['x-webhook-secret'] === 'string' ? (req.headers['x-webhook-secret'] as string) : undefined)
  if (!segredoWebhookValido(recebido)) {
    res.status(401).json({ erro: 'Não autorizado.' })
    return
  }
  try {
    const r = await processarWebhookApollo(req.body)
    res.status(200).json({ ok: true, ...r })
  } catch (erro) {
    logger.error({ erro: String(erro) }, 'Webhook Apollo falhou ao processar.')
    res.status(200).json({ ok: false }) // 200 mesmo em erro: não queremos reenvio.
  }
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

app.post('/jobs/promover', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const id = dispararPromocao()
    res.status(202).json({ job_id: id, status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

// ─── Radar (Prompt 03) ───────────────────────────────────────────────────────

app.post('/jobs/radar/onepay', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const id = dispararSincronizarOnepay()
    res.status(202).json({ job_id: id, status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

const loteRadarSchema = z.object({ lote_id: z.string().uuid() })

app.post('/jobs/radar/lote', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lote_id } = loteRadarSchema.parse(req.body ?? {})
    // Recusa SÍNCRONA: o 202 desta rota é fire-and-forget, então um lote inelegível
    // devolvia "enfileirado" e morria no log. Um 409 com o motivo chega na tela.
    const motivo = await motivoLoteNaoExecutavel(lote_id)
    if (motivo) {
      res.status(409).json({ erro: motivo })
      return
    }
    const id = dispararLoteRadar(lote_id)
    res.status(202).json({ job_id: id, status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/radar/protestos-clientes', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const id = dispararProtestosClientesMensal()
    res.status(202).json({ job_id: id, status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/radar/protestos-aviso', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const id = dispararAvisoCustoProtestos()
    res.status(202).json({ job_id: id, status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

const protestosEmpresaSchema = z.object({
  empresa_id: z.string().uuid(),
  incluir_spes: z.boolean().default(false),
  ano_min: z.number().int().min(1900).max(2100).nullable().default(null),
  /** Default false: a tela antiga não manda este campo, e ela continua valendo. */
  somente_afiancadas: z.boolean().default(false),
})

app.post('/jobs/radar/protestos-empresa', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { empresa_id, incluir_spes, ano_min, somente_afiancadas } = protestosEmpresaSchema.parse(
      req.body ?? {},
    )
    const id = dispararProtestosEmpresa({
      empresaId: empresa_id,
      incluirSpes: incluir_spes,
      anoMin: ano_min,
      somenteAfiancadas: somente_afiancadas,
    })
    res.status(202).json({ job_id: id, status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

/**
 * Sync de certificados digitais (04b §3). 202 e segue: o caller acompanha por
 * `mercado_ingestoes` (fonte `onepay_certificados`), como as demais ingestões.
 */
app.post('/jobs/radar/certificados', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const id = await dispararSincronizarCertificados()
    res.status(202).json({ ingestao_id: id, status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

const contatosEmpresaSchema = z.object({
  empresa_id: z.string().uuid(),
  revelar_telefone: z.boolean().optional(),
})

/** Contatos (Apollo) sob demanda de UMA empresa — o botão na ficha. Ação PAGA. */
app.post('/jobs/radar/contatos-empresa', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { empresa_id, revelar_telefone } = contatosEmpresaSchema.parse(req.body ?? {})
    const id = dispararContatosEmpresa({ empresaId: empresa_id, revelarTelefone: revelar_telefone })
    res.status(202).json({ job_id: id, status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

// ─── Antecipação (Prompt 04) ─────────────────────────────────────────────────

/**
 * 202, como os demais: o sync pagina um endpoint de terceiro e parseia XML por
 * nota, e depois ainda reclassifica o funil. O caller acompanha por
 * `mercado_ingestoes` (fonte `onepay_nf`).
 */
app.post('/jobs/antecipacao/sync-nfs', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const id = await dispararSyncNfs()
    res.status(202).json({ ingestao_id: id, status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/antecipacao/diario', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararAntecipacaoDiario(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

/**
 * Sync de antecipações + re-matching (04e), sob demanda. No ciclo normal ele roda
 * encadeado ao sync de NFs; esta rota existe para o botão "sincronizar agora" e
 * para recuperar uma corrida que falhou sem esperar 4 horas.
 */
app.post('/jobs/antecipacao/sync-antecipacoes', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const id = await dispararSyncAntecipacoes()
    res.status(202).json({ ingestao_id: id, status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

/** Calibração da economia com a carteira real (04e §5). Só mede; aplicar é da tela. */
app.post('/jobs/antecipacao/calibrar', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararCalibrarEconomia(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/antecipacao/reclassificar', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararReclassificacaoFunil(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/antecipacao/outbox', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararOutbox(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

const empresaIdSchema = z.object({ empresa_id: z.string().uuid() })
const funcionariosLoteSchema = z.object({ lote_id: z.string().uuid() })

/**
 * Cascata de domínio para UMA empresa (§3), do botão da ficha. Inclui a etapa paga do
 * Claude (R$ 0,10) porque é um clique deliberado sobre uma empresa só — e registra em
 * `enriquecimentos`, como toda tentativa que custa.
 */
app.post('/jobs/radar/dominio-empresa', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { empresa_id } = empresaIdSchema.parse(req.body ?? {})
    res.status(202).json({ job_id: dispararDominioEmpresa(empresa_id), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

/**
 * Headcount de UMA empresa (04c §4.3). `organizations/enrich` não consome crédito de
 * revelação, então não há confirmação de custo — ao contrário de protestos.
 */
app.post('/jobs/radar/funcionarios-empresa', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { empresa_id } = empresaIdSchema.parse(req.body ?? {})
    res.status(202).json({ job_id: dispararFuncionariosEmpresa(empresa_id), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/radar/funcionarios-lote', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lote_id } = funcionariosLoteSchema.parse(req.body ?? {})
    res.status(202).json({ job_id: dispararFuncionariosLote(lote_id), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

/** Backfill retroativo de headcount. Custo zero: relê payload já pago. */
app.post('/jobs/radar/backfill-funcionarios', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararBackfillFuncionarios(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

/** Mensal: calibra nos declarantes e reestima todo mundo, nesta ordem. */
app.post('/jobs/radar/estimar-faturamento', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararEstimadorMensal(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

/** Só a estimativa, sem recalibrar — para reaplicar a versão vigente. */
app.post('/jobs/radar/reestimar', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararEstimativaFaturamento(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

// ─── Crédito (Prompt 04d) ────────────────────────────────────────────────────

const enviarAnalisesSchema = z.object({ analise_ids: z.array(z.string().uuid()).optional() })

/** Mensal: calibra na carteira, pontua a base e calcula o potencial, NESTA ordem. */
app.post('/jobs/credito/mensal', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararCreditoMensal(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

/** Só os scores (+ o potencial, que depende da chance). O que ativar um scorecard dispara. */
app.post('/jobs/credito/scores', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararRecalcularScores(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

/** Só o potencial, reaplicando a versão vigente (depois de mexer em taxa, TAC ou caps). */
app.post('/jobs/credito/potencial', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararEstimarPotencial(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

/**
 * Envio à seguradora. É a ÚNICA rota que pode resolver um buyer novo — e resolver buyer
 * pode ser cobrado. Por isso ela recebe ids explícitos: um envio em massa acidental é
 * uma fatura, não um incômodo.
 */
app.post('/jobs/credito/enviar', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { analise_ids } = enviarAnalisesSchema.parse(req.body ?? {})
    res.status(202).json({ job_id: dispararEnviarAnalises(analise_ids), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/credito/poll', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararPollDecisoes(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

/** Backfill do histórico da apólice. Roda uma vez; não descobre buyer novo. */
app.post('/jobs/credito/backfill', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararBackfillAtradius(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

/** Diário: sync do que já está na apólice + poll + expiração. */
app.post('/jobs/credito/sync', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararSyncAtradius(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

/**
 * Perfil de Quem Opera (04f). Mensal, encadeado depois das calibrações — e
 * também sob demanda, do botão "Recalcular agora" do painel.
 */
app.post('/jobs/perfil/recalcular', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararPerfilRecalcular(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/credito/expirar', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararExpirarAnalises(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

const protestoFornecedorSchema = z.object({ cnpj: z.string().regex(/^[0-9]{14}$/) })

/**
 * Protesto de UM fornecedor do funil (ação PAGA) + reclassificação. O CNPJ basta:
 * fornecedor de aquisição não existe em `empresas`, e exigir a promoção antes
 * inverteria a ordem da decisão.
 */
app.post('/jobs/antecipacao/protesto-fornecedor', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cnpj } = protestoFornecedorSchema.parse(req.body ?? {})
    res.status(202).json({ job_id: dispararProtestoFornecedor({ cnpj }), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/antecipacao/lookup', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararLookupCadastral(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/antecipacao/contatos', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararContatosNf(), status: 'executando' })
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
