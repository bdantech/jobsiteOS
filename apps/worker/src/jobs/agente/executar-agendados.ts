import { lerConfigComunicacao } from '../../comunicacao/config.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { decidirParaConversa, type ResultadoAgente } from './decidir.js'

/**
 * A varredura de `conversas.proxima_acao_em` (§10).
 *
 * É o irmão do `agente/decidir`: aquele acorda por EVENTO (chegou resposta,
 * houve no-show), este acorda por RELÓGIO — a hora que o próprio agente marcou.
 *
 * ─── O KILL SWITCH É CHECADO AQUI, ANTES DA VARREDURA ───────────────────────
 * Ele para os modos autônomos (§7.5). Checá-lo no começo e não por conversa é o
 * que faz o "um clique para tudo" ser verdade: com o switch ligado, o job termina
 * sem tocar em nada, e nenhuma decisão parcial fica pela metade.
 *
 * O modo `sugestao` continua rodando: uma sugestão não sai da casa, e desligar o
 * copiloto junto com o piloto tiraria a ferramenta de quem estava trabalhando.
 */

export async function executarAgendados(limite = 50): Promise<ResultadoAgente> {
  const cfg = await lerConfigComunicacao(true)
  const agora = new Date()

  const acc: ResultadoAgente = {
    conversas: 0,
    decisoes: 0,
    executadas: 0,
    sugeridas: 0,
    fallback: 0,
    escalacoes: 0,
    puladas: 0,
  }

  const { data, error } = await supabaseAdmin
    .from('conversas')
    .select('id, canal, empresa_id, contato_id, objetivo, playbook_id, responsavel_vendedor_id, modo_agente, status, ultima_mensagem_em, ultima_direcao, proxima_acao_em')
    .not('proxima_acao_em', 'is', null)
    .lte('proxima_acao_em', agora.toISOString())
    .in('status', ['ativa', 'aguardando_resposta'])
    .neq('modo_agente', 'desligado')
    .order('proxima_acao_em', { ascending: true })
    .limit(limite)
  if (error) {
    logger.error({ erro: error.message }, 'Falha ao varrer conversas agendadas.')
    return acc
  }

  const conversas = data ?? []
  acc.conversas = conversas.length

  for (const c of conversas) {
    if (cfg.agente.kill_switch && c.modo_agente === 'autonomo') {
      acc.puladas += 1
      continue
    }
    try {
      const r = await decidirParaConversa(c as never, 'agendado', cfg, agora)
      acc.decisoes += r.decidiu ? 1 : 0
      acc.executadas += r.executou ? 1 : 0
      acc.sugeridas += r.sugeriu ? 1 : 0
      acc.fallback += r.fallback ? 1 : 0
      acc.escalacoes += r.escalou ? 1 : 0
      acc.puladas += r.pulou ? 1 : 0
    } catch (erro) {
      logger.error({ conversa: c.id, erro: String(erro) }, 'Falha ao executar passo agendado.')
      acc.puladas += 1
    }
  }

  logger.info(acc, 'Passos agendados do agente processados.')
  return acc
}

/**
 * O DESFECHO das decisões (§7.6): o que aconteceu depois.
 *
 * Sem isto, `agente_decisoes` diria quantas vezes o agente decidiu e nunca
 * quantas vezes ele acertou — que é a diferença entre um log e um painel de
 * eficácia. Roda uma vez por dia sobre as decisões executadas nas últimas duas
 * semanas que ainda não têm desfecho.
 */
export async function apurarDesfechos(): Promise<{ avaliadas: number; marcadas: number }> {
  const desde = new Date(Date.now() - 14 * 86_400_000).toISOString()
  const { data } = await supabaseAdmin
    .from('agente_decisoes')
    .select('id, conversa_id, acao, executada_em')
    .eq('executada', true)
    .is('desfecho', null)
    .gte('executada_em', desde)
    .limit(500)

  let marcadas = 0
  for (const d of data ?? []) {
    if (!d.conversa_id || !d.executada_em) continue

    if (d.acao === 'escalar_humano') {
      await marcar(d.id, 'escalou')
      marcadas += 1
      continue
    }

    const { data: resposta } = await supabaseAdmin
      .from('comunicacoes')
      .select('id')
      .eq('conversa_id', d.conversa_id)
      .eq('direcao', 'entrada')
      .gt('criado_em', d.executada_em)
      .limit(1)
      .maybeSingle()

    const { data: conversa } = await supabaseAdmin
      .from('conversas')
      .select('status')
      .eq('id', d.conversa_id)
      .maybeSingle()

    // A ordem responde à pergunta mais forte primeiro: encerrada por opt-out é um
    // desfecho, mesmo que a pessoa tenha respondido para dizer "pare".
    const desfecho = conversa?.status === 'encerrada' ? 'suprimiu' : resposta ? 'respondeu' : null

    // Só marca "sem resposta" depois de a cadência ter tido tempo de acontecer.
    const passaram3Dias = Date.now() - new Date(d.executada_em).getTime() > 3 * 86_400_000
    const final = desfecho ?? (passaram3Dias ? 'sem_resposta' : null)
    if (!final) continue

    await marcar(d.id, final)
    marcadas += 1
  }

  return { avaliadas: (data ?? []).length, marcadas }
}

async function marcar(id: string, desfecho: string): Promise<void> {
  await supabaseAdmin
    .from('agente_decisoes')
    .update({ desfecho, desfecho_em: new Date().toISOString() })
    .eq('id', id)
}
