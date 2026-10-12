/**
 * Reuniões por janela (04u §2.2): agendadas e realizadas são conjuntos DIFERENTES.
 *
 *   agendada ....... conta no dia em que foi MARCADA (`agendada_em`)
 *   realizada ...... conta no dia em que ACONTECEU (`inicio_em`)
 *
 * Quem marcou na sexta realiza na semana seguinte. Por isso este módulo não tem, e não deve
 * ganhar, nenhuma função que divida uma pela outra: seria uma taxa entre populações
 * distintas com cara de conversão.
 *
 * É o espelho testável de `app__rp_aq_reunioes` no banco. A reunião é UM registro — o
 * `vendedor_eventos` —, e remarcar atualiza esse registro em vez de criar outro. É o que
 * faz uma remarcação não contar duas vezes como agendada, e o teste abaixo trava isso.
 */
import { naSemana, type Semana } from './semanas.js'
import type { ContagemReunioes, FatoReuniao } from './aquisicao.js'

export interface ReuniaoRegistro {
  id: string
  /** Quando foi MARCADA. Não muda na remarcação. */
  agendada_em: string
  /** Quando ACONTECE (ou aconteceu). É o que a remarcação altera. */
  inicio_em: string
  cancelada_em?: string | null
  /** Os instantes em que foi remarcada. */
  remarcada_em?: readonly string[]
  /** Os instantes em que o lead foi marcado como no-show. */
  no_show_em?: readonly string[]
  /**
   * O último desfecho registrado: o lead foi para "reunião realizada"/"qualificada", ou
   * para "no-show". `null` = ninguém registrou nada.
   */
  desfecho?: 'realizada' | 'no_show' | null
  /** A transcrição do Fireflies chegou. Sozinha, já prova que a reunião aconteceu. */
  transcrita?: boolean
  /** O gravador entrou na chamada (`bot_entrou_em`). */
  bot_entrou?: boolean
}

/**
 * A reunião aconteceu? Exige EVIDÊNCIA — transcrição, ou o desfecho registrado.
 *
 * Um evento cuja hora passou sem nada registrado não é contado como realizado: ele vai
 * para "sem desfecho", que é a fila de higiene. Contar por "a hora passou" inflaria o
 * número justamente com as reuniões de que ninguém sabe dizer se houve.
 */
export function reuniaoRealizada(r: ReuniaoRegistro, agora: Date | string = new Date()): boolean {
  if (r.cancelada_em) return false
  if (new Date(r.inicio_em).getTime() > new Date(agora).getTime()) return false
  return r.transcrita === true || r.desfecho === 'realizada'
}

/** Os fatos de UMA reunião que caem dentro da janela. Cada fato é julgado pela SUA data. */
export function fatosDaReuniao(
  r: ReuniaoRegistro,
  janela: Semana,
  agora: Date | string = new Date(),
): FatoReuniao[] {
  const fatos: FatoReuniao[] = []
  const passou = new Date(r.inicio_em).getTime() <= new Date(agora).getTime()
  const realizada = reuniaoRealizada(r, agora)

  // Uma vez só, pelo dia em que foi marcada — mesmo que depois tenha sido cancelada: o
  // esforço de prospecção da semana aconteceu.
  if (naSemana(r.agendada_em, janela)) fatos.push('agendada')

  if (naSemana(r.inicio_em, janela)) {
    if (realizada) {
      fatos.push('realizada')
      if (!r.transcrita && !r.bot_entrou) fatos.push('sem_captura')
    } else if (!r.cancelada_em && passou && r.desfecho !== 'no_show') {
      fatos.push('sem_desfecho')
    }
  }

  if (naSemana(r.cancelada_em, janela)) fatos.push('cancelada')
  for (const em of r.remarcada_em ?? []) if (naSemana(em, janela)) fatos.push('remarcada')
  for (const em of r.no_show_em ?? []) if (naSemana(em, janela)) fatos.push('no_show')
  return fatos
}

/** As contagens de reunião de uma janela. */
export function reunioesDaJanela(
  reunioes: readonly ReuniaoRegistro[],
  janela: Semana,
  agora: Date | string = new Date(),
): ContagemReunioes {
  const c: ContagemReunioes = {
    agendadas: 0, realizadas: 0, canceladas: 0, remarcadas: 0, no_shows: 0,
    sem_captura: 0, sem_desfecho: 0,
  }
  for (const r of reunioes) {
    for (const f of fatosDaReuniao(r, janela, agora)) {
      if (f === 'agendada') c.agendadas += 1
      else if (f === 'realizada') c.realizadas += 1
      else if (f === 'cancelada') c.canceladas += 1
      else if (f === 'remarcada') c.remarcadas += 1
      else if (f === 'no_show') c.no_shows += 1
      else if (f === 'sem_captura') c.sem_captura += 1
      else c.sem_desfecho += 1
    }
  }
  return c
}
