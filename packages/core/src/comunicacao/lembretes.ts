import { partesNoFuso } from './janela.js'

/**
 * QUANDO os lembretes de reunião saem.
 *
 * Vive no core, e não no job, para poder ser testado sem banco: o job importa
 * `db.js` e `env.js`, e uma regra de calendário não devia precisar de credencial
 * para ser conferida.
 *
 * São dois lembretes, e cada um tem a sua régua:
 *
 *   confirmação (D-0) ... HORA MARCADA: 9h do dia da reunião, ou uma hora antes
 *                         quando a reunião é às 9h ou mais cedo. Decisão de
 *                         25/09/2026 — a de véspera (D-1) saiu da régua.
 *   H-1 ................. a uma hora e meia da reunião, e só dentro da janela.
 */
export type TipoLembrete = 'h1'

/** Uma hora e meia: a régua do H-1, que fala em "daqui a pouco". */
const JANELA_H1_MS = 90 * 60_000

/** Folga para "a entrega é agora": o job roda de hora em hora, não no minuto exato. */
const ENTREGA_IMEDIATA_MS = 60_000

/** A confirmação sai às 9h locais… */
const HORA_CONFIRMACAO = 9
/** …e uma hora antes quando a reunião é às 9h ou antes. */
const ANTECEDENCIA_REUNIAO_CEDO_MS = 60 * 60_000

/**
 * Quanto antes do horário a confirmação entra na fila. O job roda no minuto 10 de
 * cada hora: com 70 minutos, a rodada das 8:10 enfileira a das 9h, e a das 7:10 a
 * das 8h. Enfileirar tarde de propósito — uma reunião cancelada ou remarcada na
 * véspera não deixa uma confirmação velha esperando na fila.
 */
const ANTECEDENCIA_FILA_MS = 70 * 60_000

/** Rodada perdida: a seguinte ainda manda, com até uma hora de atraso. */
const TOLERANCIA_ATRASO_MS = 60 * 60_000

/** 9h do dia da reunião, no fuso de quem lê — ou uma hora antes, se a reunião é às 9h ou antes. */
export function horarioDaConfirmacao(reuniao: Date, timezone: string): Date {
  const l = partesNoFuso(reuniao, timezone)
  if (l.hora < HORA_CONFIRMACAO || (l.hora === HORA_CONFIRMACAO && l.minuto === 0)) {
    return new Date(reuniao.getTime() - ANTECEDENCIA_REUNIAO_CEDO_MS)
  }
  // Recua da própria reunião até as 9h locais do MESMO dia: não depende do offset do
  // fuso, só da distância entre os dois horários no relógio de quem lê.
  const minutosDesde9h = (l.hora - HORA_CONFIRMACAO) * 60 + l.minuto
  const alvo = new Date(reuniao.getTime() - minutosDesde9h * 60_000)
  alvo.setUTCSeconds(0, 0)
  return alvo
}

/**
 * Enfileirar a confirmação agora? Devolve o instante de envio, ou `null`.
 *
 * Reunião marcada DEPOIS do horário da confirmação (às 10h, para as 15h do mesmo
 * dia) não recebe: quem acabou de marcar não precisa confirmar, e o "bom dia"
 * chegaria à tarde.
 */
export function quandoConfirmar(input: {
  reuniao: Date
  agora: Date
  criadaEm: Date
  timezone: string
}): Date | null {
  const { reuniao, agora, criadaEm, timezone } = input
  if (reuniao.getTime() <= agora.getTime()) return null

  const alvo = horarioDaConfirmacao(reuniao, timezone)
  if (criadaEm.getTime() >= alvo.getTime()) return null

  const faltam = alvo.getTime() - agora.getTime()
  if (faltam > ANTECEDENCIA_FILA_MS) return null
  if (faltam > 0) return alvo
  // Passou do horário: só manda se a rodada perdida foi há pouco — e agora.
  return -faltam <= TOLERANCIA_ATRASO_MS ? agora : null
}

/**
 * O H-1: a uma hora e meia ou menos da reunião, e só quando a ENTREGA é agora.
 *
 * Fora da janela a fila segura a mensagem até a abertura. Classificar o H-1 pela
 * distância até a entrega fazia a véspera à noite, para uma reunião às 9:30
 * (entrega às 9h, faltam 30 minutos), gerar um "é daqui a pouco" — medido em
 * 25/09/2026: o Ibraheem recebeu às 9h um "daqui a pouco, às 10:00" gerado às 18h
 * do dia anterior.
 */
export function tipoDeLembrete(
  /** Reunião menos entrega. Negativo ou zero = a conversa já começou. */
  faltamMs: number,
  _reuniao: Date,
  entrega: Date,
  _timezone: string,
  opcoes: {
    /** Agora. Ausente = a entrega é agora (dentro da janela). */
    agora?: Date
  } = {},
): TipoLembrete | null {
  if (faltamMs <= 0) return null
  const entregaEAgora =
    !opcoes.agora || entrega.getTime() - opcoes.agora.getTime() < ENTREGA_IMEDIATA_MS
  if (faltamMs <= JANELA_H1_MS && entregaEAgora) return 'h1'
  return null
}
