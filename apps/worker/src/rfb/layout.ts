/**
 * The Receita's layout, and the translations it needs.
 *
 * The dump ships codes, not values: situação cadastral is "02", porte is "01",
 * dates are "20180131", capital is "1500000,00", município is a 4-digit RFB code
 * (not IBGE), and the CNPJ is split across three columns. Everything the rest of
 * the worker sees has already been through here.
 */

// ─── Colunas, por arquivo (sem cabeçalho: a posição É o contrato) ───────────

export const EMPRESAS = {
  cnpj_basico: 0,
  razao_social: 1,
  natureza_juridica: 2,
  qualificacao_responsavel: 3,
  capital_social: 4,
  porte: 5,
  ente_federativo: 6,
} as const

export const ESTABELECIMENTOS = {
  cnpj_basico: 0,
  cnpj_ordem: 1,
  cnpj_dv: 2,
  matriz_filial: 3,
  nome_fantasia: 4,
  situacao_cadastral: 5,
  data_situacao: 6,
  motivo_situacao: 7,
  cidade_exterior: 8,
  pais: 9,
  data_inicio_atividade: 10,
  cnae_principal: 11,
  cnaes_secundarios: 12,
  tipo_logradouro: 13,
  logradouro: 14,
  numero: 15,
  complemento: 16,
  bairro: 17,
  cep: 18,
  uf: 19,
  municipio: 20,
  ddd1: 21,
  telefone1: 22,
  ddd2: 23,
  telefone2: 24,
  ddd_fax: 25,
  fax: 26,
  email: 27,
  situacao_especial: 28,
  data_situacao_especial: 29,
} as const

export const SOCIOS = {
  cnpj_basico: 0,
  identificador: 1, // 1 = PJ, 2 = PF, 3 = estrangeiro
  nome_socio: 2,
  cpf_cnpj_socio: 3,
  qualificacao: 4,
  data_entrada: 5,
  pais: 6,
  representante_legal: 7,
  nome_representante: 8,
  qualificacao_representante: 9,
  faixa_etaria: 10,
} as const

export const SIMPLES = {
  cnpj_basico: 0,
  opcao_simples: 1,
  data_opcao_simples: 2,
  data_exclusao_simples: 3,
  opcao_mei: 4,
  data_opcao_mei: 5,
  data_exclusao_mei: 6,
} as const

/** Domain tables (Municipios.zip, Naturezas.zip): código;descrição. */
export const DOMINIO = { codigo: 0, descricao: 1 } as const

// ─── Traduções ──────────────────────────────────────────────────────────────

const SITUACOES: Record<string, string> = {
  '01': 'nula',
  '02': 'ativa',
  '03': 'suspensa',
  '04': 'inapta',
  '08': 'baixada',
}

const PORTES: Record<string, string> = {
  '01': 'ME',
  '03': 'EPP',
  '05': 'DEMAIS',
}

export function situacaoCadastral(codigo: string | undefined): string | null {
  return SITUACOES[(codigo ?? '').trim()] ?? null
}

export function porte(codigo: string | undefined): string | null {
  return PORTES[(codigo ?? '').trim()] ?? null
}

export function matrizOuFilial(codigo: string | undefined): string | null {
  const c = (codigo ?? '').trim()
  if (c === '1') return 'matriz'
  if (c === '2') return 'filial'
  return null
}

export function tipoSocio(codigo: string | undefined): string | null {
  const c = (codigo ?? '').trim()
  if (c === '1') return 'PJ'
  if (c === '2') return 'PF'
  if (c === '3') return 'estrangeiro'
  return null
}

export function texto(v: string | undefined): string | null {
  const s = (v ?? '').trim()
  return s.length > 0 ? s : null
}

/**
 * "20180131" → "2018-01-31". "0" / "00000000" / garbage → null.
 *
 * Also accepts DD/MM/YYYY and YYYY-MM-DD, because the CNO dump and its mirrors do
 * not agree on a format and a date parsed as `null` is far better than one parsed
 * as the wrong day.
 */
export function data(v: string | undefined): string | null {
  const s = (v ?? '').trim()
  if (s.length === 0) return null

  let ano: string
  let mes: string
  let dia: string

  if (/^\d{8}$/.test(s)) {
    ano = s.slice(0, 4)
    mes = s.slice(4, 6)
    dia = s.slice(6, 8)
  } else if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    ano = s.slice(0, 4)
    mes = s.slice(5, 7)
    dia = s.slice(8, 10)
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    dia = s.slice(0, 2)
    mes = s.slice(3, 5)
    ano = s.slice(6, 10)
  } else {
    return null
  }

  if (ano === '0000' || mes === '00' || dia === '00') return null
  if (Number(mes) > 12 || Number(dia) > 31) return null
  return `${ano}-${mes}-${dia}`
}

/** "1500000,00" → 1500000. The RFB uses a comma decimal separator, no thousands. */
export function numero(v: string | undefined): number | null {
  const s = (v ?? '').trim().replace(/\./g, '').replace(',', '.')
  if (s.length === 0) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * "49.97" → 49.97. The CNO dump uses a DOT decimal, not the CNPJ dump's comma — so
 * numero() (which strips dots as thousands) would turn 49.97 m² into 4997. No
 * thousands separator here; a stray comma is tolerated as a decimal just in case.
 */
export function numeroPonto(v: string | undefined): number | null {
  const s = (v ?? '').trim().replace(',', '.')
  if (s.length === 0) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** "S" → true, "N" → false, "" → null. */
export function sim(v: string | undefined): boolean | null {
  const s = (v ?? '').trim().toUpperCase()
  if (s === 'S') return true
  if (s === 'N') return false
  return null
}

/**
 * The CNPJ, reassembled and normalized: básico(8) + ordem(4) + dv(2), zero-padded
 * to exactly 14 characters of TEXT. Never a number — 00.000.000/0001-91 becomes
 * 191 the instant anyone casts it, and then it silently stops joining to anything.
 */
export function montarCnpj(
  basico: string | undefined,
  ordem: string | undefined,
  dv: string | undefined,
): string | null {
  const b = (basico ?? '').replace(/\D/g, '').padStart(8, '0')
  const o = (ordem ?? '').replace(/\D/g, '').padStart(4, '0')
  const d = (dv ?? '').replace(/\D/g, '').padStart(2, '0')
  const cnpj = `${b}${o}${d}`
  return /^\d{14}$/.test(cnpj) ? cnpj : null
}

export function raizDe(cnpjOuBasico: string | undefined): string | null {
  const digitos = (cnpjOuBasico ?? '').replace(/\D/g, '')
  if (digitos.length < 8) return null
  return digitos.slice(0, 8)
}

/** "4110700,4120400" → ["4110700","4120400"]. Kept as a joined string for COPY. */
export function listaCnaes(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => /^\d{5,7}$/.test(c))
}

/** As divisões de 2 dígitos de todos os CNAEs da linha. */
export function divisoesCnae(principal: string | undefined, secundarios: string | undefined): string[] {
  const todos = [...listaCnaes(principal), ...listaCnaes(secundarios)]
  return [...new Set(todos.map((c) => c.slice(0, 2)))]
}

/** O recorte da construção: 41 (edifícios), 42 (infraestrutura), 43 (especializados). */
export const DIVISOES_CONSTRUCAO = new Set(['41', '42', '43'])

/**
 * O recorte é pelo CNAE PRINCIPAL, não pelos secundários.
 *
 * Incluir secundários trazia 6,4 milhões de estabelecimentos — 3x mais — porque milhões
 * de empresas listam alguma atividade de construção como secundária sem serem do setor
 * (imobiliárias, holdings, comércio que também faz obra). Para mapear quem vender ERP,
 * quem interessa é quem TEM a construção como atividade principal (~1,5-2 mi). Os
 * secundários continuam armazenados na coluna, só não definem mais quem entra.
 */
export function noRecorteConstrucao(principal: string | undefined): boolean {
  const [c] = listaCnaes(principal)
  return c !== undefined && DIVISOES_CONSTRUCAO.has(c.slice(0, 2))
}

/**
 * Situação cadastral ATIVA — código '02' na Receita.
 *
 * O recorte só entra com empresa ativa: um CNPJ baixado, inapto ou suspenso não é
 * cliente de ERP, e incluí-los inflava o staging (dos 4,28 mi por CNAE principal, boa
 * parte é CNPJ morto). Filtrar aqui, na passada 1, reduz o pico de disco na origem.
 */
export function situacaoAtiva(codigo: string | undefined): boolean {
  return texto(codigo) === '02'
}
