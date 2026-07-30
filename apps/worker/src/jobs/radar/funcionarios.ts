import {
  EVENTO_TIPOS,
  crescimento12m,
  origemVence,
  type OrigemMetrica,
} from '../../../../../packages/core/src/index.js'
import type { Json, Tables } from '../../../../../packages/core/src/types/database.js'
import { supabaseAdmin } from '../../db.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { criarPacer, requisitarJson } from '../../net/http.js'
import { lerConfigFuncionarios } from '../../radar/config.js'
import { emitirEvento } from '../../radar/eventos.js'
import type { ProcessarItem, ResultadoItem } from './lote.js'

/**
 * Headcount via Apollo (04c §4).
 *
 * A fonte primária é `organizations/enrich`, que devolve `estimated_num_employees` —
 * a estimativa do Apollo para o quadro TOTAL. O fallback é o `total` do
 * `mixed_people/api_search`, que conta perfis INDEXADOS: é outra coisa, subconta
 * muito mais, e por isso vira `origem = 'apollo_search'` com confiança baixa em vez
 * de se disfarçar de mesma medida.
 *
 * O AVISO QUE PRECISA SOBREVIVER A ESTE ARQUIVO: nenhuma das duas mede canteiro de
 * obra. Uma construtora com 800 pessoas aparece com 40, porque pedreiro não tem
 * LinkedIn. O número serve para COMPARAR empresas entre si sob a mesma régua torta,
 * e é isso que faz a calibração do estimador funcionar — nunca como quadro real.
 *
 * Cada leitura é um snapshot novo em `empresa_metricas`. Nunca update: a pergunta
 * comercial é sobre a derivada ("está crescendo?"), e guardar só o último valor
 * destrói exatamente o dado que interessa.
 */

const APOLLO = 'https://api.apollo.io/api/v1'

function cabecalhos(): Record<string, string> {
  return { 'x-api-key': env.APOLLO_API_KEY ?? '', 'cache-control': 'no-cache' }
}

export interface OrgApollo {
  id?: string
  estimated_num_employees?: number | null
}

/** `organizations/enrich` — não consome crédito de revelação. */
export async function enriquecerOrganizacao(dominio: string): Promise<OrgApollo | null> {
  const resp = await requisitarJson<{ organization?: OrgApollo }>(
    `${APOLLO}/organizations/enrich?domain=${encodeURIComponent(dominio)}`,
    { method: 'POST', headers: cabecalhos(), tentativas: 2 },
  )
  return resp.organization ?? null
}

/** Fallback: quantos perfis o Apollo tem indexados desta organização. */
export async function contarPerfis(orgId: string): Promise<number | null> {
  const resp = await requisitarJson<{ pagination?: { total_entries?: number } }>(
    `${APOLLO}/mixed_people/api_search`,
    {
      method: 'POST',
      headers: { ...cabecalhos(), 'content-type': 'application/json' },
      body: JSON.stringify({ organization_ids: [orgId], page: 1, per_page: 1 }),
      tentativas: 2,
    },
  )
  const total = resp.pagination?.total_entries
  return typeof total === 'number' && total > 0 ? total : null
}

// ─── O snapshot ─────────────────────────────────────────────────────────────

export interface EntradaMetrica {
  cnpj: string
  empresaId: string | null
  metrica: 'funcionarios' | 'faturamento_anual'
  valor: number
  origem: OrigemMetrica
  confianca?: 'alta' | 'media' | 'baixa' | null
  detalhes?: Record<string, unknown>
  /** Para o backfill: a data ORIGINAL da leitura, não a de hoje. */
  capturadoEm?: string
}

/**
 * Grava o snapshot e atualiza o cache — nesta ordem, e o cache só se a origem vence.
 *
 * A série é sempre gravada, mesmo quando a origem perde. É o que permite responder
 * depois "o Apollo dizia 40 quando o cliente declarou 800", que é exatamente a
 * medida do viés de canteiro. Jogar fora a leitura pior apagaria essa evidência.
 */
export async function gravarMetrica(e: EntradaMetrica): Promise<void> {
  const capturado = e.capturadoEm ?? new Date().toISOString()

  const { error } = await supabaseAdmin.from('empresa_metricas').insert({
    empresa_id: e.empresaId,
    cnpj: e.cnpj,
    metrica: e.metrica,
    valor: e.valor,
    origem: e.origem,
    confianca: e.confianca ?? null,
    detalhes: (e.detalhes ?? {}) as Json,
    capturado_em: capturado,
  })
  if (error) {
    logger.error({ cnpj: e.cnpj, erro: error.message }, 'Falha ao gravar snapshot de métrica.')
    return
  }

  if (!e.empresaId) return // sem empresa não há cache a atualizar; a série guarda

  const { data: emp } = await supabaseAdmin
    .from('empresas')
    .select('funcionarios, funcionarios_origem, faturamento_anual, faturamento_origem')
    .eq('id', e.empresaId)
    .maybeSingle()
  if (!emp) return

  if (e.metrica === 'funcionarios') {
    if (!origemVence(e.origem, emp.funcionarios_origem)) return
    await supabaseAdmin
      .from('empresas')
      .update({
        funcionarios: Math.round(e.valor),
        funcionarios_origem: e.origem,
        funcionarios_atualizado_em: capturado,
        funcionarios_crescimento_12m: await calcularCrescimento(e.cnpj),
      })
      .eq('id', e.empresaId)
  } else {
    if (!origemVence(e.origem, emp.faturamento_origem)) return
    await supabaseAdmin
      .from('empresas')
      .update({
        faturamento_anual: e.valor,
        faturamento_origem: e.origem,
        faturamento_confianca: e.confianca ?? null,
        faturamento_atualizado_em: capturado,
      })
      .eq('id', e.empresaId)
  }
}

/**
 * Recalcula a derivada na hora em que um ponto novo entra — a única hora em que ela
 * muda. Fazer isso na view custaria uma lateral por linha em toda varredura do
 * Explorador, sobre 740 mil linhas do universo.
 */
async function calcularCrescimento(cnpj: string): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from('empresa_metricas')
    .select('valor, capturado_em')
    .eq('cnpj', cnpj)
    .eq('metrica', 'funcionarios')
    .order('capturado_em', { ascending: false })
    .limit(50)
  if (!data?.length) return null
  return crescimento12m(data.map((p) => ({ valor: Number(p.valor), capturado_em: p.capturado_em })))
}

/**
 * A consulta de headcount de um domínio, com o fallback. Devolve o que achou e a
 * procedência — quem chama decide se grava, se registra em `enriquecimentos` e se
 * emite evento.
 */
export async function consultarHeadcount(
  dominio: string,
): Promise<{ valor: number; origem: 'apollo' | 'apollo_search'; orgId: string | null } | null> {
  const org = await enriquecerOrganizacao(dominio)
  if (!org) return null

  const direto = org.estimated_num_employees
  if (typeof direto === 'number' && direto > 0) {
    return { valor: direto, origem: 'apollo', orgId: org.id ?? null }
  }

  // Sem a estimativa do Apollo, conta perfis indexados. É pior e é declarado como
  // pior — `apollo_search` fica gravado no snapshot e aparece na tela.
  if (!org.id) return null
  const perfis = await contarPerfis(org.id)
  if (perfis === null) return null
  return { valor: perfis, origem: 'apollo_search', orgId: org.id }
}

async function emitirAtualizado(
  empresaId: string | null,
  cnpj: string,
  valor: number,
  anterior: number | null,
  origem: string,
): Promise<void> {
  if (!empresaId) return
  if (anterior !== null && Math.round(anterior) === Math.round(valor)) return // nada mudou
  await emitirEvento(empresaId, EVENTO_TIPOS.FUNCIONARIOS_ATUALIZADO, {
    titulo: 'Funcionários atualizados',
    resumo:
      anterior === null
        ? `${valor} funcionários (${origem}).`
        : `Funcionários: ${anterior} → ${valor} (${origem}).`,
    cnpj,
    de: anterior,
    para: valor,
    origem,
  })
}

// ─── (1) Backfill retroativo, custo zero ────────────────────────────────────

/**
 * Varre o que JÁ foi pago.
 *
 * O snapshot nasce com `capturado_em` da leitura ORIGINAL — datar como hoje
 * inventaria uma série achatada e faria "crescimento em 12 meses" mentir na primeira
 * consulta.
 *
 * MEDIDO NA BASE REAL: hoje isto recupera ZERO. A spec supunha que o payload dos
 * enriquecimentos de contatos já carregasse `estimated_num_employees`, mas o
 * `enriquecerOrg` anterior devolvia só o `id` da organização e o resto era
 * descartado antes de chegar ao banco — os 79 payloads existentes têm apenas
 * `{creditos, revelados}`. O job fica porque a carona passou a guardar
 * `organizacao` no payload: daqui para frente ele tem o que reler, e um
 * enriquecimento interrompido antes de gravar a métrica é recuperável.
 *
 * `aguardando_webhook` entra junto de `sucesso`: aquele item JÁ chamou o
 * `organizations/enrich` e já pagou a revelação — só está esperando o telefone
 * chegar. Deixá-lo de fora descartaria 72 das 79 leituras por um detalhe de fase.
 */
export async function backfillFuncionarios(): Promise<{
  examinados: number
  gravados: number
  sem_headcount: number
}> {
  const acc = { examinados: 0, gravados: 0, sem_headcount: 0 }

  const { data: enr } = await supabaseAdmin
    .from('enriquecimentos')
    .select('cnpj, empresa_id, payload, executado_em')
    .eq('tipo', 'contatos')
    .in('status', ['sucesso', 'aguardando_webhook'])
    .not('cnpj', 'is', null)
    .order('executado_em', { ascending: true })
    .limit(5000)

  for (const e of enr ?? []) {
    acc.examinados++
    const p = (e.payload ?? {}) as Record<string, unknown>
    const org = p.organizacao as OrgApollo | undefined
    const valor = Number(org?.estimated_num_employees ?? p.estimated_num_employees ?? 0)
    if (!Number.isFinite(valor) || valor <= 0) {
      acc.sem_headcount++
      continue
    }
    if (!e.cnpj) continue

    // Idempotente: o backfill roda uma vez, mas "uma vez" costuma virar duas.
    const { count } = await supabaseAdmin
      .from('empresa_metricas')
      .select('id', { count: 'exact', head: true })
      .eq('cnpj', e.cnpj)
      .eq('metrica', 'funcionarios')
      .eq('capturado_em', e.executado_em)
    if ((count ?? 0) > 0) continue

    await gravarMetrica({
      cnpj: e.cnpj,
      empresaId: e.empresa_id,
      metrica: 'funcionarios',
      valor,
      origem: 'apollo',
      confianca: 'media',
      detalhes: { backfill: true, de: 'enriquecimento_contatos' },
      capturadoEm: e.executado_em,
    })
    acc.gravados++
  }

  logger.info(acc, 'Backfill de funcionários concluído.')
  return acc
}

// ─── (3) Sob demanda e em lote ──────────────────────────────────────────────

/** O botão "Atualizar funcionários" na ficha. Uma empresa, uma chamada. */
export async function funcionariosEmpresa(empresaId: string): Promise<{
  valor: number | null
  origem: string | null
  motivo?: string
}> {
  const { data: emp } = await supabaseAdmin
    .from('empresas')
    .select('id, cnpj, dominio, funcionarios')
    .eq('id', empresaId)
    .maybeSingle()
  if (!emp) throw new Error('Empresa não encontrada.')
  if (!emp.dominio) return { valor: null, origem: null, motivo: 'sem_dominio' }

  const cfg = await lerConfigFuncionarios()
  const r = await consultarHeadcount(emp.dominio)

  await supabaseAdmin.from('enriquecimentos').insert({
    tipo: 'funcionarios',
    fonte: r?.origem ?? 'apollo',
    empresa_id: emp.id,
    cnpj: emp.cnpj,
    dominio: emp.dominio,
    status: r ? 'sucesso' : 'sem_dados',
    custo_real: cfg.custo_unitario,
    unidades_retornadas: r ? 1 : 0,
    payload: (r ?? null) as Json,
  })

  if (!r) return { valor: null, origem: null, motivo: 'sem_dados' }

  await gravarMetrica({
    cnpj: emp.cnpj,
    empresaId: emp.id,
    metrica: 'funcionarios',
    valor: r.valor,
    origem: r.origem,
    confianca: r.origem === 'apollo' ? 'media' : 'baixa',
    detalhes: { dominio: emp.dominio, sob_demanda: true },
  })
  await emitirAtualizado(emp.id, emp.cnpj, r.valor, emp.funcionarios, r.origem)

  return { valor: r.valor, origem: r.origem }
}

/** Processador do lote `tipo = 'funcionarios'`, no fluxo padrão do Radar. */
export function criarProcessadorFuncionarios(_lote: Tables<'lotes_enriquecimento'>): ProcessarItem {
  const pace = criarPacer(300) // não custa crédito, mas custa rate limit
  const cfgPromise = lerConfigFuncionarios()

  return async (item: Tables<'lote_itens'>): Promise<ResultadoItem> => {
    if (!env.APOLLO_API_KEY) {
      return { status: 'erro', fonte: 'apollo', erro: 'APOLLO_API_KEY não configurada.' }
    }
    // Sem domínio não há o que consultar. Falha declarada, e não silêncio: é o
    // sinal de que a cascata de domínio precisa rodar antes deste lote.
    if (!item.dominio) {
      return { status: 'erro', fonte: 'apollo', erro: 'sem_dominio' }
    }

    const cfg = await cfgPromise
    await pace()

    let r: Awaited<ReturnType<typeof consultarHeadcount>>
    try {
      r = await consultarHeadcount(item.dominio)
    } catch (e) {
      return { status: 'erro', fonte: 'apollo', erro: String(e) }
    }
    if (!r) {
      return { status: 'sem_dados', fonte: 'apollo', resultado: { motivo: 'organização sem headcount no Apollo' } }
    }

    if (item.cnpj) {
      const { data: emp } = item.empresa_id
        ? await supabaseAdmin.from('empresas').select('funcionarios').eq('id', item.empresa_id).maybeSingle()
        : { data: null }

      await gravarMetrica({
        cnpj: item.cnpj,
        empresaId: item.empresa_id,
        metrica: 'funcionarios',
        valor: r.valor,
        origem: r.origem,
        confianca: r.origem === 'apollo' ? 'media' : 'baixa',
        detalhes: { dominio: item.dominio, lote: true },
      })
      await emitirAtualizado(item.empresa_id, item.cnpj, r.valor, emp?.funcionarios ?? null, r.origem)
    }

    return {
      status: 'sucesso',
      fonte: r.origem,
      custo: cfg.custo_unitario,
      unidades: 1,
      resultado: { estimated_num_employees: r.valor, origem: r.origem },
    }
  }
}
