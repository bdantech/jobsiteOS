import { normalizarNumeroNf } from './numero-nf.js'

/**
 * O motor de casamento antecipação ↔ nota fiscal (04e §4.2).
 *
 * A regra que governa tudo aqui: PRECISÃO ACIMA DE RECALL. Uma antecipação
 * casada com a NF errada marca como convertida uma nota que ninguém antecipou —
 * e envenena, de uma vez, o funil, a métrica por faixa e a taxa de conversão que
 * decide onde o comercial gasta o dia. Um `revisao` a mais custa um clique.
 *
 * Por isso não existe caminho de "melhor palpite": ou uma candidata satisfaz
 * todas as guardas, ou o caso vai para a fila humana. Ambiguidade nunca vira
 * conversão automática.
 *
 * Puro de propósito — sem banco, sem relógio de parede. O chamador traz as
 * candidatas (as NFs do MESMO par fornecedor↔sacado) e aplica o resultado.
 */

export const MATCH_STATUS = ['pendente', 'casada', 'sem_nf', 'revisao', 'ignorada'] as const
export type MatchStatus = (typeof MATCH_STATUS)[number]

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  pendente: 'Aguardando casamento',
  casada: 'Casada',
  sem_nf: 'Sem NF correspondente',
  revisao: 'Revisão manual',
  ignorada: 'Ignorada',
}

export const MATCH_CONFIANCAS = ['exata', 'valor_confirmado'] as const
export type MatchConfianca = (typeof MATCH_CONFIANCAS)[number]

export const MATCH_CONFIANCA_LABELS: Record<MatchConfianca, string> = {
  exata: 'Número idêntico, candidata única',
  valor_confirmado: 'Confirmada pelo valor',
}

/** Por que o motor decidiu o que decidiu — vai para a fila e para o log. */
export type MotivoMatch =
  | 'numero_unico'
  | 'valor_desempatou'
  | 'valor_nao_desempatou'
  | 'numero_aproximado_confirmado'
  | 'numero_aproximado_ambiguo'
  | 'numero_aproximado_sem_confirmacao'
  | 'sem_numero'
  | 'sem_candidatas'
  | 'nenhuma_parecida'

export const MOTIVO_MATCH_LABELS: Record<MotivoMatch, string> = {
  numero_unico: 'Número idêntico e candidata única.',
  valor_desempatou: 'Mesmo número em mais de uma nota; o valor desempatou.',
  valor_nao_desempatou: 'Mesmo número em mais de uma nota e o valor não desempatou.',
  numero_aproximado_confirmado: 'Número aproximado, confirmado por valor e vencimento.',
  numero_aproximado_ambiguo: 'Mais de uma nota aproximada passou nas duas confirmações.',
  numero_aproximado_sem_confirmacao:
    'Nota de número aproximado, mas o valor ou o vencimento não confirmam.',
  sem_numero: 'A antecipação não traz número de documento.',
  sem_candidatas: 'Nenhuma nota deste fornecedor contra este sacado.',
  nenhuma_parecida: 'Nenhuma nota do par tem número parecido.',
}

export interface CandidataNf {
  access_key: string
  /** Cru, como está em `notas_fiscais.numero`. A normalização acontece aqui. */
  numero: string | null
  valor: number | null
  /** `yyyy-mm-dd`. */
  vencimento: string | null
}

export interface AntecipacaoParaCasar {
  /** Cru, como veio em `documentNumber`. */
  document_number: string | null
  gross_value: number | null
  /** `yyyy-mm-dd`. */
  original_due_date: string | null
}

export interface ToleranciasMatch {
  /** Diferença percentual máxima entre `gross_value` e o valor da NF. */
  valor_pct: number
  /** Diferença máxima, em dias, entre `originalDueDate` e o vencimento da NF. */
  vencimento_dias: number
}

export const TOLERANCIAS_PADRAO: ToleranciasMatch = { valor_pct: 1, vencimento_dias: 5 }

export interface ResultadoMatch {
  status: Extract<MatchStatus, 'casada' | 'sem_nf' | 'revisao'>
  access_key: string | null
  confianca: MatchConfianca | null
  motivo: MotivoMatch
  /**
   * As candidatas que o motor considerou plausíveis. Preenchida nos casos de
   * `revisao` — é exatamente o que a fila precisa mostrar para que a pessoa
   * escolha em vez de investigar.
   */
  candidatas: string[]
}

// ─── Comparações ────────────────────────────────────────────────────────────

/** Diferença relativa dentro da tolerância. Zero ou negativo nunca confirma. */
export function valorConfere(
  a: number | null | undefined,
  b: number | null | undefined,
  pct: number,
): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false
  if (!(a > 0) || !(b > 0)) return false
  return Math.abs(a - b) / Math.max(a, b) <= pct / 100
}

const DIA_MS = 86_400_000

/**
 * Vencimentos compatíveis dentro de ±N dias.
 *
 * Ausência NÃO confirma: 70% da base teve o vencimento estimado em emissão + 30
 * (`vencimento_origem = 'estimado'`), e tratar "não sei" como "bate" faria a
 * guarda mais fraca do fuzzy desaparecer justamente onde ela é necessária.
 */
export function vencimentoConfere(
  a: string | null | undefined,
  b: string | null | undefined,
  dias: number,
): boolean {
  if (!a || !b) return false
  const ta = Date.parse(`${a.slice(0, 10)}T00:00:00Z`)
  const tb = Date.parse(`${b.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false
  return Math.abs(ta - tb) <= dias * DIA_MS
}

/**
 * Números que divergem só por zeros ao final ou por truncamento — `84` vs `840`,
 * `8821` vs `88210`, `1234567` vs `123456`.
 *
 * Relação de PREFIXO, com no máximo 3 dígitos de diferença. É deliberadamente
 * frouxa: sozinha ela não casa nada. Serve para escolher quem merece passar
 * pelas duas confirmações caras (valor E vencimento) do §4.2.3.
 */
export function numerosParecidos(a: string, b: string): boolean {
  if (a === b) return true
  const [curto, longo] = a.length <= b.length ? [a, b] : [b, a]
  if (longo.length - curto.length > 3) return false
  return longo.startsWith(curto)
}

// ─── O motor ────────────────────────────────────────────────────────────────

function decidir(
  status: ResultadoMatch['status'],
  motivo: MotivoMatch,
  extra: Partial<ResultadoMatch> = {},
): ResultadoMatch {
  return { status, access_key: null, confianca: null, motivo, candidatas: [], ...extra }
}

/**
 * As candidatas JÁ vêm recortadas por fornecedor + sacado — esse par é a única
 * parte do casamento que não admite aproximação, e por isso não é negociada
 * aqui: quem monta a lista é quem consulta o banco.
 */
export function casarAntecipacao(
  antecipacao: AntecipacaoParaCasar,
  candidatas: readonly CandidataNf[],
  tolerancias: ToleranciasMatch = TOLERANCIAS_PADRAO,
): ResultadoMatch {
  const numero = normalizarNumeroNf(antecipacao.document_number)
  if (candidatas.length === 0) return decidir('sem_nf', 'sem_candidatas')
  // Sem número não há por onde começar: casar só por valor num par que tem em
  // média 2,6 notas (e até 407) é sorteio, não casamento.
  if (!numero) return decidir('revisao', 'sem_numero')

  const comNumero = candidatas
    .map((c) => ({ ...c, normalizado: normalizarNumeroNf(c.numero) }))
    .filter((c): c is CandidataNf & { normalizado: string } => c.normalizado !== null)

  // ── 1 e 2: número idêntico ────────────────────────────────────────────────
  const exatas = comNumero.filter((c) => c.normalizado === numero)

  if (exatas.length === 1) {
    return decidir('casada', 'numero_unico', {
      access_key: (exatas[0] as CandidataNf).access_key,
      confianca: 'exata',
    })
  }

  if (exatas.length > 1) {
    // Mesmo número em séries diferentes. O valor é o único desempate que não é
    // palpite — e se ele não decidir sozinho, a decisão é de gente.
    const porValor = exatas.filter((c) =>
      valorConfere(antecipacao.gross_value, c.valor, tolerancias.valor_pct),
    )
    if (porValor.length === 1) {
      return decidir('casada', 'valor_desempatou', {
        access_key: (porValor[0] as CandidataNf).access_key,
        confianca: 'valor_confirmado',
      })
    }
    return decidir('revisao', 'valor_nao_desempatou', {
      candidatas: exatas.map((c) => c.access_key),
    })
  }

  // ── 3: número aproximado ──────────────────────────────────────────────────
  const parecidas = comNumero.filter((c) => numerosParecidos(c.normalizado, numero))
  if (parecidas.length === 0) return decidir('sem_nf', 'nenhuma_parecida')

  const confirmadas = parecidas.filter(
    (c) =>
      valorConfere(antecipacao.gross_value, c.valor, tolerancias.valor_pct) &&
      vencimentoConfere(
        antecipacao.original_due_date,
        c.vencimento,
        tolerancias.vencimento_dias,
      ),
  )

  if (confirmadas.length === 1) {
    return decidir('casada', 'numero_aproximado_confirmado', {
      access_key: (confirmadas[0] as CandidataNf).access_key,
      confianca: 'valor_confirmado',
    })
  }

  if (confirmadas.length > 1) {
    return decidir('revisao', 'numero_aproximado_ambiguo', {
      candidatas: confirmadas.map((c) => c.access_key),
    })
  }

  // Parecidas existem, mas nenhuma passou nas confirmações. Vai para revisão e
  // não para `sem_nf`: há uma nota quase igual ali, e é justamente o caso em que
  // um humano decide rápido e a máquina não deve decidir nunca.
  return decidir('revisao', 'numero_aproximado_sem_confirmacao', {
    candidatas: parecidas.map((c) => c.access_key),
  })
}
