import { partesNoFuso } from '../comunicacao/janela.js'

/**
 * AS JANELAS DO CLOSER (Prompt 09 §7).
 *
 * ─── UM CONJUNTO FECHADO, NUNCA UM HORÁRIO INVENTADO ────────────────────────
 * O agente oferece ao cliente — e manda para a Ana, numa ligação de agendamento — só
 * janelas calculadas AQUI, contra a agenda real do closer. A Ana confirma uma delas ou
 * devolve `agendar_retorno`; ela nunca inventa horário, e o agente de texto também não.
 *
 * ─── RESERVA TEMPORÁRIA ─────────────────────────────────────────────────────
 * Janela oferecida fica reservada por N minutos (§7.5, default 30): duas conversas em
 * paralelo não recebem o mesmo horário do mesmo closer. A reserva expira sozinha — quem
 * consulta simplesmente ignora as vencidas, e nenhum job precisa limpar.
 *
 * ─── O SUBSTITUTO ───────────────────────────────────────────────────────────
 * Titular ausente (férias marcadas) ou sem janela no horizonte → substituto. Nenhum dos
 * dois → o agente devolve "interesse com pendência" e o gestor é avisado (§7, fim).
 */

export interface Intervalo {
  inicio: Date
  fim: Date
}

export interface HorarioComercial {
  hora_inicio: number
  hora_fim: number
  /** ISO: 1 = segunda … 7 = domingo. */
  dias_semana: readonly number[]
  timezone: string
}

export interface ReservaViva {
  inicio: Date
  fim: Date
  expiraEm: Date
  mandatoId: string | null
}

export interface ParametrosJanelas {
  agora: Date
  horario: HorarioComercial
  horizonteDiasUteis: number
  duracaoMin: number
  bufferMin: number
  /** Passo entre inícios candidatos. 30 min: reunião às 10h ou 10h30, não às 10h07. */
  passoMin?: number
  /** Nada antes disto a partir de agora — ninguém aceita reunião para daqui a 20 minutos. */
  antecedenciaMinimaMin?: number
  /** Eventos do closer (Google + `vendedor_eventos`). */
  ocupados: readonly Intervalo[]
  /** Reservas de janela em aberto; as vencidas e as do próprio mandato são ignoradas. */
  reservas: readonly ReservaViva[]
  mandatoId?: string | null
  quantas: number
}

/** O instante UTC que corresponde a (data, hora) no fuso — funciona com ou sem horário de verão. */
export function instanteNoFuso(ano: number, mes: number, dia: number, hora: number, minuto: number, tz: string): Date {
  let palpite = Date.UTC(ano, mes - 1, dia, hora, minuto)
  for (let i = 0; i < 3; i++) {
    const p = partesNoFuso(new Date(palpite), tz)
    const visto = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto)
    const alvo = Date.UTC(ano, mes - 1, dia, hora, minuto)
    const delta = alvo - visto
    if (delta === 0) break
    palpite += delta
  }
  return new Date(palpite)
}

const sobrepoe = (a: Intervalo, b: Intervalo) => a.inicio.getTime() < b.fim.getTime() && b.inicio.getTime() < a.fim.getTime()

/**
 * As próximas `quantas` janelas livres, espalhadas: no máximo DUAS por dia, para o cliente
 * poder escolher entre dias diferentes em vez de três horários da mesma terça.
 */
export function janelasLivres(p: ParametrosJanelas): Intervalo[] {
  const passo = (p.passoMin ?? 30) * 60_000
  const dur = p.duracaoMin * 60_000
  const buffer = p.bufferMin * 60_000
  const minimo = p.agora.getTime() + (p.antecedenciaMinimaMin ?? 120) * 60_000

  // Bloqueios: eventos com buffer dos dois lados + reservas vivas de OUTROS mandatos.
  const bloqueios: Intervalo[] = [
    ...p.ocupados.map((o) => ({ inicio: new Date(o.inicio.getTime() - buffer), fim: new Date(o.fim.getTime() + buffer) })),
    ...p.reservas
      .filter((r) => r.expiraEm.getTime() > p.agora.getTime() && (r.mandatoId ?? null) !== (p.mandatoId ?? null))
      .map((r) => ({ inicio: r.inicio, fim: r.fim })),
  ]

  const saida: Intervalo[] = []
  let diasUteis = 0
  const hoje = partesNoFuso(p.agora, p.horario.timezone)
  for (let d = 0; d < 60 && diasUteis < p.horizonteDiasUteis && saida.length < p.quantas; d++) {
    const base = new Date(Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia + d, 12))
    const pd = partesNoFuso(base, p.horario.timezone)
    if (!p.horario.dias_semana.includes(pd.diaSemana)) continue
    diasUteis++
    let noDia = 0
    const abre = instanteNoFuso(pd.ano, pd.mes, pd.dia, p.horario.hora_inicio, 0, p.horario.timezone).getTime()
    const fecha = instanteNoFuso(pd.ano, pd.mes, pd.dia, p.horario.hora_fim, 0, p.horario.timezone).getTime()
    for (let t = abre; t + dur <= fecha && noDia < 2 && saida.length < p.quantas; t += passo) {
      if (t < minimo) continue
      const cand = { inicio: new Date(t), fim: new Date(t + dur) }
      if (bloqueios.some((b) => sobrepoe(cand, b))) continue
      saida.push(cand)
      noDia++
      // A segunda janela do dia, se houver, pelo menos duas horas depois da primeira.
      t += Math.max(0, 2 * 3_600_000 - passo)
    }
  }
  return saida
}

export interface CloserCandidato {
  id: string
  /** Data ISO até quando está ausente (férias). */
  ausenteAte: string | null
  janelas: Intervalo[]
}

export type EscolhaDeCloser =
  | { ok: true; closerId: string; substituto: boolean; janelas: Intervalo[] }
  | { ok: false; motivo: 'sem_closer' | 'sem_janela' }

/**
 * Titular, a não ser que esteja ausente ou sem janela no horizonte; aí o substituto.
 * Trocar o closer de um agente não mexe no que já foi marcado — isto só decide as PRÓXIMAS.
 */
export function escolherCloser(
  titular: CloserCandidato | null,
  substituto: CloserCandidato | null,
  hoje: Date,
): EscolhaDeCloser {
  const ausente = (c: CloserCandidato) => !!c.ausenteAte && Date.parse(`${c.ausenteAte}T23:59:59Z`) >= hoje.getTime()
  if (!titular && !substituto) return { ok: false, motivo: 'sem_closer' }
  if (titular && !ausente(titular) && titular.janelas.length > 0) {
    return { ok: true, closerId: titular.id, substituto: false, janelas: titular.janelas }
  }
  if (substituto && !ausente(substituto) && substituto.janelas.length > 0) {
    return { ok: true, closerId: substituto.id, substituto: true, janelas: substituto.janelas }
  }
  return { ok: false, motivo: 'sem_janela' }
}

/** "terça, 29/09 às 10h30" — como a janela é dita ao cliente. */
export function rotuloDaJanela(i: Intervalo, tz: string): string {
  const dia = i.inicio.toLocaleDateString('pt-BR', { timeZone: tz, weekday: 'long', day: '2-digit', month: '2-digit' })
  const p = partesNoFuso(i.inicio, tz)
  return `${dia} às ${p.hora}h${p.minuto ? String(p.minuto).padStart(2, '0') : ''}`
}

/**
 * O EXPEDIENTE DA ANA: ela disca uma ligação por vez, das 9h às 18h, em dias úteis — e a
 * fila só anda nesse horário (resposta da Ana à v2, 28/09/2026). Uma ligação enfileirada
 * às 17h40 de sexta é discada na segunda às 9h.
 */
export const EXPEDIENTE_DA_ANA: HorarioComercial = {
  hora_inicio: 9,
  hora_fim: 18,
  dias_semana: [1, 2, 3, 4, 5],
  timezone: 'America/Sao_Paulo',
}

/**
 * ATÉ QUANDO UMA LIGAÇÃO ENFILEIRADA AGORA AINDA DEVE SER DISCADA: o fim do expediente da
 * Ana no primeiro dia útil que ainda tenha pelo menos `folgaMin` de fila pela frente.
 *
 * Serve a duas coisas que precisam do mesmo instante:
 *   • a RESERVA das janelas de uma ligação de agendamento dura até aqui. A Ana confere o
 *     `expira_em` de cada janela na hora de oferecer, então uma reserva de uma hora morria
 *     antes de ela discar sempre que a fila tinha mais de vinte ligações ou virava a noite;
 *   • a VARREDURA desiste da ligação que não foi discada até aqui: cancela na Ana e devolve
 *     o mandato ao agente.
 */
export function fimDoExpedienteDaVoz(agora: Date, folgaMin = 60, horario: HorarioComercial = EXPEDIENTE_DA_ANA): Date {
  const hoje = partesNoFuso(agora, horario.timezone)
  for (let d = 0; d < 15; d++) {
    const base = new Date(Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia + d, 12))
    const pd = partesNoFuso(base, horario.timezone)
    if (!horario.dias_semana.includes(pd.diaSemana)) continue
    const fecha = instanteNoFuso(pd.ano, pd.mes, pd.dia, horario.hora_fim, 0, horario.timezone)
    if (fecha.getTime() - agora.getTime() >= folgaMin * 60_000) return fecha
  }
  // Inalcançável com um dia útil na semana; o fallback só evita um `Date` inválido.
  return new Date(agora.getTime() + 24 * 3_600_000)
}
