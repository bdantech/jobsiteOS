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
export type TipoLembrete = 'd1' | 'd0' | 'h1'

/** Uma hora e meia: a régua do H-1, que fala em "daqui a pouco". */
const JANELA_H1_MS = 90 * 60_000

/** O D-1 clássico: a véspera, com folga para o job de hora em hora não perder. */
const JANELA_D1_MS = 28 * 3_600_000

export function tipoDeLembrete(
  /** Reunião menos entrega. Negativo ou zero = a conversa já começou. */
  faltamMs: number,
  reuniao: Date,
  entrega: Date,
  timezone: string,
): TipoLembrete | null {
  // Lembrete depois da hora é pior que lembrete nenhum — e agora que a conta é
  // contra a entrega, o passado entra: uma reunião de sexta 17h cujo lembrete só
  // abriria na segunda cai exatamente aqui.
  if (faltamMs <= 0) return null
  if (faltamMs <= JANELA_H1_MS) return 'h1'

  const e = partesNoFuso(entrega, timezone)
  const r = partesNoFuso(reuniao, timezone)
  if (e.ano === r.ano && e.mes === r.mes && e.dia === r.dia) return 'd0'

  if (faltamMs <= JANELA_D1_MS) return 'd1'
  // Reunião distante: ainda não tem lembrete, e terá amanhã.
  return null
}
