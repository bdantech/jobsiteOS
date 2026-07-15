import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { sessaoDedicada } from '../db.js'
import { logger } from '../logger.js'
import {
  abrirIngestao,
  anotarMeta,
  concluirIngestao,
  falharIngestao,
  type Contadores,
} from '../ingestoes.js'
import { detectarSpes } from '../derivadas/spe.js'
import { montarGrupos } from '../derivadas/grupos.js'
import { atualizarMetricas } from '../derivadas/metricas.js'
import { reclassificar } from '../derivadas/reclassificar.js'
import { promoverElegiveis } from '../derivadas/promover.js'
import { ingerirReceita, type OpcoesReceita } from './receita.js'
import { ingerirCno, type OpcoesCno } from './cno.js'

/**
 * Jobs are ASYNC, always. A Receita run downloads several gigabytes from a server
 * that is having a bad decade; it can take four hours. There is no HTTP client on
 * earth — least of all a Vercel Cron — that will hold that connection open, so the
 * route returns 202 with an id and the caller watches `mercado_ingestoes`.
 */

export type TipoJob = 'receita' | 'cno' | 'reclassificar' | 'metricas'

/** Single-flight, per job kind. Two concurrent Receita runs would COPY the same
 *  2M rows into the same tables and fight over the staging temp tables. */
const emExecucao = new Map<TipoJob, string>()

export class JobEmExecucaoError extends Error {
  constructor(readonly tipo: TipoJob, readonly id: string) {
    super(`Já existe um job "${tipo}" em execução (${id}).`)
    this.name = 'JobEmExecucaoError'
  }
}

function reservar(tipo: TipoJob, id: string): void {
  const atual = emExecucao.get(tipo)
  if (atual) throw new JobEmExecucaoError(tipo, atual)
  emExecucao.set(tipo, id)
}

// ─── Derivadas (§3.2), na ordem em que dependem umas das outras ─────────────

export interface ResultadoDerivadas {
  spes_alteradas: number
  grupos: { arestas: number; grupos: number; membros: number }
  metricas: number
  reclassificacao: Awaited<ReturnType<typeof reclassificar>>
  promocao: Awaited<ReturnType<typeof promoverElegiveis>>
}

/**
 * The order is not a preference, it is a dependency chain:
 *   SPE   → is_spe is what grupo_spes_total counts.
 *   grupo → grupo_id is what the group metrics aggregate over.
 *   métricas → qtd_filiais / grupo_spes_* / obras_ativas are READ BY the rules.
 *   reclassificação → camada.
 *   promoção → reads the camada that reclassification just wrote.
 * Running metrics after reclassification would classify the whole universe against
 * last month's numbers, every month, forever.
 */
export async function rodarDerivadas(client: pg.Client): Promise<ResultadoDerivadas> {
  const spes = await detectarSpes(client)
  const grupos = await montarGrupos(client)
  const metricas = await atualizarMetricas(client)
  const reclassificacao = await reclassificar(client)
  const promocao = await promoverElegiveis(client)

  // Promotion creates `empresas` rows, and `tem_contato`/erp columns on the view
  // only exist for promoted companies. A second, cheap pass keeps the metrics
  // consistent with what the Explorador will show a minute from now.
  await atualizarMetricas(client)

  return { spes_alteradas: spes, grupos, metricas, reclassificacao, promocao }
}

// ─── Os jobs ────────────────────────────────────────────────────────────────

async function executar(
  tipo: TipoJob,
  ingestaoId: string,
  trabalho: (client: pg.Client) => Promise<Contadores & { meta?: Record<string, unknown> }>,
  fonte: 'receita_cnpj' | 'cno',
): Promise<void> {
  const client = await sessaoDedicada()
  try {
    const { meta, ...contadores } = await trabalho(client)
    await concluirIngestao(ingestaoId, fonte, contadores, meta ?? {})
  } catch (erro) {
    logger.error({ tipo, ingestaoId, erro: String(erro) }, 'Job falhou.')
    await falharIngestao(ingestaoId, fonte, erro)
  } finally {
    await client.end().catch(() => undefined)
    emExecucao.delete(tipo)
  }
}

/** Returns the `mercado_ingestoes` id immediately; the work continues in background. */
export async function dispararReceita(opcoes: OpcoesReceita): Promise<string> {
  const id = await abrirIngestao('receita_cnpj', { sample: !!opcoes.sample, fallback: !!opcoes.fallback })
  reservar('receita', id)

  void executar(
    'receita',
    id,
    async (client) => {
      const r = await ingerirReceita(client, id, opcoes)
      const derivadas = await rodarDerivadas(client)
      await anotarMeta(id, { receita: r, derivadas })
      return {
        linhas_processadas: r.linhas_processadas,
        linhas_novas: r.linhas_novas,
        linhas_atualizadas: r.linhas_atualizadas,
      }
    },
    'receita_cnpj',
  )

  return id
}

export async function dispararCno(opcoes: OpcoesCno): Promise<string> {
  const id = await abrirIngestao('cno', { sample: !!opcoes.sample, fallback: !!opcoes.fallback })
  reservar('cno', id)

  void executar(
    'cno',
    id,
    async (client) => {
      const r = await ingerirCno(client, id, opcoes)
      // Obras feed obras_ativas / m²_em_execução, which are SOM signals — so the
      // pyramid has to be recomputed, not just the metrics table.
      const derivadas = await rodarDerivadas(client)
      await anotarMeta(id, { cno: r, derivadas })
      return {
        linhas_processadas: r.linhas_processadas,
        linhas_novas: r.linhas_novas,
        linhas_atualizadas: r.linhas_atualizadas,
      }
    },
    'cno',
  )

  return id
}

// ─── Jobs sem ingestão (reclassificar / métricas) ───────────────────────────
// These write no source data, so they do not open a `mercado_ingestoes` row:
// `fonte` only admits receita_cnpj | cno | lista (migration 0011), and inventing a
// value would break the check constraint. They report through an in-memory job id.

export interface JobAvulso {
  id: string
  tipo: TipoJob
  status: 'executando' | 'concluida' | 'falhou'
  iniciado_em: string
  terminado_em?: string
  resultado?: unknown
  erro?: string
}

const avulsos = new Map<string, JobAvulso>()

export function statusJob(id: string): JobAvulso | undefined {
  return avulsos.get(id)
}

function dispararAvulso(tipo: TipoJob, trabalho: (client: pg.Client) => Promise<unknown>): string {
  const id = randomUUID()
  reservar(tipo, id)
  avulsos.set(id, { id, tipo, status: 'executando', iniciado_em: new Date().toISOString() })

  void (async () => {
    const client = await sessaoDedicada()
    try {
      const resultado = await trabalho(client)
      avulsos.set(id, {
        ...(avulsos.get(id) as JobAvulso),
        status: 'concluida',
        terminado_em: new Date().toISOString(),
        resultado,
      })
    } catch (erro) {
      logger.error({ tipo, id, erro: String(erro) }, 'Job avulso falhou.')
      avulsos.set(id, {
        ...(avulsos.get(id) as JobAvulso),
        status: 'falhou',
        terminado_em: new Date().toISOString(),
        erro: String(erro),
      })
    } finally {
      await client.end().catch(() => undefined)
      emExecucao.delete(tipo)
    }
  })()

  return id
}

/**
 * `camada` is accepted and recorded, but reclassification is ALWAYS global — and
 * that is not laziness. A company gets the HIGHEST layer whose rule matches, so
 * changing the SAM rule can move a company into SOM or out of it entirely.
 * "Reclassify only SAM" is not a well-defined operation; it would leave rows
 * holding a layer no active rule justifies.
 */
export function dispararReclassificacao(camada?: string): string {
  return dispararAvulso('reclassificar', async (client) => {
    logger.info({ camada_solicitada: camada ?? 'todas' }, 'Reclassificação sob demanda.')
    await atualizarMetricas(client)
    const reclassificacao = await reclassificar(client)
    const promocao = await promoverElegiveis(client)
    return { camada_solicitada: camada ?? null, reclassificacao, promocao }
  })
}

export function dispararMetricas(): string {
  return dispararAvulso('metricas', async (client) => {
    const spes = await detectarSpes(client)
    const grupos = await montarGrupos(client)
    const metricas = await atualizarMetricas(client)
    return { spes_alteradas: spes, grupos, metricas }
  })
}
