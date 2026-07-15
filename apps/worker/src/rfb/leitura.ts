import { createReadStream } from 'node:fs'
import { parse } from 'csv-parse'
import iconv from 'iconv-lite'
import unzipper from 'unzipper'

/**
 * Reading a Receita file, honestly.
 *
 * The CSVs are latin-1 (ISO-8859-1), semicolon-separated, quote-delimited, and
 * have NO header row. Decoding them as UTF-8 — Node's default — turns every
 * "CONSTRUÇÃO" into "CONSTRU��O" and every "SÃO PAULO" into garbage, and the
 * damage is silent: the rows load fine and the razão social is wrong forever.
 *
 * Nothing is buffered: zip entry → latin-1 decode → CSV parse → caller, one row
 * at a time. An Estabelecimentos part is ~1 GB uncompressed.
 */

const OPCOES_CSV = {
  delimiter: ';',
  quote: '"',
  escape: '"',
  // The RFB dump contains rows with stray quotes inside unquoted fields. Strict
  // parsing aborts the whole file on one of them; we would rather keep the row.
  relax_quotes: true,
  relax_column_count: true,
  skip_empty_lines: true,
  trim: false,
} as const

function fluxoCsv(entrada: NodeJS.ReadableStream, cabecalho: boolean): NodeJS.ReadableStream {
  const parser = cabecalho
    ? parse({
        ...OPCOES_CSV,
        columns: (linha: string[]) => linha.map(normalizarCabecalho),
      })
    : parse(OPCOES_CSV)

  return entrada.pipe(iconv.decodeStream('latin1')).pipe(parser)
}

/** "Nº Inscrição CNO" → "n_inscricao_cno". Header names in the CNO dump are not stable. */
export function normalizarCabecalho(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Every data row of every CSV inside `caminho`. Accepts a .zip (each entry is
 * parsed in turn) or a bare .csv — which is what makes --sample able to run the
 * exact same code path over a fixture.
 */
export async function* lerLinhas(caminho: string): AsyncGenerator<string[]> {
  if (!caminho.toLowerCase().endsWith('.zip')) {
    yield* fluxoCsv(createReadStream(caminho), false) as AsyncIterable<string[]>
    return
  }

  const zip = createReadStream(caminho).pipe(unzipper.Parse({ forceStream: true }))

  for await (const entrada of zip as AsyncIterable<unzipper.Entry>) {
    if (entrada.type === 'Directory') {
      entrada.autodrain()
      continue
    }
    yield* fluxoCsv(entrada, false) as AsyncIterable<string[]>
  }
}

/** Same, for sources that DO carry a header row (CNO). Keys are normalized. */
export async function* lerRegistros(caminho: string): AsyncGenerator<Record<string, string>> {
  if (!caminho.toLowerCase().endsWith('.zip')) {
    yield* fluxoCsv(createReadStream(caminho), true) as AsyncIterable<Record<string, string>>
    return
  }

  const zip = createReadStream(caminho).pipe(unzipper.Parse({ forceStream: true }))

  for await (const entrada of zip as AsyncIterable<unzipper.Entry>) {
    if (entrada.type === 'Directory' || !entrada.path.toLowerCase().endsWith('.csv')) {
      entrada.autodrain()
      continue
    }
    yield* fluxoCsv(entrada, true) as AsyncIterable<Record<string, string>>
  }
}
