import {
  desfechoEstruturado,
  type ContatoRevelado,
  type JanelaOferecida,
} from '../../../../packages/core/src/agentes/voz-adapter.js'
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
 *   agendar_retorno        → idem para o contato, e o mandato dorme até o horário pedido:
 *                            "liga às 15h30" é às 15h30, não no próximo ciclo;
 *   reuniao_agendada (v2)  → a janela reservada que a Ana confirmou vira a reunião;
 *   qualificacao, reativacao (v2) → o que a Ana apurou fica estruturado na ação, e o
 *                            agente decide no próximo ciclo (propor agendamento, mover o lead).
 *
 * A RPC de resultado já acordou o mandato (0270d). O que se grava aqui é uma AÇÃO de
 * sistema, `desfecho_ligacao`, com o que foi consumido — o agente a lê no próximo ciclo e
 * replaneja com o contato novo já existindo.
 *
 * ── UMA VEZ SÓ ──────────────────────────────────────────────────────────────
 * A Ana reenvia o webhook até receber 2xx, e cada entrega passa por aqui. A linha
 * `desfecho_ligacao` é o RECIBO: ela é inserida PRIMEIRO, contra o índice único parcial
 * da 0271a (`voz_ligacao_id` onde `ferramenta = 'desfecho_ligacao'`). Quem não consegue
 * inserir chegou depois — outra entrega já consumiu (ou está consumindo) — e para ali,
 * sem segundo contato, segundo evento nem segunda reunião. Reivindicar depois dos efeitos
 * deixaria duas entregas simultâneas marcarem a reunião duas vezes.
 */
export async function consumirDesfechoNoMandato(idExterno: string, corpo: unknown): Promise<void> {
  const { data: lig } = await supabaseAdmin
    .from('voz_ligacoes')
    .select('id, mandato_id, contato_id, empresa_id, outcome, resumo, pedido')
    .eq('id_externo', idExterno)
    .maybeSingle()
  if (!lig?.mandato_id) return

  const { data: m } = await supabaseAdmin
    .from('mandatos')
    .select('id, agente_id, empresa_id, codigo, estado, expira_em')
    .eq('id', lig.mandato_id)
    .maybeSingle()
  if (!m) return

  const d = desfechoEstruturado(corpo)
  const consumido: Record<string, unknown> = { tipo: d.tipo, outcome: lig.outcome }
  const oferecidas = janelasOferecidas(lig.pedido)
  if (d.tipo === 'nenhum' && !lig.outcome) {
    await liberarJanelas(oferecidas, null)
    return
  }

  const { rows: recibo } = await pool.query<{ id: string }>(
    `insert into mandato_acoes
       (mandato_id, agente_id, empresa_id, ferramenta, intencao, resultado, sucesso, sinal, contato_id, voz_ligacao_id)
     values ($1, $2, $3, 'desfecho_ligacao', $4, $5::jsonb, true, 'neutro', $6, $7)
     on conflict (voz_ligacao_id) where ferramenta = 'desfecho_ligacao' do nothing
     returning id`,
    [m.id, m.agente_id, m.empresa_id, resumoDoConsumo(d.tipo, consumido), JSON.stringify(consumido), lig.contato_id, lig.id],
  )
  const reciboId = recibo[0]?.id
  if (!reciboId) {
    logger.info({ id_externo: idExterno, mandato: m.id }, 'Desfecho desta ligação já consumido: reenvio ignorado.')
    return
  }

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
    // A RPC de resultado acordou o mandato para agora. Com um horário pedido, válido e
    // antes do prazo do mandato, a próxima ação é ESSE horário: acordar agora faria o
    // agente ligar de novo antes da hora que a pessoa marcou.
    const quando = d.quando ? Date.parse(d.quando) : NaN
    if (Number.isFinite(quando) && quando > Date.now() && quando < Date.parse(m.expira_em)) {
      await supabaseAdmin
        .from('mandatos')
        .update({ proxima_acao_em: new Date(quando).toISOString() })
        .eq('id', m.id)
        .in('estado', ['aberto', 'em_andamento', 'aguardando_externo'])
      consumido.proxima_acao_em = new Date(quando).toISOString()
    }
  }
  if (d.tipo === 'qualificacao') {
    consumido.qualificacao = { fit: d.fit, volume_mensal_brl: d.volume_mensal_brl, sacados: d.sacados, observacao: d.observacao }
    if (d.decisor) consumido.decisor_novo = await registrarRevelado(m.empresa_id, d.decisor, d.observacao ?? lig.resumo ?? null, m.codigo)
  }
  if (d.tipo === 'reativacao') {
    consumido.reativacao = { motivo_saida: d.motivo_saida, quer_voltar: d.quer_voltar, observacao: d.observacao }
  }
  let confirmada: string | null = null
  if (d.tipo === 'reuniao_agendada') {
    const r = await confirmarReuniao(m, lig.contato_id, d, oferecidas)
    consumido.reuniao = r.registro
    confirmada = r.reservaConfirmada
  }
  // A ligação acabou: as janelas que ela segurava e não viraram reunião voltam para a
  // agenda do closer agora, e não daqui a meia hora.
  await liberarJanelas(oferecidas, confirmada)

  const reuniaoFalhou = d.tipo === 'reuniao_agendada' && !confirmada
  const { error } = await supabaseAdmin
    .from('mandato_acoes')
    .update({
      intencao: resumoDoConsumo(d.tipo, consumido),
      resultado: consumido as never,
      sucesso: !reuniaoFalhou,
      erro: reuniaoFalhou ? String((consumido.reuniao as { erro?: string } | undefined)?.erro ?? 'reunião não confirmada').slice(0, 500) : null,
    })
    .eq('id', reciboId)
  if (error) logger.error({ erro: error.message, mandato: m.id }, 'Falha ao completar o desfecho da ligação no mandato.')

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

/** As janelas (reservas) que o `ligar` mandou para a Ana, gravadas no contexto do pedido. */
function janelasOferecidas(pedido: unknown): JanelaOferecida[] {
  const ctx = pedido && typeof pedido === 'object' ? (pedido as { contexto?: { janelas?: unknown } }).contexto : null
  const lista = Array.isArray(ctx?.janelas) ? (ctx.janelas as JanelaOferecida[]) : []
  return lista.filter((j) => j && typeof j.id === 'string')
}

async function liberarJanelas(oferecidas: JanelaOferecida[], exceto: string | null): Promise<void> {
  const ids = oferecidas.map((j) => j.id).filter((id) => id !== exceto)
  if (!ids.length) return
  await supabaseAdmin
    .from('agenda_reservas')
    .update({ expira_em: new Date().toISOString() })
    .in('id', ids)
    .is('confirmada_em', null)
}

/**
 * `reuniao_agendada`: a janela que a Ana confirmou vira a reunião do closer.
 *
 * A Ana devolve o `janela_id` que mandamos (o id da reserva). Na falta dele, vale o
 * `inicio` — mas só se bater com uma das janelas OFERECIDAS nesta ligação: um horário que
 * não oferecemos não vira reunião, por mais que a Ana diga que a pessoa aceitou.
 *
 * Entre oferecer e confirmar pode ter passado mais que a reserva (a Ana liga quando
 * pode). Então a janela é RECONFERIDA antes de marcar: `app__agenda_reservar` recusa se
 * outra conversa a reservou ou se o closer já tem reunião naquele horário. Ocupada, a
 * reunião não é marcada e o agente lê "janela perdida" no próximo ciclo — duas reuniões
 * no mesmo horário do closer são piores que uma ligação de volta.
 */
async function confirmarReuniao(
  m: { id: string; codigo: string | null },
  contatoId: string | null,
  d: Extract<ReturnType<typeof desfechoEstruturado>, { tipo: 'reuniao_agendada' }>,
  oferecidas: JanelaOferecida[],
): Promise<{ registro: Record<string, unknown>; reservaConfirmada: string | null }> {
  const escolhida =
    (d.janela_id ? oferecidas.find((j) => j.id === d.janela_id) : null) ??
    (d.inicio ? oferecidas.find((j) => Date.parse(j.inicio) === Date.parse(d.inicio!)) : null) ??
    null
  const reservaId = escolhida?.id ?? d.janela_id
  if (!reservaId) return { registro: { erro: 'A Ana não disse qual janela foi aceita.' }, reservaConfirmada: null }

  const { data: reserva } = await supabaseAdmin
    .from('agenda_reservas')
    .select('id, closer_id, inicio, fim, mandato_id, confirmada_em')
    .eq('id', reservaId)
    .maybeSingle()
  if (!reserva || reserva.mandato_id !== m.id) {
    return { registro: { erro: 'A janela devolvida pela Ana não é uma das oferecidas neste mandato.' }, reservaConfirmada: null }
  }
  if (reserva.confirmada_em) return { registro: { erro: 'Esta janela já tinha sido confirmada.' }, reservaConfirmada: null }

  const { data: conferida } = await supabaseAdmin.rpc('app__agenda_reservar', {
    p: { closer_id: reserva.closer_id, mandato_id: m.id, inicio: reserva.inicio, fim: reserva.fim, minutos: 5 } as never,
  })
  const c = conferida as { ok: boolean; reserva_id?: string; motivo?: string } | null
  if (!c?.ok || !c.reserva_id) {
    return {
      registro: { erro: 'janela_perdida: o horário aceito foi tomado antes da confirmação. Ofereça outras janelas.', inicio: reserva.inicio },
      reservaConfirmada: null,
    }
  }

  const { data: contato } = contatoId
    ? await supabaseAdmin.from('contatos').select('nome, email').eq('id', contatoId).maybeSingle()
    : { data: null }
  const { data: marcada, error } = await supabaseAdmin.rpc('app__agente_agendar_reuniao', {
    p: {
      mandato_id: m.id,
      closer_id: reserva.closer_id,
      inicio: reserva.inicio,
      duracao_min: Math.round((new Date(reserva.fim).getTime() - new Date(reserva.inicio).getTime()) / 60_000),
      modalidade: 'meet',
      reserva_id: reserva.id,
      participantes: contato ? [{ nome: contato.nome, email: contato.email, contato_id: contatoId }] : [],
      descricao: `Reunião confirmada por telefone pela Ana (${m.codigo ?? ''}).`,
    } as never,
  })
  // A reserva de conferência cumpriu o papel (travar o horário até a reunião existir).
  await supabaseAdmin.from('agenda_reservas').update({ expira_em: new Date().toISOString() }).eq('id', c.reserva_id)
  if (error) return { registro: { erro: error.message }, reservaConfirmada: null }
  return { registro: marcada as Record<string, unknown>, reservaConfirmada: reserva.id }
}

function resumoDoConsumo(tipo: string, c: Record<string, unknown>): string {
  const contato = c.contato_novo as { nome?: string; ja_existia?: boolean } | undefined
  switch (tipo) {
    case 'indicou_outro_contato':
      // Sem a chave ainda: é o texto do recibo, gravado antes de registrar o contato.
      if (!('contato_novo' in c)) return 'A ligação indicou outro contato; registrando.'
      if (!contato) return 'A ligação indicou outro contato, mas não foi possível registrá-lo.'
      return `A ligação indicou outro contato: ${contato.nome ?? '—'}${contato.ja_existia ? ' (já cadastrado)' : ' (registrado agora)'}.`
    case 'agendar_retorno':
      return `A pessoa pediu retorno${c.retorno_em ? ` em ${String(c.retorno_em)}` : ''}${contato?.nome ? ` com ${contato.nome}` : ''}.`
    case 'qualificacao': {
      const q = c.qualificacao as { fit?: string | null } | undefined
      return `A ligação qualificou a empresa: fit ${q?.fit ?? 'não informado'}.`
    }
    case 'reativacao': {
      const r = c.reativacao as { quer_voltar?: string | null; motivo_saida?: string | null } | undefined
      return `Reativação: quer voltar? ${r?.quer_voltar ?? 'não informado'}${r?.motivo_saida ? `. Motivo da saída: ${r.motivo_saida}` : ''}.`
    }
    case 'reuniao_agendada': {
      const erro = (c.reuniao as { erro?: string } | undefined)?.erro
      if (erro) return `A pessoa aceitou uma janela ao telefone, mas a reunião NÃO foi marcada: ${erro}`
      return c.reuniao ? 'A Ana confirmou uma das janelas: a reunião foi marcada.' : 'A Ana disse que a pessoa aceitou uma janela; confirmando a reunião.'
    }
    default:
      return `A ligação terminou com o desfecho "${String(c.outcome ?? 'sem desfecho')}".`
  }
}
