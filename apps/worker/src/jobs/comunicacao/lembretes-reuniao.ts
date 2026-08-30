import {
  identificadorCanonico,
  primeiroNome,
  renderizarMensagem,
} from '../../../../../packages/core/src/comunicacao/index.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'

/**
 * Reuniões: confirmação, lembrete D-1, lembrete H-1 e reagendamento pós no-show
 * (§5).
 *
 * Entrou neste prompt por ROI imediato: os dados já existem em `vendedor_eventos`
 * desde o 04g, e um lembrete de véspera é a diferença entre uma agenda cheia e
 * uma agenda com no-show — sem nenhum modelo, nenhuma decisão e nenhum risco.
 *
 * ─── A IDEMPOTÊNCIA É O LEDGER, NÃO UMA COLUNA DE CONTROLE ──────────────────
 * O job roda de hora em hora e não pode mandar o mesmo lembrete duas vezes. Em
 * vez de uma coluna `lembrete_d1_enviado` (que é estado duplicado e mente quando
 * o envio falha), a checagem é: já existe saída para esta conversa, neste
 * template, nesta janela? O ledger é a verdade, e usá-lo aqui é a mesma regra do
 * §2 aplicada a si mesma.
 */

export interface ResultadoLembretes {
  reunioes: number
  confirmacoes: number
  d1: number
  h1: number
  reagendamentos: number
}

type Tipo = 'confirmacao' | 'd1' | 'h1' | 'reagendamento'

const TEMPLATE_POR_TIPO: Record<Tipo, string> = {
  confirmacao: 'Confirmação de reunião',
  d1: 'Lembrete D-1',
  h1: 'Lembrete H-1',
  reagendamento: 'Reagendamento pós no-show',
}

interface Evento {
  id: string
  vendedor_id: string
  empresa_id: string | null
  titulo: string
  inicio_em: string
  criado_em: string
  sdr_lead_id: string | null
}

export async function lembretesDeReuniao(agora = new Date()): Promise<ResultadoLembretes> {
  const acc: ResultadoLembretes = {
    reunioes: 0,
    confirmacoes: 0,
    d1: 0,
    h1: 0,
    reagendamentos: 0,
  }

  const daqui48h = new Date(agora.getTime() + 48 * 3_600_000)
  const { data, error } = await supabaseAdmin
    .from('vendedor_eventos')
    .select('id, vendedor_id, empresa_id, titulo, inicio_em, criado_em, sdr_lead_id')
    .eq('tipo', 'reuniao')
    .is('cancelado_em', null)
    .gte('inicio_em', agora.toISOString())
    .lte('inicio_em', daqui48h.toISOString())
    .limit(200)
  if (error) {
    logger.error({ erro: error.message }, 'Falha ao listar reuniões para lembrete.')
    return acc
  }

  const eventos = (data ?? []) as Evento[]
  acc.reunioes = eventos.length

  for (const ev of eventos) {
    const inicio = new Date(ev.inicio_em)
    const faltamMs = inicio.getTime() - agora.getTime()

    // Confirmação: só para reuniões marcadas na última hora. Mandar confirmação
    // de uma reunião marcada semana passada confunde quem já a tem na agenda.
    if (agora.getTime() - new Date(ev.criado_em).getTime() < 3_600_000) {
      if (await enfileirarLembrete(ev, 'confirmacao', inicio)) acc.confirmacoes += 1
    }
    if (faltamMs > 20 * 3_600_000 && faltamMs <= 28 * 3_600_000) {
      if (await enfileirarLembrete(ev, 'd1', inicio)) acc.d1 += 1
    }
    if (faltamMs > 0 && faltamMs <= 90 * 60_000) {
      if (await enfileirarLembrete(ev, 'h1', inicio)) acc.h1 += 1
    }
  }

  acc.reagendamentos = await reagendarNoShows(agora)

  logger.info(acc, 'Lembretes de reunião processados.')
  return acc
}

/**
 * No-show vira convite para remarcar, e não silêncio.
 *
 * A alternativa que existia era o card ficar em `no_show` até alguém lembrar de
 * ligar — e o lead esfria exatamente aí. A mensagem sai sem cobrança: quem não
 * apareceu já sabe que não apareceu.
 */
async function reagendarNoShows(agora: Date): Promise<number> {
  const ontem = new Date(agora.getTime() - 26 * 3_600_000)
  const { data } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, empresa_id, sdr_id, reuniao_em, atualizado_em')
    .eq('estagio', 'no_show')
    .gte('atualizado_em', ontem.toISOString())
    .limit(100)

  let n = 0
  for (const lead of data ?? []) {
    if (!lead.empresa_id) continue
    const ev: Evento = {
      id: lead.id,
      vendedor_id: lead.sdr_id,
      empresa_id: lead.empresa_id,
      titulo: 'Reunião',
      inicio_em: lead.reuniao_em ?? agora.toISOString(),
      criado_em: lead.atualizado_em,
      sdr_lead_id: lead.id,
    }
    if (await enfileirarLembrete(ev, 'reagendamento', new Date(ev.inicio_em))) n += 1
  }
  return n
}

async function enfileirarLembrete(ev: Evento, tipo: Tipo, inicio: Date): Promise<boolean> {
  if (!ev.empresa_id) return false

  const { data: template } = await supabaseAdmin
    .from('templates_mensagem')
    .select('id, corpo, assunto, canal')
    .eq('nome', TEMPLATE_POR_TIPO[tipo])
    .eq('ativo', true)
    .limit(1)
    .maybeSingle()
  if (!template) return false

  // Ponto focal primeiro — a mesma hierarquia de todo o sistema.
  const { data: contato } = await supabaseAdmin
    .from('contatos')
    .select('id, nome, whatsapp, telefone, email, base_legal')
    .eq('empresa_id', ev.empresa_id)
    .order('ponto_focal', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!contato) return false

  const canal = template.canal as 'whatsapp' | 'email'
  const destino = identificadorCanonico(
    canal,
    canal === 'email' ? contato.email : (contato.whatsapp ?? contato.telefone),
  )
  if (!destino) return false

  if (await jaEnviado(ev, tipo, template.id)) return false

  const { data: empresa } = await supabaseAdmin
    .from('empresas')
    .select('razao_social, nome_fantasia')
    .eq('id', ev.empresa_id)
    .maybeSingle()

  const corpo = renderizarMensagem(
    template.corpo,
    {
      contato_nome: primeiroNome(contato.nome),
      empresa_nome: empresa?.razao_social ?? empresa?.nome_fantasia ?? '',
      data_reuniao: formatarDataHora(inicio),
      hora_reuniao: formatarHora(inicio),
    },
    { canal, baseLegal: contato.base_legal as never },
  )

  const { error } = await supabaseAdmin.from('mensagens_outbox').insert({
    canal,
    destinatario: destino,
    destinatario_contato_id: contato.id,
    corpo,
    assunto: template.assunto,
    status: 'aprovada',
    origem: 'outbox',
    empresa_id: ev.empresa_id,
    vendedor_id: ev.vendedor_id,
    template_id: template.id,
    funil: 'sdr',
    funil_card_id: ev.sdr_lead_id,
    access_keys: [],
    /*
     * O H-1 fura a janela DE PROPÓSITO, e é a única automação que faz isso: um
     * lembrete de uma reunião que começa em uma hora não pode esperar até as 9h
     * do dia seguinte — nessa altura ele não é um lembrete, é um obituário.
     */
    agendada_para: tipo === 'h1' ? new Date().toISOString() : null,
  })
  if (error) {
    logger.error({ erro: error.message, tipo }, 'Falha ao enfileirar lembrete.')
    return false
  }
  return true
}

/**
 * Já mandamos este lembrete? Pergunta feita ao LEDGER, com a janela certa por
 * tipo: um D-1 só existe uma vez por reunião, mas um reagendamento pode
 * acontecer de novo meses depois com a mesma pessoa.
 */
async function jaEnviado(ev: Evento, tipo: Tipo, templateId: string): Promise<boolean> {
  const desde = new Date(
    Date.now() - (tipo === 'reagendamento' ? 7 : 3) * 86_400_000,
  ).toISOString()

  const { count: noLedger } = await supabaseAdmin
    .from('comunicacoes')
    .select('id', { count: 'exact', head: true })
    .eq('empresa_id', ev.empresa_id!)
    .eq('template_id', templateId)
    .eq('direcao', 'saida')
    .gte('criado_em', desde)
  if ((noLedger ?? 0) > 0) return true

  // E na fila também: entre enfileirar e enviar existe uma janela em que o
  // ledger ainda não tem a linha, e o job roda de hora em hora.
  const { count: naFila } = await supabaseAdmin
    .from('mensagens_outbox')
    .select('id', { count: 'exact', head: true })
    .eq('empresa_id', ev.empresa_id!)
    .eq('template_id', templateId)
    .in('status', ['aprovada', 'pendente_envio'])
  return (naFila ?? 0) > 0
}

function formatarDataHora(d: Date): string {
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatarHora(d: Date): string {
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  })
}
