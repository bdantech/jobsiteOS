import {
  CalendarioGoogle,
  ESCOPO_CALENDAR,
  type ConvidadoGoogle,
  type ReuniaoParaGoogle,
} from '../../../../../packages/core/src/transportes/index.js'
import { contaGmailDoUsuario, accessTokenGmail } from '../../comunicacao/transportes.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'

/**
 * A reunião do funil vira evento no Google Agenda do anfitrião, com Meet e com o
 * cliente convidado (0201 §2 e §3).
 *
 * ─── A FILA É UMA COLUNA, E ISSO NÃO É PREGUIÇA ────────────────────────────
 * `vendedor_eventos.google_pendente_em` marcado = tem coisa a escrever lá.
 * Qualquer caminho que mexa na reunião marca; este job escreve e limpa.
 *
 * Uma tabela de fila separada seria mais "arrumada" e traria o problema que a
 * gente não quer: dois registros para um fato, e o dia em que eles discordam
 * (uma linha de fila que sobreviveu a um rollback, um evento editado sem
 * enfileirar) ninguém descobre, porque o sintoma é só uma reunião que não
 * apareceu na agenda de alguém — que é exatamente o bug que este job existe para
 * acabar.
 *
 * ─── O QUE ACONTECE QUANDO FALHA DECIDE SE A FILA ANDA ─────────────────────
 * `pendente_em` só é limpo quando a escrita no Google deu certo OU quando
 * insistir não vai adiantar (sem conexão, sem escopo, sem e-mail do anfitrião).
 * Erro transitório mantém a linha na fila para a próxima rodada. O motivo fica em
 * `google_erro` nos dois casos — é ele que a aba mostra, e é a diferença entre
 * "ainda não foi" e "não vai ir até alguém fazer alguma coisa".
 *
 * ─── PASSADO NÃO ENTRA NA FILA ─────────────────────────────────────────────
 * Reunião que já aconteceu não vai para o Google. Criar hoje um evento de ontem
 * dispara convite retroativo para o cliente — um e-mail dizendo "você foi
 * convidado" para uma conversa que já teve — e isso é pior que não sincronizar.
 */

export interface ResultadoReunioesGoogle {
  pendentes: number
  criadas: number
  atualizadas: number
  canceladas: number
  falhas: number
  /** Anfitriões sem Google conectado ou sem a permissão de agenda. */
  sem_conexao: number
}

interface EventoPendente {
  id: string
  vendedor_id: string
  empresa_id: string | null
  titulo: string
  inicio_em: string
  duracao_min: number | null
  modalidade: string
  local: string | null
  descricao: string | null
  participantes: unknown
  acompanhantes: string[] | null
  cancelado_em: string | null
  google_evento_id: string | null
  google_calendar_id: string | null
  google_conta_usuario_id: string | null
}

interface ParticipanteGravado {
  nome?: string | null
  email?: string | null
  contato_id?: string | null
}

export async function sincronizarReunioesGoogle(limite = 50): Promise<ResultadoReunioesGoogle> {
  const acc: ResultadoReunioesGoogle = {
    pendentes: 0,
    criadas: 0,
    atualizadas: 0,
    canceladas: 0,
    falhas: 0,
    sem_conexao: 0,
  }

  const { data, error } = await supabaseAdmin
    .from('vendedor_eventos')
    .select(
      'id, vendedor_id, empresa_id, titulo, inicio_em, duracao_min, modalidade, local, descricao, ' +
        'participantes, acompanhantes, cancelado_em, google_evento_id, google_calendar_id, ' +
        'google_conta_usuario_id',
    )
    .not('google_pendente_em', 'is', null)
    .order('google_pendente_em')
    .limit(limite)
  if (error) {
    logger.error({ erro: error.message }, 'Falha ao listar reuniões pendentes de sincronização.')
    return acc
  }

  const eventos = (data ?? []) as unknown as EventoPendente[]
  acc.pendentes = eventos.length
  if (eventos.length === 0) return acc

  for (const ev of eventos) {
    try {
      await sincronizarUma(ev, acc)
    } catch (erro) {
      acc.falhas += 1
      logger.error({ evento: ev.id, erro: String(erro) }, 'Erro ao sincronizar reunião com o Google.')
      await marcar(ev.id, { google_erro: String(erro) })
    }
  }

  logger.info(acc, 'Reuniões sincronizadas com o Google Agenda.')
  return acc
}

async function sincronizarUma(ev: EventoPendente, acc: ResultadoReunioesGoogle): Promise<void> {
  const cancelada = ev.cancelado_em !== null

  /*
   * O DONO DA AGENDA É QUEM ERA O DONO QUANDO O EVENTO FOI CRIADO.
   *
   * Se o card trocou de closer, o evento continua morando na agenda de quem o
   * criou — só ele tem permissão para editá-lo. Mover de agenda seria apagar lá e
   * criar cá, o que dispara "reunião cancelada" seguido de "você foi convidado"
   * no e-mail do cliente. Trocar de responsável não é remarcar, e o cliente não
   * tem que saber da nossa reorganização interna.
   */
  const anfitriao = await usuarioDoVendedor(ev.vendedor_id)
  const usuarioDaAgenda = ev.google_conta_usuario_id ?? anfitriao?.usuario_id ?? null

  if (!usuarioDaAgenda) {
    acc.sem_conexao += 1
    return marcar(ev.id, {
      google_pendente_em: null,
      google_erro:
        `O anfitrião (${anfitriao?.nome ?? 'vendedor'}) não tem login na plataforma — ` +
        'não há agenda do Google para escrever. A reunião continua no calendário interno.',
    })
  }

  const conta = await contaGmailDoUsuario(usuarioDaAgenda)
  if (!conta) {
    acc.sem_conexao += 1
    return marcar(ev.id, {
      // Sem conexão não é erro transitório: insistir de hora em hora não conecta
      // o Google de ninguém. Sai da fila e volta quando a reunião for editada —
      // ou no instante em que a pessoa conecta, porque o callback do OAuth
      // reenfileira as reuniões futuras dela (ver o callback do Gmail na web).
      google_pendente_em: null,
      google_erro:
        `${anfitriao?.nome ?? 'O anfitrião'} não conectou o Google. Em Comunicação › ` +
        'Configurações, conectar a conta põe as reuniões no Google Agenda.',
    })
  }
  if (!conta.escopos?.includes(ESCOPO_CALENDAR)) {
    acc.sem_conexao += 1
    return marcar(ev.id, {
      google_pendente_em: null,
      google_erro:
        `A conexão do Google de ${conta.endereco} é anterior à agenda e não tem essa ` +
        'permissão. Reconecte em Comunicação › Configurações.',
    })
  }

  if (!cancelada && new Date(ev.inicio_em).getTime() < Date.now()) {
    return marcar(ev.id, {
      google_pendente_em: null,
      google_erro: 'Reunião no passado — não foi criada no Google para não disparar convite retroativo.',
    })
  }

  const accessToken = await accessTokenGmail(conta)
  if (!accessToken) {
    // Refresh revogado: `accessTokenGmail` já marcou a conta e a tela já pede
    // reconexão. Fica na fila — uma reconexão resolve sem tocar na reunião.
    acc.falhas += 1
    return marcar(ev.id, { google_erro: 'Não foi possível renovar o token do Google.' })
  }

  const calendario = new CalendarioGoogle({
    accessToken,
    calendarId: ev.google_calendar_id ?? 'primary',
  })

  if (cancelada) {
    if (!ev.google_evento_id) {
      // Nasceu e morreu sem nunca ter ido ao Google. Nada a cancelar lá.
      return marcar(ev.id, { google_pendente_em: null, google_erro: null })
    }
    const r = await calendario.cancelar(ev.google_evento_id)
    if (!r.ok && r.falha === 'transitoria') {
      acc.falhas += 1
      return marcar(ev.id, { google_erro: r.erro ?? null })
    }
    acc.canceladas += 1
    return marcar(ev.id, {
      google_pendente_em: null,
      google_evento_id: null,
      meet_url: null,
      google_sincronizado_em: new Date().toISOString(),
      google_erro: r.ok ? null : (r.erro ?? null),
    })
  }

  const reuniao = await montarReuniao(ev, conta.endereco)

  const resposta = ev.google_evento_id
    ? await calendario.atualizar(ev.google_evento_id, reuniao)
    : await calendario.criar(reuniao)

  /*
   * Evento apagado à mão na agenda do Google vira um evento NOVO, não um erro.
   *
   * O `PUT` num id que não existe mais devolve 404, e a alternativa seria deixar
   * a reunião marcada como "falhou" para sempre. Quem apagou provavelmente estava
   * limpando a agenda; quem abriu o card continua vendo uma reunião marcada. A
   * verdade é a nossa, e recriar é como ela volta a valer nos dois lugares.
   */
  if (!resposta.ok && resposta.falha === 'sumiu') {
    const recriada = await calendario.criar(reuniao)
    return concluir(ev, recriada, acc, true)
  }

  return concluir(ev, resposta, acc, !ev.google_evento_id)
}

async function concluir(
  ev: EventoPendente,
  r: { ok: boolean; eventoId?: string | null; meetUrl?: string | null; erro?: string | null; falha?: string | null },
  acc: ResultadoReunioesGoogle,
  criou: boolean,
): Promise<void> {
  if (!r.ok) {
    acc.falhas += 1
    if (r.falha === 'escopo') acc.sem_conexao += 1
    return marcar(ev.id, {
      // Transitório fica na fila; o resto sai, porque tentar de novo daria o mesmo.
      google_pendente_em: r.falha === 'transitoria' || r.falha === 'token' ? undefined : null,
      google_erro: r.erro ?? 'Falha desconhecida ao escrever no Google.',
    })
  }

  if (criou) acc.criadas += 1
  else acc.atualizadas += 1

  await marcar(ev.id, {
    google_evento_id: r.eventoId ?? null,
    google_calendar_id: ev.google_calendar_id ?? 'primary',
    google_conta_usuario_id: ev.google_conta_usuario_id ?? (await usuarioDoVendedor(ev.vendedor_id))?.usuario_id,
    // O Meet só vem na criação da conferência; um update de reunião presencial
    // não pode apagar o link de uma que já tinha sala.
    meet_url: r.meetUrl ?? undefined,
    google_pendente_em: null,
    google_sincronizado_em: new Date().toISOString(),
    google_erro: null,
  })
}

/**
 * Quem é convidado: os contatos do cliente que a aba escolheu, mais os nossos
 * acompanhantes que têm e-mail de trabalho.
 *
 * O anfitrião NÃO entra na lista. Ele é o organizador — o Google já o põe no
 * evento, e repeti-lo em `attendees` faz a própria pessoa receber um convite para
 * a reunião que ela está criando.
 */
async function montarReuniao(ev: EventoPendente, emailAnfitriao: string): Promise<ReuniaoParaGoogle> {
  const convidados: ConvidadoGoogle[] = []

  const participantes = Array.isArray(ev.participantes)
    ? (ev.participantes as ParticipanteGravado[])
    : []
  for (const p of participantes) {
    if (p?.email && p.email.includes('@')) {
      convidados.push({ email: p.email, nome: p.nome ?? null, interno: false })
    }
  }

  for (const vendedorId of ev.acompanhantes ?? []) {
    const v = await usuarioDoVendedor(vendedorId)
    // `email_remetente` é o endereço de trabalho do vendedor; a conta do Google
    // conectada é o mesmo endereço quando existe. Sem nenhum dos dois, o
    // acompanhante fica de fora do convite e continua com a reunião no calendário
    // interno — que é onde ele já a via antes disto tudo.
    const email = v?.email ?? null
    if (email && email !== emailAnfitriao) {
      convidados.push({ email, nome: v?.nome ?? null, interno: true })
    }
  }

  const modalidade = (['meet', 'presencial', 'telefone', 'a_definir'] as const).includes(
    ev.modalidade as 'meet',
  )
    ? (ev.modalidade as ReuniaoParaGoogle['modalidade'])
    : 'a_definir'

  return {
    id: ev.id,
    titulo: ev.titulo,
    inicioEm: new Date(ev.inicio_em),
    duracaoMin: ev.duracao_min ?? 60,
    modalidade,
    local: ev.local,
    descricao: ev.descricao,
    convidados,
  }
}

interface VendedorResolvido {
  usuario_id: string | null
  nome: string
  email: string | null
}

/** Memória por corrida: o mesmo SDR acompanha várias reuniões do mesmo lote. */
const cacheVendedor = new Map<string, VendedorResolvido | null>()

async function usuarioDoVendedor(vendedorId: string): Promise<VendedorResolvido | null> {
  if (cacheVendedor.has(vendedorId)) return cacheVendedor.get(vendedorId) ?? null

  const { data } = await supabaseAdmin
    .from('vendedores')
    .select('usuario_id, nome, email_remetente')
    .eq('id', vendedorId)
    .maybeSingle()

  let resolvido: VendedorResolvido | null = null
  if (data) {
    const d = data as { usuario_id: string | null; nome: string; email_remetente: string | null }
    let email = d.email_remetente
    if (!email && d.usuario_id) {
      const { data: conta } = await supabaseAdmin
        .from('gmail_contas')
        .select('endereco')
        .eq('usuario_id', d.usuario_id)
        .maybeSingle()
      email = (conta as { endereco: string } | null)?.endereco ?? null
    }
    resolvido = { usuario_id: d.usuario_id, nome: d.nome, email }
  }
  cacheVendedor.set(vendedorId, resolvido)
  return resolvido
}

/** `undefined` numa chave significa "não mexe"; `null` significa "apaga". */
async function marcar(id: string, campos: Record<string, unknown>): Promise<void> {
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(campos)) {
    if (v !== undefined) patch[k] = v
  }
  if (Object.keys(patch).length === 0) return
  const { error } = await supabaseAdmin.from('vendedor_eventos').update(patch).eq('id', id)
  if (error) logger.error({ evento: id, erro: error.message }, 'Falha ao gravar o estado da sincronização.')
}
