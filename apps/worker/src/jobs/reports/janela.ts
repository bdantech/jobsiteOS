/**
 * A janela padrão do report, e o motivo de ela morar sozinha aqui.
 *
 * É a única parte do caminho do 04q que dá para testar sem banco, sem rede e sem modelo —
 * e é justamente a que, se estiver errada, erra em SILÊNCIO: uma janela deslocada em um dia
 * não falha, ela só manda a diretoria comparar a semana errada.
 *
 * O arquivo não importa NADA. Os testes do worker rodam com `--experimental-strip-types`,
 * que não entende parameter property — e `net/http.ts` tem uma. Deixar esta função dentro
 * de `semanal.ts` a tornaria impossível de testar por causa de um import três níveis
 * abaixo. É a mesma razão de `amostras.ts` existir separado de `estimador.ts`.
 */

export interface JanelaSemana {
  inicio: string
  fim: string
}

/**
 * A semana ISO FECHADA mais recente: segunda a domingo, já terminada.
 *
 * Abrir na semana corrente compararia três dias com sete, e toda segunda o report diria
 * que a semana desabou. Num domingo, a janela ainda é a semana ANTERIOR — o domingo de
 * hoje não acabou.
 */
export function semanaFechada(hoje = new Date()): JanelaSemana {
  const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()))
  /* getUTCDay(): 0 = domingo. Recuar até o domingo ANTERIOR — e num domingo recuar sete
     dias, não zero, porque o dia de hoje ainda está correndo. */
  const diasAteDomingo = d.getUTCDay() === 0 ? 7 : d.getUTCDay()
  const fim = new Date(d)
  fim.setUTCDate(d.getUTCDate() - diasAteDomingo)
  const inicio = new Date(fim)
  inicio.setUTCDate(fim.getUTCDate() - 6)
  return { inicio: inicio.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) }
}
