import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { from as copyFrom } from 'pg-copy-streams'
import type pg from 'pg'

/**
 * COPY … FROM STDIN, the only sane way to put millions of rows into Postgres.
 * An INSERT per row would be ~2M round trips; a multi-row INSERT still parses
 * and plans every batch. COPY is why the worker holds a direct pg connection at
 * all (supabase-js speaks PostgREST, which has no COPY).
 *
 * Values are never concatenated into SQL here either: COPY carries DATA, not a
 * statement. The only thing that must be escaped is the CSV framing itself.
 */

export type ValorCopia = string | number | boolean | null | undefined

/**
 * COPY CSV semantics, which are not the same as SQL's:
 *   - an UNQUOTED empty field is NULL
 *   - a QUOTED empty field is the empty string
 * So `null` must emit nothing at all, and every present value is quoted — which
 * also neutralizes the delimiter, quotes and newlines inside razões sociais.
 */
function campo(v: ValorCopia): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 't' : 'f'
  const s = String(v)
  return `"${s.replace(/"/g, '""')}"`
}

export function linhaCsv(valores: readonly ValorCopia[]): string {
  return `${valores.map(campo).join(',')}\n`
}

/**
 * Streams rows into `tabela` with backpressure. The source is an async iterable,
 * so the CSV is parsed, filtered and copied in one pass — the file is never
 * materialized in memory.
 */
export async function copiarLinhas(
  client: pg.Client,
  tabela: string,
  colunas: readonly string[],
  linhas: AsyncIterable<readonly ValorCopia[]>,
): Promise<number> {
  let total = 0

  const origem = Readable.from(
    (async function* () {
      for await (const linha of linhas) {
        total++
        yield linhaCsv(linha)
      }
    })(),
    { objectMode: false, encoding: 'utf8' },
  )

  const destino = client.query(
    copyFrom(
      `copy ${tabela} (${colunas.join(', ')}) from stdin with (format csv, delimiter ',', quote '"', null '')`,
    ),
  )

  await pipeline(origem, destino)
  return total
}
