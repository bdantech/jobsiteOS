import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import {
  calcularReceitaEsperada,
  diasParaVencimento,
  formatarMoeda,
} from '../../../../../packages/core/src/antecipacao/economia.js'
import { calcularTac } from '../../../../../packages/core/src/credito/precificacao.js'
import {
  MOTIVOS_DESCARTE_TITULO,
  extrairTitulos,
  normalizarTituloPayload,
  totalDePaginasTitulo,
  type MotivoDescarteTitulo,
  type RespostaTitulo,
  type TituloNormalizado,
  type TituloPayload,
} from '../../../../../packages/core/src/funil/titulo-payload.js'
import {
  montarJanelaFunil,
  querystringFunil,
  type ModoSyncFunil,
} from '../../../../../packages/core/src/funil/sync-plano.js'
import { tituloEntraNoFunil } from '../../../../../packages/core/src/funil/entrada.js'
import type { ConfigEconomia } from '../../../../../packages/core/src/antecipacao/schemas.js'
import { lerConfigEconomia } from '../../antecipacao/config.js'
import {
  enfileirarLookup,
  resolverEmpresa,
  tacDoSacado,
  taxaDaAnalise,
  taxaDoUltimoSnapshot,
} from '../../antecipacao/sacado-precificado.js'
import { lerConfigFunilOportunidades } from '../../funil/config.js'
import { supabaseAdmin } from '../../db.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { requisitarJson } from '../../net/http.js'
import { emitirEvento } from '../../radar/eventos.js'
import { limiteDoSacado } from './limite.js'

/**
 * Sync dos TÍTULOS SIENGE (04s §3) — uma linha por PARCELA.
 *
 * ── O QUE ESTA FONTE É ──────────────────────────────────────────────────────
 * O contas-a-pagar da construtora, lido pela conexão com o ERP dela. É o funil
 * visto do outro lado: enquanto a NF chega pelo certificado do fornecedor, a
 * parcela chega pela construtora — e ela sabe coisas que a nota não sabe, como o
 * número de parcelas e se o pagamento já foi ao banco.
 *
 * ── AS ARMADILHAS DO §2.2, TODAS AQUI ───────────────────────────────────────
 * A janela filtra por `firstSeenAt` e NUNCA por `hydratedAt` — o segundo muda a
 * cada releitura, e usá-lo faria a janela curta trazer eternamente as mesmas
 * parcelas. A retenção é tri-estado e chega do core preservada. O `bill_id` nunca
 * viaja sozinho. O credor PF fica fora do roteamento e do agrupamento.
 */

export interface ResultadoSyncTitulos {
  modo: ModoSyncFunil
  janela: string
  paginas: number
  lidas: number
  novas: number
  atualizadas: number
  no_funil: number
  fora_do_funil: Record<string, number>
  descartes: Record<MotivoDescarteTitulo | 'erro_upsert', number>
  transicoes: number
  /** `not_eligible` que um originador resolve — trabalho, não ruído. */
  recuperaveis: number
  /** Pagas no ERP sem antecipar. O dinheiro estava lá e passou. */
  perdidas_para_o_erp: number
  credores_pf: number
  eventos: number
  cnpjs_enfileirados: number
}

const CAMINHO_PADRAO = '/api/v1/sienge-installments'

function autorizacao(): Record<string, string> {
  const token = env.ONEPAY_NF_TOKEN ?? env.ONEPAY_BI_TOKEN
  return token ? { authorization: `Bearer ${token}` } : {}
}

function urlBase(): string {
  const bruta = (env.ONEPAY_BI_URL ?? '').replace(/\/+$/, '')
  return `${bruta}${CAMINHO_PADRAO}`
}

function descartesZerados(): ResultadoSyncTitulos['descartes'] {
  const zero = { erro_upsert: 0 } as ResultadoSyncTitulos['descartes']
  for (const m of MOTIVOS_DESCARTE_TITULO) zero[m] = 0
  return zero
}

export async function sincronizarTitulosSienge(
  modo: ModoSyncFunil = 'novidade',
): Promise<ResultadoSyncTitulos> {
  if (!env.ONEPAY_BI_URL) {
    throw new Error('ONEPAY_BI_URL não configurada — é a mesma API do sync de NFs.')
  }

  const [cfg, cfgEconomia] = await Promise.all([lerConfigFunilOportunidades(), lerConfigEconomia()])
  const janela = montarJanelaFunil(modo, new Date(), cfg)
  const base = urlBase()

  const acc: ResultadoSyncTitulos = {
    modo,
    janela: janela.descricao,
    paginas: 0,
    lidas: 0,
    novas: 0,
    atualizadas: 0,
    no_funil: 0,
    fora_do_funil: {},
    descartes: descartesZerados(),
    transicoes: 0,
    recuperaveis: 0,
    perdidas_para_o_erp: 0,
    credores_pf: 0,
    eventos: 0,
    cnpjs_enfileirados: 0,
  }

  logger.info({ janela: janela.descricao, base }, 'Sync de títulos Sienge iniciado.')

  let page = 1
  for (;;) {
    const url = `${base}?${querystringFunil(janela, page, cfg.page_size)}`
    const resp = await requisitarJson<RespostaTitulo>(url, {
      headers: autorizacao(),
      timeoutMs: 120_000,
    })

    const itens = extrairTitulos(resp)
    acc.paginas++

    for (const item of itens) {
      await processar(item, cfg, cfgEconomia, acc)
      acc.lidas++
    }

    const total = totalDePaginasTitulo(resp)
    const acabou =
      itens.length === 0 ||
      itens.length < cfg.page_size ||
      (typeof total === 'number' && page >= total)
    if (acabou) break
    page++
  }

  logger.info(acc, 'Sync de títulos Sienge concluído.')
  return acc
}

type CfgFunil = Awaited<ReturnType<typeof lerConfigFunilOportunidades>>

async function processar(
  item: TituloPayload,
  cfg: CfgFunil,
  cfgEconomia: ConfigEconomia,
  acc: ResultadoSyncTitulos,
): Promise<void> {
  const r = normalizarTituloPayload(item)
  if (!r.ok) {
    logger.warn({ id: r.id, motivo: r.motivo }, 'Título Sienge descartado no sync.')
    acc.descartes[r.motivo]++
    return
  }
  const t: TituloNormalizado = r.titulo

  const gravado = await linhaGravada(t.id_externo)
  const veredito = tituloEntraNoFunil(t, cfg)
  if (veredito.entra) acc.no_funil++
  else acc.fora_do_funil[veredito.motivo] = (acc.fora_do_funil[veredito.motivo] ?? 0) + 1

  if (t.credor_pessoa_fisica) acc.credores_pf++
  if (veredito.entra && t.situation === 'not_eligible') acc.recuperaveis++
  if (t.situation === 'paid_in_erp') acc.perdidas_para_o_erp++

  const dias = diasParaVencimento(t.vencimento)
  const matriz = t.sacado_matriz_cnpj

  const { receita, taxa } = calcularReceitaEsperada({
    valor: t.valor,
    diasParaVencimento: dias,
    taxaMensal: await taxaDoUltimoSnapshot(matriz),
    taxaPadrao: cfgEconomia.taxa_mensal_padrao,
  })
  const tac = calcularTac(t.valor, ...(await tacDoSacado(matriz, cfgEconomia)))
  const analise = await taxaDaAnalise(matriz)
  const limite = await limiteDoSacado(matriz)

  /*
   * O CREDOR PF não vira empresa, e isso é a regra e não uma falta.
   *
   * `creditor.taxId` nulo é pessoa física. Ele não casa com `empresas`, não entra
   * no roteamento e não entra no agrupamento por fornecedor — juntar todos os
   * credores sem CNPJ criaria um fornecedor fictício com o volume somado de
   * centenas de pessoas diferentes, e esse fornecedor apareceria no topo de
   * qualquer lista ordenada por valor.
   */
  const credor = t.credor_cnpj
    ? await resolverEmpresa(t.credor_cnpj, { name: t.credor_nome, registered: null })
    : { empresaId: null, conhecido: false }
  const sacado = await resolverEmpresa(matriz, { name: t.sacado_nome, registered: true })

  const linha = {
    id_externo: t.id_externo,
    situation: t.situation,
    situation_anterior:
      gravado && gravado.situation !== t.situation
        ? gravado.situation
        : (gravado?.situation_anterior ?? null),
    guard_reason: t.guard_reason,
    exception_code: t.exception_code,
    primeira_vez_visto: t.primeira_vez_visto,
    hidratado_em: t.hidratado_em,
    installment_id: t.installment_id,
    installment_number: t.installment_number,
    valor: t.valor,
    retencao: t.retencao,
    vencimento: t.vencimento,
    erp_situacao: t.erp_situacao,
    enviado_banco: t.enviado_banco,
    tipo_pagamento: t.tipo_pagamento,
    erp_pago_em: t.erp_pago_em,
    erp_removido_em: t.erp_removido_em,
    nfe_candidate_access_key: t.nfe_candidate_access_key,
    nfe_candidate_count: t.nfe_candidate_count,
    write_back_status: t.write_back_status,
    write_back_repointed_em: t.write_back_repointed_em,
    bill_id: t.bill_id,
    bill_document_number: t.bill_document_number,
    bill_document_type: t.bill_document_type,
    bill_origin: t.bill_origin,
    bill_status: t.bill_status,
    bill_access_key: t.bill_access_key,
    bill_issue_date: t.bill_issue_date,
    bill_total: t.bill_total,
    bill_retencao_total: t.bill_retencao_total,
    connection_id: t.connection_id,
    connection_subdomain: t.connection_subdomain,
    sacado_cnpj: t.sacado_cnpj,
    sacado_matriz_cnpj: matriz,
    sacado_nome: t.sacado_nome,
    sacado_empresa_id: sacado.empresaId,
    credor_cnpj: t.credor_cnpj,
    credor_nome: t.credor_nome,
    credor_erp_id: t.credor_erp_id,
    credor_pessoa_fisica: t.credor_pessoa_fisica,
    credor_empresa_id: credor.empresaId,
    credor_cadastrado: credor.empresaId !== null,
    pre_autorizacao_id_externo: t.pre_autorizacao_id_externo,
    anticipation_id_externo: t.anticipation_id_externo,
    anticipation_status: t.anticipation_status,
    anticipation_net: t.anticipation_net,
    numero_normalizado: t.numero_normalizado,
    receita_esperada: receita,
    taxa_usada: taxa,
    tac_estimada: tac,
    seguro_estimado: cfgEconomia.seguro_por_nota,
    dias_para_vencimento: dias,
    limite_disponivel_sacado: limite.disponivel,
    limite_sacado_origem: limite.origem,
    taxa_analise_am: analise.taxa,
    taxa_analise_origem: analise.origem,
    /*
     * A CONVERSÃO é casamento direto por id, sem matching fuzzy (§9).
     *
     * A parcela converteu quando `anticipation.anticipationId` está preenchido — e a
     * ordem aqui importa: `removed_in_erp` MANTÉM o `anticipation` como histórico da
     * operação cancelada, então ler o id primeiro faria uma parcela removida entrar
     * no relatório como receita que não existe. O veredito de situação vem antes, e
     * `estagioDeSaida` já mandou a removida para `perdida`.
     */
    ...(t.anticipation_id_externo !== null && veredito.entra
      ? { estagio_funil: 'convertida', estagio_alterado_em: new Date().toISOString() }
      : gravado
        ? veredito.entra
          ? {}
          : {
              estagio_funil: estagioDeSaida(veredito.motivo),
              estagio_alterado_em: new Date().toISOString(),
            }
        : { estagio_funil: veredito.entra ? 'a_prospectar' : estagioDeSaida(veredito.motivo) }),
    raw: item as never,
    sincronizado_em: new Date().toISOString(),
  }

  const { error } = await supabaseAdmin
    .from('sienge_titulos')
    .upsert(linha as never, { onConflict: 'id_externo' })
  if (error) {
    logger.error({ id: t.id_externo, erro: error.message }, 'Falha no upsert do título Sienge.')
    acc.descartes.erro_upsert++
    return
  }

  if (gravado) acc.atualizadas++
  else acc.novas++

  if (t.credor_cnpj) {
    acc.cnpjs_enfileirados += await enfileirarLookup(t.credor_cnpj, 'fornecedor_nf', credor.conhecido)
  }
  acc.cnpjs_enfileirados += await enfileirarLookup(matriz, 'sacado_nf', sacado.conhecido)

  acc.eventos += await emitirEventos(t, gravado, credor.empresaId, acc)
}

/**
 * Para onde a parcela vai quando sai do funil.
 *
 * `paid_in_erp` é PERDIDA e não expirada, e a diferença aparece no relatório: uma
 * parcela expirada é o calendário; uma paga no ERP é a construtora tendo pago com
 * o caixa dela um recebível que poderíamos ter antecipado. A segunda é competição,
 * e competição perdida precisa de nome próprio.
 */
function estagioDeSaida(motivo: string): string {
  if (motivo === 'pago_no_erp') return 'perdida'
  if (motivo === 'removido_no_erp') return 'perdida'
  /*
   * O resto — guardReason sem conserto, credor pessoa física — vai para
   * `expirada`, que é o balde neutro de "não há o que fazer aqui".
   *
   * NÃO vai para `perdida`: perda é o que poderíamos ter ganhado e não ganhamos,
   * e inflar a métrica com o que nunca foi ganhável apaga justamente o que ela
   * mede. Um credor CPF nunca foi uma operação possível.
   */
  return 'expirada'
}

async function linhaGravada(
  id: number,
): Promise<{ situation: string; situation_anterior: string | null } | null> {
  const { data } = await supabaseAdmin
    .from('sienge_titulos')
    .select('situation, situation_anterior')
    .eq('id_externo', id)
    .maybeSingle()
  return (data as { situation: string; situation_anterior: string | null } | null) ?? null
}

async function emitirEventos(
  t: TituloNormalizado,
  gravado: { situation: string } | null,
  empresaId: string | null,
  acc: ResultadoSyncTitulos,
): Promise<number> {
  if (!empresaId) return 0

  let n = 0
  const alvo = `${t.credor_nome ?? t.credor_cnpj ?? 'credor PF'} → ${t.sacado_nome ?? t.sacado_cnpj}`
  const url = `/antecipacao?oportunidade=titulo:${t.id_externo}`
  const parcela = t.installment_number !== null ? `parcela ${t.installment_number}` : 'parcela'

  if (!gravado) {
    await emitirEvento(empresaId, EVENTO_TIPOS.TITULO_SINCRONIZADO, {
      titulo: 'Nova parcela no ERP da construtora',
      resumo: `${alvo}: ${formatarMoeda(t.valor)} — ${parcela} do documento ${t.bill_document_number ?? t.bill_id}.`,
      url,
      titulo_id: t.id_externo,
      valor: t.valor,
    })
    n++
  }

  if (gravado && gravado.situation !== t.situation) {
    acc.transicoes++

    /*
     * Três transições, três eventos DIFERENTES — porque três trabalhos diferentes.
     *
     * `paid_in_erp` não pede ação nenhuma: acabou, e vira número no bloco de perdas.
     * `not_eligible` recuperável é uma tarefa concreta para o originador (quase
     * sempre: cadastrar o fornecedor). O resto é informação de acompanhamento.
     */
    const pagou = t.situation === 'paid_in_erp'
    const recuperavel = t.situation === 'not_eligible' && t.guard_reason !== null

    const tipo = pagou
      ? EVENTO_TIPOS.TITULO_PAGO_NO_ERP
      : recuperavel
        ? EVENTO_TIPOS.TITULO_NAO_ELEGIVEL_RECUPERAVEL
        : EVENTO_TIPOS.TITULO_SITUACAO_ALTERADA

    await emitirEvento(empresaId, tipo, {
      titulo: pagou
        ? 'Parcela paga no ERP sem antecipar'
        : recuperavel
          ? 'Parcela destravável pelo originador'
          : 'Situação da parcela mudou',
      resumo: pagou
        ? `${alvo}: ${formatarMoeda(t.valor)} — a construtora pagou com o caixa dela.`
        : recuperavel
          ? `${alvo}: ${formatarMoeda(t.valor)} — não elegível por ${t.guard_reason}.`
          : `${alvo}: ${formatarMoeda(t.valor)} — ${gravado.situation} → ${t.situation}.`,
      url,
      de: gravado.situation,
      para: t.situation,
      guard_reason: t.guard_reason,
      titulo_id: t.id_externo,
      valor: t.valor,
    })
    n++
  }

  return n
}
