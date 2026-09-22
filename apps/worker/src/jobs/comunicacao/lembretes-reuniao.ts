import {
  identificadorCanonico,
  primeiroNome,
  renderizarMensagem,
} from '../../../../../packages/core/src/comunicacao/index.js'
import { proximaAbertura } from '../../../../../packages/core/src/comunicacao/janela.js'
import { tipoDeLembrete } from '../../../../../packages/core/src/comunicacao/lembretes.js'
import { lerConfigComunicacao } from '../../comunicacao/config.js'
import { contaDoUsuario } from '../../comunicacao/transportes.js'
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
  /** Entrega cai no MESMO dia da reunião — o D-1 que atrasou vira "é hoje". */
  d0: number
  h1: number
  reagendamentos: number
}

type Tipo = 'confirmacao' | 'd1' | 'd0' | 'h1' | 'reagendamento'

const TEMPLATE_POR_TIPO: Record<Tipo, string> = {
  confirmacao: 'Confirmação de reunião',
  d1: 'Lembrete D-1',
  d0: 'Lembrete D-0',
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

/**
 * Quem ASSINA o lembrete: o SDR que marcou a reunião.
 *
 * `vendedor_eventos.vendedor_id` é o dono da AGENDA — o closer que vai à chamada.
 * Está certo para o calendário e errado para a mensagem: quem falou com o contato,
 * combinou o horário e cujo número ele conhece é o SDR. Mandar o lembrete em nome
 * de alguém que o cliente nunca viu é um número desconhecido pedindo confirmação
 * de uma reunião — que é como se ganha um bloqueio.
 *
 * O caminho de reagendamento neste mesmo arquivo já usava `lead.sdr_id`; esta
 * função é essa regra aplicada também aos lembretes que nascem da agenda.
 */
async function assinanteDoLembrete(ev: Evento): Promise<string> {
  if (!ev.sdr_lead_id) return ev.vendedor_id
  const { data } = await supabaseAdmin
    .from('sdr_leads')
    .select('sdr_id')
    .eq('id', ev.sdr_lead_id)
    .maybeSingle()
  return (data as { sdr_id?: string | null } | null)?.sdr_id ?? ev.vendedor_id
}

export async function lembretesDeReuniao(agora = new Date()): Promise<ResultadoLembretes> {
  const acc: ResultadoLembretes = {
    reunioes: 0,
    confirmacoes: 0,
    d1: 0,
    d0: 0,
    h1: 0,
    reagendamentos: 0,
  }

  const cfg = await lerConfigComunicacao()
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

  /*
   * O TEXTO É ESCRITO PARA A HORA DA ENTREGA, NÃO PARA A HORA DA GERAÇÃO.
   *
   * A janela de envio é seg–sex, 9h–18h: o fim de semana já nunca recebeu nada.
   * O que faltava era o corpo saber disso. Um D-1 gerado no domingo de manhã dizia
   * "nossa conversa AMANHÃ, 21/09" e só saía da fila na segunda às 9h — quando
   * "amanhã" já era hoje e a reunião estava a uma hora, não a vinte e oito.
   *
   * `proximaAbertura` responde "se eu enfileirar agora, quando isso chega?", e é
   * essa distância — e não a distância até agora — que escolhe o template. Domingo
   * de manhã, para uma reunião segunda ao meio-dia, a resposta passa a ser o D-0
   * ("é hoje, às 13:00"), enfileirado no domingo e entregue na segunda.
   */
  const entrega = proximaAbertura(agora, cfg.janela)

  for (const ev of eventos) {
    const inicio = new Date(ev.inicio_em)
    const faltamNaEntrega = inicio.getTime() - entrega.getTime()

    /*
     * Nada que só chegue DEPOIS da conversa — nem lembrete, nem confirmação.
     *
     * Antes esta guarda não precisava existir: a conta era feita contra `agora` e
     * o passado nunca entrava. Agora que ela é contra a ENTREGA, uma reunião de
     * sexta às 17h cujo primeiro horário de envio é segunda de manhã cai aqui.
     */
    if (faltamNaEntrega <= 0) continue

    // Confirmação: só para reuniões marcadas na última hora. Mandar confirmação
    // de uma reunião marcada semana passada confunde quem já a tem na agenda.
    if (agora.getTime() - new Date(ev.criado_em).getTime() < 3_600_000) {
      if (await enfileirarLembrete(ev, 'confirmacao', inicio, entrega)) {
        acc.confirmacoes += 1
      }
    }

    const tipo = tipoDeLembrete(faltamNaEntrega, inicio, entrega, cfg.janela.timezone)
    if (!tipo) continue
    if (await enfileirarLembrete(ev, tipo, inicio, entrega)) {
      acc[tipo] += 1
    }
  }

  acc.reagendamentos = await reagendarNoShows(agora, entrega)

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
async function reagendarNoShows(agora: Date, entrega: Date): Promise<number> {
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
    if (await enfileirarLembrete(ev, 'reagendamento', new Date(ev.inicio_em), entrega)) n += 1
  }
  return n
}

async function enfileirarLembrete(
  ev: Evento,
  tipo: Tipo,
  inicio: Date,
  entrega: Date,
): Promise<boolean> {
  if (!ev.empresa_id) return false

  const assinante = await assinanteDoLembrete(ev)
  const { data: vendedor } = await supabaseAdmin
    .from('vendedores')
    .select('usuario_id')
    .eq('id', assinante)
    .maybeSingle()
  const assinanteUsuarioId = (vendedor as { usuario_id?: string | null } | null)?.usuario_id ?? null

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

  /*
   * O NÚMERO É FIXADO AQUI, e não sorteado no envio.
   *
   * `enviar-fila` resolve a conta assim: `whatsapp_conta_id` → conta de
   * `criada_por` → `escolherConta()` (round-robin pela menos usada do dia). Uma
   * automação não tem `criada_por` — não há humano que a escreveu —, então os
   * lembretes caíam SEMPRE no round-robin e saíam pelo celular de quem tivesse
   * mandado menos mensagens naquele dia.
   *
   * O resultado foi um lembrete do card do Viktor saindo pelo número do Rodrigo,
   * que não sabia de nada. O número de quem assina é a única resposta certa: é no
   * aparelho dele que a resposta do cliente vai cair.
   *
   * Sem conta ligada, segue nulo e o round-robin decide — um lembrete por um
   * número estranho ainda é melhor que reunião sem lembrete —, mas o aviso fica
   * registrado, porque a correção é ligar o número daquela pessoa.
   */
  const conta = await contaDoUsuario(assinanteUsuarioId, 'relacionamento')
  if (!conta) {
    logger.warn(
      { vendedor_id: assinante, tipo },
      'Quem assina o lembrete não tem conta de WhatsApp: o número sairá por rodízio.',
    )
  }

  const { error } = await supabaseAdmin.from('mensagens_outbox').insert({
    canal,
    destinatario: destino,
    destinatario_contato_id: contato.id,
    corpo,
    assunto: template.assunto,
    status: 'aprovada',
    origem: 'outbox',
    empresa_id: ev.empresa_id,
    vendedor_id: assinante,
    whatsapp_conta_id: conta?.id ?? null,
    template_id: template.id,
    funil: 'sdr',
    funil_card_id: ev.sdr_lead_id,
    access_keys: [],
    /*
     * O H-1 fura a janela DE PROPÓSITO, e é a única automação que faz isso: um
     * lembrete de uma reunião que começa em uma hora não pode esperar até as 9h
     * do dia seguinte — nessa altura ele não é um lembrete, é um obituário.
     */
    /*
     * O instante da ENTREGA, explícito — o mesmo que escolheu o texto.
     *
     * Era `null` (= "assim que der"), e quem descobria a hora real era a fila,
     * horas depois. Gravar aqui faz o corpo e o horário saírem da mesma conta: se
     * a mensagem diz "é hoje", é porque ela foi agendada para hoje.
     *
     * O H-1 continua sendo agora: um lembrete de uma reunião que começa em uma
     * hora não espera pela próxima abertura — nessa altura ele não é um lembrete,
     * é um obituário.
     */
    agendada_para: tipo === 'h1' ? new Date().toISOString() : entrega.toISOString(),
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
