/**
 * O PARSER do retorno de protestos, sem nenhuma dependência.
 *
 * Separado de `directd.ts` para poder ser TESTADO: aquele arquivo importa `env`
 * e `net/http`, e os dois usam construções que o `--experimental-strip-types`
 * dos testes recusa (parameter property) além de exigir variáveis de ambiente no
 * import. O parser é a parte que erra, então é a parte que precisa de teste — e
 * ele não precisa de nada além do payload.
 */

import type { ResultadoConsultaCredito } from '../../../../packages/core/src/radar/credit.js'

/**
 * Um valor de protesto chega ora como number, ora como string no formato BR
 * ("293.265,96" = 293265,96): ponto é milhar, vírgula é decimal. `Number("293.265,96")`
 * é NaN — por isso o valor caía para 0 e a empresa aparecia com R$ 0 protestado.
 */
export function parseNumero(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v !== 'string') return 0
  const s = v.trim()
  if (!s) return 0
  // Se há vírgula, ela é o decimal e o ponto é separador de milhar (BR). Sem vírgula,
  // o ponto (se houver) já é o decimal (US) — não o apague.
  const normal = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  const n = Number(normal.replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * Lê a primeira chave que existir, ignorando maiúsculas e minúsculas.
 *
 * A grafia é o que quebrou este parser três vezes. O IEPTB devolve
 * `numeroTotalProtestosUF` e o código procurava `totalNumProtestosUf`: nomes
 * parecidos, chaves diferentes, e o resultado era um zero silencioso. Comparar
 * em minúsculas custa uma varredura de umas seis chaves e elimina a classe
 * inteira de erro.
 */
function campo(obj: Record<string, unknown>, ...nomes: string[]): unknown {
  const mapa = new Map(Object.keys(obj).map((k) => [k.toLowerCase(), k]))
  for (const n of nomes) {
    const real = mapa.get(n.toLowerCase())
    if (real !== undefined && obj[real] !== undefined && obj[real] !== null) return obj[real]
  }
  return undefined
}

function num(obj: Record<string, unknown>, ...nomes: string[]): number {
  const v = campo(obj, ...nomes)
  return v === undefined ? 0 : parseNumero(v)
}

/**
 * Soma qtd/valor descendo na árvore de cartórios, POR CAMPO.
 *
 * O `continue` que existia aqui era o terceiro bug: quando o estado trazia o
 * valor mas não a contagem (o caso comum do IEPTB), a função somava o valor e
 * pulava para o próximo estado sem nunca descer aos cartórios — que é exatamente
 * onde a contagem estava. Resultado: 20 das 24 consultas com protesto ficaram com
 * `qtd_protestos = 0` tendo valor gravado.
 *
 * Agora cada campo cai para os cartórios de forma independente. Achar um não é
 * ter achado os dois.
 */
export function somarCartorios(cartorios: unknown): { qtd: number; valor: number } {
  let qtd = 0
  let valor = 0
  if (!Array.isArray(cartorios)) return { qtd, valor }

  for (const uf of cartorios) {
    const e = (uf ?? {}) as Record<string, unknown>
    // `numeroTotalProtestosUF` é a grafia do IEPTB; as outras cobrem o formato
    // antigo de SP e variações já vistas.
    let qUf = num(e, 'numeroTotalProtestosUF', 'totalNumProtestosUf', 'numProtestosUf')
    let vUf = num(e, 'valorTotalProtestosEstado', 'valorTotalProtestosUf')

    if (qUf === 0 || vUf === 0) {
      const filhos = campo(e, 'cartorios', 'cartoriosProtesto')
      if (Array.isArray(filhos)) {
        let qFilhos = 0
        let vFilhos = 0
        for (const c of filhos) {
          const cc = (c ?? {}) as Record<string, unknown>
          qFilhos += num(cc, 'numeroProtestos', 'numProtestos')
          vFilhos += num(cc, 'valorTotalProtestosCartorio')
        }
        if (qUf === 0) qUf = qFilhos
        if (vUf === 0) vUf = vFilhos
      }
    }

    qtd += qUf
    valor += vUf
  }
  return { qtd, valor }
}

/** A resposta da DirectD varia por versão; extrai defensivamente e guarda o bruto. */
export function extrair(payload: unknown, custo: number): ResultadoConsultaCredito {
  const p = (payload ?? {}) as Record<string, unknown>
  const raiz = (campo(p, 'retorno', 'RetornoProtestos', 'dados') ?? p) as Record<string, unknown>

  // `numeroTotalProtestos` é a chave do IEPTB Online e faltava nesta lista — é o
  // primeiro dos três bugs que zeravam a contagem.
  let qtd = num(
    raiz,
    'numeroTotalProtestos',
    'totalNumProtestos',
    'qtdTitulos',
    'totalTitulos',
    'quantidadeProtestos',
    'qtdeProtestos',
  )
  let valor = num(raiz, 'valorTotalProtestos', 'valorTotal', 'valorProtestado')

  const cartorios = campo(raiz, 'protestos', 'cartorios', 'detalhes') ?? null

  // Fallback POR CAMPO: o nacional traz o valor no topo mas nem sempre a contagem
  // com o mesmo nome — então valor vinha certo e qtd ficava 0.
  if (qtd === 0 || valor === 0) {
    const s = somarCartorios(cartorios)
    if (qtd === 0) qtd = s.qtd
    if (valor === 0) valor = s.valor
  }

  const constam = campo(raiz, 'constamProtestos', 'constaProtesto') === true
  const tem = constam || qtd > 0 || valor > 0 || (Array.isArray(cartorios) && cartorios.length > 0)
  return { tem_protesto: tem, qtd_protestos: qtd, valor_total: valor, cartorios, payload, custo }
}

