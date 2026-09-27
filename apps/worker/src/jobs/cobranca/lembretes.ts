import { hojeSaoPaulo, somarDiasCorridos, diasEntreDatas } from '../../../../../packages/core/src/cobranca/datas.js'
import { formatarDataBr } from '../../../../../packages/core/src/cobranca/modelos.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { avisar } from '../../radar/eventos.js'
import { dataSp, lerConfigCobranca, lotes } from './comum.js'
import { reiteracaoDevida } from './regras.js'

/**
 * `cobranca/lembretes` (Prompt 07 §14), diário: o que alguém precisa fazer e ainda não
 * fez. Nenhum destes lembretes DISPARA nada — reiterar, responder a seguradora e retirar
 * o protesto são atos de gente (§1: "nada dispara sozinho").
 *
 *   a) reiteração devida: a última rodada enviada passou de `dias_para_reiteracao` (§5);
 *   b) documento complementar pedido pela seguradora a 5 dias do prazo de 30 — e o que
 *      venceu vira `vencida` (a análise do sinistro pode ser suspensa, §6.1);
 *   c) protesto de título já quitado sem instrução de cancelamento: dano moral contra
 *      nós (§8, §11).
 */

export interface ResultadoLembretes {
  hoje: string
  reiteracoes: number
  solicitacoes_perto: number
  solicitacoes_vencidas: number
  protestos_a_retirar: number
}

const ENVIADA = new Set(['enviada', 'entregue', 'respondida'])
const destinatarios = (id: string | null | undefined) => (id ? [id] : [])

export async function lembretesCobranca(): Promise<ResultadoLembretes> {
  const hoje = hojeSaoPaulo()
  const cfg = await lerConfigCobranca()
  const r: ResultadoLembretes = { hoje, reiteracoes: 0, solicitacoes_perto: 0, solicitacoes_vencidas: 0, protestos_a_retirar: 0 }

  // ── a) Reiteração devida ────────────────────────────────────────────────
  const { data: cobrancas, error: erroCob } = await supabaseAdmin
    .from('cobrancas')
    .select('id, codigo, responsavel_id, sacado_empresa_id')
    .in('estagio', ['notificada', 'em_negociacao'])
  if (erroCob) throw new Error(`Falha ao ler as cobranças: ${erroCob.message}`)

  for (const lote of lotes(cobrancas ?? [], 200)) {
    const { data: notifs } = await supabaseAdmin
      .from('cobranca_notificacoes')
      .select('cobranca_id, rodada, status, enviada_em')
      .in('cobranca_id', lote.map((c) => c.id))
    const porCobranca = new Map<string, { maior: number; enviada: number | null; em: string | null }>()
    for (const n of notifs ?? []) {
      const e = porCobranca.get(n.cobranca_id) ?? { maior: 0, enviada: null, em: null }
      e.maior = Math.max(e.maior, n.rodada)
      if (ENVIADA.has(n.status) && n.enviada_em) {
        if (e.enviada === null || n.rodada > e.enviada) {
          e.enviada = n.rodada
          e.em = n.enviada_em
        } else if (n.rodada === e.enviada && (!e.em || n.enviada_em > e.em)) {
          e.em = n.enviada_em
        }
      }
      porCobranca.set(n.cobranca_id, e)
    }

    for (const c of lote) {
      const e = porCobranca.get(c.id)
      if (!e) continue
      const devida = reiteracaoDevida({
        ultima_rodada_enviada: e.enviada,
        enviada_em: dataSp(e.em),
        maior_rodada: e.maior,
        hoje,
        dias_para_reiteracao: cfg.cobranca.dias_para_reiteracao,
      })
      if (!devida) continue
      r.reiteracoes++
      await avisar(
        'cobranca.reiteracao_devida',
        {
          titulo: `Reiteração devida — ${c.codigo ?? 'cobrança'}`,
          resumo:
            `A rodada ${e.enviada} saiu há mais de ${cfg.cobranca.dias_para_reiteracao} dias sem uma nova. ` +
            'Gere a próxima rodada com o valor atualizado, se fizer sentido.',
          url: `/cobranca/cobrancas/${c.id}`,
          destinatarios: destinatarios(c.responsavel_id),
          chave: `cobranca.reiteracao_devida:${c.id}:r${e.enviada}`,
          cobranca_id: c.id,
          codigo: c.codigo,
          rodada: e.enviada,
        },
        { empresaId: c.sacado_empresa_id },
      )
    }
  }

  // ── b) Documentos complementares pedidos pela seguradora ────────────────
  const limite = somarDiasCorridos(hoje, 5)
  const { data: solicitacoes, error: erroSol } = await supabaseAdmin
    .from('sinistro_solicitacoes')
    .select('id, descricao, prazo_em, sinistro_id, sinistros!inner(codigo, responsavel_id, sacado_empresa_id)')
    .eq('status', 'aberta')
    .lte('prazo_em', limite)
  if (erroSol) logger.error({ erro: erroSol.message }, 'Falha ao ler as solicitações da seguradora.')

  for (const s of solicitacoes ?? []) {
    const sin = s.sinistros as { codigo: string | null; responsavel_id: string | null; sacado_empresa_id: string | null } | null
    const venceu = s.prazo_em < hoje
    if (venceu) {
      const { error } = await supabaseAdmin
        .from('sinistro_solicitacoes')
        .update({ status: 'vencida' })
        .eq('id', s.id)
        .eq('status', 'aberta')
      if (error) {
        logger.error({ solicitacao: s.id, erro: error.message }, 'Falha ao marcar solicitação vencida.')
        continue
      }
      r.solicitacoes_vencidas++
    } else {
      r.solicitacoes_perto++
    }
    const faltam = diasEntreDatas(hoje, s.prazo_em)
    await avisar(
      'sinistro.doc_prazo',
      {
        titulo: venceu
          ? `Prazo de documento VENCIDO — sinistro ${sin?.codigo ?? ''}`
          : `Documento da seguradora ${faltam === 0 ? 'vence hoje' : `vence em ${faltam} dia(s)`} — sinistro ${sin?.codigo ?? ''}`,
        resumo: `${s.descricao} (prazo ${formatarDataBr(s.prazo_em)}).${venceu ? ' A análise do sinistro pode ser suspensa.' : ''}`,
        url: `/cobranca/sinistros/${s.sinistro_id}`,
        destinatarios: destinatarios(sin?.responsavel_id),
        // perto do prazo: todo dia até responder; vencida: uma vez só
        chave: venceu ? `sinistro.doc_prazo:${s.id}:vencida` : `sinistro.doc_prazo:${s.id}:${hoje}`,
        sinistro_id: s.sinistro_id,
        solicitacao_id: s.id,
        prazo_em: s.prazo_em,
      },
      { empresaId: sin?.sacado_empresa_id ?? null },
    )
  }

  // ── c) Protesto de título quitado sem instrução de cancelamento ─────────
  const { data: protestos, error: erroProt } = await supabaseAdmin
    .from('protesto_titulos')
    .select(
      'id, situacao, cartorio, protocolo_cartorio, instrucao_nao_aplicavel_motivo, protesto_remessas!inner(tipo, cobranca_id, uf), cobranca_titulos!inner(situacao, quitado_em, cobranca_id, titulos(numero, externo_id))',
    )
    .in('situacao', ['enviado', 'apontado', 'protestado'])
    .is('instrucao_cancelamento_em', null)
    .eq('protesto_remessas.tipo', 'apresentacao')
    .eq('cobranca_titulos.situacao', 'quitado')
  if (erroProt) logger.error({ erro: erroProt.message }, 'Falha ao ler os protestos a retirar.')

  const pendentes = (protestos ?? []).filter((p) => !p.instrucao_nao_aplicavel_motivo?.trim())
  const cobrancaIds = [
    ...new Set(pendentes.map((p) => (p.cobranca_titulos as { cobranca_id: string } | null)?.cobranca_id).filter((x): x is string => !!x)),
  ]
  const infoCobranca = new Map<string, { codigo: string | null; responsavel_id: string | null; sacado_empresa_id: string | null }>()
  for (const ids of lotes(cobrancaIds, 200)) {
    const { data } = await supabaseAdmin.from('cobrancas').select('id, codigo, responsavel_id, sacado_empresa_id').in('id', ids)
    for (const c of data ?? []) infoCobranca.set(c.id, c)
  }

  for (const p of pendentes) {
    const ct = p.cobranca_titulos as {
      quitado_em: string | null
      cobranca_id: string
      titulos: { numero: string | null; externo_id: string } | null
    } | null
    if (!ct) continue
    const c = infoCobranca.get(ct.cobranca_id)
    const numero = ct.titulos?.numero ?? ct.titulos?.externo_id ?? '—'
    r.protestos_a_retirar++
    await avisar(
      'protesto.retirada_pendente',
      {
        titulo: `Protesto a retirar — título ${numero}`,
        resumo:
          `Título quitado${ct.quitado_em ? ` em ${formatarDataBr(ct.quitado_em)}` : ''} com protesto ${p.situacao}` +
          `${p.cartorio ? ` (${p.cartorio})` : ''} sem instrução de cancelamento. Protesto mantido depois do pagamento ` +
          'vira dano moral contra nós.',
        url: `/cobranca/cobrancas/${ct.cobranca_id}`,
        destinatarios: destinatarios(c?.responsavel_id),
        chave: `protesto.retirada_pendente:${p.id}:${hoje}`,
        protesto_titulo_id: p.id,
        cobranca_id: ct.cobranca_id,
        codigo: c?.codigo ?? null,
      },
      { empresaId: c?.sacado_empresa_id ?? null },
    )
  }

  logger.info(r, 'Lembretes da cobrança emitidos.')
  return r
}
