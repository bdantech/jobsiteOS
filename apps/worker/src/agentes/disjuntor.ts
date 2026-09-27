import { avaliarDisjuntor, type SinalAcao } from '../../../../packages/core/src/agentes/disjuntor.js'
import type { EstadoDisjuntor } from '../../../../packages/core/src/agentes/schemas.js'
import { pool, supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'

/**
 * O DISJUNTOR NO MUNDO (Prompt 09 §9.2): avalia a janela do agente depois de cada ação com
 * desfecho e, se abrir, PARA — pausa todos os mandatos ativos dele e avisa o gestor e o
 * closer na hora, com as últimas ações que motivaram. Reabrir é só manual, na tela.
 *
 * A regra de quando abrir está no core (`avaliarDisjuntor`, com testes); aqui é leitura,
 * gravação e o efeito.
 */
export async function avaliarDisjuntorDoAgente(agenteId: string): Promise<EstadoDisjuntor> {
  const { data: d } = await supabaseAdmin.from('agentes_disjuntor').select('*').eq('agente_id', agenteId).maybeSingle()
  if (!d) {
    // Agente sem linha (criado por fora da RPC de persona): nasce com o padrão.
    await supabaseAdmin.from('agentes_disjuntor').insert({ agente_id: agenteId }).select().maybeSingle()
    return 'ok'
  }
  if (d.estado === 'aberto') return 'aberto'

  const { data: acoes } = await supabaseAdmin
    .from('mandato_acoes')
    .select('sinal, ferramenta, intencao, erro, executada_em, mandato_id')
    .eq('agente_id', agenteId)
    .neq('sinal', 'neutro')
    .gte('executada_em', d.janela_desde)
    .order('executada_em', { ascending: false })
    .limit(Math.max(d.janela_acoes, 5))

  const av = avaliarDisjuntor({
    sinais: (acoes ?? []).map((a) => a.sinal as SinalAcao),
    config: {
      janela_acoes: d.janela_acoes,
      limiar_supressao: Number(d.limiar_supressao),
      limiar_sem_interesse: Number(d.limiar_sem_interesse),
      limiar_escalacao: Number(d.limiar_escalacao),
      limiar_falha_tecnica: Number(d.limiar_falha_tecnica),
    },
    estadoAtual: d.estado as EstadoDisjuntor,
  })

  if (av.estado !== 'aberto') {
    if (av.estado !== d.estado) {
      await supabaseAdmin.from('agentes_disjuntor').update({ estado: av.estado, avaliado_em: new Date().toISOString() }).eq('agente_id', agenteId)
    }
    return av.estado
  }

  const ultimas = (acoes ?? []).slice(0, 8).map((a) => ({
    em: a.executada_em,
    ferramenta: a.ferramenta,
    sinal: a.sinal,
    intencao: a.intencao,
    erro: a.erro,
    mandato_id: a.mandato_id,
  }))
  await supabaseAdmin
    .from('agentes_disjuntor')
    .update({
      estado: 'aberto',
      aberto_em: new Date().toISOString(),
      aberto_motivo: av.motivo ?? 'Limiar ultrapassado.',
      aberto_detalhe: { taxas: av.taxas, metrica: av.metrica, ultimas } as never,
      avaliado_em: new Date().toISOString(),
    })
    .eq('agente_id', agenteId)

  // Pausa, não encerra: reaberto o disjuntor, os mandatos continuam de onde estavam.
  await pool.query(
    `update mandatos set estado = 'pausado', pausado_motivo = 'disjuntor_aberto'
      where agente_id = $1 and estado in ('aberto', 'em_andamento', 'aguardando_externo')`,
    [agenteId],
  )

  const { data: agente } = await supabaseAdmin.from('vendedores').select('nome, closer_id').eq('id', agenteId).maybeSingle()
  const { data: closer } = agente?.closer_id
    ? await supabaseAdmin.from('vendedores').select('usuario_id').eq('id', agente.closer_id).maybeSingle()
    : { data: null }
  await supabaseAdmin.from('empresa_eventos').insert({
    empresa_id: null,
    tipo: 'agente.disjuntor_aberto',
    payload: {
      titulo: `Disjuntor aberto: ${agente?.nome ?? 'agente'} parou`,
      resumo: av.motivo,
      url: '/agentes',
      agente_id: agenteId,
      ultimas,
      destinatarios: closer?.usuario_id ? [closer.usuario_id] : [],
    } as never,
  })
  logger.warn({ agenteId, motivo: av.motivo }, 'Disjuntor do agente aberto; mandatos pausados.')
  return 'aberto'
}
