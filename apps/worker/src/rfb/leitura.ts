import { createReadStream } from 'node:fs'
import { parse } from 'csv-parse'
import iconv from 'iconv-lite'
import unzipper from 'unzipper'

/**
 * Reading a Receita file, honestly.
 *
 * Both are latin-1 (ISO-8859-1); they differ in delimiter and header:
 *   CNPJ dump — semicolon-separated, NO header row.
 *   CNO dump  — COMMA-separated, WITH a header row (new Nextcloud share).
 * The delimiter is what has to be per-source: parsing the comma-separated CNO with
 * ';' collapses every row into one column and loads 0 obras. Encoding stays latin-1
 * for both — decoding the CNO as UTF-8 turns each accented byte (0xE1 = "á") into a
 * replacement char, so "NI do responsável" normalizes to a key that matches no
 * alias (which loaded 0 obras a different way). So delimiter is passed in.
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
    yield* fluxoCsv(createReadStream(caminho), true, ',', 'latin1') as AsyncIterable<Record<string, string>>
    return
  }

  const zip = createReadStream(caminho).pipe(unzipper.Parse({ forceStream: true }))

  for await (const entrada of zip as AsyncIterable<unzipper.Entry>) {
    const nome = (entrada.path.split('/').pop() ?? entrada.path).toLowerCase()
    if (entrada.type === 'Directory' || !nome.endsWith('.csv') || !aceitarArquivo(nome)) {
      entrada.autodrain()
      continue
    }
    yield* fluxoCsv(entrada, true, ',', 'latin1') as AsyncIterable<Record<string, string>>
  }
}
