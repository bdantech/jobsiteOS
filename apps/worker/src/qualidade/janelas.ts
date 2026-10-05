import { fecharJanela } from '../../../../packages/core/src/analise/estado.js'
import { supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'
import { carregarConfigQualidade } from './config.js'

/**
 * JANELAS DE CONVERSA (05C §2) e RETENÇÃO (§12), no job diário.
 *
 * Uma mensagem isolada não tem rubrica aplicável — o que se julga é a janela: tudo o que
 * passou na conversa desde a última análise. Quem decide se fecha é `fecharJanela` no core.
 */

export interface ResultadoJanelas {
  candidatas: number
  enfileiradas: number
  expurgadas: number
}

export async function fecharJanelas(limite = 2000): Promise<ResultadoJanelas> {
  const cfg = await carregarConfigQualidade()
  const res: ResultadoJanelas = { candidatas: 0, enfileiradas: 0, expurgadas: 0 }

  const { data, error } = await supabaseAdmin.rpc('app__qualidade_janelas_candidatas', {
    p_horas: cfg.janela.horas_silencio,
    p_limite: limite,
  })
  if (error) throw new Error(error.message)
  const agora = new Date()
  for (const c of data ?? []) {
    res.candidatas++
    const mensagens = (c.mensagens ?? []).map((m: string) => ({ criado_em: m }))
    const j = fecharJanela({
      mensagensDesde: mensagens,
      ultimaJanelaFim: c.ultima_janela_fim,
      agora,
      minMensagens: cfg.janela.min_mensagens,
      horasSilencio: cfg.janela.horas_silencio,
    })
    if (!j) continue
    // A primeira janela começa um instante antes da primeira mensagem: o recorte da análise
    // é "depois do início", e a primeira mensagem tem de entrar.
    const inicio = c.ultima_janela_fim ?? new Date(new Date(j.inicio).getTime() - 1000).toISOString()
    const { error: e } = await supabaseAdmin.from('analise_fila').insert({
      escopo: 'janela_conversa',
      conversa_id: c.conversa_id,
      janela_inicio: inicio,
      janela_fim: j.fim,
      janela_mensagens: j.mensagens,
    })
    if (!e) res.enfileiradas++
    else if (e.code !== '23505') logger.warn({ conversa: c.conversa_id, erro: e.message }, 'Janela não enfileirada.')
  }

  res.expurgadas = await expurgarTranscricoes(cfg.retencao.dias_transcricao)
  logger.info(res, 'Janelas de conversa fechadas.')
  return res
}

/** O texto sai; a análise, o resumo e o link ficam (§12). Nulo = manter. */
async function expurgarTranscricoes(dias: number | null): Promise<number> {
  if (!dias) return 0
  const corte = new Date(Date.now() - dias * 86_400_000).toISOString()
  const { data, error } = await supabaseAdmin
    .from('reunioes')
    .update({ transcricao: null, transcricao_segmentos: null, transcricao_expurgada_em: new Date().toISOString() })
    .lt('transcricao_recebida_em', corte)
    .not('transcricao', 'is', null)
    .select('id')
  if (error) {
    logger.error({ erro: error.message }, 'Expurgo de transcrições falhou.')
    return 0
  }
  return data?.length ?? 0
}
