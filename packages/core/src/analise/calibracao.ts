import type { StatusCalibracao } from './tipos.js'

/**
 * CALIBRAÇÃO POR ITEM (05C §5). Nenhuma nota chega a um vendedor antes disto.
 *
 * ─── A CLASSE QUE IMPORTA É A FALTA ─────────────────────────────────────────
 * O F1 é medido sobre "NÃO atendeu" — é a única saída que chega ao vendedor como cobrança.
 * Num time que quase sempre explora a dor, um classificador que diz "atendeu" para tudo
 * teria F1 alto sobre a classe "atendeu" e não detectaria falta nenhuma. Precisão aqui é
 * "das faltas que apontamos, quantas eram falta"; recall, "das faltas reais, quantas vimos".
 *
 * ─── O LIMIAR NÃO É CHUTADO ─────────────────────────────────────────────────
 * O Jev é subconfiante: acertos pontuam perto de 0,75. Um limiar de 0,9 por intuição
 * descartaria metade deles. O limiar é o ponto que maximiza o F1 nas amostras rotuladas;
 * em empate, o MENOR — o que reprova menos. Item sem amostras suficientes fica INATIVO,
 * e item com F1 abaixo do mínimo fica em SOMBRA como "pergunta mal formulada": o defeito
 * é da rubrica, não do vendedor.
 */

export interface Amostra {
  /** P(atendido) devolvida pelo classificador para aquela interação. */
  prob_atendido: number
  /** O rótulo humano: o item foi atendido? */
  atendido: boolean
}

export interface PontoCurva {
  limiar: number
  precisao: number
  recall: number
  f1: number
  /** Quantas faltas o limiar aponta (o "suporte" da precisão). */
  apontadas: number
}

export interface CalibracaoItem {
  status: Exclude<StatusCalibracao, 'nao_calibrado'>
  limiar: number | null
  f1: number | null
  precisao: number | null
  recall: number | null
  n_amostras: number
  n_faltas: number
  curva: PontoCurva[]
  motivo: string
}

/** Limiares candidatos: a grade de 0,01 — fina o bastante, e estável entre recalibrações. */
const GRADE = Array.from({ length: 99 }, (_, i) => (i + 1) / 100)

export function curvaPrecisaoRecall(amostras: readonly Amostra[]): PontoCurva[] {
  const faltasReais = amostras.filter((a) => !a.atendido).length
  return GRADE.map((limiar) => {
    let vp = 0
    let fp = 0
    for (const a of amostras) {
      const apontaFalta = a.prob_atendido < limiar
      if (!apontaFalta) continue
      if (!a.atendido) vp++
      else fp++
    }
    const apontadas = vp + fp
    const precisao = apontadas > 0 ? vp / apontadas : 0
    const recall = faltasReais > 0 ? vp / faltasReais : 0
    const f1 = precisao + recall > 0 ? (2 * precisao * recall) / (precisao + recall) : 0
    return { limiar, precisao: r3(precisao), recall: r3(recall), f1: r3(f1), apontadas }
  })
}

export function calibrarItem(
  amostras: readonly Amostra[],
  cfg: { min_amostras: number; min_por_classe: number; f1_minimo: number },
): CalibracaoItem {
  const n = amostras.length
  const faltas = amostras.filter((a) => !a.atendido).length
  const acertos = n - faltas
  const vazio = { limiar: null, f1: null, precisao: null, recall: null, n_amostras: n, n_faltas: faltas, curva: [] }

  if (n < cfg.min_amostras) {
    return { ...vazio, status: 'inativo_amostras', motivo: `${n} de ${cfg.min_amostras} amostras rotuladas.` }
  }
  if (faltas < cfg.min_por_classe || acertos < cfg.min_por_classe) {
    const lado = faltas < cfg.min_por_classe ? `${faltas} falta(s)` : `${acertos} acerto(s)`
    return {
      ...vazio,
      status: 'inativo_amostras',
      motivo: `Só ${lado} entre as amostras; são precisos ${cfg.min_por_classe} de cada lado para medir.`,
    }
  }

  const curva = curvaPrecisaoRecall(amostras)
  let melhor = curva[0]!
  for (const p of curva) if (p.f1 > melhor.f1) melhor = p // estrito: em empate fica o menor limiar

  // A régua trivial: apontar falta em TODAS dá precisão = prevalência e recall = 1. Com
  // metade das amostras em falta isso já é F1 0,67 — perto do mínimo. Um item que não
  // supera essa régua não está lendo a conversa, está lendo a estatística do time.
  const prevalencia = faltas / n
  const f1Trivial = r3((2 * prevalencia) / (1 + prevalencia))
  if (melhor.f1 <= f1Trivial) {
    return {
      status: 'sombra_f1',
      limiar: melhor.limiar,
      f1: melhor.f1,
      precisao: melhor.precisao,
      recall: melhor.recall,
      n_amostras: n,
      n_faltas: faltas,
      curva,
      motivo: `F1 ${fmt(melhor.f1)} não supera apontar falta em todas (${fmt(f1Trivial)}) — a pergunta precisa ser reescrita.`,
    }
  }

  if (melhor.f1 < cfg.f1_minimo) {
    return {
      status: 'sombra_f1',
      limiar: melhor.limiar,
      f1: melhor.f1,
      precisao: melhor.precisao,
      recall: melhor.recall,
      n_amostras: n,
      n_faltas: faltas,
      curva,
      motivo: `F1 ${fmt(melhor.f1)} abaixo do mínimo ${fmt(cfg.f1_minimo)} — a pergunta precisa ser reescrita.`,
    }
  }
  return {
    status: 'publicado',
    limiar: melhor.limiar,
    f1: melhor.f1,
    precisao: melhor.precisao,
    recall: melhor.recall,
    n_amostras: n,
    n_faltas: faltas,
    curva,
    motivo: `F1 ${fmt(melhor.f1)} com limiar ${fmt(melhor.limiar)} sobre ${n} amostras.`,
  }
}

/**
 * A rubrica sai de sombra quando a calibração rodou com amostras suficientes — mesmo que
 * alguns itens fiquem de fora. O que não passou continua gravando e não pontua.
 */
export function rubricaCalibrada(resultados: readonly CalibracaoItem[]): boolean {
  return resultados.some((r) => r.status === 'publicado')
}

/** Recalibra quando entram N contestações novas desde a última calibração, ou nunca houve uma. */
export function deveRecalibrar(a: { calibrada_em: string | null; contestacoes_desde: number; limite: number }): boolean {
  if (!a.calibrada_em) return true
  return a.contestacoes_desde >= a.limite
}

const r3 = (x: number) => Math.round(x * 1000) / 1000
const fmt = (x: number) => x.toFixed(2).replace('.', ',')
