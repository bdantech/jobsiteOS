import { AsyncLocalStorage } from 'node:async_hooks'
import type { NextFunction, Request, Response } from 'express'
import {
  CABECALHO_CRON_ACOMPANHADO,
  CABECALHO_CRON_EXECUCAO,
  CABECALHO_CRON_JOB,
} from '../../../packages/core/src/crons/saude.js'
import { pool } from './db.js'
import { logger } from './logger.js'

/**
 * A ponta do worker do registro de execuções de cron (0272).
 *
 * A rota da Vercel abre a linha em `cron_execucoes` e manda o id no cabeçalho; aqui
 * o id vira contexto da requisição, e o job que nasce dela o herda — inclusive a parte
 * que continua em segundo plano depois do 202, porque o AsyncLocalStorage segue as
 * promessas. Quem assume o job (`dispararAvulso`, `abrirIngestao`) avisa a Vercel pelo
 * cabeçalho da resposta, e fecha a linha quando termina.
 *
 * Só o PRIMEIRO job da requisição fecha a linha: um job que dispara outro por dentro
 * não pode encerrar a execução pelo filho.
 */

interface ContextoCron {
  execucaoId: string
  jobId: string | null
  res: Response
}

const contexto = new AsyncLocalStorage<ContextoCron>()

export function contextoDeCron(req: Request, res: Response, next: NextFunction): void {
  const execucaoId = req.header(CABECALHO_CRON_EXECUCAO)
  if (!execucaoId) {
    next()
    return
  }
  contexto.run({ execucaoId, jobId: null, res }, next)
}

/** O job `jobId` é o que responde por esta execução de cron. */
export function assumirExecucaoCron(jobId: string): void {
  const ctx = contexto.getStore()
  if (!ctx || ctx.jobId) return
  ctx.jobId = jobId
  if (!ctx.res.headersSent) {
    ctx.res.setHeader(CABECALHO_CRON_ACOMPANHADO, '1')
    ctx.res.setHeader(CABECALHO_CRON_JOB, jobId)
  }
}

/**
 * Fecha a execução pelo fim do job. Nunca lança: é observação, e o job já terminou.
 *
 * Falha sobrescreve qualquer estado — se a resposta saiu antes de o job ser assumido,
 * a Vercel já terá marcado `concluida` pelo 202, e o job que falhou depois precisa
 * aparecer como falha.
 */
export async function encerrarExecucaoCron(
  jobId: string,
  status: 'concluida' | 'falhou',
  erro?: unknown,
): Promise<void> {
  const ctx = contexto.getStore()
  if (!ctx || ctx.jobId !== jobId) return

  const mensagem = erro === undefined ? null : (erro instanceof Error ? erro.message : String(erro)).slice(0, 2000)
  try {
    await pool.query(
      `update cron_execucoes
          set status = $2, erro = $3, terminado_em = now(), acompanhado = true, job_id = $4
        where id = $1 and (status = 'executando' or $2 = 'falhou')`,
      [ctx.execucaoId, status, mensagem, jobId],
    )
  } catch (e) {
    logger.warn({ execucaoId: ctx.execucaoId, erro: String(e) }, 'Não foi possível fechar a execução de cron.')
  }
}
