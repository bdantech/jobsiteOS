/**
 * O contraste entre duas coortes, e as regras de honestidade que impedem o
 * resultado de mentir (04f §4).
 *
 * A conta em si é elementar — prevalência de cada lado, razão entre elas. O que
 * este arquivo realmente faz é decidir QUANDO NÃO FALAR:
 *
 *   1. N pequeno na célula → `indicativo`. Nunca vira sugestão automática.
 *      Com 9 fornecedores conversores, "3 de 9 são S.A." é 33% — e um único
 *      fornecedor a mais ou a menos move isso em 11 pontos. É ruído com cara de
 *      achado.
 *
 *   2. Cobertura baixa → suprimido do painel principal. Uma variável preenchida
 *      em 12% da coorte descreve as 12%, não a coorte — e o leitor não tem como
 *      saber disso olhando a barra.
 *
 *   3. Denominador zero → lift `null`, nunca `Infinity`. "∞× mais provável" é a
 *      forma mais rápida de transformar uma amostra de um em uma política.
 *
 * A `null` da variável é SEM DADO e sai do numerador E do denominador — a mesma
 * renormalização do scorecard de crédito, pelo mesmo motivo: diluir quem não
 * respondeu inventa uma resposta.
 */

export interface ParametrosContraste {
  /** Mínimo de linhas por lado, na célula, para o achado deixar de ser indicativo. */
  n_minimo: number
  /** Cobertura mínima (0–1) para o achado aparecer no painel principal. */
  cobertura_minima: number
  /** Lift a partir do qual o achado é forte o bastante para virar sugestão. */
  lift_minimo: number
}

export const PARAMETROS_CONTRASTE_PADRAO: ParametrosContraste = {
  n_minimo: 15,
  cobertura_minima: 0.4,
  lift_minimo: 2,
}

/** Uma linha achatada: variável → valor já categorizado (ou `null` = sem dado). */
export type LinhaCategorizada = Readonly<Record<string, string | null>>

export interface CategoriaContraste {
  chave: string
  /** Quantas linhas da coorte A (operadores) caem nesta categoria. */
  n_a: number
  /** Idem, coorte B (controle). */
  n_b: number
  /** Fração DENTRO de quem tem dado — não sobre a coorte inteira. */
  prevalencia_a: number
  prevalencia_b: number
  /**
   * `prevalencia_a / prevalencia_b`. `null` quando o controle é zero: não existe
   * "3 vezes mais que nunca".
   */
  lift: number | null
  /** Verdadeiro quando a categoria só aparece entre os operadores. */
  exclusiva_a: boolean
  /** A célula tem N suficiente dos DOIS lados? */
  solida: boolean
}

export interface AchadoContraste {
  variavel: string
  categorias: CategoriaContraste[]
  /** A categoria com maior lift entre as que têm N — é ela que vira a frase. */
  destaque: CategoriaContraste | null
  n_a: number
  n_b: number
  /** Fração da coorte com dado nesta variável. */
  cobertura_a: number
  cobertura_b: number
  confianca: 'solida' | 'indicativo'
  /** Fora do painel principal por cobertura baixa (ainda visível em "ver tudo"). */
  suprimido: boolean
}

function prevalencia(n: number, total: number): number {
  return total > 0 ? n / total : 0
}

/**
 * O contraste de UMA variável.
 *
 * `chaves` fixa a ordem e o vocabulário das categorias quando a variável é
 * ordinal (faixas de idade, de capital): sem isso, `Object.keys` devolveria a
 * ordem de aparição, e "10–20 anos" viria antes de "3–5" na barra por acidente
 * de amostragem.
 */
export function calcularAchado(
  variavel: string,
  coorteA: readonly LinhaCategorizada[],
  coorteB: readonly LinhaCategorizada[],
  params: ParametrosContraste = PARAMETROS_CONTRASTE_PADRAO,
  chaves?: readonly string[],
): AchadoContraste {
  const contar = (linhas: readonly LinhaCategorizada[]): { mapa: Map<string, number>; comDado: number } => {
    const mapa = new Map<string, number>()
    let comDado = 0
    for (const linha of linhas) {
      const v = linha[variavel]
      if (v === null || v === undefined || v === '') continue
      comDado++
      mapa.set(v, (mapa.get(v) ?? 0) + 1)
    }
    return { mapa, comDado }
  }

  const a = contar(coorteA)
  const b = contar(coorteB)

  const ordem = chaves ?? [...new Set([...a.mapa.keys(), ...b.mapa.keys()])].sort()

  const categorias: CategoriaContraste[] = ordem.map((chave) => {
    const nA = a.mapa.get(chave) ?? 0
    const nB = b.mapa.get(chave) ?? 0
    const pA = prevalencia(nA, a.comDado)
    const pB = prevalencia(nB, b.comDado)
    return {
      chave,
      n_a: nA,
      n_b: nB,
      prevalencia_a: pA,
      prevalencia_b: pB,
      lift: pB > 0 ? pA / pB : null,
      exclusiva_a: pB === 0 && pA > 0,
      solida: nA >= params.n_minimo && nB >= params.n_minimo,
    }
  })

  // O destaque sai SÓ das células sólidas. Deixar uma célula de 2 linhas virar a
  // frase do card é exatamente como um painel honesto passa a mentir com número
  // verdadeiro.
  const candidatas = categorias.filter((c) => c.solida && c.lift !== null)
  const destaque =
    candidatas.length > 0
      ? candidatas.reduce((melhor, c) => ((c.lift ?? 0) > (melhor.lift ?? 0) ? c : melhor))
      : null

  const coberturaA = prevalencia(a.comDado, coorteA.length)
  const coberturaB = prevalencia(b.comDado, coorteB.length)

  return {
    variavel,
    categorias,
    destaque,
    n_a: a.comDado,
    n_b: b.comDado,
    cobertura_a: coberturaA,
    cobertura_b: coberturaB,
    confianca: destaque ? 'solida' : 'indicativo',
    // Basta um lado com cobertura ruim: um contraste entre 95% e 12% compara uma
    // coorte com um recorte da outra, e nada na barra denunciaria isso.
    suprimido: coberturaA < params.cobertura_minima || coberturaB < params.cobertura_minima,
  }
}

export interface EntradaVariavel {
  id: string
  /** Ordem e vocabulário fixos, para variáveis ordinais. */
  chaves?: readonly string[]
}

/**
 * Ordena por LIFT decrescente, com os indicativos e os suprimidos no fim.
 *
 * A ordenação é o produto: ninguém lê 40 achados. O que sobe é o que tem
 * evidência — não o que tem número maior.
 */
export function calcularContraste(
  variaveis: readonly EntradaVariavel[],
  coorteA: readonly LinhaCategorizada[],
  coorteB: readonly LinhaCategorizada[],
  params: ParametrosContraste = PARAMETROS_CONTRASTE_PADRAO,
): AchadoContraste[] {
  const achados = variaveis.map((v) => calcularAchado(v.id, coorteA, coorteB, params, v.chaves))

  return achados.sort((x, y) => {
    const peso = (a: AchadoContraste): number =>
      (a.suprimido ? 2 : 0) + (a.confianca === 'indicativo' ? 1 : 0)
    const dp = peso(x) - peso(y)
    if (dp !== 0) return dp
    return forcaDoLift(y.destaque) - forcaDoLift(x.destaque)
  })
}

/**
 * Distância de 1 — porque um lift de 0,25 (quatro vezes MENOS provável) é tão
 * informativo quanto um de 4. Ordenar por lift cru enterraria toda evidência
 * negativa no fim da lista.
 */
export function forcaDoLift(c: CategoriaContraste | null): number {
  if (!c || c.lift === null || c.lift === 0) return 0
  return c.lift >= 1 ? c.lift : 1 / c.lift
}

/** O lift é forte o bastante (nos dois sentidos) para virar sugestão? */
export function liftRelevante(
  c: CategoriaContraste | null,
  params: ParametrosContraste = PARAMETROS_CONTRASTE_PADRAO,
): boolean {
  return c !== null && c.solida && forcaDoLift(c) >= params.lift_minimo
}
