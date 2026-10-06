import { z } from 'zod'

/**
 * FIREFLIES (05C §1) — o que é contrato com eles, sem HTTP.
 *
 * ─── O VÍNCULO NÃO É POR TÍTULO NEM POR HORÁRIO ─────────────────────────────
 * O `client_reference_id` só existe para áudio enviado por upload: reunião em que o bot
 * entra pelo calendário volta sem ele. O que volta é o `cal_id` — o id do evento no
 * Google, que nós mesmos criamos e guardamos em `vendedor_eventos.google_evento_id`. A
 * ordem de casamento é: referência nossa → evento do calendário → link da conferência.
 * Título e horário nunca: duas reuniões às 10h com "Reunião — Construtora X" existem.
 *
 * ─── O HMAC NÃO USA `node:crypto` ───────────────────────────────────────────
 * Este arquivo está no barril, que vai para o browser. A Web Crypto (`crypto.subtle`)
 * existe no Node 20 e no browser — e a comparação em tempo constante é feita à mão.
 */

export const FIREFLIES_GRAPHQL = 'https://api.fireflies.ai/graphql'

export const EVENTOS_FIREFLIES = ['meeting.bot_joined', 'meeting.transcribed', 'meeting.summarized'] as const
export type EventoFireflies = (typeof EVENTOS_FIREFLIES)[number]

export interface WebhookFireflies {
  evento: string
  conhecido: boolean
  meeting_id: string | null
  client_reference_id: string | null
  timestamp: Date | null
}

export function lerWebhookFireflies(corpo: unknown): WebhookFireflies {
  const o = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>
  // V2 usa `event`; o formato antigo usava `eventType` ("Transcription completed") e `meetingId`.
  const evento = String(o.event ?? o.eventType ?? '').trim()
  const meeting = o.meeting_id ?? o.meetingId
  const ref = o.client_reference_id ?? o.clientReferenceId
  const ts = typeof o.timestamp === 'number' ? new Date(o.timestamp) : null
  return {
    evento,
    conhecido: (EVENTOS_FIREFLIES as readonly string[]).includes(evento),
    meeting_id: typeof meeting === 'string' && meeting ? meeting : null,
    client_reference_id: typeof ref === 'string' && ref ? ref : null,
    timestamp: ts && !Number.isNaN(ts.getTime()) ? ts : null,
  }
}

/** Entrega repetida não duplica nada: um evento por (tipo, reunião). */
export function chaveIdempotencia(w: Pick<WebhookFireflies, 'evento' | 'meeting_id'>): string | null {
  return w.meeting_id ? `${w.evento}:${w.meeting_id}` : null
}

// ─── Assinatura ─────────────────────────────────────────────────────────────

async function hmacSha256Hex(segredo: string, corpo: string): Promise<string> {
  const enc = new TextEncoder()
  const chave = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await globalThis.crypto.subtle.sign('HMAC', chave, enc.encode(corpo))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Igualdade sem atalho: o tempo não depende de onde as strings divergem. */
export function iguaisTempoConstante(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

/**
 * `X-Hub-Signature: sha256=<hex>` sobre o CORPO CRU. Reserializar o JSON mudaria espaços e
 * ordem de chaves e a assinatura nunca bateria — ou, pior, bateria por acidente.
 * Sem segredo configurado, falha fechado.
 */
export async function assinaturaFirefliesConfere(
  segredo: string | null | undefined,
  corpoCru: string,
  cabecalho: string | null | undefined,
): Promise<boolean> {
  if (!segredo || !cabecalho) return false
  const recebida = cabecalho.trim().replace(/^sha256=/i, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(recebida)) return false
  const esperada = await hmacSha256Hex(segredo, corpoCru)
  return iguaisTempoConstante(esperada, recebida)
}

// ─── Resgate manual: `addToLiveMeeting` ─────────────────────────────────────
//
// Limite duro do lado deles: 3 chamadas a cada 20 minutos. Estourar devolve
// `too_many_requests` — erro críptico para quem só queria o bot na reunião. O contador é
// nosso, e a tela diz quando o próximo resgate estará disponível.

export const RESGATE_LIMITE = 3
export const RESGATE_JANELA_MIN = 20

export interface EstadoResgate {
  disponivel: boolean
  usados: number
  /** Quando abre a próxima vaga; nulo se há vaga agora. */
  proximo_em: Date | null
}

export function estadoResgate(chamadas: readonly Date[], agora: Date): EstadoResgate {
  const inicio = agora.getTime() - RESGATE_JANELA_MIN * 60_000
  const naJanela = chamadas
    .map((d) => d.getTime())
    .filter((t) => t > inicio && t <= agora.getTime())
    .sort((a, b) => a - b)
  if (naJanela.length < RESGATE_LIMITE) return { disponivel: true, usados: naJanela.length, proximo_em: null }
  // A vaga abre quando a chamada mais antiga que ainda ocupa o teto sai da janela.
  const libera = naJanela[naJanela.length - RESGATE_LIMITE]! + RESGATE_JANELA_MIN * 60_000
  return { disponivel: false, usados: naJanela.length, proximo_em: new Date(libera) }
}

export const MUTATION_ADD_TO_LIVE = `mutation AddToLive($meetingLink: String!, $title: String, $duration: Int, $language: String) {
  addToLiveMeeting(meeting_link: $meetingLink, title: $title, duration: $duration, language: $language) { success }
}`

export const QUERY_ACTIVE_MEETINGS = `query Ativas($email: String) {
  active_meetings(input: { email: $email }) { id title meeting_link organizer_email start_time }
}`

export const QUERY_TRANSCRIPT = `query Transcricao($id: String!) {
  transcript(id: $id) {
    id title date duration transcript_url meeting_link cal_id calendar_id organizer_email
    participants
    meeting_attendees { displayName email name }
    speakers { id name }
    sentences { index speaker_name text start_time end_time }
    summary { overview short_summary action_items shorthand_bullet keywords }
  }
}`

// ─── Conferir a chave antes de gravar ───────────────────────────────────────
//
// A tela aceitava qualquer texto. Em 05/10/2026 ficou gravado um texto que não era chave,
// e por um dia cada transcrição morreu em `auth_failed` no worker, depois de 5 tentativas,
// com as reuniões marcadas "sem captura" — o erro só aparecia em `fireflies_webhooks`.
// Quem diz se a chave vale é o Fireflies: `user` sem id devolve o dono da chave.

export const QUERY_DONO_DA_CHAVE = `query Dono { user { email name } }`

export type ConferenciaChaveFireflies =
  | { valida: true; email: string | null }
  | { valida: false; motivo: string }
  /** Não deu para saber (fora do ar, resposta estranha): quem chama decide, sem recusar. */
  | { valida: null; motivo: string }

const CODIGOS_CHAVE_RECUSADA = new Set(['auth_failed', 'unauthorized', 'unauthenticated', 'forbidden'])

/**
 * Lê a resposta de `QUERY_DONO_DA_CHAVE`. Só RECUSA quando o Fireflies disse que a chave
 * não vale — e ele diz isso com HTTP 500 e `auth_failed` no corpo, não com 401. Instabilidade
 * do lado deles não pode impedir alguém de cadastrar uma chave certa.
 */
export function lerConferenciaChave(status: number, corpo: unknown): ConferenciaChaveFireflies {
  const o = (corpo && typeof corpo === 'object' ? corpo : {}) as {
    data?: { user?: { email?: unknown } | null } | null
    errors?: Array<{ code?: unknown; extensions?: { code?: unknown } | null }> | null
  }
  const codigos = (Array.isArray(o.errors) ? o.errors : []).map((e) =>
    String(e?.extensions?.code ?? e?.code ?? '').toLowerCase(),
  )
  if (status === 401 || status === 403 || codigos.some((c) => CODIGOS_CHAVE_RECUSADA.has(c))) {
    return {
      valida: false,
      motivo:
        'O Fireflies recusou esta chave. Copie de novo em Settings → Developer Settings → API Key, ' +
        'na conta central, e cole aqui.',
    }
  }
  const user = o.data?.user
  if (user && typeof user === 'object') {
    return { valida: true, email: typeof user.email === 'string' && user.email ? user.email : null }
  }
  return { valida: null, motivo: `O Fireflies não confirmou a chave (HTTP ${status}).` }
}

// ─── Transcrição ────────────────────────────────────────────────────────────

const transcriptSchema = z
  .object({
    id: z.string(),
    title: z.string().nullish(),
    date: z.union([z.number(), z.string()]).nullish(),
    duration: z.number().nullish(),
    transcript_url: z.string().nullish(),
    meeting_link: z.string().nullish(),
    cal_id: z.string().nullish(),
    calendar_id: z.string().nullish(),
    organizer_email: z.string().nullish(),
    participants: z.array(z.string()).nullish(),
    meeting_attendees: z
      .array(z.object({ displayName: z.string().nullish(), email: z.string().nullish(), name: z.string().nullish() }))
      .nullish(),
    sentences: z
      .array(
        z.object({
          speaker_name: z.string().nullish(),
          text: z.string().nullish(),
          start_time: z.number().nullish(),
          end_time: z.number().nullish(),
        }),
      )
      .nullish(),
    summary: z
      .object({
        overview: z.string().nullish(),
        short_summary: z.string().nullish(),
        action_items: z.string().nullish(),
        shorthand_bullet: z.string().nullish(),
      })
      .nullish(),
  })
  .passthrough()

export interface Segmento {
  falante: string
  texto: string
  inicio_s: number | null
  fim_s: number | null
}

export interface TranscricaoNormalizada {
  meeting_id: string
  titulo: string | null
  /** O texto que vai para a análise e para a busca: "Falante: fala", uma por linha. */
  texto: string
  segmentos: Segmento[]
  /** Quem realmente falou, com e-mail quando o Fireflies casou com o convite. */
  participantes: Array<{ nome: string | null; email: string | null; falou: boolean }>
  resumo: string | null
  proximos_passos: string[]
  duracao_s: number | null
  url: string | null
  cal_id: string | null
  meeting_link: string | null
}

export function normalizarTranscricao(bruto: unknown): TranscricaoNormalizada {
  const t = transcriptSchema.parse(bruto)
  const segmentos: Segmento[] = (t.sentences ?? [])
    .filter((s) => (s.text ?? '').trim())
    .map((s) => ({
      falante: (s.speaker_name ?? '').trim() || 'Participante',
      texto: (s.text ?? '').trim(),
      inicio_s: s.start_time ?? null,
      fim_s: s.end_time ?? null,
    }))

  // Fala consecutiva do mesmo falante vira um parágrafo: é como se lê, e corta o texto à metade.
  const blocos: string[] = []
  let atual: { falante: string; partes: string[] } | null = null
  for (const s of segmentos) {
    if (atual && atual.falante === s.falante) atual.partes.push(s.texto)
    else {
      if (atual) blocos.push(`${atual.falante}: ${atual.partes.join(' ')}`)
      atual = { falante: s.falante, partes: [s.texto] }
    }
  }
  if (atual) blocos.push(`${atual.falante}: ${atual.partes.join(' ')}`)

  const falantes = new Set(segmentos.map((s) => s.falante.toLowerCase()))
  const convidados = (t.meeting_attendees ?? []).map((a) => ({
    nome: (a.displayName ?? a.name ?? '').trim() || null,
    email: (a.email ?? '').trim().toLowerCase() || null,
  }))
  const participantes = convidados.map((c) => ({ ...c, falou: !!c.nome && falantes.has(c.nome.toLowerCase()) }))
  for (const f of new Set(segmentos.map((s) => s.falante))) {
    if (!participantes.some((p) => p.nome?.toLowerCase() === f.toLowerCase())) {
      participantes.push({ nome: f, email: null, falou: true })
    }
  }

  const resumo = (t.summary?.overview ?? t.summary?.short_summary ?? '').trim() || null
  // `action_items` vem em markdown: um cabeçalho em negrito por responsável, e os itens abaixo.
  const proximos = (t.summary?.action_items ?? '')
    .split('\n')
    .filter((l) => !/^\s*\*\*.*\*\*\s*$/.test(l))
    .map((l) => l.replace(/^[\s*•\-–\d.)]+/, '').trim())
    .filter((l) => l.length > 3)

  // `duration` vem em minutos (decimal).
  const duracao = typeof t.duration === 'number' ? Math.round(t.duration * 60) : null

  return {
    meeting_id: t.id,
    titulo: t.title ?? null,
    texto: blocos.join('\n'),
    segmentos,
    participantes,
    resumo,
    proximos_passos: proximos,
    duracao_s: duracao,
    url: t.transcript_url ?? null,
    cal_id: t.cal_id ?? t.calendar_id ?? null,
    meeting_link: t.meeting_link ?? null,
  }
}

/** O link da conferência, para casar com o `meet_url`: sem esquema, sem query, sem barra final. */
export function normalizarLinkReuniao(link: string | null | undefined): string | null {
  if (!link) return null
  const s = link.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[?#].*$/, '').replace(/\/+$/, '')
  return s || null
}
