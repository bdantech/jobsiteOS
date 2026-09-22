import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import {
  calcularReceitaEsperada,
  diasParaVencimento,
  formatarMoeda,
} from '../../../../../packages/core/src/antecipacao/economia.js'
import { calcularTac } from '../../../../../packages/core/src/credito/precificacao.js'
import {
  MOTIVOS_DESCARTE_PREAUTH,
  extrairPreAuths,
  normalizarPreAuthPayload,
  totalDePaginasPreAuth,
  type MotivoDescartePreAuth,
  type PreAuthPayload,
  type PreAutorizacaoNormalizada,
  type RespostaPreAuth,
} from '../../../../../packages/core/src/funil/preauth-payload.js'
import {
  montarJanelaFunil,
  querystringFunil,
  type ModoSyncFunil,
} from '../../../../../packages/core/src/funil/sync-plano.js'
import { preAutorizacaoEntraNoFunil } from '../../../../../packages/core/src/funil/entrada.js'
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
import { emitirEvento, notificarPerfis } from '../../radar/eventos.js'
import { limiteDoSacado } from './limite.js'

/**
 * Sync das PRÉ-AUTORIZAÇÕES (04s §3).
 *
 * ── O QUE ESTA FONTE É ──────────────────────────────────────────────────────
 * Uma oferta de antecipação que a construtora JÁ FEZ ao fornecedor. Em
 * `WAITING_CONTRACTED` ela é o sinal mais quente do sistema inteiro: o crédito já
 * existe, o dinheiro já está reservado, e o fornecedor só não clicou. Não há nada
 * a convencer — há alguém a lembrar, antes de o relógio zerar.
 *
 * ── DUAS PASSADAS, E A SEGUNDA NÃO É OPCIONAL ───────────────────────────────
 * `modo: 'novidade'` (7 dias, encadeada ao sync de NFs de 4 em 4 horas) e
 * `modo: 'estado'` (92 dias, no diário). A segunda existe porque o endpoint filtra
 * por `createdAt`, não por atualização: uma oferta criada há vinte dias que
 * expirou HOJE jamais apareceria numa janela curta — e ela é exatamente o card que
 * precisa sair do funil.
 *
 * ── IDEMPOTENTE POR `id` ────────────────────────────────────────────────────
 * Upsert por `id_externo`. Sobrepor janelas não duplica nada; só reescreve a mesma
 * linha. É o que torna a varredura de 92 dias barata o bastante para ser diária.
 */

export interface ResultadoSyncPreAuth {
  modo: ModoSyncFunil
  janela: string
  paginas: number
  lidas: number
  novas: number
  atualizadas: number
  /** Entraram no funil; o resto foi gravado mas nasce fora dele. */
  no_funil: number
  fora_do_funil: Record<string, number>
  descartes: Record<MotivoDescartePreAuth | 'erro_upsert', number>
  transicoes: number
  expirando: number
  eventos: number
  cnpjs_enfileirados: number
}

const CAMINHO_PADRAO = '/api/v1/pre-authorizations'

function autorizacao(): Record<string, string> {
  const token = env.ONEPAY_NF_TOKEN ?? env.ONEPAY_BI_TOKEN
  return token ? { authorization: `Bearer ${token}` } : {}
}

/** Mesma API e MESMO token do sync de NFs — pedir outra variável só cria a chance
 *  de as duas divergirem no dia em que o host mudar. */
function urlBase(): string {
  const bruta = (env.ONEPAY_BI_URL ?? '').replace(/\/+$/, '')
  return `${bruta}${CAMINHO_PADRAO}`
}

function descartesZerados(): ResultadoSyncPreAuth['descartes'] {
  const zero = { erro_upsert: 0 } as ResultadoSyncPreAuth['descartes']
  for (const m of MOTIVOS_DESCARTE_PREAUTH) zero[m] = 0
  return zero
}

export async function sincronizarPreAutorizacoes(
  modo: ModoSyncFunil = 'novidade',
): Promise<ResultadoSyncPreAuth> {
  if (!env.ONEPAY_BI_URL) {
    throw new Error('ONEPAY_BI_URL não configurada — é a mesma API do sync de NFs.')
  }

  const [cfg, cfgEconomia] = await Promise.all([lerConfigFunilOportunidades(), lerConfigEconomia()])
  const janela = montarJanelaFunil(modo, new Date(), cfg)
  const base = urlBase()

  const acc: ResultadoSyncPreAuth = {
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
    expirando: 0,
    eventos: 0,
    cnpjs_enfileirados: 0,
  }

  logger.info({ janela: janela.descricao, base }, 'Sync de pré-autorizações iniciado.')

  let page = 1
  for (;;) {
    const url = `${base}?${querystringFunil(janela, page, cfg.page_size)}`
    const resp = await requisitarJson<RespostaPreAuth>(url, {
      headers: autorizacao(),
      timeoutMs: 120_000,
    })

    const itens = extrairPreAuths(resp)
    acc.paginas++

    for (const item of itens) {
      await processar(item, cfg, cfgEconomia, acc)
      acc.lidas++
    }

    const total = totalDePaginasPreAuth(resp)
    const acabou =
      itens.length === 0 ||
      itens.length < cfg.page_size ||
      (typeof total === 'number' && page >= total)
    if (acabou) break
    page++
  }

  logger.info(acc, 'Sync de pré-autorizações concluído.')
  return acc
}

type CfgFunil = Awaited<ReturnType<typeof lerConfigFunilOportunidades>>

async function processar(
  item: PreAuthPayload,
  cfg: CfgFunil,
  cfgEconomia: ConfigEconomia,
  acc: ResultadoSyncPreAuth,
): Promise<void> {
  const r = normalizarPreAuthPayload(item)
  if (!r.ok) {
    logger.warn({ id: r.id, motivo: r.motivo }, 'Pré-autorização descartada no sync.')
    acc.descartes[r.motivo]++
    return
  }
  const pre: PreAutorizacaoNormalizada = r.pre

  const gravada = await linhaGravada(pre.id_externo)

  /*
   * A regra de entrada decide o ESTÁGIO, e não se a linha existe.
   *
   * Gravar mesmo o que não entra no funil é deliberado: `paid_in_erp` do lado do
   * título e `ANTICIPATION_REQUESTED` daqui são a matéria-prima da métrica de
   * perda e da taxa de conversão (§9). Jogá-los fora na ingestão deixaria o
   * relatório sem denominador — saberíamos quantas ofertas ganhamos e nunca
   * quantas existiram.
   */
  const veredito = preAutorizacaoEntraNoFunil(pre, cfg)
  if (!veredito.entra) {
    acc.fora_do_funil[veredito.motivo] = (acc.fora_do_funil[veredito.motivo] ?? 0) + 1
  } else {
    acc.no_funil++
  }

  const dias = diasParaVencimento(pre.vencimento)

  /*
   * A MATRIZ precifica, não a SPE. `sacado_matriz_cnpj` é o que vai para a taxa, a
   * TAC e o limite — é a construtora que é analisada, e é a condição dela que a
   * plataforma aplica na hora de debitar. Usar a SPE aqui devolveria "sem análise"
   * para quase toda oferta e o funil inteiro cairia no default da carteira.
   */
  const matriz = pre.sacado_matriz_cnpj

  const { receita, taxa } = calcularReceitaEsperada({
    valor: pre.valor,
    diasParaVencimento: dias,
    taxaMensal: await taxaDoUltimoSnapshot(matriz),
    taxaPadrao: cfgEconomia.taxa_mensal_padrao,
  })
  const tac = calcularTac(pre.valor, ...(await tacDoSacado(matriz, cfgEconomia)))
  const analise = await taxaDaAnalise(matriz)
  const limite = await limiteDoSacado(matriz)

  const [fornecedor, sacado] = await Promise.all([
    resolverEmpresa(pre.fornecedor_cnpj, {
      name: pre.fornecedor_nome,
      registered: pre.fornecedor_cadastrado,
    }),
    // O sacado é resolvido pela MATRIZ: é ela que carrega a relação, a carteira e
    // o grupo econômico. A SPE fica na linha como detalhe da operação.
    resolverEmpresa(matriz, { name: pre.sacado_nome, registered: true }),
  ])

  const linha = {
    id_externo: pre.id_externo,
    status: pre.status,
    status_anterior: gravada && gravada.status !== pre.status ? gravada.status : gravada?.status_anterior ?? null,
    origin: pre.origin,
    migrated: pre.migrated,
    identification: pre.identification,
    criada_em: pre.criada_em,
    expira_em: pre.expira_em,
    solicitada_em: pre.solicitada_em,
    valor: pre.valor,
    invoice_number: pre.invoice_number,
    numero_normalizado: pre.numero_normalizado,
    vencimento: pre.vencimento,
    sacado_cnpj: pre.sacado_cnpj,
    sacado_matriz_cnpj: matriz,
    sacado_nome: pre.sacado_nome,
    sacado_empresa_id: sacado.empresaId,
    fornecedor_cnpj: pre.fornecedor_cnpj,
    fornecedor_nome: pre.fornecedor_nome,
    fornecedor_cadastrado: pre.fornecedor_cadastrado,
    fornecedor_empresa_id: fornecedor.empresaId,
    anticipation_id_externo: pre.anticipation_id_externo,
    revoked_reason: pre.revoked_reason,
    sienge_bill_id: pre.sienge_bill_id,
    sienge_installment_id: pre.sienge_installment_id,
    sienge_installment_number: pre.sienge_installment_number,
    sienge_document_number: pre.sienge_document_number,
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
     * O estágio é tocado SÓ no nascimento e na saída. Uma oferta que alguém já
     * moveu para "em negociação" não pode voltar para "a prospectar" porque o sync
     * passou de novo — é trabalho humano, e o sync não desfaz trabalho humano.
     */
    ...(gravada
      ? veredito.entra
        ? {}
        : { estagio_funil: estagioDeSaida(veredito.motivo), estagio_alterado_em: new Date().toISOString() }
      : { estagio_funil: veredito.entra ? 'a_prospectar' : estagioDeSaida(veredito.motivo) }),
    raw: item as never,
    sincronizada_em: new Date().toISOString(),
  }

  const { error } = await supabaseAdmin
    .from('pre_autorizacoes')
    .upsert(linha as never, { onConflict: 'id_externo' })
  if (error) {
    logger.error({ id: pre.id_externo, erro: error.message }, 'Falha no upsert da pré-autorização.')
    acc.descartes.erro_upsert++
    return
  }

  if (gravada) acc.atualizadas++
  else acc.novas++

  acc.cnpjs_enfileirados +=
    (await enfileirarLookup(pre.fornecedor_cnpj, 'fornecedor_nf', fornecedor.conhecido)) +
    (await enfileirarLookup(matriz, 'sacado_nf', sacado.conhecido))

  acc.eventos += await emitirEventos(pre, gravada, fornecedor.empresaId, cfg, acc)
}

/**
 * Para onde a oferta vai quando sai do funil — e o motivo é o que distingue.
 *
 * `ANTICIPATION_REQUESTED` com `anticipationId` É a conversão (§9): casamento direto
 * por id, sem matching fuzzy. Expirada e revogada são perda por relógio, e o bloco de
 * perdas soma as duas separadamente do que converteu.
 */
function estagioDeSaida(motivo: string): string {
  return motivo === 'ja_converteu' ? 'convertida' : 'expirada'
}

async function linhaGravada(
  id: number,
): Promise<{ status: string; status_anterior: string | null; expira_em: string | null } | null> {
  const { data } = await supabaseAdmin
    .from('pre_autorizacoes')
    .select('status, status_anterior, expira_em')
    .eq('id_externo', id)
    .maybeSingle()
  return (data as { status: string; status_anterior: string | null; expira_em: string | null } | null) ?? null
}

async function emitirEventos(
  pre: PreAutorizacaoNormalizada,
  gravada: { status: string } | null,
  empresaId: string | null,
  cfg: CfgFunil,
  acc: ResultadoSyncPreAuth,
): Promise<number> {
  let n = 0
  const alvo = `${pre.fornecedor_nome ?? pre.fornecedor_cnpj} → ${pre.sacado_nome ?? pre.sacado_cnpj}`
  const url = `/antecipacao?oportunidade=pre_autorizacao:${pre.id_externo}`

  // Só na PRIMEIRA vez. O sync roda 6× por dia com sobreposição; um evento por
  // passagem encheria a timeline de ruído até ninguém mais olhar para ela.
  if (!gravada && empresaId) {
    await emitirEvento(empresaId, EVENTO_TIPOS.PREAUTH_SINCRONIZADA, {
      titulo:
        pre.status === 'WAITING_CONTRACTED'
          ? 'Oferta de antecipação esperando o fornecedor'
          : 'Nova pré-autorização',
      resumo: `${alvo}: ${formatarMoeda(pre.valor)} — status ${pre.status}.`,
      url,
      pre_autorizacao_id: pre.id_externo,
      valor: pre.valor,
    })
    n++
  }

  if (gravada && gravada.status !== pre.status && empresaId) {
    const expirou = pre.status === 'EXPIRED'
    await emitirEvento(
      empresaId,
      expirou ? EVENTO_TIPOS.PREAUTH_EXPIRADA : EVENTO_TIPOS.PREAUTH_STATUS_ALTERADO,
      {
        titulo: expirou ? 'Pré-autorização expirada' : 'Status da pré-autorização mudou',
        resumo: `${alvo}: ${formatarMoeda(pre.valor)} — ${gravada.status} → ${pre.status}.`,
        url,
        de: gravada.status,
        para: pre.status,
        pre_autorizacao_id: pre.id_externo,
        valor: pre.valor,
      },
    )
    acc.transicoes++
    n++
  }

  /*
   * D-2 — O ÚNICO PUSH DO SISTEMA SOBRE UM PRAZO DE HORAS.
   *
   * Uma NF em faixa alta continua em faixa alta amanhã. Uma oferta que expira em
   * dois dias pode não existir depois de amanhã, e o trabalho para salvá-la é um
   * telefonema. É por isso que este aviso empurra, em vez de esperar alguém abrir
   * a tela — e é por isso que ele vale para o ORIGINADOR titular, que é quem liga.
   */
  if (pre.status === 'WAITING_CONTRACTED' && pre.expira_em) {
    const faltam = Math.ceil((new Date(pre.expira_em).getTime() - Date.now()) / 86_400_000)
    if (faltam >= 0 && faltam <= cfg.aviso_expiracao_dias) {
      acc.expirando++
      if (empresaId) {
        await emitirEvento(empresaId, EVENTO_TIPOS.PREAUTH_EXPIRANDO, {
          titulo: `Oferta expira em ${faltam} dia(s)`,
          resumo: `${alvo}: ${formatarMoeda(pre.valor)} — a construtora já ofereceu e o prazo acaba.`,
          url,
          dias: faltam,
          pre_autorizacao_id: pre.id_externo,
          valor: pre.valor,
        })
        n++
      }
      await notificarPerfis(['Admin', 'Comercial'], {
        titulo: `Pré-autorização expirando: ${formatarMoeda(pre.valor)}`,
        corpo: `${alvo} — expira em ${faltam} dia(s). O crédito já existe; falta o fornecedor aceitar.`,
        url,
      })
    }
  }

  return n
}
