import {
  calibrarItem,
  rubricaCalibrada,
  type Amostra,
  type CalibracaoItem,
} from '../../../../packages/core/src/analise/calibracao.js'
import { EVENTO_TIPOS } from '../../../../packages/core/src/constants.js'
import { supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'
import { emitirEvento } from '../radar/eventos.js'
import { carregarConfigQualidade } from './config.js'
import { carregarRubrica, classificar, montarBracos, montarInteracao, type RubricaCarregada } from './analisar.js'
import { custoClaudeCentavos, custoJevCentavos, type EscopoAnalise } from '../../../../packages/core/src/analise/tipos.js'

/**
 * RECALIBRAÇÃO (05C §5) — rodada quando alguém pede, quando a rubrica muda de versão, ou
 * quando entram N contestações rotuladas desde a última.
 *
 * ─── O RÓTULO SOBREVIVE À VERSÃO; A PROBABILIDADE NÃO ───────────────────────
 * O rótulo diz o que aconteceu na conversa (chave a chave), e vale para qualquer versão
 * que pergunte a mesma coisa. A probabilidade é do classificador respondendo a UMA
 * redação de pergunta. Por isso, para cada interação rotulada que ainda não tem a
 * probabilidade desta versão, a recalibração pergunta de novo ao classificador — barato
 * no Jev, e o que permite que uma versão nova saia de sombra sem ninguém rotular de novo.
 *
 * Só entram amostras do braço configurado: probabilidade do Claude não calibra limiar
 * do Jev.
 */

export interface ResultadoRecalibrar {
  rubricas: number
  publicaram: number
  reperguntadas: number
}

export async function recalibrar(): Promise<ResultadoRecalibrar> {
  const res: ResultadoRecalibrar = { rubricas: 0, publicaram: 0, reperguntadas: 0 }
  const cfg = await carregarConfigQualidade()

  const { data: ativas } = await supabaseAdmin
    .from('rubricas')
    .select('id, tipo_interacao, calibrada_em, recalibrar_pedido_em')
    .eq('ativa', true)
  for (const r of ativas ?? []) {
    let gatilho: 'manual' | 'versao' | 'contestacoes' | 'inicial' | null = r.recalibrar_pedido_em ? 'manual' : null
    if (!gatilho && !r.calibrada_em) {
      // Rubrica em sombra com rótulos suficientes calibra sozinha: ninguém precisa lembrar de apertar o botão.
      const { count } = await supabaseAdmin
        .from('calibracao_rotulos')
        .select('analise_id', { count: 'exact', head: true })
        .eq('tipo_interacao', r.tipo_interacao)
      if ((count ?? 0) >= cfg.calibracao.min_amostras_calibracao) gatilho = 'inicial'
    }
    if (!gatilho) continue
    const rubrica = await carregarRubrica({ id: r.id })
    if (!rubrica) continue
    try {
      const x = await calibrarRubrica(rubrica, gatilho)
      res.rubricas++
      res.reperguntadas += x.reperguntadas
      if (x.saiuDeSombra) res.publicaram++
    } catch (erro) {
      logger.error({ rubrica: r.id, erro: String(erro) }, 'Recalibração falhou.')
    }
  }
  logger.info(res, 'Recalibração concluída.')
  return res
}

async function calibrarRubrica(rubrica: RubricaCarregada, gatilho: 'manual' | 'versao' | 'contestacoes' | 'inicial') {
  const cfg = await carregarConfigQualidade()
  const provedor = cfg.classificacao.provedor

  const { data: rotulos } = await supabaseAdmin
    .from('calibracao_rotulos')
    .select('analise_id, chave, aplicavel, atendido')
    .eq('tipo_interacao', rubrica.tipo_interacao)
  const porAnalise = new Map<string, Map<string, { aplicavel: boolean; atendido: boolean | null }>>()
  for (const l of rotulos ?? []) {
    const m = porAnalise.get(l.analise_id) ?? new Map()
    m.set(l.chave, { aplicavel: l.aplicavel, atendido: l.atendido })
    porAnalise.set(l.analise_id, m)
  }
  const analiseIds = [...porAnalise.keys()]
  const itemIds = rubrica.itens.map((i) => i.id)

  // As probabilidades que já existem para ESTA versão.
  const prob = new Map<string, number>() // `${item_id}|${analise_id}`
  if (analiseIds.length && itemIds.length) {
    const { data: amostras } = await supabaseAdmin
      .from('calibracao_amostras')
      .select('item_id, analise_id, prob_atendido, provedor')
      .in('item_id', itemIds)
      .in('analise_id', analiseIds)
      .eq('provedor', provedor)
    for (const a of amostras ?? []) if (a.prob_atendido !== null) prob.set(`${a.item_id}|${a.analise_id}`, Number(a.prob_atendido))
  }

  // As interações rotuladas sem probabilidade desta versão: pergunta de novo.
  let reperguntadas = 0
  let custo = 0
  const faltando = analiseIds.filter((id) => rubrica.itens.some((i) => !prob.has(`${i.id}|${id}`)))
  if (faltando.length) {
    const bracos = await montarBracos(cfg)
    if (bracos.primario.provedor === provedor) {
      const { data: analises } = await supabaseAdmin
        .from('analises')
        .select('id, escopo, reuniao_id, voz_ligacao_id, conversa_id, janela_inicio, janela_fim')
        .in('id', faltando)
      for (const a of analises ?? []) {
        const m = await montarInteracao({ ...a, escopo: a.escopo as EscopoAnalise })
        if (!m.ok) continue
        try {
          const { decisoes, queda } = await classificar(m.interacao.estado, rubrica.itens, cfg, { ...bracos, reserva: null })
          if (queda.respostas.some((r) => r.provedor !== provedor)) continue
          const linhas = decisoes
            .filter((d) => d.prob_atendido !== null)
            .map((d) => ({ item_id: d.item_id, analise_id: a.id, prob_aplicavel: d.aplicabilidade_prob, prob_atendido: d.prob_atendido, provedor }))
          if (linhas.length) await supabaseAdmin.from('calibracao_amostras').upsert(linhas, { onConflict: 'item_id,analise_id' })
          for (const l of linhas) prob.set(`${l.item_id}|${a.id}`, l.prob_atendido!)
          reperguntadas++
        } catch (erro) {
          logger.warn({ analise: a.id, erro: String(erro) }, 'Não deu para reperguntar uma interação rotulada.')
        }
      }
      custo = custoJevCentavos(bracos.jev.entrada, cfg.precos) + custoClaudeCentavos(bracos.claude, cfg.precos)
    }
  }

  // Calibra item a item. Só entra amostra que o humano disse ser aplicável e com resposta.
  const resultados: Array<{ chave: string; id: string; r: CalibracaoItem }> = []
  for (const item of rubrica.itens) {
    const amostras: Amostra[] = []
    for (const [analiseId, rot] of porAnalise) {
      const rr = rot.get(item.chave)
      const p = prob.get(`${item.id}|${analiseId}`)
      if (!rr || !rr.aplicavel || rr.atendido === null || p === undefined) continue
      amostras.push({ prob_atendido: p, atendido: rr.atendido })
    }
    // Item informativo (peso zero) não tem limiar a calibrar.
    if (item.peso <= 0) continue
    const r = calibrarItem(amostras, {
      min_amostras: cfg.calibracao.min_amostras_calibracao,
      min_por_classe: cfg.calibracao.min_por_classe,
      f1_minimo: cfg.calibracao.f1_minimo,
    })
    resultados.push({ chave: item.chave, id: item.id, r })
    await supabaseAdmin
      .from('rubrica_itens')
      .update({
        status_calibracao: r.status,
        limiar: r.status === 'inativo_amostras' ? null : r.limiar,
        limiar_origem: r.status === 'inativo_amostras' ? null : 'calibracao',
        f1: r.f1,
        precisao: r.precisao,
        recall: r.recall,
        n_amostras: r.n_amostras,
        calibracao: { curva: r.curva, motivo: r.motivo, n_faltas: r.n_faltas } as never,
        calibrado_em: new Date().toISOString(),
      })
      .eq('id', item.id)
  }

  const calibrada = rubricaCalibrada(resultados.map((x) => x.r))
  const saiuDeSombra = calibrada && !rubrica.calibrada_em
  await supabaseAdmin
    .from('rubricas')
    .update({ calibrada_em: calibrada ? new Date().toISOString() : null, recalibrar_pedido_em: null })
    .eq('id', rubrica.id)
  await supabaseAdmin.from('calibracao_execucoes').insert({
    rubrica_id: rubrica.id,
    gatilho,
    saiu_de_sombra: saiuDeSombra,
    custo_centavos: custo,
    resultado: resultados.map((x) => ({
      chave: x.chave,
      status: x.r.status,
      limiar: x.r.limiar,
      f1: x.r.f1,
      precisao: x.r.precisao,
      recall: x.r.recall,
      n: x.r.n_amostras,
      motivo: x.r.motivo,
    })) as never,
  })

  await emitirEvento(null, EVENTO_TIPOS.RUBRICA_CALIBRADA, {
    titulo: 'Rubrica calibrada',
    resumo: `${resultados.filter((x) => x.r.status === 'publicado').length} de ${resultados.length} itens publicam nota.`,
    url: '/comercial/qualidade?aba=calibracao',
    rubrica_id: rubrica.id,
  })
  if (saiuDeSombra) {
    await emitirEvento(null, EVENTO_TIPOS.RUBRICA_SAIU_DE_SOMBRA, {
      titulo: 'Rubrica saiu de sombra',
      resumo: `A rubrica de ${rubrica.tipo_interacao} está calibrada: as próximas análises chegam ao time com nota.`,
      url: '/comercial/qualidade?aba=calibracao',
      rubrica_id: rubrica.id,
    })
  }
  return { reperguntadas, saiuDeSombra }
}
