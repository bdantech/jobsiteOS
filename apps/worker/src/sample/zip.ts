/**
 * A minimal ZIP writer — store method, no compression.
 *
 * It exists so that --sample exercises the SAME code path as a real run: fixture
 * CSV → latin-1 encode → zip → unzipper → csv-parse → COPY. A sample mode that
 * fed plain UTF-8 CSVs straight into the parser would "pass" while leaving both
 * the archive layer and the charset layer untested — and those are precisely the
 * two places where a Receita ingestion silently corrupts every razão social.
 *
 * Store (method 0) rather than deflate: the fixtures are kilobytes, and a zip
 * with no compression is 60 lines instead of a dependency.
 */

const TABELA_CRC = (() => {
  const tabela = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    tabela[i] = c
  }
  return tabela
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = (TABELA_CRC[(c ^ byte) & 0xff] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface ArquivoZip {
  nome: string
  conteudo: Buffer
}

export function montarZip(arquivos: readonly ArquivoZip[]): Buffer {
  const locais: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const arquivo of arquivos) {
    const nome = Buffer.from(arquivo.nome, 'ascii')
    const dados = arquivo.conteudo
    const crc = crc32(dados)

    const cabecalho = Buffer.alloc(30)
    cabecalho.writeUInt32LE(0x04034b50, 0) // assinatura local
    cabecalho.writeUInt16LE(20, 4) // versão necessária
    cabecalho.writeUInt16LE(0, 6) // flags
    cabecalho.writeUInt16LE(0, 8) // método: store
    cabecalho.writeUInt16LE(0, 10) // hora
    cabecalho.writeUInt16LE(0, 12) // data
    cabecalho.writeUInt32LE(crc, 14)
    cabecalho.writeUInt32LE(dados.length, 18)
    cabecalho.writeUInt32LE(dados.length, 22)
    cabecalho.writeUInt16LE(nome.length, 26)
    cabecalho.writeUInt16LE(0, 28) // extra

    locais.push(cabecalho, nome, dados)

    const entrada = Buffer.alloc(46)
    entrada.writeUInt32LE(0x02014b50, 0) // assinatura central
    entrada.writeUInt16LE(20, 4)
    entrada.writeUInt16LE(20, 6)
    entrada.writeUInt16LE(0, 8)
    entrada.writeUInt16LE(0, 10)
    entrada.writeUInt16LE(0, 12)
    entrada.writeUInt16LE(0, 14)
    entrada.writeUInt32LE(crc, 16)
    entrada.writeUInt32LE(dados.length, 20)
    entrada.writeUInt32LE(dados.length, 24)
    entrada.writeUInt16LE(nome.length, 28)
    entrada.writeUInt16LE(0, 30) // extra
    entrada.writeUInt16LE(0, 32) // comentário
    entrada.writeUInt16LE(0, 34) // disco
    entrada.writeUInt16LE(0, 36) // atributos internos
    entrada.writeUInt32LE(0, 38) // atributos externos
    entrada.writeUInt32LE(offset, 42)

    central.push(entrada, nome)
    offset += cabecalho.length + nome.length + dados.length
  }

  const corpoCentral = Buffer.concat(central)
  const fim = Buffer.alloc(22)
  fim.writeUInt32LE(0x06054b50, 0)
  fim.writeUInt16LE(0, 4)
  fim.writeUInt16LE(0, 6)
  fim.writeUInt16LE(arquivos.length, 8)
  fim.writeUInt16LE(arquivos.length, 10)
  fim.writeUInt32LE(corpoCentral.length, 12)
  fim.writeUInt32LE(offset, 16)
  fim.writeUInt16LE(0, 20)

  return Buffer.concat([...locais, corpoCentral, fim])
}
