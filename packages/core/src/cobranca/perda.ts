/**
 * Perda segurada e indenização (Prompt 07 §7.3, cl. 22100.20 §3 e cl. 26100.00).
 *
 *   perda_segurada = devido na Interrupção Automática de Cobertura
 *                  − recebíveis não segurados
 *                  − créditos do Comprador (pagamentos, notas de crédito, abatimentos,
 *                    descontos, compensações, reconvenção, garantias, revenda de bens)
 *   indenização    = percentagem segurada × MIN(perda_segurada, limite de crédito vigente)
 *   indenização    = MIN(indenização, valor efetivamente pago ao cedente)
 *   perda_segurada ≤ franquia  →  não indenizável
 *
 * A saída é a conta ABERTA, linha a linha, com a origem de cada número. Ninguém deve
 * descobrir o teto da indenização no e-mail de recusa — e a linha que diz "limite de
 * crédito desconhecido" vale mais que um total bonito calculado sobre um null.
 *
 * A franquia é POR COMPRADOR: é por isso que o sinistro consolida o grupo inteiro do
 * sacado, e não fatia por SPE (cada fatia cairia abaixo dela).
 */

export interface TituloPerda {
  id: string
  descricao: string
  /** Valor devido pelo comprador no título (face). */
  valor_devido: number
  /** Coberto pela apólice? Recebível não segurado sai da base. */
  segurado: boolean
  /** O que pagamos ao cedente por este título. `null` = a produção não informou. */
  valor_cedido: number | null
}

export interface CreditosComprador {
  pagamentos?: number
  notas_credito?: number
  abatimentos?: number
  descontos?: number
  compensacoes?: number
  reconvencao?: number
  garantias?: number
  revenda_bens?: number
}

export const CREDITOS_COMPRADOR_LABELS: Record<keyof CreditosComprador, string> = {
  pagamentos: 'Pagamentos recebidos',
  notas_credito: 'Notas de crédito',
  abatimentos: 'Abatimentos',
  descontos: 'Descontos',
  compensacoes: 'Compensações',
  reconvencao: 'Reconvenção',
  garantias: 'Produto de garantias',
  revenda_bens: 'Revenda de bens recuperados',
}

export interface EntradaPerda {
  titulos: readonly TituloPerda[]
  creditos: CreditosComprador
  percentagem_segurada: number
  franquia: number
  /** Limite de crédito vigente do comprador na apólice. `null` = desconhecido. */
  limite_credito_vigente: number | null
}

export interface LinhaPerda {
  rotulo: string
  valor: number
  sinal: '+' | '-' | '=' | '×' | 'min'
  origem: string
}

export interface ResultadoPerda {
  devido_total: number
  nao_segurados: number
  creditos: number
  perda_segurada: number
  base_indenizavel: number
  indenizacao: number
  indenizavel: boolean
  teto_aplicado: 'nenhum' | 'limite_credito' | 'valor_pago_cedente'
  memoria: LinhaPerda[]
  avisos: string[]
}

const c = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function calcularPerdaSegurada(e: EntradaPerda): ResultadoPerda {
  const memoria: LinhaPerda[] = []
  const avisos: string[] = []

  const devido = c(e.titulos.reduce((s, t) => s + t.valor_devido, 0))
  memoria.push({
    rotulo: `Devido pelo comprador (${e.titulos.length} título(s))`,
    valor: devido,
    sinal: '+',
    origem: 'Valor de face dos títulos do sinistro',
  })

  const naoSegurados = c(e.titulos.filter((t) => !t.segurado).reduce((s, t) => s + t.valor_devido, 0))
  if (naoSegurados > 0) {
    memoria.push({ rotulo: 'Recebíveis não segurados', valor: naoSegurados, sinal: '-', origem: 'Títulos fora da cobertura' })
  }

  let creditos = 0
  for (const [k, v] of Object.entries(e.creditos) as [keyof CreditosComprador, number | undefined][]) {
    if (!v) continue
    creditos += v
    memoria.push({ rotulo: CREDITOS_COMPRADOR_LABELS[k], valor: c(v), sinal: '-', origem: 'Créditos do comprador' })
  }
  creditos = c(creditos)

  const perda = c(devido - naoSegurados - creditos)
  memoria.push({ rotulo: 'Perda segurada', valor: perda, sinal: '=', origem: 'cl. 22100.20 §3' })

  if (perda <= e.franquia) {
    memoria.push({
      rotulo: `Franquia por comprador (perda ≤ R$ ${e.franquia.toFixed(2)})`,
      valor: e.franquia,
      sinal: 'min',
      origem: 'cl. 26100.00 — não indenizável',
    })
    return {
      devido_total: devido,
      nao_segurados: naoSegurados,
      creditos,
      perda_segurada: perda,
      base_indenizavel: 0,
      indenizacao: 0,
      indenizavel: false,
      teto_aplicado: 'nenhum',
      memoria,
      avisos: ['A perda segurada não supera a franquia: o sinistro não é indenizável.'],
    }
  }

  let base = perda
  let teto: ResultadoPerda['teto_aplicado'] = 'nenhum'
  if (e.limite_credito_vigente === null) {
    avisos.push('Limite de crédito vigente desconhecido: a indenização abaixo não considera esse teto.')
  } else if (e.limite_credito_vigente < perda) {
    base = c(e.limite_credito_vigente)
    teto = 'limite_credito'
    memoria.push({ rotulo: 'Teto: limite de crédito vigente', valor: base, sinal: 'min', origem: 'Limite na apólice' })
  }

  let indenizacao = c(e.percentagem_segurada * base)
  memoria.push({
    rotulo: `Percentagem segurada (${(e.percentagem_segurada * 100).toFixed(0)}%)`,
    valor: indenizacao,
    sinal: '×',
    origem: 'Apólice',
  })

  const semCedido = e.titulos.filter((t) => t.valor_cedido === null)
  if (semCedido.length > 0) {
    avisos.push(
      `${semCedido.length} título(s) sem o valor pago ao cedente: o teto "valor efetivamente pago" não pôde ser aplicado a eles.`,
    )
  } else {
    const pagoCedente = c(e.titulos.reduce((s, t) => s + (t.segurado ? (t.valor_cedido ?? 0) : 0), 0))
    if (pagoCedente < indenizacao) {
      indenizacao = pagoCedente
      teto = 'valor_pago_cedente'
      memoria.push({
        rotulo: 'Teto: valor efetivamente pago ao cedente',
        valor: pagoCedente,
        sinal: 'min',
        origem: 'Soma do valor cedido dos títulos segurados',
      })
    }
  }

  memoria.push({ rotulo: 'Indenização estimada', valor: indenizacao, sinal: '=', origem: 'cl. 22100.20 §3' })

  return {
    devido_total: devido,
    nao_segurados: naoSegurados,
    creditos,
    perda_segurada: perda,
    base_indenizavel: base,
    indenizacao,
    indenizavel: true,
    teto_aplicado: teto,
    memoria,
    avisos,
  }
}
