import type { TipoOportunidade } from './schemas.js'

/**
 * A junção das páginas das três fontes — e por que ela mora no core.
 *
 * ── O PROBLEMA ──────────────────────────────────────────────────────────────
 * O Kanban não pode ler a união das três views: o `UNION ALL` é barreira de
 * otimização para ordenação, e com ele o `ORDER BY ... LIMIT` deixa de alcançar o
 * índice (medido em 22/09/2026: 1,85 ms → 8.382 ms, e a tela parou de mostrar
 * notas). Cada fonte é consultada separadamente, já ordenada pelo banco, e as
 * listas são juntadas aqui.
 *
 * Isso é correto e não é atalho: o top-N global é sempre um SUBCONJUNTO da união
 * dos top-N de cada fonte. Pedindo `(pagina + 1) × limite` de cada uma, a página
 * que sai é exatamente a que a união produziria.
 *
 * ── POR QUE COM TESTE ───────────────────────────────────────────────────────
 * Porque a primeira versão disto estava errada e o erro era invisível.
 * `numeric` do Postgres chega pelo PostgREST como STRING — `"16500.00"`, não
 * `16500` —, para não perder precisão. O comparador tentava `Date.parse` antes de
 * `Number`, `Date.parse("16500.00")` devolve NaN, e a ordenação silenciosamente
 * caía no critério de desempate. O funil continuava cheio, só que ordenado por
 * chave de acesso em vez de por receita esperada: nada quebra, nada avisa, e o
 * card que deveria estar no topo está na página quatro.
 */

export interface LinhaOrdenavel {
  tipo: string | null
  id: string | null
  [coluna: string]: unknown
}

/**
 * O valor comparável de uma célula.
 *
 * `Number` vem ANTES de `Date.parse` justamente por causa do `numeric` como
 * string. Uma data ISO devolve NaN em `Number` e cai no `Date.parse`, que é a
 * ordem certa das duas tentativas.
 */
export function valorDeOrdenacao(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (Number.isFinite(n)) return n
  const t = Date.parse(String(v))
  return Number.isFinite(t) ? t : null
}

/**
 * Junta, ordena e fatia. `ascendente` espelha o `nullsFirst: false` do banco: nulo
 * vai para o fim nas DUAS direções, senão inverter a ordem encheria a primeira
 * página de linhas sem valor.
 */
export function juntarPaginas<T extends LinhaOrdenavel>(
  paginas: readonly (readonly T[])[],
  opcoes: { coluna: string; ascendente: boolean; pagina: number; limite: number },
): T[] {
  const sinal = opcoes.ascendente ? 1 : -1

  const juntas = paginas.flat().sort((a, b) => {
    const va = valorDeOrdenacao(a[opcoes.coluna])
    const vb = valorDeOrdenacao(b[opcoes.coluna])
    if (va === null) return vb === null ? desempate(a, b) : 1
    if (vb === null) return -1
    if (va !== vb) return (va - vb) * sinal
    return desempate(a, b)
  })

  const de = opcoes.pagina * opcoes.limite
  return juntas.slice(de, de + opcoes.limite)
}

/**
 * O desempate é o PAR `(tipo, id)`, que é a identidade real entre fontes — nada
 * impede uma pré-autorização 4242 e uma parcela 4242 existirem ao mesmo tempo.
 *
 * Sem ele, paginar por OFFSET faz duas linhas de mesmo valor trocarem de lugar
 * entre páginas: um card aparece duas vezes e outro nunca aparece.
 */
function desempate(a: LinhaOrdenavel, b: LinhaOrdenavel): number {
  return `${a.tipo}:${a.id}`.localeCompare(`${b.tipo}:${b.id}`)
}

/** As três fontes, e a view que responde por cada uma. */
export const VIEW_DA_FONTE = {
  nf: 'funil_oportunidades_nf',
  pre_autorizacao: 'funil_oportunidades_preauth',
  titulo: 'funil_oportunidades_titulo',
} as const satisfies Record<TipoOportunidade, string>
