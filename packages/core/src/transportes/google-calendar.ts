/**
 * Google Calendar: a reunião do funil na agenda de quem vai a ela.
 *
 * ─── POR QUE ESCREVER NA API EM VEZ DE MELHORAR O FEED .ICS ─────────────────
 * O feed do 04g já existe e continua existindo. Ele resolve o caso de quem não
 * conectou o Google e o de quem usa Outlook, e custa zero. O que ele não faz —
 * e não tem como fazer — é três coisas que foram pedidas:
 *
 *   1. Aparecer AGORA. Um feed .ics é PUXADO pelo Google quando o Google quiser,
 *      tipicamente de poucas em poucas horas. Para uma reunião marcada de manhã
 *      para a tarde, "quando o Google quiser" é depois da reunião.
 *   2. Ter link de Meet. O Meet nasce do `events.insert`, no servidor do Google,
 *      com `conferenceData.createRequest`. Um .ics só pode CARREGAR um link que
 *      já exista; ele não faz nascer nenhum.
 *   3. Convidar o cliente. Convite é `attendees` + `sendUpdates` — é o Google que
 *      manda o e-mail, em nome de quem organiza, com "Sim / Não / Talvez" dentro.
 *      Um feed é uma assinatura de leitura; ninguém é convidado para um feed.
 *
 * ─── A AGENDA É A DO ANFITRIÃO, E É UMA SÓ ─────────────────────────────────
 * O evento é criado na agenda do closer (o dono do card), com o SDR e os contatos
 * do cliente como convidados. Não criamos uma cópia na agenda do SDR: quem é
 * convidado pelo Google já recebe o evento na própria agenda, e uma segunda
 * escrita nossa seria a mesma duplicação que a 0201 acabou de desfazer, agora do
 * lado de lá.
 *
 * ─── O `requestId` DO MEET É O ID DO NOSSO EVENTO ──────────────────────────
 * O Google usa `requestId` para deduplicar a criação da conferência: repetir o
 * mesmo id devolve a MESMA sala em vez de abrir outra. Usar o uuid da linha faz
 * com que um retry — e retry vai acontecer, é uma chamada de rede — não gere uma
 * segunda sala para a mesma reunião, com metade dos convidados em cada uma.
 */

import { ESCOPOS_GMAIL } from './gmail.js'

export const ESCOPO_CALENDAR = 'https://www.googleapis.com/auth/calendar.events'

/**
 * O que o botão "Conectar Google" pede hoje: os três do Gmail mais a agenda.
 *
 * `ESCOPOS_GMAIL` continua exportado e continua sendo a lista do que o e-mail
 * precisa — é ela que o worker usa para saber se PODE enviar. Esta é a lista do
 * CONSENTIMENTO, que é outra pergunta: quem conectou antes desta data consentiu
 * só com os três primeiros, e a tela precisa saber a diferença para pedir a
 * reconexão em vez de deixar a agenda falhar em silêncio.
 */
export const ESCOPOS_GOOGLE = [...ESCOPOS_GMAIL, ESCOPO_CALENDAR] as const

const API = 'https://www.googleapis.com/calendar/v3'

export interface ConvidadoGoogle {
  email: string
  nome?: string | null
  /**
   * Convidado nosso (SDR/closer) ou do cliente. Não muda nada no corpo enviado ao
   * Google — os dois vão como convidados obrigatórios. Serve para o chamador
   * distinguir "não temos o e-mail do cliente" (que é um aviso na tela) de "o SDR
   * não tem login" (que não é problema de ninguém).
   */
  interno?: boolean
}

export interface ReuniaoParaGoogle {
  /** O uuid de `vendedor_eventos`. Vira o `requestId` da sala do Meet. */
  id: string
  titulo: string
  inicioEm: Date
  duracaoMin: number
  modalidade: 'meet' | 'presencial' | 'telefone' | 'a_definir'
  local?: string | null
  descricao?: string | null
  convidados: ConvidadoGoogle[]
}

export interface RespostaEvento {
  ok: boolean
  eventoId?: string | null
  meetUrl?: string | null
  /** Mensagem pronta para a tela — não o JSON cru do Google. */
  erro?: string | null
  /** 401/403/404 mudam o que o chamador deve fazer; ver `classificarFalha`. */
  falha?: FalhaGoogle | null
}

export type FalhaGoogle =
  /** Token vencido: renovar e repetir resolve. */
  | 'token'
  /** Consentimento sem o escopo de agenda: só reconectar resolve. */
  | 'escopo'
  /** O evento não existe mais lá (apagado à mão na agenda). */
  | 'sumiu'
  | 'transitoria'
  | 'permanente'

/**
 * O corpo do evento, isolado e sem rede — é o que dá para testar de verdade.
 *
 * `location` só quando é presencial: o Google mostra o campo de local no convite
 * e no lembrete do celular, e escrever "Google Meet" ali competiria com o botão
 * de entrar na chamada que ele mesmo põe logo acima.
 */
export function montarEventoGoogle(r: ReuniaoParaGoogle): Record<string, unknown> {
  const fim = new Date(r.inicioEm.getTime() + r.duracaoMin * 60_000)

  const corpo: Record<string, unknown> = {
    summary: r.titulo,
    description: r.descricao ?? undefined,
    start: { dateTime: r.inicioEm.toISOString(), timeZone: 'America/Sao_Paulo' },
    end: { dateTime: fim.toISOString(), timeZone: 'America/Sao_Paulo' },
    /*
     * Convidado NUNCA é opcional, nem o nosso.
     *
     * "Opcional" no Google significa "não precisa responder", e o que se perde é
     * exatamente o sinal que importa aqui: quem confirmou. Um SDR marcado como
     * opcional não aparece na lista de confirmados, e a véspera da reunião fica
     * sem resposta para "o cliente vem?".
     */
    attendees: r.convidados
      .filter((c) => c.email.includes('@'))
      .map((c) => ({ email: c.email.toLowerCase(), displayName: c.nome ?? undefined })),
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 60 },
        { method: 'popup', minutes: 10 },
      ],
    },
  }

  if (r.modalidade === 'presencial' && r.local) corpo.location = r.local
  if (r.modalidade === 'telefone' && r.local) corpo.location = r.local
  if (r.modalidade === 'meet') {
    corpo.conferenceData = {
      createRequest: {
        requestId: r.id,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    }
  }
  return corpo
}

/** O link da sala dentro da resposta do Google, que vem em dois lugares. */
export function meetDaResposta(bruto: unknown): string | null {
  const e = bruto as Record<string, any> | null
  if (!e) return null
  const pontos: unknown[] = e.conferenceData?.entryPoints ?? []
  for (const p of pontos) {
    const ponto = p as Record<string, any>
    if (ponto.entryPointType === 'video' && typeof ponto.uri === 'string') return ponto.uri
  }
  // `hangoutLink` é o campo antigo; ainda vem preenchido e às vezes é o único.
  return typeof e.hangoutLink === 'string' ? e.hangoutLink : null
}

/**
 * De um erro do Google para o que se deve FAZER a respeito.
 *
 * A distinção que paga por si: 403 por escopo insuficiente e 403 por cota são o
 * mesmo código HTTP e problemas opostos — um pede que a pessoa reconecte o
 * Google, o outro pede que a gente espere. Chamar os dois de "erro 403" manda
 * metade das pessoas para o lugar errado.
 */
export function classificarFalha(status: number, corpo: unknown): { falha: FalhaGoogle; erro: string } {
  const c = corpo as Record<string, any> | null
  const motivo = String(c?.error?.errors?.[0]?.reason ?? '')
  const mensagem = String(c?.error?.message ?? `HTTP ${status}`)

  if (status === 401) return { falha: 'token', erro: 'Token do Google vencido.' }
  if (status === 404 || status === 410) {
    return { falha: 'sumiu', erro: 'O evento não existe mais na agenda do Google.' }
  }
  if (status === 403) {
    if (/insufficient|scope|ACCESS_TOKEN_SCOPE/i.test(mensagem) || motivo === 'insufficientPermissions') {
      return {
        falha: 'escopo',
        erro:
          'A conexão do Google não inclui a permissão de agenda. Reconecte em ' +
          'Comunicação › Configurações para a reunião ir para o Google Agenda.',
      }
    }
    if (/rate|quota|usageLimits/i.test(`${motivo} ${mensagem}`)) {
      return { falha: 'transitoria', erro: 'Cota da API do Google atingida; vai tentar de novo.' }
    }
    return { falha: 'permanente', erro: mensagem }
  }
  if (status === 429 || status >= 500) {
    return { falha: 'transitoria', erro: `Google indisponível (${status}); vai tentar de novo.` }
  }
  return { falha: 'permanente', erro: mensagem }
}

export interface ConfigCalendario {
  /** Access token JÁ RENOVADO pelo chamador, como no TransporteGmail. */
  accessToken: string
  calendarId?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export class CalendarioGoogle {
  private readonly cfg: ConfigCalendario

  constructor(cfg: ConfigCalendario) {
    this.cfg = cfg
  }

  private get calendario(): string {
    return encodeURIComponent(this.cfg.calendarId ?? 'primary')
  }

  private async chamar(
    url: string,
    init: { method: string; body?: unknown },
  ): Promise<{ status: number; corpo: unknown }> {
    const f = this.cfg.fetchImpl ?? fetch
    const res = await f(url, {
      method: init.method,
      headers: {
        authorization: `Bearer ${this.cfg.accessToken}`,
        'content-type': 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 20_000),
    })
    const texto = await res.text().catch(() => '')
    return { status: res.status, corpo: texto ? JSON.parse(texto) : {} }
  }

  /**
   * `sendUpdates=all` é o que transforma "evento criado" em "cliente convidado".
   * Sem ele o Google grava o evento e não avisa ninguém — a reunião aparece só na
   * agenda de quem organiza, que é o estado de hoje com outro nome.
   */
  async criar(r: ReuniaoParaGoogle): Promise<RespostaEvento> {
    const url =
      `${API}/calendars/${this.calendario}/events` +
      `?conferenceDataVersion=1&sendUpdates=all`
    try {
      const { status, corpo } = await this.chamar(url, { method: 'POST', body: montarEventoGoogle(r) })
      if (status >= 400) return { ok: false, ...classificarFalha(status, corpo) }
      const e = corpo as Record<string, any>
      return { ok: true, eventoId: e.id ?? null, meetUrl: meetDaResposta(corpo) }
    } catch (erro) {
      return { ok: false, falha: 'transitoria', erro: String(erro) }
    }
  }

  /**
   * PUT e não PATCH: o corpo que montamos é a verdade inteira da reunião, e um
   * PATCH deixaria para trás um convidado removido aqui — ele continuaria na
   * agenda do Google, recebendo lembrete de uma reunião da qual foi tirado.
   */
  async atualizar(eventoId: string, r: ReuniaoParaGoogle): Promise<RespostaEvento> {
    const url =
      `${API}/calendars/${this.calendario}/events/${encodeURIComponent(eventoId)}` +
      `?conferenceDataVersion=1&sendUpdates=all`
    try {
      const { status, corpo } = await this.chamar(url, { method: 'PUT', body: montarEventoGoogle(r) })
      if (status >= 400) return { ok: false, ...classificarFalha(status, corpo) }
      return { ok: true, eventoId, meetUrl: meetDaResposta(corpo) }
    } catch (erro) {
      return { ok: false, falha: 'transitoria', erro: String(erro) }
    }
  }

  /** Cancelar avisa os convidados — é metade do motivo de cancelar pelo sistema. */
  async cancelar(eventoId: string): Promise<RespostaEvento> {
    const url =
      `${API}/calendars/${this.calendario}/events/${encodeURIComponent(eventoId)}` +
      `?sendUpdates=all`
    try {
      const { status, corpo } = await this.chamar(url, { method: 'DELETE' })
      // 410/404 no cancelamento é sucesso: o que se queria é que não exista mais.
      if (status === 404 || status === 410) return { ok: true, eventoId: null }
      if (status >= 400) return { ok: false, ...classificarFalha(status, corpo) }
      return { ok: true, eventoId: null }
    } catch (erro) {
      return { ok: false, falha: 'transitoria', erro: String(erro) }
    }
  }
}
