import 'server-only'

import { inflateRawSync } from 'node:zlib'

/**
 * Leitor de planilhas: .csv e .xlsx, sem dependência externa.
 *
 * O monorepo não tem (e este agente não pode adicionar) uma lib de xlsx. Um
 * .xlsx é um ZIP de XMLs — e o Node já traz o inflate. São ~150 linhas de
 * leitor de ZIP + um scanner de XML, contra uma dependência de 800KB que faz
 * mil coisas que não usamos. O que precisamos daqui é estreito e conhecido:
 * ler a PRIMEIRA planilha como uma grade de strings. Datas, fórmulas, estilos e
 * formatos não entram — nenhum campo canônico da importação (§5.5) é uma data,
 * e um número de série do Excel interpretado como data errada é pior do que o
 * texto cru que o usuário vê na tela.
 *
 * TUDO sai como string. A conversão para número/booleano acontece depois, no
 * mapeamento, onde sabemos qual campo é qual.
 */

export class ErroPlanilha extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ErroPlanilha'
  }
}

export interface Planilha {
  /** Cabeçalhos únicos e não vazios, na ordem das colunas. */
  cabecalhos: string[]
  /** Uma linha = um objeto { cabeçalho: valor }. Célula vazia = ''. */
  linhas: Record<string, string>[]
}

/** Uma lista maior que isto não é uma lista pré-qualificada: é um dump. */
export const MAX_LINHAS = 20_000

// ─── ZIP ────────────────────────────────────────────────────────────────────

const ASSINATURA_EOCD = 0x06054b50
const ASSINATURA_CENTRAL = 0x02014b50
const ASSINATURA_LOCAL = 0x04034b50

interface EntradaZip {
  metodo: number
  offsetLocal: number
  tamanhoComprimido: number
}

function lerDiretorioCentral(buf: Buffer): Map<string, EntradaZip> {
  // O EOCD fica no fim, depois de um comentário de até 65535 bytes.
  const minimo = Math.max(0, buf.length - 22 - 0xffff)
  let eocd = -1
  for (let i = buf.length - 22; i >= minimo; i--) {
    if (buf.readUInt32LE(i) === ASSINATURA_EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ErroPlanilha('Arquivo .xlsx inválido: não é um ZIP.')

  const total = buf.readUInt16LE(eocd + 10)
  let ponteiro = buf.readUInt32LE(eocd + 16)

  if (ponteiro === 0xffffffff) {
    throw new ErroPlanilha('Arquivo .xlsx em formato ZIP64 não é suportado. Salve novamente em .xlsx padrão ou exporte em .csv.')
  }

  const entradas = new Map<string, EntradaZip>()

  for (let i = 0; i < total; i++) {
    if (ponteiro + 46 > buf.length || buf.readUInt32LE(ponteiro) !== ASSINATURA_CENTRAL) {
      throw new ErroPlanilha('Arquivo .xlsx corrompido: diretório central inválido.')
    }

    const metodo = buf.readUInt16LE(ponteiro + 10)
    const tamanhoComprimido = buf.readUInt32LE(ponteiro + 20)
    const tamanhoNome = buf.readUInt16LE(ponteiro + 28)
    const tamanhoExtra = buf.readUInt16LE(ponteiro + 30)
    const tamanhoComentario = buf.readUInt16LE(ponteiro + 32)
    const offsetLocal = buf.readUInt32LE(ponteiro + 42)
    const nome = buf.toString('utf8', ponteiro + 46, ponteiro + 46 + tamanhoNome)

    if (tamanhoComprimido === 0xffffffff || offsetLocal === 0xffffffff) {
      throw new ErroPlanilha('Arquivo .xlsx em formato ZIP64 não é suportado. Salve novamente em .xlsx padrão ou exporte em .csv.')
    }

    entradas.set(nome, { metodo, offsetLocal, tamanhoComprimido })
    ponteiro += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario
  }

  return entradas
}

function extrair(buf: Buffer, entrada: EntradaZip, nome: string): string {
  const { offsetLocal } = entrada

  if (buf.readUInt32LE(offsetLocal) !== ASSINATURA_LOCAL) {
    throw new ErroPlanilha(`Arquivo .xlsx corrompido: cabeçalho local de "${nome}" inválido.`)
  }

  // O cabeçalho local pode trazer tamanhos zerados (data descriptor); os do
  // diretório central são sempre confiáveis. Só os comprimentos de nome/extra
  // saem daqui, porque eles são o offset até os bytes.
  const tamanhoNome = buf.readUInt16LE(offsetLocal + 26)
  const tamanhoExtra = buf.readUInt16LE(offsetLocal + 28)
  const inicio = offsetLocal + 30 + tamanhoNome + tamanhoExtra
  const bytes = buf.subarray(inicio, inicio + entrada.tamanhoComprimido)

  if (entrada.metodo === 0) return bytes.toString('utf8')
  if (entrada.metodo === 8) return inflateRawSync(bytes).toString('utf8')

  throw new ErroPlanilha(`Arquivo .xlsx usa uma compressão não suportada (método ${entrada.metodo}).`)
}

// ─── XML ────────────────────────────────────────────────────────────────────

const ENTIDADES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

function decodificar(texto: string): string {
  return texto.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (todo, entidade: string) => {
    if (entidade.startsWith('#x') || entidade.startsWith('#X')) {
      return String.fromCodePoint(parseInt(entidade.slice(2), 16))
    }
    if (entidade.startsWith('#')) {
      return String.fromCodePoint(parseInt(entidade.slice(1), 10))
    }
    return ENTIDADES[entidade] ?? todo
  })
}

/** Todos os <t> de um trecho, concatenados: um <si> pode vir quebrado em runs (<r>). */
function textosDe(xml: string): string {
  let saida = ''
  for (const m of xml.matchAll(/<t\b[^>]*\/>|<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
    saida += decodificar(m[1] ?? '')
  }
  return saida
}

function lerSharedStrings(xml: string): string[] {
  const strings: string[] = []
  for (const m of xml.matchAll(/<si\b[^>]*\/>|<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    strings.push(textosDe(m[1] ?? ''))
  }
  return strings
}

/** "A" → 0, "Z" → 25, "AA" → 26. Sem isso, uma célula vazia desalinha a linha inteira. */
function indiceDaColuna(letras: string): number {
  let indice = 0
  for (const letra of letras) {
    indice = indice * 26 + (letra.charCodeAt(0) - 64)
  }
  return indice - 1
}

function lerPlanilhaXml(xml: string, compartilhadas: readonly string[]): string[][] {
  const grade: string[][] = []

  for (const linha of xml.matchAll(/<row\b[^>]*\/>|<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const corpoLinha = linha[1] ?? ''
    const celulas: string[] = []

    for (const celula of corpoLinha.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const atributos = celula[1] ?? ''
      const corpo = celula[2] ?? ''

      const referencia = /r="([A-Z]+)\d+"/.exec(atributos)?.[1]
      const tipo = /t="([^"]+)"/.exec(atributos)?.[1] ?? 'n'
      const indice = referencia ? indiceDaColuna(referencia) : celulas.length

      let valor = ''
      if (tipo === 's') {
        const bruto = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1]
        const posicao = bruto === undefined ? NaN : Number(bruto)
        valor = Number.isInteger(posicao) ? (compartilhadas[posicao] ?? '') : ''
      } else if (tipo === 'inlineStr') {
        valor = textosDe(corpo)
      } else {
        const bruto = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1]
        valor = bruto === undefined ? '' : decodificar(bruto)
      }

      while (celulas.length < indice) celulas.push('')
      celulas[indice] = valor
    }

    grade.push(celulas)
    if (grade.length > MAX_LINHAS + 1) break
  }

  return grade
}

/** A primeira aba na ORDEM DO WORKBOOK — que não é necessariamente sheet1.xml. */
function caminhoDaPrimeiraAba(entradas: Map<string, EntradaZip>, buf: Buffer): string {
  const workbook = entradas.get('xl/workbook.xml')
  const rels = entradas.get('xl/_rels/workbook.xml.rels')

  if (workbook && rels) {
    const xmlWorkbook = extrair(buf, workbook, 'xl/workbook.xml')
    const idRelacao = /<sheet\b[^>]*r:id="([^"]+)"/.exec(xmlWorkbook)?.[1]

    if (idRelacao) {
      const xmlRels = extrair(buf, rels, 'xl/_rels/workbook.xml.rels')
      const escapado = idRelacao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const alvo = new RegExp(`<Relationship\\b[^>]*Id="${escapado}"[^>]*Target="([^"]+)"`).exec(
        xmlRels,
      )?.[1]

      if (alvo) {
        const limpo = alvo.replace(/^\/?xl\//, '').replace(/^\.\//, '')
        const caminho = `xl/${limpo}`
        if (entradas.has(caminho)) return caminho
      }
    }
  }

  if (entradas.has('xl/worksheets/sheet1.xml')) return 'xl/worksheets/sheet1.xml'

  const primeira = [...entradas.keys()].find((nome) => nome.startsWith('xl/worksheets/'))
  if (primeira) return primeira

  throw new ErroPlanilha('O arquivo .xlsx não tem nenhuma planilha.')
}

function lerXlsx(buf: Buffer): string[][] {
  const entradas = lerDiretorioCentral(buf)

  const sharedStrings = entradas.get('xl/sharedStrings.xml')
  const compartilhadas = sharedStrings
    ? lerSharedStrings(extrair(buf, sharedStrings, 'xl/sharedStrings.xml'))
    : []

  const caminho = caminhoDaPrimeiraAba(entradas, buf)
  const aba = entradas.get(caminho)
  if (!aba) throw new ErroPlanilha('O arquivo .xlsx não tem nenhuma planilha.')

  return lerPlanilhaXml(extrair(buf, aba, caminho), compartilhadas)
}

// ─── CSV ────────────────────────────────────────────────────────────────────

/**
 * Planilha exportada por ERP brasileiro raramente é UTF-8: quase sempre é
 * windows-1252, e "CONSTRUÇÃO" vira "CONSTRU��O" se a gente assumir errado.
 * UTF-8 estrito primeiro (que FALHA em bytes inválidos, e é justamente por isso
 * que ele é um bom detector), windows-1252 depois.
 */
function decodificarTexto(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('windows-1252').decode(buf)
  }
}

/** ; é o separador padrão do Excel em pt-BR, mas a lista pode vir de qualquer lugar. */
function detectarSeparador(amostra: string): string {
  const candidatos = [';', ',', '\t', '|']
  let melhor = ';'
  let maior = -1

  for (const separador of candidatos) {
    let contagem = 0
    let dentroDeAspas = false
    for (const caractere of amostra) {
      if (caractere === '"') dentroDeAspas = !dentroDeAspas
      else if (caractere === separador && !dentroDeAspas) contagem++
    }
    if (contagem > maior) {
      maior = contagem
      melhor = separador
    }
  }

  return melhor
}

function lerCsv(texto: string): string[][] {
  const semBom = texto.replace(/^﻿/, '')
  const primeiraLinha = semBom.split(/\r?\n/, 1)[0] ?? ''
  const separador = detectarSeparador(primeiraLinha)

  const grade: string[][] = []
  let linha: string[] = []
  let campo = ''
  let dentroDeAspas = false

  const fecharCampo = (): void => {
    linha.push(campo)
    campo = ''
  }
  const fecharLinha = (): void => {
    fecharCampo()
    grade.push(linha)
    linha = []
  }

  for (let i = 0; i < semBom.length; i++) {
    const caractere = semBom[i]!

    if (dentroDeAspas) {
      if (caractere === '"') {
        // "" dentro de um campo entre aspas é uma aspa literal.
        if (semBom[i + 1] === '"') {
          campo += '"'
          i++
        } else {
          dentroDeAspas = false
        }
      } else {
        campo += caractere
      }
      continue
    }

    if (caractere === '"' && campo.length === 0) {
      dentroDeAspas = true
    } else if (caractere === separador) {
      fecharCampo()
    } else if (caractere === '\n') {
      fecharLinha()
      if (grade.length > MAX_LINHAS + 1) break
    } else if (caractere !== '\r') {
      campo += caractere
    }
  }

  // Último campo sem quebra de linha no fim do arquivo.
  if (campo.length > 0 || linha.length > 0) fecharLinha()

  return grade
}

// ─── Grade → Planilha ───────────────────────────────────────────────────────

/**
 * Cabeçalhos vazios e repetidos são a regra, não a exceção: planilhas de ERP
 * têm colunas sem nome e três colunas chamadas "Status". O mapeamento é por
 * chave, então duas chaves iguais fariam uma coluna sumir em silêncio.
 */
function normalizarCabecalhos(bruto: readonly string[]): string[] {
  const vistos = new Map<string, number>()

  return bruto.map((valor, indice) => {
    const base = valor.trim() || `Coluna ${indice + 1}`
    const repeticoes = vistos.get(base) ?? 0
    vistos.set(base, repeticoes + 1)
    return repeticoes === 0 ? base : `${base} (${repeticoes + 1})`
  })
}

function montarPlanilha(grade: string[][]): Planilha {
  const primeira = grade.findIndex((linha) => linha.some((celula) => celula.trim() !== ''))
  if (primeira < 0) throw new ErroPlanilha('A planilha está vazia.')

  const cabecalhos = normalizarCabecalhos(grade[primeira]!.map((c) => c.trim()))

  if (cabecalhos.length === 0) {
    throw new ErroPlanilha('A planilha não tem uma linha de cabeçalho.')
  }

  const linhas: Record<string, string>[] = []

  for (const bruta of grade.slice(primeira + 1)) {
    // Linha totalmente vazia é separador visual da planilha, não dado.
    if (!bruta.some((celula) => celula.trim() !== '')) continue

    const linha: Record<string, string> = {}
    cabecalhos.forEach((cabecalho, indice) => {
      linha[cabecalho] = (bruta[indice] ?? '').trim()
    })
    linhas.push(linha)

    if (linhas.length > MAX_LINHAS) {
      throw new ErroPlanilha(
        `A planilha tem mais de ${MAX_LINHAS.toLocaleString('pt-BR')} linhas. Divida o arquivo antes de importar.`,
      )
    }
  }

  if (linhas.length === 0) {
    throw new ErroPlanilha('A planilha tem cabeçalho, mas nenhuma linha de dados.')
  }

  return { cabecalhos, linhas }
}

export function lerPlanilha(buf: Buffer, nomeArquivo: string): Planilha {
  const extensao = nomeArquivo.toLowerCase().split('.').pop() ?? ''

  if (extensao === 'xlsx') return montarPlanilha(lerXlsx(buf))
  if (extensao === 'csv' || extensao === 'txt') return montarPlanilha(lerCsv(decodificarTexto(buf)))

  throw new ErroPlanilha('Formato não suportado. Envie um arquivo .xlsx ou .csv.')
}
