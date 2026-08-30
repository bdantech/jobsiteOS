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
import { callbackEscavadorValido } from './juridico/callback-auth.js'
import { registrarCallback } from './jobs/juridico/callbacks.js'
import {
  dispararCno,
  dispararMetricas,
  dispararPromocao,
  dispararReceita,
  dispararReclassificacao,
  dispararSincronizarOnepay,
  dispararSincronizarAnalisesPlataforma,
  dispararSincronizarCertificados,
  dispararLoteRadar,
  motivoLoteNaoExecutavel,
  dispararAvisoCustoProtestos,
  dispararDistribuirSdr,
  dispararSlaComercial,
  dispararSugerirPassivos,
  dispararApurarComissoes,
  dispararComissoesDiario,
  dispararFecharCompetencia,
  dispararAceitesSdr,
  dispararLiberarDormentes,
  dispararAlertaReclassificacao,
  dispararRotearNotas,
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
  dispararAnalisePropria,
  dispararDrenarAnalisesProprias,
  dispararExpirarAnalises,
  dispararEnriquecerEmpresa,
  dispararAlertasJuridico,
  dispararCallbacksJuridico,
  dispararClassificarFases,
  dispararDescobrirProcessos,
  dispararMonitoramentosJuridico,
  dispararSincronizarJuridico,
  executarParecerJuridico,
  dispararEnriquecerLeads,
  dispararSugerirReanalises,
  dispararPollDecisoes,
  dispararRecalcularScores,
  dispararSyncAtradius,
  dispararFuncionariosEmpresa,
  dispararFuncionariosLote,
  dispararLookupCadastral,
  dispararProtestoFornecedor,
  dispararFunilFornecedores,
  dispararDescobertaFornecedores,
  dispararValidarContatos,
  executarCliqueDescoberta,
  executarBuscaAprofundada,
  dispararEnviarFila,
  dispararTriagem,
  dispararGmailSync,
  dispararLembretesReuniao,
  dispararPlantao,
  dispararAgenteDecidir,
  dispararAgenteAgendados,
  statusJob,
  JobEmExecucaoError,
} from './jobs/index.js'
import {
  processarWebhookResend,
  processarWebhookWasender,
} from './jobs/comunicacao/webhooks.js'
import { segredoWasenderValido, segredoResendValido } from './comunicacao/webhook-auth.js'

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

/*
 * ─── Webhook do Escavador (público: eles não mandam o WORKER_SECRET) ────────
 *
 * Autenticado pelo `ESCAVADOR_CALLBACK_TOKEN` no header `Authorization`, que é um
 * segredo DIFERENTE do token da API — reaproveitar o token de saída aqui o
 * publicaria num header que qualquer um pode fazer a gente comparar batendo na
 * nossa URL, e é ele que gasta dinheiro.
 *
 * ── POR QUE 200 QUASE SEMPRE ───────────────────────────────────────────────
 * O Escavador reenvia até 11 vezes com backoff quando não recebe 200. A rota só
 * GRAVA a linha (idempotente pelo `uuid`, que é PK) e responde; quem processa é o
 * job. Fazer o trabalho aqui levaria dezenas de segundos, o Escavador desistiria
 * da entrega, e o reenvio chegaria com o primeiro ainda rodando.
 *
 * A MESMA rota existe em apps/web (`/api/webhooks/escavador`), porque a URL
 * cadastrada no painel deles pode apontar para qualquer uma das duas. As duas
 * gravam na mesma tabela, com a mesma chave — registrar a URL da web e a do worker
 * ao mesmo tempo não duplica nada.
 */
app.post('/webhooks/escavador', async (req: Request, res: Response) => {
  const cabecalho = req.headers.authorization ?? ''
  const recebido = cabecalho.toLowerCase().startsWith('bearer ') ? cabecalho.slice(7).trim() : cabecalho
  if (!callbackEscavadorValido(recebido)) {
    res.status(401).json({ erro: 'Não autorizado.' })
    return
  }
  try {
    const r = await registrarCallback(req.body)
    res.status(200).json({ ok: true, ...r })
  } catch (erro) {
    logger.error({ erro: String(erro) }, 'Callback do Escavador falhou ao ser gravado.')
    // 500 aqui É intencional, ao contrário do webhook do Apollo: se NÃO conseguimos
    // gravar, queremos o reenvio. A idempotência pela PK torna o reenvio seguro, e
    // perder um `novo_processo` é perder uma ação nova contra nós.
    res.status(500).json({ ok: false })
  }
})

/*
 * ─── Webhooks de comunicação (públicos: os provedores não mandam o WORKER_SECRET)
 *
 * Autenticados por segredo PRÓPRIO — `WASENDER_WEBHOOK_SECRET` e
 * `RESEND_WEBHOOK_SECRET` — que NÃO são os tokens de envio. O token de envio é
 * por conta e vive no Vault; reusá-lo aqui o publicaria num header que qualquer
 * um pode nos fazer comparar batendo na nossa URL, e é ele que manda mensagem
 * pelo nosso número. É a mesma decisão do callback do Escavador (0143).
 *
 * ── POR QUE 200 QUASE SEMPRE ───────────────────────────────────────────────
 * Os dois provedores reentregam quando não recebem 200 rápido. A rota grava
 * (idempotente pelo id da mensagem) e responde; a triagem, que chama modelo, é
 * do job. Classificar aqui estouraria o timeout do provedor e provocaria
 * exatamente a tempestade de reenvio que a idempotência está contendo.
 *
 * A MESMA rota existe em apps/web, porque a URL cadastrada no painel do provedor
 * pode apontar para qualquer uma das duas — e as duas gravam na mesma tabela com
 * a mesma chave.
 */
app.post('/webhooks/wasender', async (req: Request, res: Response) => {
  const recebido =
    (typeof req.query.secret === 'string' ? req.query.secret : undefined) ??
    (typeof req.headers['x-webhook-secret'] === 'string'
      ? (req.headers['x-webhook-secret'] as string)
      : undefined)
  if (!segredoWasenderValido(recebido)) {
    res.status(401).json({ erro: 'Não autorizado.' })
    return
  }
  try {
    const r = await processarWebhookWasender(req.body)
    res.status(200).json(r)
  } catch (erro) {
    logger.error({ erro: String(erro) }, 'Webhook do Wasender falhou ao processar.')
    res.status(200).json({ ok: false })
  }
})

app.post('/webhooks/resend', async (req: Request, res: Response) => {
  const cabecalho = req.headers['svix-signature'] ?? req.headers['x-webhook-secret']
  if (!segredoResendValido(typeof cabecalho === 'string' ? cabecalho : undefined)) {
    res.status(401).json({ erro: 'Não autorizado.' })
    return
  }
  try {
    const r = await processarWebhookResend(req.body)
    res.status(200).json(r)
  } catch (erro) {
    logger.error({ erro: String(erro) }, 'Webhook do Resend falhou ao processar.')
    res.status(200).json({ ok: false })
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

// ─── Comercial (Prompt 04g) ─────────────────────────────────────────────────

app.post('/jobs/comercial/distribuir-sdr', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararDistribuirSdr(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/comercial/sla-leads', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararSlaComercial(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/comercial/sugerir-passivos', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararSugerirPassivos(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

const apurarSchema = z.object({
  // AAAA-MM-01. Omitido = mês anterior, que é o caso do cron.
  competencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

const descobertaSchema = z.object({
  // Quantos fornecedores a rodada olha. O default do job (200) cobre a lista inteira
  // em pouco mais de três noites, na ordem do potencial.
  limite: z.coerce.number().int().min(1).max(1000).optional(),
})

const cliqueSchema = z.object({
  cnpj: z.string().regex(/^[0-9]{14}$/),
  solicitado_por: z.string().uuid().optional(),
  // Liberação do gestor para um clique que estourou o teto do originador.
  forcar: z.boolean().optional(),
})

app.post('/jobs/comercial/apurar-comissoes', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { competencia } = apurarSchema.parse(req.body ?? {})
    res.status(202).json({ job_id: dispararApurarComissoes(competencia), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

/*
 * Motor de comissões v2 (04k §10). Três rotas, três relógios diferentes:
 * o diário (titularidade + backfill + fecho no último dia útil), o horário da fila de
 * aceite e o semanal do alerta de reclassificação.
 */

app.post('/jobs/comercial/comissoes-diario', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararComissoesDiario(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/comercial/fechar-competencia', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { competencia } = apurarSchema.parse(req.body ?? {})
    res.status(202).json({ job_id: dispararFecharCompetencia(competencia), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/comercial/liberar-dormentes', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararLiberarDormentes(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/comercial/aceites-sdr', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararAceitesSdr(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/comercial/alerta-reclassificacao', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararAlertaReclassificacao(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

/*
 * Funil de cadastro de fornecedores (04l §7).
 *
 * O CLIQUE é a única rota deste arquivo que responde 200 com o resultado em vez de
 * 202 com um id — e a exceção é deliberada. A tela mostrou "este clique custa R$
 * 1,65" e perguntou se pode; devolver um id e mandar consultar depois transformaria
 * uma decisão de gastar dinheiro em algo que a pessoa não vê acontecer.
 */
app.post('/jobs/fornecedores/atualizar-funil', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararFunilFornecedores(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/fornecedores/descoberta-automatica', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limite } = descobertaSchema.parse(req.body ?? {})
    res.status(202).json({ job_id: dispararDescobertaFornecedores(limite), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/fornecedores/buscar-contatos', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const dados = cliqueSchema.parse(req.body ?? {})
      const r = await executarCliqueDescoberta({
        cnpj: dados.cnpj,
        solicitadoPor: dados.solicitado_por ?? null,
        forcar: dados.forcar ?? false,
      })
      res.status(200).json(r)
    } catch (erro) {
      next(erro)
    }
  })()
})

app.post('/jobs/fornecedores/buscar-contatos-aprofundado', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const dados = cliqueSchema.parse(req.body ?? {})
      const r = await executarBuscaAprofundada({
        cnpj: dados.cnpj,
        solicitadoPor: dados.solicitado_por ?? null,
        forcar: dados.forcar ?? false,
      })
      res.status(200).json(r)
    } catch (erro) {
      next(erro)
    }
  })()
})

app.post('/jobs/fornecedores/validar-contatos', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararValidarContatos(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/comercial/rotear-nfs', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararRotearNotas(), status: 'executando' })
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
/**
 * Análises de crédito da plataforma + detecção de ex-clientes (04h §3). Devolve
 * `ingestao_id` e não `job_id`: esta é uma ingestão registrada, e é por ela que a
 * página de Ingestões responde "de quando é esta lista?".
 */
app.post('/jobs/credito/sync-analises-plataforma', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const id = await dispararSincronizarAnalisesPlataforma()
    res.status(202).json({ ingestao_id: id, status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

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

/**
 * Backfill do histórico da apólice. Roda uma vez; não descobre buyer novo.
 *
 * `{ simular: true }` faz o ensaio: lê e mapeia tudo, relata o que faria e não grava nada.
 * É o único modo que roda fora de produção.
 */
app.post('/jobs/credito/backfill', (req: Request, res: Response, next: NextFunction) => {
  try {
    const simular = (req.body as { simular?: unknown } | undefined)?.simular === true
    res.status(202).json({ job_id: dispararBackfillAtradius(simular), status: 'executando' })
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

// ─── Análise proprietária (04j) ──────────────────────────────────────────────

const analisePropriaSchema = z.object({ analise_propria_id: z.string().uuid() })

/**
 * Roda UMA análise, do ponto em que ela parou. Chamada logo depois do RPC que a abriu e
 * de novo depois da revisão da extração — as duas metades do mesmo caminho.
 */
app.post('/jobs/credito/analise-propria', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { analise_propria_id } = analisePropriaSchema.parse(req.body ?? {})
    res.status(202).json({ job_id: dispararAnalisePropria(analise_propria_id), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

/** Rede de segurança: retoma o que ficou parado em `processando`. */
app.post('/jobs/credito/analises-drenar', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararDrenarAnalisesProprias(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

/** Diário. SUGERE reanálise — nunca executa em lote (custo de tokens). */
app.post('/jobs/credito/sugerir-reanalises', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararSugerirReanalises(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

/**
 * Enriquecimento dos leads pendentes. Sem corpo: a varredura decide o que fazer a partir
 * de `formulario_submissoes` — quem chama não escolhe leads, e por isso não pode escolher
 * gastar.
 */
app.post('/jobs/leads/enriquecer', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararEnriquecerLeads(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

const enriquecerEmpresaSchema = z.object({
  empresa_id: z.string().uuid(),
  incluir_pagos: z.boolean().default(true),
})

/** Domínio → funcionários → faturamento → score, na ordem, sobre uma empresa. */
app.post('/jobs/radar/enriquecer-empresa', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { empresa_id, incluir_pagos } = enriquecerEmpresaSchema.parse(req.body ?? {})
    res.status(202).json({
      job_id: dispararEnriquecerEmpresa({ empresaId: empresa_id, incluirPagos: incluir_pagos }),
      status: 'executando',
    })
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

// ─── Jurídico (Prompt 08) ───────────────────────────────────────────────────

const descobrirSchema = z.object({
  cnpj: z.string().optional(),
  incluirInativos: z.boolean().optional(),
  comMovimentacoes: z.boolean().optional(),
})

app.post('/jobs/juridico/descobrir', (req: Request, res: Response, next: NextFunction) => {
  try {
    const opcoes = descobrirSchema.parse(req.body ?? {})
    res.status(202).json({ job_id: dispararDescobrirProcessos(opcoes), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

const sincronizarJuridicoSchema = z.object({
  /** O botão "Atualizar agora" de UM processo. Ignora a agenda de propósito. */
  numeroCnj: z.string().optional(),
  /** Rodar mesmo fora dos dias configurados (botão do admin). */
  forcarAgenda: z.boolean().optional(),
})

app.post('/jobs/juridico/sincronizar', (req: Request, res: Response, next: NextFunction) => {
  try {
    const opcoes = sincronizarJuridicoSchema.parse(req.body ?? {})
    res.status(202).json({ job_id: dispararSincronizarJuridico(opcoes), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/juridico/callbacks', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararCallbacksJuridico(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/juridico/classificar', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { numeroCnj } = z.object({ numeroCnj: z.string().optional() }).parse(req.body ?? {})
    res.status(202).json({ job_id: dispararClassificarFases(numeroCnj), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/juridico/alertas', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararAlertasJuridico(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/juridico/monitoramentos', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararMonitoramentosJuridico(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

/**
 * SÍNCRONO, ao contrário de todos os outros jobs desta seção.
 *
 * Quem clicou "Gerar parecer" está com a tela aberta e acabou de autorizar um gasto
 * em tokens. Um 202 com id o obrigaria a recarregar a tela até o texto que ele pagou
 * aparecer. O teto de tempo é o do próprio modelo (300s), bem dentro do que uma
 * Server Action aguenta.
 */
const parecerSchema = z.object({
  numeroCnj: z.string().min(1),
  geradoPor: z.string().uuid().nullish(),
})

app.post('/jobs/juridico/parecer', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { numeroCnj, geradoPor } = parecerSchema.parse(req.body ?? {})
    const resultado = await executarParecerJuridico(numeroCnj, geradoPor ?? null)
    res.json(resultado)
  } catch (erro) {
    next(erro)
  }
})

// ─── Comunicação (05A) ──────────────────────────────────────────────────────

const limiteSchema = z.object({ limite: z.coerce.number().int().min(1).max(500).optional() })

app.post('/jobs/comunicacao/enviar-fila', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limite } = limiteSchema.parse(req.body ?? {})
    res.status(202).json({ job_id: dispararEnviarFila(limite), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/comunicacao/triagem', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limite } = limiteSchema.parse(req.body ?? {})
    res.status(202).json({ job_id: dispararTriagem(limite), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/comunicacao/gmail-sync', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararGmailSync(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/comunicacao/lembretes', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararLembretesReuniao(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/comunicacao/plantao', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ job_id: dispararPlantao(), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/agente/decidir', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limite } = limiteSchema.parse(req.body ?? {})
    res.status(202).json({ job_id: dispararAgenteDecidir(limite), status: 'executando' })
  } catch (erro) {
    next(erro)
  }
})

app.post('/jobs/agente/executar-agendados', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limite } = limiteSchema.parse(req.body ?? {})
    res.status(202).json({ job_id: dispararAgenteAgendados(limite), status: 'executando' })
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
