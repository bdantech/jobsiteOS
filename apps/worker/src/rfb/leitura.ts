import { createReadStream } from 'node:fs'
import { parse } from 'csv-parse'
import iconv from 'iconv-lite'
import unzipper from 'unzipper'

/**
 * Reading a Receita file, honestly.
 *
 * Two formats, and they differ in EVERYTHING but the quote char:
 *   CNPJ dump — latin-1 (ISO-8859-1), semicolon-separated, NO header row.
 *   CNO dump  — UTF-8, COMMA-separated, WITH a header row (new Nextcloud share).
 * Decoding CNPJ as UTF-8 turns "CONSTRUÇÃO" into "CONSTRU��O"; decoding CNO as
 * latin-1 turns "NI do responsável" into a header that matches no alias (which is
 * exactly why the first real CNO run loaded 0 obras). So delimiter + encoding are
 * per-source, passed in — never global.
 *
 * Nothing is buffered: zip entry → decode → CSV parse → caller, one row at a time.
 * An Estabelecimentos part is ~1 GB uncompressed.
 */

const OPCOES_CSV = {
  quote: '"',
  escape: '"',
  // The RFB dump contains rows with stray quotes inside unquoted fields. Strict
  // parsing aborts the whole file on one of them; we would rather keep the row.
  relax_quotes: true,
  relax_column_count: true,
  skip_empty_lines: true,
  trim: false,
} as const

/** Defaults are the CNPJ format (latin-1, ';'); lerRegistros overrides for CNO. */
function fluxoCsv(
  entrada: NodeJS.ReadableStream,
  cabecalho: boolean,
  delimitador = ';',
  codificacao = 'latin1',
): NodeJS.ReadableStream {
  const opcoes = { ...OPCOES_CSV, delimiter: delimitador }
  const parser = cabecalho
    ? parse({
        ...opcoes,
        columns: (linha: string[]) => linha.map(normalizarCabecalho),
      })
    : parse(opcoes)

  return entrada.pipe(iconv.decodeStream(codificacao)).pipe(parser)
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
export async function* lerRegistros(
  caminho: string,
  // The CNO zip carries several CSVs (areas, vínculos, dicionário…); only cno.csv is
  // the obras table. Reading the rest wastes time and — via the `on conflict (cno)`
  // upsert — risks a supplementary row overwriting a good obra. Caller restricts.
  aceitarArquivo: (nome: string) => boolean = () => true,
): AsyncGenerator<Record<string, string>> {
  if (!caminho.toLowerCase().endsWith('.zip')) {
    yield* fluxoCsv(createReadStream(caminho), true, ',', 'utf8') as AsyncIterable<Record<string, string>>
    return
  }

  const zip = createReadStream(caminho).pipe(unzipper.Parse({ forceStream: true }))

  for await (const entrada of zip as AsyncIterable<unzipper.Entry>) {
    const nome = (entrada.path.split('/').pop() ?? entrada.path).toLowerCase()
    if (entrada.type === 'Directory' || !nome.endsWith('.csv') || !aceitarArquivo(nome)) {
      entrada.autodrain()
      continue
    }
    yield* fluxoCsv(entrada, true, ',', 'utf8') as AsyncIterable<Record<string, string>>
  }
}
