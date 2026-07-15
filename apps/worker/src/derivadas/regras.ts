import type { Consultavel } from '../db.js'
import { compileToSql } from '../../../../packages/core/src/mercado/filters.js'
import {
  CAMADAS_COM_REGRA,
  type CamadaComRegra,
} from '../../../../packages/core/src/mercado/schemas.js'

/**
 * The bridge between the rule engine and a 2M-row UPDATE.
 *
 * compileToSql() is the worker's compiler — the browser gets compileToPostgrest()
 * instead, and never sees SQL. Both compile the SAME validated tree, which is what
 * makes the dry-run count in the Pirâmide (§5.1) and the reclassification the
 * worker actually runs agree. If they could diverge, the confirmation card would
 * be a lie.
 */

export interface RegraAtiva {
  camada: CamadaComRegra
  versao: number
  definicao: unknown
}

export async function regrasAtivas(db: Consultavel): Promise<RegraAtiva[]> {
  const { rows } = await db.query<{ camada: string; versao: number; definicao: unknown }>(
    `select camada, versao, definicao from camada_regras where ativa order by camada`,
  )

  return rows
    .filter((r): r is { camada: CamadaComRegra; versao: number; definicao: unknown } =>
      (CAMADAS_COM_REGRA as readonly string[]).includes(r.camada),
    )
    .map((r) => ({ camada: r.camada, versao: r.versao, definicao: r.definicao }))
}

/**
 * compileToSql() always numbers from $1. Splicing three rules into one statement
 * means the second and third have to be renumbered — the text contains ONLY
 * placeholders and catalog-supplied column names (never a literal value, by
 * construction), so a rewrite of `$n` cannot touch data.
 */
export function deslocarPlaceholders(texto: string, deslocamento: number): string {
  if (deslocamento === 0) return texto
  return texto.replace(/\$(\d+)/g, (_, n: string) => `$${Number(n) + deslocamento}`)
}

export interface ExpressaoCamada {
  /** A CASE expression over the columns of `mercado_explorador`. */
  sql: string
  values: unknown[]
  /** camada → rule version that produced it. Stored in camada_regra_versao. */
  versoes: Record<string, number>
}

/**
 * Highest layer wins. The rules are independent by construction (each repeats the
 * conditions of the one below it — migration 0014), so "SOM ⇒ SAM" is a property
 * of the seeded trees, not something evaluated here. Evaluating them top-down in
 * ONE CASE means one sequential scan of the view instead of three UPDATE passes
 * over 2M rows.
 */
export function expressaoCamada(
  regras: readonly RegraAtiva[],
  deslocamentoInicial = 0,
  hoje: Date = new Date(),
): ExpressaoCamada {
  const ordem: readonly CamadaComRegra[] = ['som', 'sam', 'tam']
  const values: unknown[] = []
  const versoes: Record<string, number> = {}
  const quandos: string[] = []

  for (const camada of ordem) {
    const regra = regras.find((r) => r.camada === camada)
    if (!regra) continue

    const { text, values: v } = compileToSql(regra.definicao, hoje)
    quandos.push(`when ${deslocarPlaceholders(text, deslocamentoInicial + values.length)} then '${camada}'`)
    values.push(...v)
    versoes[camada] = regra.versao
  }

  // No active rule at all → everything is universo. Correct, and preferable to
  // leaving stale layers behind after someone deactivates every rule.
  const sql = quandos.length === 0 ? `'universo'::text` : `case ${quandos.join(' ')} else 'universo' end`

  return { sql, values, versoes }
}
