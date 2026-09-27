import { desfechoEstruturado, type ContatoRevelado } from '../../../../packages/core/src/agentes/voz-adapter.js'
import { pool, supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'

/**
 * O DESFECHO DA LIGAÇÃO VOLTA AO MANDATO (Prompt 09 §4.3).
 *
 * "Não era o decisor, ela indicou o Carlos, ligue para ele às 15h30" era, até aqui, um
 * resumo de texto que ninguém lia. É exatamente o comportamento que o módulo existe para
 * ter, então ele é CONSUMIDO:
 *
 *   indicou_outro_contato  → o contato indicado é registrado (base legal `indicacao`, com
 *                            a evidência da ligação) e quem atendeu vira "não é o decisor";
 *   agendar_retorno        → idem para o contato, e o horário pedido vai para o registro;
 *   reuniao_agendada (v2)  → a janela reservada que a Ana confirmou vira a reunião.
 *
 * A RPC de resultado já acordou o mandato (0270d). O que se grava aqui é uma AÇÃO de
 * sistema, `desfecho_ligacao`, com o que foi consumido — o agente a lê no próximo ciclo e
 * replaneja com o contato novo já existindo.
 */
export async function consumirDesfechoNoMandato(idExterno: string, corpo: unknown): Promise<void> {
  const { data: lig } = await supabaseAdmin
    .from('voz_ligacoes')
    .select('id, mandato_id, contato_id, empresa_id, outcome, resumo')
    .eq('id_externo', idExterno)
    .maybeSingle()
  if (!lig?.mandato_id) return

  const { data: m } = await supabaseAdmin
    .from('mandatos')
    .select('id, agente_id, empresa_id, codigo, estado')
    .eq('id', lig.mandato_id)
    .maybeSingle()
  if (!m) return

  const d = desfechoEstruturado(corpo)
  const consumido: Record<string, unknown> = { tipo: d.tipo, outcome: lig.outcome }

  if (d.tipo === 'indicou_outro_contato' || (d.tipo === 'agendar_retorno' && d.contato)) {
    const contato = (d as { contato: ContatoRevelado }).contato
    const novo = await registrarRevelado(m.empresa_id, contato, d.observacao ?? lig.resumo ?? null, m.codigo)
    consumido.contato_novo = novo
    if (d.tipo === 'indicou_outro_contato' && lig.contato_id && novo && novo.id !== lig.contato_id) {
      // Não é o decisor — NUNCA suprimido: volta a ser útil no dia em que o indicado sair.
      await supabaseAdmin.from('contatos').update({ nao_e_o_decisor: true }).eq('id', lig.contato_id)
    }
  }
  if (d.tipo === 'agendar_retorno') {
    consumido.retorno_em = d.quando
    consumido.observacao = d.observacao
  }
  if (d.tipo === 'reuniao_agendada' && d.janela_id) {
    const { data: reserva } = await supabaseAdmin
      .from('agenda_reservas')
      .select('id, closer_id, inicio, fim, mandato_id')
      .eq('id', d.janela_id)
      .maybeSingle()
    if (reserva && reserva.mandato_id === m.id) {
      const { data: contato } = lig.contato_id
        ? await supabaseAdmin.from('contatos').select('nome, email').eq('id', lig.contato_id).maybeSingle()
        : { data: null }
      const { data: marcada, error } = await supabaseAdmin.rpc('app__agente_agendar_reuniao', {
        p: {
          mandato_id: m.id,
          closer_id: reserva.closer_id,
          inicio: reserva.inicio,
          duracao_min: Math.round((new Date(reserva.fim).getTime() - new Date(reserva.inicio).getTime()) / 60_000),
          modalidade: 'meet',
          reserva_id: reserva.id,
          participantes: contato ? [{ nome: contato.nome, email: contato.email, contato_id: lig.contato_id }] : [],
          descricao: `Reunião confirmada por telefone pela Ana (${m.codigo ?? ''}).`,
        } as never,
      })
      consumido.reuniao = error ? { erro: error.message } : marcada
    }
  }

  if (d.tipo === 'nenhum' && !lig.outcome) return

  const { rows } = await pool.query<{ n: number }>(
    'select coalesce(max(sequencia), 0) + 1 as n from mandato_acoes where mandato_id = $1',
    [m.id],
  )
  const { error } = await supabaseAdmin.from('mandato_acoes').insert({
    mandato_id: m.id,
    agente_id: m.agente_id,
    empresa_id: m.empresa_id,
    sequencia: rows[0]?.n ?? 1,
    ferramenta: 'desfecho_ligacao',
    intencao: resumoDoConsumo(d.tipo, consumido),
    resultado: consumido as never,
    sucesso: true,
    sinal: 'neutro',
    contato_id: lig.contato_id,
    voz_ligacao_id: lig.id,
  })
  if (error) logger.error({ erro: error.message, mandato: m.id }, 'Falha ao registrar o desfecho da ligação no mandato.')

  if (d.tipo !== 'nenhum') {
    await supabaseAdmin.from('empresa_eventos').insert({
      empresa_id: m.empresa_id,
      tipo: 'voz.desfecho_estruturado',
      payload: {
        resumo: resumoDoConsumo(d.tipo, consumido),
        mandato_id: m.id,
        url: `/agentes/mandatos?m=${m.id}`,
        ...consumido,
      } as never,
    })
  }
}

async function registrarRevelado(
  empresaId: string,
  c: ContatoRevelado,
  evidencia: string | null,
  codigo: string | null,
): Promise<{ id: string; nome: string | null; ja_existia: boolean } | null> {
  const filtros = [
    c.telefone_e164 ? `telefone.eq.${c.telefone_e164}` : null,
    c.telefone_e164 ? `whatsapp.eq.${c.telefone_e164}` : null,
    c.email ? `email.eq.${c.email.toLowerCase()}` : null,
  ].filter(Boolean)
  const { data: existente } = await supabaseAdmin
    .from('contatos')
    .select('id, nome')
    .eq('empresa_id', empresaId)
    .or(filtros.join(','))
    .limit(1)
    .maybeSingle()
  if (existente) return { id: existente.id, nome: existente.nome, ja_existia: true }

  const { data, error } = await supabaseAdmin
    .from('contatos')
    .insert({
      empresa_id: empresaId,
      nome: c.nome,
      cargo: c.cargo,
      telefone: c.telefone_e164,
      whatsapp: c.telefone_e164,
      email: c.email?.toLowerCase() ?? null,
      origem: 'indicacao_na_conversa',
      base_legal: 'indicacao',
      base_legal_em: new Date().toISOString(),
      base_legal_detalhe: `Indicado em ligação da Ana (${codigo ?? 'mandato'}): ${(evidencia ?? 'sem transcrição').slice(0, 400)}`,
    })
    .select('id, nome')
    .maybeSingle()
  if (error || !data) {
    logger.error({ erro: error?.message }, 'Falha ao registrar o contato revelado na ligação.')
    return null
  }
  return { id: data.id, nome: data.nome, ja_existia: false }
}

function resumoDoConsumo(tipo: string, c: Record<string, unknown>): string {
  const contato = c.contato_novo as { nome?: string; ja_existia?: boolean } | undefined
  switch (tipo) {
    case 'indicou_outro_contato':
      return `A ligação indicou outro contato: ${contato?.nome ?? '—'}${contato?.ja_existia ? ' (já cadastrado)' : ' (registrado agora)'}.`
    case 'agendar_retorno':
      return `A pessoa pediu retorno${c.retorno_em ? ` em ${String(c.retorno_em)}` : ''}${contato?.nome ? ` com ${contato.nome}` : ''}.`
    case 'reuniao_agendada':
      return 'A Ana confirmou uma das janelas: a reunião foi marcada.'
    default:
      return `A ligação terminou com o desfecho "${String(c.outcome ?? 'sem desfecho')}".`
  }
}
