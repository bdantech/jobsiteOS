import type { Tables } from '../../../../../packages/core/src/types/database.js'
import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { env } from '../../env.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { emitirEvento } from '../../radar/eventos.js'
import { executarLote } from '../radar/lote.js'
import { criarProcessadorProtestos } from '../radar/protestos.js'
import { lerEnriquecimento } from './config.js'

/**
 * "Enriquecer sacado" — a ação PAGA do card (04r §5).
 *
 * ─── A ECONOMIA CERTA ───────────────────────────────────────────────────────
 *
 * Pagar protesto para as dezenas que já mostraram fluxo recorrente, e não para os
 * milhares da lista. É por isso que isto é um CLIQUE, com o custo na tela antes, e não
 * uma varredura noturna: 243 sacados × qualquer centavo é uma fatura que ninguém
 * aprovou, e o que separa os que valem dos que não valem é justamente o que o card já
 * mostra de graça.
 *
 * ─── O TETO É POR ORIGINADOR, E A VERDADE DELE É A SOMA ─────────────────────
 *
 * Mesma decisão do Radar e do 04l: `prospeccao_enriquecimentos` é um ledger, não um
 * contador. Um contador incrementado em paralelo diverge na primeira vez que um job
 * morre no meio, e a divergência é invisível porque o número continua parecendo número.
 *
 * O ledger é PRÓPRIO, e não `descoberta_execucoes`: aquela tabela mede descoberta de
 * CONTATO DE FORNECEDOR e tem `fornecedor_cnpj NOT NULL`. Misturar as duas faria dois
 * tetos virarem um, e quem estourasse aqui descobriria pelo botão de lá.
 */

function inicioDoMesUtc(): string {
  const h = new Date()
  return new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth(), 1)).toISOString()
}

export interface EstadoTetoProspeccao {
  gasto: number
  teto: number
  saldo: number
  cabe: boolean
  alerta: boolean
}

export async function tetoDoOriginador(
  originadorId: string | null,
  custoDoClique: number,
): Promise<EstadoTetoProspeccao> {
  const { teto_mensal_por_originador: teto, alerta_percentual: pct } = await lerEnriquecimento()

  const base = supabaseAdmin
    .from('prospeccao_enriquecimentos')
    .select('custo')
    .gte('executado_em', inicioDoMesUtc())
  const { data, error } = await (originadorId
    ? base.eq('originador_id', originadorId)
    : base.is('originador_id', null))
  if (error) throw new Error(`Falha ao apurar gasto de enriquecimento: ${error.message}`)

  const gasto = (data ?? []).reduce((s, r) => s + (Number(r.custo) || 0), 0)
  const projetado = gasto + custoDoClique
  return {
    gasto,
    teto,
    saldo: Math.max(0, teto - gasto),
    cabe: projetado <= teto,
    alerta: teto > 0 && projetado >= teto * pct,
  }
}

/** O preço da consulta, da mesma fonte que a tela mostra antes do clique. */
async function custoProtesto(): Promise<number> {
  const { data } = await supabaseAdmin.rpc('antecipacao_custo_protesto' as never)
  const c = data as unknown as { nacional?: number } | null
  return Number(c?.nacional ?? 0)
}

export interface ResultadoEnriquecer {
  ok: boolean
  motivo?: 'teto_estourado' | 'sem_card' | 'sem_credencial'
  custo?: number
  teto?: EstadoTetoProspeccao
  lote_id?: string
}

/**
 * Enriquece UM sacado do funil: protesto nacional, pelo caminho de lote do Radar.
 *
 * Síncrono e por CNPJ, não por lote de muitos: a tela mostrou "este clique custa R$
 * 8,90" e perguntou se pode. Devolver um id e mandar consultar depois transformaria uma
 * decisão de gastar dinheiro em algo que a pessoa não vê acontecer.
 */
export async function enriquecerSacado(opts: {
  cnpj: string
  originadorId: string | null
  solicitadoPor: string | null
  forcar: boolean
}): Promise<ResultadoEnriquecer> {
  if (!env.DIRECTD_API_KEY) return { ok: false, motivo: 'sem_credencial' }

  const { data: card } = await supabaseAdmin
    .from('sacados_prospeccao')
    .select('id, cnpj_sacado, sacado_nome, empresa_id, originador_id')
    .eq('cnpj_sacado', opts.cnpj)
    .maybeSingle()
  if (!card) return { ok: false, motivo: 'sem_card' }

  // O teto é o de QUEM É DONO DO CARD, não o de quem clicou. Um gestor conferindo o
  // funil de outra pessoa não deve consumir o próprio orçamento — nem escondê-lo do
  // relatório de quem realmente vai trabalhar o lead.
  const originadorId = card.originador_id ?? opts.originadorId
  const custo = await custoProtesto()
  const teto = await tetoDoOriginador(originadorId, custo)
  if (!teto.cabe && !opts.forcar) {
    return { ok: false, motivo: 'teto_estourado', custo, teto }
  }

  const { data: lote, error } = await supabaseAdmin
    .from('lotes_enriquecimento')
    .insert({
      tipo: 'protestos',
      nome: `Protesto — ${card.sacado_nome ?? opts.cnpj} (sacados por NF)`,
      definicao_filtro: {} as never,
      parametros: { cliente: false, motivo: 'prospeccao_sacado', cnpj: opts.cnpj } as never,
      status: 'aprovado',
      criado_por: opts.solicitadoPor,
    })
    .select('id')
    .single()
  if (error || !lote) throw new Error(`Falha ao abrir lote de protesto: ${error?.message}`)

  const { error: erroItem } = await supabaseAdmin
    .from('lote_itens')
    .insert({ lote_id: lote.id, cnpj: opts.cnpj, empresa_id: card.empresa_id })
  if (erroItem) throw new Error(`Falha ao inserir o item do lote: ${erroItem.message}`)
  await supabaseAdmin.from('lotes_enriquecimento').update({ total_itens: 1 }).eq('id', lote.id)

  const loteMin = {
    id: lote.id,
    tipo: 'protestos',
    parametros: { cliente: false },
  } as unknown as Tables<'lotes_enriquecimento'>
  const r = await executarLote(lote.id, criarProcessadorProtestos(loteMin))

  /*
   * O GASTO É REGISTRADO MESMO QUANDO A CONSULTA NÃO ACHA NADA.
   *
   * "Sem protesto" é resposta, e ela foi cobrada igual. Debitar só o sucesso faria o
   * teto medir descobertas em vez de dinheiro — e a primeira pessoa a gastar o mês
   * inteiro em CNPJs limpos descobriria isso pela fatura.
   */
  await supabaseAdmin.from('prospeccao_enriquecimentos').insert({
    cnpj_sacado: opts.cnpj,
    originador_id: originadorId,
    solicitado_por: opts.solicitadoPor,
    fonte: 'protesto',
    status: r.processados > 0 ? 'sucesso' : 'sem_dados',
    custo: Number(r.custo) || custo,
    lote_id: lote.id,
  })

  await emitirEvento(card.empresa_id, EVENTO_TIPOS.SACADO_PROSPECCAO_ENRIQUECIDO, {
    titulo: 'Sacado por NF enriquecido',
    resumo: `Consulta de protesto para ${card.sacado_nome ?? opts.cnpj}.`,
    url: '/antecipacao/sacados-por-nf',
    cnpj_sacado: opts.cnpj,
    custo: Number(r.custo) || custo,
  })

  logger.info({ cnpj: opts.cnpj, custo: r.custo }, 'Sacado do funil enriquecido.')
  return { ok: true, custo: Number(r.custo) || custo, teto, lote_id: lote.id }
}
