import type { ProtestoSituacao } from './schemas.js'

/**
 * Protesto (Prompt 07 §8) — a parte que é nossa: montar a remessa e ler o retorno.
 *
 * ── O QUE ESTE ARQUIVO NÃO FINGE SER ────────────────────────────────────────
 * Não existe API pública de auto-serviço de protesto. O caminho real é o convênio de
 * apresentante com o IEPTB/CRA de cada UF, com e-CNPJ ICP-Brasil da cessionária. O
 * layout exato da troca de arquivos (CRA/CRA21) vem do manual entregue na assinatura do
 * convênio — e ainda não temos nenhum.
 *
 * Por isso o modo `portal_manual` gera a PLANILHA de importação (CSV `;`, UTF-8 com BOM)
 * com os campos que todo portal de CRA pede, e o parser de retorno aceita CSV com
 * cabeçalho, casando as colunas por nome. Quando um convênio for assinado, o layout XML
 * daquele CRA entra como um novo gerador ao lado deste, pelo mesmo contrato
 * (`LinhaRemessaProtesto` → arquivo; arquivo → `LinhaRetornoProtesto[]`).
 */

export interface LinhaRemessaProtesto {
  /** id em `protesto_titulos` — volta no retorno e é como casamos a linha. */
  protesto_titulo_id: string
  numero_titulo: string
  especie: 'DMI' | 'DSI' | 'CBI' | 'OUTRO'
  nf_chave_acesso: string | null
  emissao: string | null
  vencimento: string
  valor: number
  saldo: number
  devedor_nome: string
  devedor_cnpj: string
  devedor_endereco: string
  devedor_cep: string | null
  devedor_municipio: string | null
  devedor_uf: string
  sacador_nome: string
  sacador_cnpj: string
  cedente_nome: string
  cedente_cnpj: string
}

const COLUNAS_REMESSA: [keyof LinhaRemessaProtesto, string][] = [
  ['protesto_titulo_id', 'id_interno'],
  ['numero_titulo', 'numero_titulo'],
  ['especie', 'especie'],
  ['nf_chave_acesso', 'chave_nfe'],
  ['emissao', 'data_emissao'],
  ['vencimento', 'data_vencimento'],
  ['valor', 'valor_titulo'],
  ['saldo', 'saldo_titulo'],
  ['devedor_nome', 'devedor_nome'],
  ['devedor_cnpj', 'devedor_documento'],
  ['devedor_endereco', 'devedor_endereco'],
  ['devedor_cep', 'devedor_cep'],
  ['devedor_municipio', 'devedor_cidade'],
  ['devedor_uf', 'devedor_uf'],
  ['sacador_nome', 'apresentante_nome'],
  ['sacador_cnpj', 'apresentante_documento'],
  ['cedente_nome', 'cedente_nome'],
  ['cedente_cnpj', 'cedente_documento'],
]

function celula(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return v.toFixed(2).replace('.', ',')
  const s = String(v)
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function gerarRemessaProtestoCsv(linhas: readonly LinhaRemessaProtesto[]): string {
  const out = [COLUNAS_REMESSA.map(([, c]) => c).join(';')]
  for (const l of linhas) out.push(COLUNAS_REMESSA.map(([k]) => celula(l[k])).join(';'))
  return `﻿${out.join('\r\n')}\r\n`
}

export interface LinhaRetornoProtesto {
  protesto_titulo_id: string
  situacao: ProtestoSituacao
  cartorio?: string
  protocolo_cartorio?: string
  data_protesto?: string
  custas?: number
  motivo_rejeicao?: string
}

export interface ResultadoRetornoProtesto {
  linhas: LinhaRetornoProtesto[]
  ignoradas: { linha: number; motivo: string }[]
}

/** Vocabulário dos retornos → nossas situações. Casamento por palavra, sem acento. */
const SITUACOES: [RegExp, ProtestoSituacao][] = [
  [/pago|liquidad/, 'pago_em_cartorio'],
  [/retirad|desist|cancelad/, 'retirado'],
  [/sustad|sustac/, 'sustado'],
  [/rejeit|devolvid|irregular|recusad/, 'rejeitado'],
  [/protestad|lavrad/, 'protestado'],
  [/apontad|protocolad|intimad/, 'apontado'],
]

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

function dividirCsv(linha: string, sep: string): string[] {
  const out: string[] = []
  let atual = ''
  let aspas = false
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i]!
    if (ch === '"') {
      if (aspas && linha[i + 1] === '"') {
        atual += '"'
        i++
      } else aspas = !aspas
    } else if (ch === sep && !aspas) {
      out.push(atual)
      atual = ''
    } else atual += ch
  }
  out.push(atual)
  return out.map((c) => c.trim())
}

function dataIso(v: string): string | undefined {
  const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined
}

function numero(v: string): number | undefined {
  if (!v) return undefined
  const n = Number(v.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : undefined
}

/**
 * Lê o arquivo de retorno do CRA. Aceita `;` ou `,`, com ou sem BOM. As colunas são
 * achadas pelo nome (há variação entre portais): `id_interno` é a que casa a linha com
 * a nossa remessa; sem ela, a linha é ignorada e reportada — nunca atribuída "ao mais
 * parecido".
 */
export function lerRetornoProtesto(texto: string, idsDaRemessa: ReadonlySet<string>): ResultadoRetornoProtesto {
  const linhasArq = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim().length > 0)
  const resultado: ResultadoRetornoProtesto = { linhas: [], ignoradas: [] }
  if (linhasArq.length < 2) return resultado

  const sep = linhasArq[0]!.split(';').length >= linhasArq[0]!.split(',').length ? ';' : ','
  const cab = dividirCsv(linhasArq[0]!, sep).map(semAcento)
  const col = (...nomes: string[]) => cab.findIndex((c) => nomes.some((n) => c === n || c.includes(n)))
  const iId = col('id_interno', 'seu_numero', 'nosso_numero')
  const iSit = col('situacao', 'status', 'ocorrencia')
  const iCart = col('cartorio')
  const iProt = col('protocolo')
  const iData = col('data_protesto', 'data_ocorrencia', 'data')
  const iCustas = col('custas', 'emolumentos')
  const iMotivo = col('motivo', 'observacao')

  if (iId < 0 || iSit < 0) {
    resultado.ignoradas.push({ linha: 1, motivo: 'Cabeçalho sem as colunas de identificação (id_interno) e situação.' })
    return resultado
  }

  linhasArq.slice(1).forEach((bruta, idx) => {
    const c = dividirCsv(bruta, sep)
    const id = c[iId] ?? ''
    if (!idsDaRemessa.has(id)) {
      resultado.ignoradas.push({ linha: idx + 2, motivo: `Título ${id || '(vazio)'} não pertence a esta remessa.` })
      return
    }
    const sitTexto = semAcento(c[iSit] ?? '')
    const situacao = SITUACOES.find(([re]) => re.test(sitTexto))?.[1]
    if (!situacao) {
      resultado.ignoradas.push({ linha: idx + 2, motivo: `Situação não reconhecida: "${c[iSit] ?? ''}".` })
      return
    }
    const l: LinhaRetornoProtesto = { protesto_titulo_id: id, situacao }
    if (iCart >= 0 && c[iCart]) l.cartorio = c[iCart]
    if (iProt >= 0 && c[iProt]) l.protocolo_cartorio = c[iProt]
    const data = iData >= 0 ? dataIso(c[iData] ?? '') : undefined
    if (data) l.data_protesto = data
    const custas = iCustas >= 0 ? numero(c[iCustas] ?? '') : undefined
    if (custas !== undefined) l.custas = custas
    if (iMotivo >= 0 && c[iMotivo]) l.motivo_rejeicao = c[iMotivo]
    resultado.linhas.push(l)
  })

  return resultado
}
