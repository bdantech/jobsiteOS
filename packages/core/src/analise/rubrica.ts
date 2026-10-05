import type { PerguntaTipada, RespostaCalibrada } from './classificador.js'
import type { ProvedorAnalise, StatusCalibracao, TipoPendencia, TipoResposta } from './tipos.js'

/**
 * A RUBRICA APLICADA (05C §3 e §4.3–4.4): aplicabilidade, decisão por item e a nota.
 *
 * ─── ITEM INAPLICÁVEL SAI DO DENOMINADOR ────────────────────────────────────
 * "Definiu próximo passo" numa ligação de 90 segundos em que o cliente disse "não tenho
 * interesse" é falso negativo — o vendedor seria punido por ter encerrado certo. Por isso a
 * condição de aplicabilidade é avaliada ANTES do item, e item inaplicável não conta nem
 * como atendido nem como falho.
 *
 * ─── O JEV NUNCA É O ÚNICO JULGADOR DE UM ITEM QUE REPROVA ──────────────────
 * Ele é subconfiante por construção (acertos em torno de 0,75), então: dentro da banda
 * cinzenta quem decide é o Claude; e fora dela, todo item reprovado passa pelo Claude
 * mesmo assim — para a citação e a orientação, e para discordar. Se o Claude disser que o
 * item foi atendido, vale o Claude e a divergência fica gravada para a recalibração:
 * na dúvida entre dois juízes, não se cobra o vendedor.
 */

export interface ItemRubrica {
  id: string
  chave: string
  etapa: string | null
  ordem: number
  /** O nome curto, para a explicação da nota. */
  rotulo: string
  pergunta: string
  tipo_resposta: TipoResposta
  opcoes: readonly string[] | null
  peso: number
  /** Outra pergunta sim/não; nulo = sempre aplicável. */
  condicao_aplicabilidade: string | null
  /** Calibrado. Nulo enquanto não houver calibração — cai no `limiar_padrao`, e o item fica em sombra. */
  limiar: number | null
  orientacao: string
  /**
   * Que respostas contam como ATENDIDO. `sim_nao`: ['sim'] ou ['nao'] — "alguma pergunta
   * ficou sem resposta?" é atendido quando a resposta é NÃO. `escolha` sem lista é item
   * informativo (objeção registrada, concorrente citado): grava, não pontua.
   */
  atende: readonly string[] | null
  status_calibracao: StatusCalibracao
  /** Quando reprovado (e publicado), vira pendência no Meu Dia. */
  gera_pendencia: TipoPendencia | null
}

export interface ParametrosDecisao {
  delta: number
  limiarAplicabilidade: number
  limiarPadrao: number
}

export interface DecisaoItem {
  item_id: string
  chave: string
  aplicavel: boolean
  aplicabilidade_prob: number | null
  /** A resposta crua (do Jev ou de quem respondeu). */
  resultado: string | null
  /** A probabilidade crua devolvida (P(sim) para sim/não). */
  probabilidade: number | null
  /** P(atendido) — a grandeza que o limiar corta e que a calibração ajusta. */
  prob_atendido: number | null
  /** `null` = informativo ou sem resposta: fora da nota. */
  atendido: boolean | null
  limiar_usado: number | null
  banda_cinzenta: boolean
  /** Precisa passar pelo Claude: banda cinzenta ou reprovado. */
  precisa_revisao: boolean
  em_sombra: boolean
  provedor: ProvedorAnalise | null
  /** Preenchidos pela revisão. */
  citacao: string | null
  orientacao: string | null
  /** O Claude discordou do primeiro julgamento. */
  divergente: boolean
  /** O que o primeiro julgador disse, quando o Claude mudou. */
  atendido_original: boolean | null
  /** A revisão era necessária e não aconteceu: o item sai da nota em vez de reprovar sozinho. */
  revisao_pendente: boolean
}

export const idPerguntaItem = (chave: string) => `item:${chave}`
export const idPerguntaAplicabilidade = (chave: string) => `apl:${chave}`

/**
 * As perguntas de uma análise: a condição de cada item que tem uma, e o próprio item.
 * Vão no MESMO pedido — o estado (a transcrição) é o que custa, e pagar por ele duas vezes
 * para economizar perguntas que custam quase nada seria trocar o caro pelo barato.
 */
export function perguntasDaRubrica(itens: readonly ItemRubrica[]): PerguntaTipada[] {
  const out: PerguntaTipada[] = []
  for (const it of itens) {
    if (it.condicao_aplicabilidade) {
      out.push({ id: idPerguntaAplicabilidade(it.chave), tipo: 'sim_nao', pergunta: it.condicao_aplicabilidade })
    }
    out.push({
      id: idPerguntaItem(it.chave),
      tipo: it.tipo_resposta,
      pergunta: it.pergunta,
      opcoes: it.tipo_resposta === 'escolha' ? (it.opcoes ?? []) : undefined,
      niveis: it.tipo_resposta === 'score' ? (it.opcoes ?? ['não atendeu', 'atendeu']) : undefined,
    })
  }
  return out
}

export function decidirItens(
  itens: readonly ItemRubrica[],
  respostas: readonly RespostaCalibrada[],
  p: ParametrosDecisao,
): DecisaoItem[] {
  const porId = new Map(respostas.map((r) => [r.id, r]))
  return itens.map((it) => decidirItem(it, porId, p))
}

function decidirItem(it: ItemRubrica, porId: Map<string, RespostaCalibrada>, p: ParametrosDecisao): DecisaoItem {
  const base: DecisaoItem = {
    item_id: it.id,
    chave: it.chave,
    aplicavel: true,
    aplicabilidade_prob: null,
    resultado: null,
    probabilidade: null,
    prob_atendido: null,
    atendido: null,
    limiar_usado: null,
    banda_cinzenta: false,
    precisa_revisao: false,
    em_sombra: it.status_calibracao !== 'publicado',
    provedor: null,
    citacao: null,
    orientacao: null,
    divergente: false,
    atendido_original: null,
    revisao_pendente: false,
  }

  if (it.condicao_aplicabilidade) {
    const apl = porId.get(idPerguntaAplicabilidade(it.chave))
    if (!apl) {
      // Sem saber se se aplica, não há como cobrar. Fora da nota.
      return { ...base, aplicavel: false }
    }
    base.aplicabilidade_prob = apl.probabilidade
    if (apl.probabilidade < p.limiarAplicabilidade) return { ...base, aplicavel: false, provedor: apl.provedor }
  }

  const r = porId.get(idPerguntaItem(it.chave))
  if (!r) return base
  base.resultado = r.resultado
  base.probabilidade = r.probabilidade
  base.provedor = r.provedor

  // Peso zero é item informativo ("mencionou concorrente?"): grava a resposta, não pontua,
  // e não gasta Claude — não há reprovação a justificar.
  if (it.peso <= 0) return base

  const limiar = it.limiar ?? p.limiarPadrao
  let probAtendido: number | null = null

  if (it.tipo_resposta === 'sim_nao') {
    const atendeSim = !it.atende || it.atende.includes('sim')
    probAtendido = atendeSim ? r.probabilidade : 1 - r.probabilidade
  } else if (it.tipo_resposta === 'escolha') {
    if (!it.atende || it.atende.length === 0) return base // informativo: grava a escolha, não pontua
    if (r.probabilidades && Object.keys(r.probabilidades).length > 0) {
      probAtendido = it.atende.reduce((s, o) => s + (r.probabilidades?.[o] ?? 0), 0)
    } else {
      probAtendido = it.atende.includes(r.resultado) ? r.probabilidade : 1 - r.probabilidade
    }
  } else {
    probAtendido = Number(r.resultado)
    if (!Number.isFinite(probAtendido)) return base
  }

  probAtendido = Math.min(1, Math.max(0, probAtendido))
  const atendido = probAtendido >= limiar
  const banda = Math.abs(probAtendido - limiar) <= p.delta
  return {
    ...base,
    prob_atendido: probAtendido,
    atendido,
    limiar_usado: limiar,
    banda_cinzenta: banda,
    precisa_revisao: banda || !atendido,
  }
}

// ─── A revisão do Claude ────────────────────────────────────────────────────

export interface RevisaoItem {
  chave: string
  atendido: boolean
  citacao?: string | null
  orientacao?: string | null
}

/**
 * Aplica o julgamento do Claude sobre os itens que precisavam dele. Item que precisava de
 * revisão e ficou sem ela NÃO reprova sozinho: sai da nota (`atendido = null`) e fica
 * marcado como `revisao_pendente`.
 */
export function aplicarRevisao(decisoes: readonly DecisaoItem[], revisao: readonly RevisaoItem[] | null): DecisaoItem[] {
  const porChave = new Map((revisao ?? []).map((r) => [r.chave, r]))
  return decisoes.map((d) => {
    if (!d.precisa_revisao || !d.aplicavel || d.atendido === null) return d
    const r = porChave.get(d.chave)
    if (!r) return { ...d, atendido_original: d.atendido, atendido: null, revisao_pendente: true }
    const divergente = r.atendido !== d.atendido
    const final = r.atendido
    return {
      ...d,
      atendido: final,
      atendido_original: divergente ? d.atendido : null,
      divergente,
      // Na banda cinzenta (ou quando mudou o resultado), quem decidiu foi o Claude.
      provedor: d.banda_cinzenta || divergente ? 'claude' : d.provedor,
      citacao: final ? null : (r.citacao?.trim() || null),
      orientacao: final ? null : (r.orientacao?.trim() || null),
    }
  })
}

// ─── A nota ─────────────────────────────────────────────────────────────────

export interface LinhaMemoriaNota {
  chave: string
  peso: number
  atendido: boolean
}

export interface Nota {
  /** Σ(peso × atendido) / Σ(peso), só sobre os aplicáveis. NULL quando não há o que somar — nunca zero. */
  score: number | null
  itens_aplicaveis: number
  itens_atendidos: number
  memoria: LinhaMemoriaNota[]
}

/**
 * A nota é aritmética. `incluirSombra` produz a nota "que seria" — para o gestor ver a
 * rubrica em sombra trabalhando —, e nunca é o que vai ao vendedor.
 */
export function calcularNota(decisoes: readonly DecisaoItem[], pesos: ReadonlyMap<string, number>, incluirSombra = false): Nota {
  const memoria: LinhaMemoriaNota[] = []
  for (const d of decisoes) {
    if (!d.aplicavel || d.atendido === null) continue
    if (d.em_sombra && !incluirSombra) continue
    memoria.push({ chave: d.chave, peso: Math.max(0, pesos.get(d.chave) ?? 0), atendido: d.atendido })
  }
  const pesoTotal = memoria.reduce((s, l) => s + l.peso, 0)
  const pesoAtendido = memoria.reduce((s, l) => s + (l.atendido ? l.peso : 0), 0)
  return {
    score: pesoTotal > 0 ? arredondar(pesoAtendido / pesoTotal) : null,
    itens_aplicaveis: memoria.length,
    itens_atendidos: memoria.filter((l) => l.atendido).length,
    memoria,
  }
}

/** "0,62 porque faltou X e Y" — a frase que sai dos itens, não de um juízo opaco. */
export function explicarNota(n: Nota, rotulos: ReadonlyMap<string, string>): string {
  if (n.score === null) return 'Sem avaliação aplicável.'
  const faltas = n.memoria.filter((l) => !l.atendido && l.peso > 0).map((l) => rotulos.get(l.chave) ?? l.chave)
  const nota = n.score.toFixed(2).replace('.', ',')
  if (faltas.length === 0 && n.itens_aplicaveis === 1) return `${nota} — o único item aplicável foi atendido.`
  if (faltas.length === 0) return `${nota} — todos os ${n.itens_aplicaveis} itens aplicáveis atendidos.`
  return `${nota} porque faltou: ${juntar(faltas)}.`
}

function juntar(xs: string[]): string {
  if (xs.length <= 1) return xs.join('')
  return `${xs.slice(0, -1).join(', ')} e ${xs.at(-1)}`
}

const arredondar = (x: number) => Math.round(x * 1000) / 1000
