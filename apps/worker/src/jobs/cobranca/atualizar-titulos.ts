import {
  extrairTitulosProducao,
  normalizarTituloProducao,
  totalDePaginasTitulosProducao,
  type MotivoDescarteTituloProducao,
  type RespostaTitulosProducao,
  type TituloProducaoNormalizado,
} from '../../../../../packages/core/src/cobranca/titulo-producao.js'
import { supabaseAdmin } from '../../db.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { requisitarJson } from '../../net/http.js'

/**
 * `cobranca/atualizar-titulos` (Prompt 07 §14): os títulos cedidos, com a liquidação,
 * vindos de `GET /api/v1/anticipation-settlements` — e, depois, o pós-sync (quitação das
 * cobranças, cobranças sem título ativo, SPE nova no bloqueio).
 *
 * ── POR QUE NÃO É MAIS A PROJEÇÃO DE `antecipacoes` (0273) ──────────────────
 * A antecipação paga continuava `BILLET_SWAPPED`, e a migração da plataforma (12/09)
 * renumerou as operações: todo vencido parecia em aberto, e as operações antigas
 * ficaram congeladas ou nunca chegaram. O endpoint novo tem o status de liquidação,
 * a data do pagamento pelo sacado, a matriz e o limite — e o histórico inteiro.
 *
 * ── DOIS MODOS ──────────────────────────────────────────────────────────────
 *   incremental — `updated_from` = o último `updatedAt` gravado, menos uma hora de folga.
 *                 A produção avança `updatedAt` a cada mudança do título (inclusive
 *                 pagamento lançado com data retroativa), então nada escapa. É o modo
 *                 das cadeias de 4h.
 *   completo    — o histórico inteiro (~14 mil, ~1 minuto em páginas de 200). É o modo
 *                 da cadeia diária e o da primeira carga: rede de segurança contra
 *                 qualquer `updatedAt` que a produção tenha deixado de avançar.
 * Sem nenhum título gravado, o incremental vira completo sozinho.
 *
 * Roda ENCADEADO depois do sync de antecipações, e não num cron próprio: a tela de
 * cobrança não pode mostrar como aberto o que a produção já baixou horas antes.
 */

export type ModoSyncTitulos = 'incremental' | 'completo'

export interface ResultadoSyncTitulos {
  modo: ModoSyncTitulos
  desde: string | null
  paginas: number
  lidos: number
  gravados: number
  descartes: Partial<Record<MotivoDescarteTituloProducao, number>>
  pos_sync: unknown
}

const CAMINHO_PADRAO = '/api/v1/anticipation-settlements'
const PAGE_SIZE = 200
/** Folga do incremental: o custo é regravar uma hora de títulos, que o upsert absorve. */
const FOLGA_MS = 60 * 60 * 1000

function urlBase(): string {
  const bruta = (env.ONEPAY_TITULOS_URL ?? env.ONEPAY_BI_URL ?? '').replace(/\/+$/, '')
  return /\/api\//.test(bruta) ? bruta : `${bruta}${CAMINHO_PADRAO}`
}

function autorizacao(): Record<string, string> {
  const token = env.ONEPAY_NF_TOKEN ?? env.ONEPAY_BI_TOKEN
  return token ? { authorization: `Bearer ${token}` } : {}
}

async function ultimoUpdatedAt(): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('titulos')
    .select('atualizado_producao_em')
    .not('atualizado_producao_em', 'is', null)
    .order('atualizado_producao_em', { ascending: false })
    .limit(1)
  if (error) throw new Error(`Falha ao ler o último título sincronizado: ${error.message}`)
  return data?.[0]?.atualizado_producao_em ?? null
}

export async function atualizarTitulosCobranca(modoPedido: ModoSyncTitulos = 'incremental'): Promise<ResultadoSyncTitulos> {
  if (!env.ONEPAY_BI_URL && !env.ONEPAY_TITULOS_URL) {
    throw new Error('ONEPAY_BI_URL não configurada — os títulos vêm da mesma API das antecipações.')
  }

  const ultimo = modoPedido === 'incremental' ? await ultimoUpdatedAt() : null
  const modo: ModoSyncTitulos = modoPedido === 'incremental' && ultimo ? 'incremental' : 'completo'
  const desde = modo === 'incremental' && ultimo ? new Date(Date.parse(ultimo) - FOLGA_MS).toISOString() : null

  const acc: ResultadoSyncTitulos = { modo, desde, paginas: 0, lidos: 0, gravados: 0, descartes: {}, pos_sync: null }
  const base = urlBase()
  logger.info({ modo, desde, base }, 'Sync de títulos da cobrança iniciado.')

  for (let page = 1; ; page++) {
    const qs = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) })
    if (desde) qs.set('updated_from', desde)
    const resp = await requisitarJson<RespostaTitulosProducao>(`${base}?${qs.toString()}`, {
      headers: autorizacao(),
      timeoutMs: 120_000,
    })
    const itens = extrairTitulosProducao(resp)
    acc.paginas++
    acc.lidos += itens.length

    const lote: TituloProducaoNormalizado[] = []
    for (const item of itens) {
      const r = normalizarTituloProducao(item)
      if (r.ok) lote.push(r.titulo)
      else {
        acc.descartes[r.motivo] = (acc.descartes[r.motivo] ?? 0) + 1
        logger.warn({ id: r.id, motivo: r.motivo }, 'Título descartado no sync.')
      }
    }

    if (lote.length > 0) {
      const { data, error } = await supabaseAdmin.rpc('app__cobranca_ingerir_titulos', { p: lote as never })
      if (error) throw new Error(`Falha ao gravar os títulos (página ${page}): ${error.message}`)
      acc.gravados += Number(data ?? 0)
    }

    const total = totalDePaginasTitulosProducao(resp)
    if (itens.length === 0 || itens.length < PAGE_SIZE || (typeof total === 'number' && page >= total)) break
  }

  // O pós-sync lê o que acabou de chegar: quitação das cobranças e bloqueio de SPE nova.
  const { data, error } = await supabaseAdmin.rpc('app__cobranca_projetar_titulos')
  if (error) throw new Error(`Falha no pós-sync dos títulos da cobrança: ${error.message}`)
  acc.pos_sync = data

  logger.info(acc, 'Títulos da cobrança sincronizados.')
  return acc
}
