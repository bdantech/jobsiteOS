import { partesNoFuso } from './janela.js'

/**
 * QUAL lembrete de reunião cabe — e a pergunta é feita contra a hora da ENTREGA,
 * nunca contra a hora da geração.
 *
 * ─── A CICATRIZ ─────────────────────────────────────────────────────────────
 * A janela de envio é seg–sex, 9h–18h, então o fim de semana nunca recebeu nada.
 * Isso sempre esteve certo. O que faltava era o CORPO da mensagem saber disso.
 *
 * Um D-1 gerado num domingo de manhã dizia "nossa conversa AMANHÃ, 21/09" e ficava
 * na fila até segunda às 9h — quando "amanhã" já era hoje e a reunião estava a uma
 * hora, não a vinte e oito. O cliente recebeu um lembrete que mentia duas vezes, e
 * nada disso aparece em typecheck, em lint ou num teste de envio: a mensagem saiu,
 * com sucesso, dizendo a coisa errada.
 *
 * Vive no core, e não no job, exatamente para poder ser testada sem banco: o job
 * importa `db.js` e `env.js`, e uma regra de calendário não devia precisar de
 * credencial para ser conferida.
 *
 * ─── POR QUE O DIA LOCAL, E NÃO "MENOS DE 24H" ──────────────────────────────
 * Uma reunião às 9h de terça está a 20 horas de uma entrega às 13h de segunda —
 * dentro de qualquer régua de "menos de um dia", e ainda assim "hoje" ali é
 * mentira. Quem decide é a virada do dia no fuso de quem lê.
 */
export type TipoLembrete = 'd0' | 'h1'

/** Uma hora e meia: a régua do H-1, que fala em "daqui a pouco". */
const JANELA_H1_MS = 90 * 60_000

/** Folga para "a entrega é agora": o job roda de hora em hora, não no minuto exato. */
const ENTREGA_IMEDIATA_MS = 60_000

function mesmoDia(a: Date, b: Date, timezone: string): boolean {
  const x = partesNoFuso(a, timezone)
  const y = partesNoFuso(b, timezone)
  return x.ano === y.ano && x.mes === y.mes && x.dia === y.dia
}

/**
 * ─── A CONFIRMAÇÃO É NO DIA, NÃO NA VÉSPERA (25/09/2026) ────────────────────
 * O D-1 ("nossa conversa amanhã, 25/09. Segue de pé?") saiu da régua. A
 * confirmação agora é o D-0, entregue na ABERTURA da janela do dia da reunião
 * ("Bom dia… confirmar nossa reunião de hoje às 14:00"): gerado na véspera, fora
 * da janela, e agendado para as 9h. Reunião marcada no próprio dia não recebe —
 * quem acabou de marcar não precisa de confirmação, e o "bom dia" chegaria à tarde.
 *
 * ─── O H-1 SÓ QUANDO A ENTREGA É AGORA ─────────────────────────────────────
 * O H-1 fura a janela e sai na hora. Classificá-lo pela distância até a ENTREGA
 * fazia a véspera à noite, para uma reunião às 9:30 (entrega às 9h, faltam 30
 * minutos), mandar "é daqui a pouco" na mesma noite. Fora da janela, o que chega na
 * abertura é o D-0 — que é exatamente a mensagem certa para aquela hora.
 */
export function tipoDeLembrete(
  /** Reunião menos entrega. Negativo ou zero = a conversa já começou. */
  faltamMs: number,
  reuniao: Date,
  entrega: Date,
  timezone: string,
  opcoes: {
    /** Agora. Ausente = a entrega é agora (dentro da janela). */
    agora?: Date
    /** Quando a reunião foi marcada. Marcada no próprio dia não tem D-0. */
    criadaEm?: Date
  } = {},
): TipoLembrete | null {
  // Lembrete depois da hora é pior que lembrete nenhum — e agora que a conta é
  // contra a entrega, o passado entra: uma reunião de sexta 17h cujo lembrete só
  // abriria na segunda cai exatamente aqui.
  if (faltamMs <= 0) return null

  const entregaEAgora =
    !opcoes.agora || entrega.getTime() - opcoes.agora.getTime() < ENTREGA_IMEDIATA_MS
  if (faltamMs <= JANELA_H1_MS && entregaEAgora) return 'h1'

  if (!mesmoDia(entrega, reuniao, timezone)) return null
  if (opcoes.criadaEm && mesmoDia(opcoes.criadaEm, reuniao, timezone)) return null
  return 'd0'
}
