import {
  FIREFLIES_GRAPHQL,
  MUTATION_ADD_TO_LIVE,
  QUERY_ACTIVE_MEETINGS,
  QUERY_TRANSCRIPT,
  assinaturaFirefliesConfere,
  chaveIdempotencia,
  estadoResgate,
  lerWebhookFireflies,
  normalizarLinkReuniao,
  normalizarTranscricao,
  type TranscricaoNormalizada,
} from '../../../../packages/core/src/analise/fireflies.js'
import { EVENTO_TIPOS } from '../../../../packages/core/src/constants.js'
import { supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'
import { requisitarJson } from '../net/http.js'
import { emitirEvento } from '../radar/eventos.js'
import { carregarConfigQualidade, segredoQualidade } from './config.js'

/**
 * FIREFLIES (05C §1) — webhook, GraphQL e o resgate manual.
 *
 * ─── SÓ GUARDAMOS TRANSCRIÇÃO DE REUNIÃO NOSSA ──────────────────────────────
 * A conta central recebe o webhook de TUDO que ela grava. Uma transcrição que não casa
 * com reunião da plataforma (reunião interna, alguém que convidou o fred por fora) é
 * registrada como evento e DESCARTADA: o texto não entra. E reunião marcada como "não
 * gravar" também não recebe o texto, mesmo que o bot tenha entrado por engano.
 *
 * ─── A MÍDIA NÃO É COPIADA (§1.5) ───────────────────────────────────────────
 * Guardamos o link, a transcrição e a análise. Áudio e vídeo ficam no Fireflies.
 */

interface ErroGraphql {
  message?: string
  code?: string
  extensions?: { code?: string }
}

async function graphql<T>(query: string, variables: Record<string, unknown>, tentativas = 2): Promise<T> {
  const chave = await segredoQualidade('fireflies_api_key')
  if (!chave) throw new Error('Chave da API do Fireflies não cadastrada (Comercial → Qualidade → Configurações).')
  const r = await requisitarJson<{ data?: T; errors?: ErroGraphql[] }>(FIREFLIES_GRAPHQL, {
    method: 'POST',
    headers: { authorization: `Bearer ${chave}` },
    body: { query, variables },
    tentativas,
    timeoutMs: 30_000,
  })
  if (r.errors?.length) {
    const msg = r.errors.map((e) => [e.extensions?.code ?? e.code, e.message].filter(Boolean).join(': ')).join('; ')
    throw new Error(`Fireflies: ${msg}`)
  }
  if (!r.data) throw new Error('Fireflies devolveu resposta vazia.')
  return r.data
}

export async function buscarTranscricao(meetingId: string): Promise<TranscricaoNormalizada> {
  const d = await graphql<{ transcript: unknown }>(QUERY_TRANSCRIPT, { id: meetingId })
  if (!d.transcript) throw new Error(`Transcrição ${meetingId} não encontrada no Fireflies.`)
  return normalizarTranscricao(d.transcript)
}

// ─── Webhook ────────────────────────────────────────────────────────────────

export interface RespostaWebhook {
  status: number
  corpo: Record<string, unknown>
  /** Id da linha gravada, para o processamento assíncrono. */
  id: string | null
}

/**
 * Grava a requisição ANTES de validar, devolve o status, e só então o trabalho acontece
 * (fora da requisição: o Fireflies desiste em 30 s e não reenvia o que respondeu tarde).
 */
export async function receberWebhookFireflies(cru: string, assinatura: string | null): Promise<RespostaWebhook> {
  const segredo = await segredoQualidade('fireflies_webhook_secret')
  const assinaturaOk = await assinaturaFirefliesConfere(segredo, cru, assinatura)
  let json: unknown = null
  try {
    json = JSON.parse(cru)
  } catch {
    json = null
  }
  const w = lerWebhookFireflies(json)

  const status = !assinaturaOk ? 401 : !w.meeting_id && w.conhecido ? 422 : 200
  const { data, error } = await supabaseAdmin
    .from('fireflies_webhooks')
    .insert({
      assinatura_ok: assinaturaOk,
      evento: w.evento || null,
      meeting_id: w.meeting_id,
      client_reference_id: w.client_reference_id,
      chave: assinaturaOk ? chaveIdempotencia(w) : null,
      conhecido: w.conhecido,
      corpo: (json ?? null) as never,
      corpo_texto: cru.slice(0, 65_536),
      status_http: status,
      erro: !assinaturaOk
        ? segredo ? (assinatura ? 'assinatura não confere' : 'sem X-Hub-Signature') : 'segredo do webhook não cadastrado'
        : !w.conhecido ? `evento desconhecido: ${w.evento || '(vazio)'}` : null,
      // Desconhecido e inválido não têm o que processar: nascem fechados.
      processado_em: !assinaturaOk || !w.conhecido || !w.meeting_id ? new Date().toISOString() : null,
    })
    .select('id')
    .single()

  if (error?.code === '23505') {
    logger.info({ evento: w.evento, meeting_id: w.meeting_id }, 'Webhook do Fireflies repetido; já registrado.')
    return { status: 200, corpo: { ok: true, duplicado: true }, id: null }
  }
  if (error) {
    logger.error({ erro: error.message }, 'Falha ao gravar webhook do Fireflies.')
    // 503: o Fireflies reenvia em 30 s, 2 min, 10 min…
    return { status: 503, corpo: { ok: false }, id: null }
  }
  if (status === 401) return { status, corpo: { erro: 'Não autorizado.' }, id: null }
  if (!w.conhecido) {
    logger.warn({ evento: w.evento }, 'Webhook do Fireflies com evento desconhecido — registrado, não tratado.')
    return { status: 200, corpo: { ok: true, registrado: true, tratado: false }, id: null }
  }
  if (status === 422) return { status, corpo: { ok: false, erro: 'meeting_id ausente.' }, id: null }
  return { status: 200, corpo: { ok: true }, id: data.id }
}

interface LinhaWebhook {
  id: string
  evento: string | null
  meeting_id: string | null
  client_reference_id: string | null
  recebido_em: string
  tentativas: number
}

async function reuniaoPorFireflies(p: {
  meeting_id?: string | null
  client_reference_id?: string | null
  cal_id?: string | null
  meeting_link?: string | null
  inicio?: string | null
}): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc('app__reuniao_por_fireflies', { p: p as never })
  if (error) throw new Error(error.message)
  return (data as string | null) ?? null
}

/** Processa uma linha. Devolve o erro (ou null) e se vale tentar de novo. */
export async function processarWebhook(id: string): Promise<{ ok: boolean; erro?: string }> {
  const { data: w } = await supabaseAdmin
    .from('fireflies_webhooks')
    .select('id, evento, meeting_id, client_reference_id, recebido_em, tentativas')
    .eq('id', id)
    .maybeSingle()
  if (!w || !w.meeting_id) return { ok: false, erro: 'webhook não encontrado' }
  await supabaseAdmin.from('fireflies_webhooks').update({ tentativas: w.tentativas + 1 }).eq('id', id)

  try {
    const r = await tratar(w as LinhaWebhook)
    await supabaseAdmin
      .from('fireflies_webhooks')
      .update({ processado_em: new Date().toISOString(), reuniao_id: r.reuniaoId, erro: r.aviso ?? null })
      .eq('id', id)
    return { ok: true }
  } catch (erro) {
    const msg = erro instanceof Error ? erro.message : String(erro)
    // Depois de 5 tentativas a linha fecha com o erro — sem fila eterna.
    const desistir = w.tentativas + 1 >= 5
    await supabaseAdmin
      .from('fireflies_webhooks')
      .update({ erro: msg.slice(0, 1000), processado_em: desistir ? new Date().toISOString() : null })
      .eq('id', id)
    logger.warn({ id, evento: w.evento, erro: msg, desistir }, 'Webhook do Fireflies não processado.')
    return { ok: false, erro: msg }
  }
}

async function tratar(w: LinhaWebhook): Promise<{ reuniaoId: string | null; aviso?: string }> {
  const meetingId = w.meeting_id!
  if (w.evento === 'meeting.bot_joined') return botEntrou(w, meetingId)
  if (w.evento === 'meeting.transcribed') return transcrita(w, meetingId)
  if (w.evento === 'meeting.summarized') return resumida(w, meetingId)
  return { reuniaoId: null, aviso: `evento não tratado: ${w.evento}` }
}

/**
 * `bot_joined` só traz o meeting_id. A reunião ao vivo ainda não tem transcrição para
 * consultar; quem diz o link é `active_meetings` da conta central. Não achou: lança, e a
 * varredura tenta de novo — a transcrição, quando vier, amarra de qualquer jeito.
 */
async function botEntrou(w: LinhaWebhook, meetingId: string) {
  let reuniaoId = await reuniaoPorFireflies({ meeting_id: meetingId, client_reference_id: w.client_reference_id })
  if (!reuniaoId) {
    const cfg = await carregarConfigQualidade()
    const d = await graphql<{ active_meetings: Array<{ id: string; meeting_link?: string | null; start_time?: string | null }> | null }>(
      QUERY_ACTIVE_MEETINGS,
      { email: cfg.captura.email_conta_central },
    )
    const ativa = (d.active_meetings ?? []).find((m) => m.id === meetingId)
    if (ativa?.meeting_link) {
      reuniaoId = await reuniaoPorFireflies({
        meeting_link: normalizarLinkReuniao(ativa.meeting_link),
        inicio: ativa.start_time ?? w.recebido_em,
      })
    }
  }
  if (!reuniaoId) throw new Error('Reunião da plataforma não encontrada para este bot.')

  const { data: r } = await supabaseAdmin
    .from('reunioes')
    .update({
      fireflies_meeting_id: meetingId,
      bot_entrou_em: w.recebido_em,
      alerta_sem_bot_em: null,
      atualizada_em: new Date().toISOString(),
    })
    .eq('id', reuniaoId)
    .select('id, empresa_id, vendedor_id, evento_id, captura_status')
    .single()
  if (r && ['agendada', 'sem_captura'].includes(r.captura_status)) {
    await supabaseAdmin.from('reunioes').update({ captura_status: 'bot_entrou' }).eq('id', reuniaoId)
  }
  // O resgate pedido para esta reunião deixa de ser necessário.
  await supabaseAdmin.from('fireflies_resgates').update({ status: 'cancelado', erro: 'o bot entrou' })
    .eq('reuniao_id', reuniaoId).eq('status', 'na_fila')
  if (r) {
    await emitirEvento(r.empresa_id, EVENTO_TIPOS.REUNIAO_BOT_ENTROU, {
      resumo: 'O gravador do Fireflies entrou na reunião.',
      reuniao_id: reuniaoId,
      evento_id: r.evento_id,
      vendedor_id: r.vendedor_id,
    })
  }
  return { reuniaoId }
}

async function transcrita(w: LinhaWebhook, meetingId: string) {
  const t = await buscarTranscricao(meetingId)
  const reuniaoId = await reuniaoPorFireflies({
    client_reference_id: w.client_reference_id,
    meeting_id: meetingId,
    cal_id: t.cal_id,
    meeting_link: normalizarLinkReuniao(t.meeting_link),
    inicio: w.recebido_em,
  })
  if (!reuniaoId) {
    logger.info({ meetingId, titulo: t.titulo }, 'Transcrição sem reunião da plataforma — texto descartado.')
    return { reuniaoId: null, aviso: 'sem reunião da plataforma correspondente: transcrição não armazenada' }
  }

  const { data: atual } = await supabaseAdmin
    .from('reunioes')
    .select('id, captura_status, empresa_id, vendedor_id, evento_id, resumo, bot_entrou_em')
    .eq('id', reuniaoId)
    .single()
  if (!atual) return { reuniaoId: null, aviso: 'reunião sumiu' }
  if (atual.captura_status === 'dispensada') {
    return { reuniaoId, aviso: 'reunião marcada para não gravar: transcrição não armazenada' }
  }

  const agora = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('reunioes')
    .update({
      fireflies_meeting_id: meetingId,
      captura_status: 'transcrita',
      bot_entrou_em: atual.bot_entrou_em ?? w.recebido_em,
      transcricao_recebida_em: agora,
      transcricao: t.texto,
      transcricao_segmentos: t.segmentos as never,
      participantes_detectados: t.participantes as never,
      duracao_s: t.duracao_s,
      url_fireflies: t.url,
      resumo: t.resumo ?? atual.resumo,
      resumo_origem: t.resumo ? 'fireflies' : undefined,
      resumo_recebido_em: t.resumo ? agora : undefined,
      proximos_passos: t.proximos_passos as never,
      alerta_sem_bot_em: null,
      atualizada_em: agora,
    })
    .eq('id', reuniaoId)
  if (error) throw new Error(error.message)

  // A chave única da fila é a da interação: a mesma reunião não entra duas vezes.
  const { error: erroFila } = await supabaseAdmin.from('analise_fila').insert({ escopo: 'reuniao', reuniao_id: reuniaoId })
  if (erroFila && erroFila.code !== '23505') throw new Error(erroFila.message)

  await emitirEvento(atual.empresa_id, EVENTO_TIPOS.REUNIAO_TRANSCRITA, {
    titulo: 'Transcrição pronta',
    resumo: 'A transcrição da reunião chegou e está na aba Reunião.',
    reuniao_id: reuniaoId,
    evento_id: atual.evento_id,
    vendedor_id: atual.vendedor_id,
  })
  return { reuniaoId }
}

async function resumida(w: LinhaWebhook, meetingId: string) {
  const reuniaoId = await reuniaoPorFireflies({ meeting_id: meetingId, client_reference_id: w.client_reference_id })
  if (!reuniaoId) throw new Error('Resumo de reunião ainda não amarrada; tenta de novo depois da transcrição.')
  const t = await buscarTranscricao(meetingId)
  if (!t.resumo) return { reuniaoId, aviso: 'resumo vazio' }
  await supabaseAdmin
    .from('reunioes')
    .update({
      resumo: t.resumo,
      resumo_origem: 'fireflies',
      resumo_recebido_em: new Date().toISOString(),
      proximos_passos: t.proximos_passos as never,
      atualizada_em: new Date().toISOString(),
    })
    .eq('id', reuniaoId)
    .neq('captura_status', 'dispensada')
  return { reuniaoId }
}

/** Varredura: webhooks que ainda não fecharam (erro transitório, bot ainda sem reunião). */
export async function reprocessarWebhooks(limite = 20): Promise<number> {
  const umMinuto = new Date(Date.now() - 60_000).toISOString()
  const { data } = await supabaseAdmin
    .from('fireflies_webhooks')
    .select('id')
    .eq('assinatura_ok', true)
    .is('processado_em', null)
    .lt('recebido_em', umMinuto)
    .order('recebido_em')
    .limit(limite)
  let ok = 0
  for (const l of data ?? []) if ((await processarWebhook(l.id)).ok) ok++
  return ok
}

// ─── Resgate manual (§1.4) ──────────────────────────────────────────────────

export interface ResultadoResgates {
  enviados: number
  falhas: number
  aguardando_vaga: number
}

/**
 * Envia os pedidos da fila respeitando 3 por 20 minutos da CONTA. Sem vaga, o pedido
 * espera a próxima rodada (o vigia roda a cada 5 minutos) e a tela já disse ao usuário
 * quando ela abre.
 */
export async function enviarResgates(): Promise<ResultadoResgates> {
  const res: ResultadoResgates = { enviados: 0, falhas: 0, aguardando_vaga: 0 }
  const desde = new Date(Date.now() - 20 * 60_000).toISOString()
  const { data: recentes } = await supabaseAdmin
    .from('fireflies_resgates')
    .select('enviado_em')
    .eq('status', 'enviado')
    .gt('enviado_em', desde)
  const enviados = (recentes ?? []).map((r) => new Date(r.enviado_em!))

  const { data: fila } = await supabaseAdmin
    .from('fireflies_resgates')
    .select('id, reuniao_id, reunioes!inner(evento_id, captura_status)')
    .eq('status', 'na_fila')
    .order('pedido_em')
    .limit(10)
  if (!fila?.length) return res

  const cfg = await carregarConfigQualidade()
  for (const pedido of fila) {
    const estado = estadoResgate(enviados, new Date())
    if (!estado.disponivel) {
      res.aguardando_vaga = fila.length - res.enviados - res.falhas
      break
    }
    const reuniao = pedido.reunioes as unknown as { evento_id: string; captura_status: string }
    const { data: ev } = await supabaseAdmin
      .from('vendedor_eventos')
      .select('meet_url, titulo, inicio_em, duracao_min, cancelado_em')
      .eq('id', reuniao.evento_id)
      .single()
    const fimMs = ev ? new Date(ev.inicio_em).getTime() + ev.duracao_min * 60_000 : 0
    if (!ev?.meet_url || ev.cancelado_em || fimMs < Date.now() || ['transcrita', 'dispensada'].includes(reuniao.captura_status)) {
      await supabaseAdmin.from('fireflies_resgates').update({ status: 'cancelado', erro: 'a reunião não está mais acontecendo' }).eq('id', pedido.id)
      continue
    }
    const restante = Math.round((fimMs - Date.now()) / 60_000)
    try {
      // UMA tentativa: retentar um 429 do Fireflies queimaria a vaga da próxima pessoa.
      await graphql(
        MUTATION_ADD_TO_LIVE,
        {
          meetingLink: ev.meet_url,
          title: (ev.titulo ?? 'Reunião').slice(0, 256),
          duration: Math.min(120, Math.max(15, restante + 10)),
          language: cfg.captura.idioma,
        },
        1,
      )
      const agora = new Date()
      await supabaseAdmin.from('fireflies_resgates').update({ status: 'enviado', enviado_em: agora.toISOString(), erro: null }).eq('id', pedido.id)
      enviados.push(agora)
      res.enviados++
    } catch (erro) {
      const msg = erro instanceof Error ? erro.message : String(erro)
      if (/too_many_requests|429/.test(msg)) {
        // O contador de lá discordou do nosso (alguém chamou por fora): espera a próxima rodada.
        res.aguardando_vaga++
        break
      }
      await supabaseAdmin.from('fireflies_resgates').update({ status: 'falhou', erro: msg.slice(0, 500) }).eq('id', pedido.id)
      res.falhas++
    }
  }
  return res
}
