import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import iconv from 'iconv-lite'
import { env } from '../env.js'
import { logger } from '../logger.js'
import type { ArquivosReceita } from '../jobs/receita.js'
import { montarZip } from './zip.js'

/**
 * --sample (§7). The ONLY way anyone will ever test this pipeline: the real dump
 * is ~5 GB zipped and takes hours on a good day.
 *
 * The fixtures are written in the REAL Receita layout — same column order, same
 * codes ("02" for ativa, "01" for ME), same "20180131" dates, same "1500000,00"
 * decimals, same `;` separator, encoded to latin-1 and zipped. So the sample run
 * goes through the identical code path: unzip → latin-1 decode → csv-parse →
 * filter → COPY → upsert → SPE → grupos → métricas → reclassificação → promoção.
 * Nothing is stubbed. Only the download is skipped.
 *
 * The 11 companies are chosen so that EVERY branch is observable — see README:
 * a holding outside the CNAE cut (reachable only via the sócio-PJ second pass),
 * SPEs both old and freshly opened, a filial (qtd_filiais ≥ 1), a company in a
 * state outside the SAM geography, a baixada, and a company whose only route to
 * SOM is an active obra in the CNO.
 */

const PASTA = () => join(env.DOWNLOAD_DIR, 'amostra')

// ─── Datas relativas a hoje, no formato da Receita ──────────────────────────

function dataRfb(mesesAtras: number): string {
  const d = new Date()
  d.setUTCMonth(d.getUTCMonth() - mesesAtras)
  const a = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dia = String(d.getUTCDate()).padStart(2, '0')
  return `${a}${m}${dia}`
}

const ANOS = (n: number): string => dataRfb(n * 12)

// ─── Empresas (por raiz) ────────────────────────────────────────────────────
// cnpj_basico;razao_social;natureza;qualificacao;capital;porte;ente
const EMPRESAS = [
  ['11111111', 'ALFA PARTICIPACOES S.A.', '2054', '10', '5000000,00', '05', ''],
  ['22222222', 'ALFA CONSTRUTORA LTDA', '2062', '49', '3000000,00', '05', ''],
  ['33333333', 'SPE ALFA 01 EMPREENDIMENTO IMOBILIARIO LTDA', '2062', '49', '1000000,00', '05', ''],
  ['44444444', 'SPE ALFA 02 EMPREENDIMENTOS LTDA', '2062', '49', '800000,00', '05', ''],
  ['45454545', 'SPE ALFA 03 EMPREENDIMENTOS LTDA', '2062', '49', '600000,00', '05', ''],
  ['55555555', 'BETA CONSTRUÇÕES E SANEAMENTO LTDA', '2062', '49', '2500000,00', '05', ''],
  ['66666666', 'GAMA REFORMAS E MANUTENÇÃO ME', '2062', '49', '10000,00', '01', ''],
  ['77777777', 'DELTA ENGENHARIA E OBRAS LTDA', '2062', '49', '900000,00', '05', ''],
  ['88888888', 'EPSILON CONSTRUTORA DA AMAZÔNIA LTDA', '2062', '49', '5000000,00', '05', ''],
  ['99999999', 'ZETA CONSTRUTORA BAIXADA LTDA', '2062', '49', '1500000,00', '05', ''],
]

// ─── Estabelecimentos ───────────────────────────────────────────────────────
// A 30-column line. Only the columns the worker reads are filled; the rest are
// present and empty, exactly as they are in the real file.
function estabelecimento(campos: {
  basico: string
  ordem: string
  dv: string
  matriz: '1' | '2'
  fantasia: string
  situacao: string
  inicio: string
  cnaePrincipal: string
  cnaesSecundarios?: string
  uf: string
  municipio: string
  email?: string
}): string[] {
  const linha = new Array<string>(30).fill('')
  linha[0] = campos.basico
  linha[1] = campos.ordem
  linha[2] = campos.dv
  linha[3] = campos.matriz
  linha[4] = campos.fantasia
  linha[5] = campos.situacao
  linha[6] = campos.inicio
  linha[7] = '00'
  linha[10] = campos.inicio
  linha[11] = campos.cnaePrincipal
  linha[12] = campos.cnaesSecundarios ?? ''
  linha[13] = 'RUA'
  linha[14] = 'DAS OBRAS'
  linha[15] = '100'
  linha[17] = 'CENTRO'
  linha[18] = '01310100'
  linha[19] = campos.uf
  linha[20] = campos.municipio
  linha[21] = '11'
  linha[22] = '30001000'
  linha[27] = campos.email ?? ''
  return linha
}

const ESTABELECIMENTOS = [
  // A holding: CNAE 6462 (holdings), NOT in the construction cut. It enters the
  // universe ONLY through the sócio-PJ second pass — and without it the ALFA
  // group would have no head.
  estabelecimento({
    basico: '11111111',
    ordem: '0001',
    dv: '91',
    matriz: '1',
    fantasia: 'ALFA PARTICIPACOES',
    situacao: '02',
    inicio: ANOS(15),
    cnaePrincipal: '6462000',
    uf: 'SP',
    municipio: '7107',
  }),
  // A construtora with one filial → qtd_filiais = 1 → SAM.
  estabelecimento({
    basico: '22222222',
    ordem: '0001',
    dv: '10',
    matriz: '1',
    fantasia: 'ALFA CONSTRUTORA',
    situacao: '02',
    inicio: ANOS(12),
    cnaePrincipal: '4120400',
    cnaesSecundarios: '4110700,4399103',
    uf: 'SP',
    municipio: '7107',
    email: 'contato@alfaconstrutora.com.br',
  }),
  estabelecimento({
    basico: '22222222',
    ordem: '0002',
    dv: '00',
    matriz: '2',
    fantasia: 'ALFA CONSTRUTORA FILIAL CAMPINAS',
    situacao: '02',
    inicio: ANOS(6),
    cnaePrincipal: '4120400',
    uf: 'SP',
    municipio: '6291',
  }),
  // SPE with 5 years: old enough for TAM on its own.
  estabelecimento({
    basico: '33333333',
    ordem: '0001',
    dv: '20',
    matriz: '1',
    fantasia: 'SPE ALFA 01',
    situacao: '02',
    inicio: ANOS(5),
    cnaePrincipal: '4110700',
    uf: 'SP',
    municipio: '7107',
  }),
  // Two SPEs opened inside the last 24 months → grupo_spes_24m = 2, which is the
  // SOM signal for the whole ALFA group. Both are younger than 3 years, so they
  // are `universo` themselves. That asymmetry is the point of grupo-level metrics.
  estabelecimento({
    basico: '44444444',
    ordem: '0001',
    dv: '30',
    matriz: '1',
    fantasia: 'SPE ALFA 02',
    situacao: '02',
    inicio: dataRfb(8),
    cnaePrincipal: '4110700',
    uf: 'SP',
    municipio: '7107',
  }),
  estabelecimento({
    basico: '45454545',
    ordem: '0001',
    dv: '40',
    matriz: '1',
    fantasia: 'SPE ALFA 03',
    situacao: '02',
    inicio: dataRfb(20),
    cnaePrincipal: '4110700',
    uf: 'SP',
    municipio: '7107',
  }),
  // Capital ≥ 2M in SC → SAM, but no buying signal → stops there.
  estabelecimento({
    basico: '55555555',
    ordem: '0001',
    dv: '50',
    matriz: '1',
    fantasia: 'BETA CONSTRUCOES',
    situacao: '02',
    inicio: ANOS(20),
    cnaePrincipal: '4211101',
    uf: 'SC',
    municipio: '8105',
  }),
  // Too young, too small → universo.
  estabelecimento({
    basico: '66666666',
    ordem: '0001',
    dv: '60',
    matriz: '1',
    fantasia: 'GAMA REFORMAS',
    situacao: '02',
    inicio: dataRfb(14),
    cnaePrincipal: '4330404',
    uf: 'SP',
    municipio: '7107',
  }),
  // Its ONLY route to SOM is an active obra in the CNO.
  estabelecimento({
    basico: '77777777',
    ordem: '0001',
    dv: '70',
    matriz: '1',
    fantasia: 'DELTA ENGENHARIA',
    situacao: '02',
    inicio: ANOS(8),
    cnaePrincipal: '4120400',
    uf: 'RS',
    municipio: '8801',
  }),
  estabelecimento({
    basico: '77777777',
    ordem: '0002',
    dv: '51',
    matriz: '2',
    fantasia: 'DELTA ENGENHARIA FILIAL',
    situacao: '02',
    inicio: ANOS(4),
    cnaePrincipal: '4120400',
    uf: 'RS',
    municipio: '8801',
  }),
  // Perfect profile, wrong state (AM is not in the SAM geography) → stops at TAM.
  estabelecimento({
    basico: '88888888',
    ordem: '0001',
    dv: '80',
    matriz: '1',
    fantasia: 'EPSILON CONSTRUTORA',
    situacao: '02',
    inicio: ANOS(10),
    cnaePrincipal: '4120400',
    uf: 'AM',
    municipio: '0255',
  }),
  // Baixada: situação cadastral kills it at the first condition of TAM.
  estabelecimento({
    basico: '99999999',
    ordem: '0001',
    dv: '90',
    matriz: '1',
    fantasia: 'ZETA CONSTRUTORA',
    situacao: '08',
    inicio: ANOS(18),
    cnaePrincipal: '4120400',
    uf: 'SP',
    municipio: '7107',
  }),
]

// ─── Sócios ─────────────────────────────────────────────────────────────────
// cnpj_basico;identificador(1=PJ,2=PF);nome;cpf_cnpj;qualificacao;data;pais;rep;nome_rep;qual_rep;faixa
const SOCIOS = [
  ['11111111', '2', 'MARIA ALVES DA SILVA', '***456789**', '49', ANOS(15), '', '', '', '', '6'],
  ['22222222', '1', 'ALFA PARTICIPACOES S.A.', '11111111000191', '22', ANOS(12), '', '', '', '', '0'],
  ['33333333', '1', 'ALFA CONSTRUTORA LTDA', '22222222000110', '22', ANOS(5), '', '', '', '', '0'],
  ['44444444', '1', 'ALFA CONSTRUTORA LTDA', '22222222000110', '22', dataRfb(8), '', '', '', '', '0'],
  ['45454545', '1', 'ALFA PARTICIPACOES S.A.', '11111111000191', '22', dataRfb(20), '', '', '', '', '0'],
  ['55555555', '2', 'JOAO BETA', '***111222**', '49', ANOS(20), '', '', '', '', '5'],
  ['66666666', '2', 'ANA GAMA', '***333444**', '49', dataRfb(14), '', '', '', '', '4'],
  ['77777777', '2', 'CARLOS DELTA', '***555666**', '49', ANOS(8), '', '', '', '', '6'],
  ['88888888', '2', 'PEDRO EPSILON', '***777888**', '49', ANOS(10), '', '', '', '', '5'],
  ['99999999', '2', 'LUIZ ZETA', '***999000**', '49', ANOS(18), '', '', '', '', '7'],
]

// ─── Simples ────────────────────────────────────────────────────────────────
const SIMPLES = [
  ['66666666', 'S', ANOS(1), '', 'N', '', ''],
  // Left the Simples 6 months ago — the "growing revenue" signal (§4).
  ['77777777', 'N', ANOS(6), dataRfb(6), 'N', '', ''],
]

const MUNICIPIOS = [
  ['7107', 'SAO PAULO'],
  ['6291', 'CAMPINAS'],
  ['8105', 'FLORIANOPOLIS'],
  ['8801', 'PORTO ALEGRE'],
  ['0255', 'MANAUS'],
]

const NATUREZAS = [
  ['2054', 'SOCIEDADE ANONIMA FECHADA'],
  ['2062', 'SOCIEDADE EMPRESARIA LIMITADA'],
]

// ─── CNO ────────────────────────────────────────────────────────────────────
// This one DOES have a header row, and the header names in the wild are not
// stable — which is exactly why the CNO reader matches on aliases.
const CNO_CABECALHO = [
  'CNO',
  'NI Responsável',
  'Tipo de Responsabilidade',
  'Situação',
  'Data da Situação',
  'Data de Início',
  'UF',
  'Município',
  'Bairro',
  'CEP',
  'Destinação',
  'Categoria',
  'Tipo de Obra',
  'Área Total',
  'CNO Vinculado',
]

const CNO_LINHAS = [
  [
    '112233445566',
    '77777777000170',
    'Empreitada total',
    'Ativa',
    dataRfb(3),
    dataRfb(10),
    'RS',
    'PORTO ALEGRE',
    'MOINHOS DE VENTO',
    '90560000',
    'Residencial multifamiliar',
    'Obra nova',
    'Edificação',
    '5000,00',
    '',
  ],
  [
    '223344556677',
    '22222222000110',
    'Incorporador',
    'Ativa',
    dataRfb(2),
    dataRfb(18),
    'SP',
    'SAO PAULO',
    'PINHEIROS',
    '05422000',
    'Residencial multifamiliar',
    'Obra nova',
    'Edificação',
    '12500,50',
    '',
  ],
  [
    '334455667788',
    '22222222000110',
    'Incorporador',
    'Encerrada',
    dataRfb(30),
    dataRfb(60),
    'SP',
    'SAO PAULO',
    'MOEMA',
    '04077000',
    'Comercial',
    'Obra nova',
    'Edificação',
    '3000,00',
    '',
  ],
  // Responsável outside the universe → must be filtered out by the CNO job.
  [
    '445566778899',
    '10101010000101',
    'Dono da obra',
    'Ativa',
    dataRfb(1),
    dataRfb(4),
    'SP',
    'SAO PAULO',
    'ITAIM',
    '04532000',
    'Residencial unifamiliar',
    'Reforma',
    'Edificação',
    '250,00',
    '',
  ],
]

// ─── Escrita ────────────────────────────────────────────────────────────────

/** `;`-separated, `"`-quoted, latin-1 — byte for byte how the Receita ships it. */
function csvLatin1(linhas: readonly string[][]): Buffer {
  const texto = linhas.map((l) => l.map((c) => `"${c.replace(/"/g, '')}"`).join(';')).join('\r\n')
  return iconv.encode(`${texto}\r\n`, 'latin1')
}

async function escreverZip(nome: string, entradas: { nome: string; conteudo: Buffer }[]): Promise<string> {
  const pasta = PASTA()
  await mkdir(pasta, { recursive: true })
  const caminho = join(pasta, nome)
  await writeFile(caminho, montarZip(entradas))
  return caminho
}

export async function arquivosDeAmostra(): Promise<ArquivosReceita> {
  logger.info({ pasta: PASTA() }, 'Gerando a amostra (modo --sample: nada é baixado).')

  const empresas = await escreverZip('Empresas0.zip', [
    { nome: 'K3241.K03200Y0.D50111.EMPRECSV', conteudo: csvLatin1(EMPRESAS) },
  ])
  const estabelecimentos = await escreverZip('Estabelecimentos0.zip', [
    { nome: 'K3241.K03200Y0.D50111.ESTABELE', conteudo: csvLatin1(ESTABELECIMENTOS) },
  ])
  const socios = await escreverZip('Socios0.zip', [
    { nome: 'K3241.K03200Y0.D50111.SOCIOCSV', conteudo: csvLatin1(SOCIOS) },
  ])
  const simples = await escreverZip('Simples.zip', [
    { nome: 'F.K03200$W.SIMPLES.CSV.D50111', conteudo: csvLatin1(SIMPLES) },
  ])
  const municipios = await escreverZip('Municipios.zip', [
    { nome: 'F.K03200$Z.D50111.MUNICCSV', conteudo: csvLatin1(MUNICIPIOS) },
  ])
  const naturezas = await escreverZip('Naturezas.zip', [
    { nome: 'F.K03200$Z.D50111.NATJUCSV', conteudo: csvLatin1(NATUREZAS) },
  ])

  return {
    empresas: [empresas],
    estabelecimentos: [estabelecimentos],
    socios: [socios],
    simples,
    municipios,
    naturezas,
  }
}

export async function arquivoCnoDeAmostra(): Promise<string> {
  return escreverZip('cno.zip', [
    { nome: 'cno.csv', conteudo: csvLatin1([CNO_CABECALHO, ...CNO_LINHAS]) },
  ])
}
