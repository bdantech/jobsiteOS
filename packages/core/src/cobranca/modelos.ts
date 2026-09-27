import type { EnderecoDestinatario, TipoModeloCobranca } from './schemas.js'

/**
 * Modelos de notificação e de confissão de dívida (Prompt 07 §5 e §9.3).
 *
 * ── PLACEHOLDER DESCONHECIDO É ERRO ─────────────────────────────────────────
 * Na gravação (e a RPC confere de novo) e na renderização. `{{valr_total}}` renderizado
 * como string vazia vira uma carta com um buraco no lugar do valor — que ninguém pode
 * assinar e que o devedor usa para contestar. O mesmo vale para placeholder CONHECIDO
 * sem valor (ex.: `{{dados_pagamento}}` sem os dados do credor cadastrados): a
 * renderização recusa e diz o que falta.
 */

export const PLACEHOLDERS_COBRANCA_BASE = [
  'destinatario.razao_social',
  'destinatario.cnpj',
  'destinatario.endereco',
  'credor.razao_social',
  'credor.cnpj',
  'tabela_titulos',
  'valor_total_face',
  'valor_total_atualizado',
  'data_base',
  'prazo_dias',
  'prazo_data',
  'dados_pagamento',
  'cobranca.codigo',
  'data_hoje',
  'memoria_calculo',
  'rodada',
] as const

export const PLACEHOLDERS_CONFISSAO = [
  'tabela_parcelas',
  'valor_confessado',
  'avalistas',
  'bem_garantia',
  'foro',
  'testemunhas',
] as const

export const PLACEHOLDER_DESCRICOES: Record<string, string> = {
  'destinatario.razao_social': 'Razão social de quem recebe',
  'destinatario.cnpj': 'CNPJ de quem recebe',
  'destinatario.endereco': 'Endereço (cadastral da Receita, editável)',
  'credor.razao_social': 'Nossa razão social (cessionária)',
  'credor.cnpj': 'Nosso CNPJ',
  tabela_titulos: 'Tabela dos títulos desta notificação',
  valor_total_face: 'Soma do valor de face',
  valor_total_atualizado: 'Total atualizado (com honorários)',
  data_base: 'Data-base da atualização',
  prazo_dias: 'Prazo para pagamento (ex.: "5 dias úteis")',
  prazo_data: 'Data-limite do pagamento',
  dados_pagamento: 'Meios de pagamento (settings → credor)',
  'cobranca.codigo': 'Código da cobrança (COB-2026-0001)',
  data_hoje: 'Data de emissão',
  memoria_calculo: 'Memória de cálculo linha a linha',
  rodada: 'Número da rodada (reiterações)',
  tabela_parcelas: 'Cronograma do acordo',
  valor_confessado: 'Valor confessado',
  avalistas: 'Qualificação dos avalistas',
  bem_garantia: 'Descrição do bem em garantia',
  foro: 'Foro eleito',
  testemunhas: 'Testemunhas',
}

export function placeholdersValidos(tipo: TipoModeloCobranca): readonly string[] {
  return tipo.startsWith('confissao_divida_')
    ? [...PLACEHOLDERS_COBRANCA_BASE, ...PLACEHOLDERS_CONFISSAO]
    : PLACEHOLDERS_COBRANCA_BASE
}

const RE_PLACEHOLDER = /\{\{\s*([^}\s]+)\s*\}\}/g

export function placeholdersDoTexto(corpo: string): string[] {
  return [...new Set([...corpo.matchAll(RE_PLACEHOLDER)].map((m) => m[1]!))]
}

export function validarModeloCobranca(tipo: TipoModeloCobranca, corpo: string): { desconhecidos: string[] } {
  const validos = new Set(placeholdersValidos(tipo))
  return { desconhecidos: placeholdersDoTexto(corpo).filter((p) => !validos.has(p)) }
}

export class ErroModeloCobranca extends Error {
  readonly codigo: 'placeholder_desconhecido' | 'valor_ausente'
  readonly placeholders: string[]

  constructor(codigo: ErroModeloCobranca['codigo'], placeholders: string[]) {
    super(
      codigo === 'placeholder_desconhecido'
        ? `Placeholder desconhecido no modelo: ${placeholders.join(', ')}.`
        : `Falta preencher para gerar o documento: ${placeholders.map((p) => PLACEHOLDER_DESCRICOES[p] ?? p).join('; ')}.`,
    )
    this.name = 'ErroModeloCobranca'
    this.codigo = codigo
    this.placeholders = placeholders
  }
}

// ─── Formatação ─────────────────────────────────────────────────────────────

export const formatarBrl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
export const formatarDataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
export function formatarCnpjCobranca(cnpj: string): string {
  const d = cnpj.replace(/\D/g, '')
  if (d.length !== 14) return cnpj
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

export function formatarEndereco(e: EnderecoDestinatario | null | undefined): string | null {
  if (!e) return null
  const rua = [e.logradouro, e.numero].filter(Boolean).join(', ')
  const partes = [rua, e.complemento, e.bairro, [e.municipio, e.uf].filter(Boolean).join('/'), e.cep ? `CEP ${e.cep}` : null]
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0)
  return partes.length ? partes.join(' — ') : null
}

// ─── A tabela de títulos (§5) ───────────────────────────────────────────────

export interface LinhaTituloNotificacao {
  numero: string | null
  nf: string | null
  cedente: string
  /** Razão social/CNPJ da SPE devedora; só aparece na carta da matriz. */
  spe_devedora: string
  emissao: string | null
  vencimento: string
  dias_atraso: number
  valor_face: number
  valor_atualizado: number | null
}

/**
 * A carta da matriz mostra a coluna "SPE devedora" (ela responde pelo grupo e precisa
 * saber de quem é cada título); a da SPE não mostra — lá a devedora é a própria.
 */
export function tabelaTitulosMarkdown(linhas: readonly LinhaTituloNotificacao[], mostrarSpe: boolean): string {
  const cab = ['Título', 'NF', 'Cedente', ...(mostrarSpe ? ['SPE devedora'] : []), 'Emissão', 'Vencimento', 'Dias de atraso', 'Valor de face', 'Valor atualizado']
  const alin = ['---', '---', '---', ...(mostrarSpe ? ['---'] : []), '---', '---', '---:', '---:', '---:']
  const out = [`| ${cab.join(' | ')} |`, `|${alin.join('|')}|`]
  for (const l of linhas) {
    const cel = [
      l.numero ?? '—',
      l.nf ?? '—',
      l.cedente,
      ...(mostrarSpe ? [l.spe_devedora] : []),
      l.emissao ? formatarDataBr(l.emissao) : '—',
      formatarDataBr(l.vencimento),
      String(l.dias_atraso),
      formatarBrl(l.valor_face),
      l.valor_atualizado === null ? '—' : formatarBrl(l.valor_atualizado),
    ]
    out.push(`| ${cel.map((c) => c.replace(/\|/g, '/')).join(' | ')} |`)
  }
  return out.join('\n')
}

// ─── Renderização ───────────────────────────────────────────────────────────

export type ValoresModeloCobranca = Partial<Record<string, string | null>>

export function renderizarModeloCobranca(
  tipo: TipoModeloCobranca,
  corpo: string,
  valores: ValoresModeloCobranca,
): string {
  const { desconhecidos } = validarModeloCobranca(tipo, corpo)
  if (desconhecidos.length) throw new ErroModeloCobranca('placeholder_desconhecido', desconhecidos)

  const ausentes = placeholdersDoTexto(corpo).filter((p) => {
    const v = valores[p]
    return v === undefined || v === null || v.trim() === ''
  })
  if (ausentes.length) throw new ErroModeloCobranca('valor_ausente', ausentes)

  return corpo.replace(RE_PLACEHOLDER, (_, nome: string) => valores[nome]!)
}

export interface ContextoNotificacao {
  destinatario: { razao_social: string; cnpj: string; endereco: EnderecoDestinatario | null }
  credor: { razao_social: string; cnpj: string; dados_pagamento: string | null }
  codigo: string
  rodada: number
  titulos: readonly LinhaTituloNotificacao[]
  mostrar_spe: boolean
  valor_total_face: number
  valor_total_atualizado: number | null
  data_base: string
  prazo_dias: number
  prazo_uteis: boolean
  prazo_data: string | null
  data_hoje: string
  memoria_calculo: string | null
  confissao?: {
    tabela_parcelas: string
    valor_confessado: number
    avalistas?: string | null
    bem_garantia?: string | null
    foro?: string | null
    testemunhas?: string | null
  }
}

/** Monta o mapa de placeholders a partir do contexto. O que não se sabe fica `null`. */
export function valoresDoContexto(ctx: ContextoNotificacao): ValoresModeloCobranca {
  const v: ValoresModeloCobranca = {
    'destinatario.razao_social': ctx.destinatario.razao_social,
    'destinatario.cnpj': formatarCnpjCobranca(ctx.destinatario.cnpj),
    'destinatario.endereco': formatarEndereco(ctx.destinatario.endereco),
    'credor.razao_social': ctx.credor.razao_social,
    'credor.cnpj': formatarCnpjCobranca(ctx.credor.cnpj),
    tabela_titulos: tabelaTitulosMarkdown(ctx.titulos, ctx.mostrar_spe),
    valor_total_face: formatarBrl(ctx.valor_total_face),
    valor_total_atualizado: ctx.valor_total_atualizado === null ? null : formatarBrl(ctx.valor_total_atualizado),
    data_base: formatarDataBr(ctx.data_base),
    prazo_dias: `${ctx.prazo_dias} ${ctx.prazo_uteis ? 'dias úteis' : 'dias'}`,
    prazo_data: ctx.prazo_data ? formatarDataBr(ctx.prazo_data) : null,
    dados_pagamento: ctx.credor.dados_pagamento,
    'cobranca.codigo': ctx.codigo,
    data_hoje: formatarDataBr(ctx.data_hoje),
    memoria_calculo: ctx.memoria_calculo,
    rodada: String(ctx.rodada),
  }
  if (ctx.confissao) {
    v.tabela_parcelas = ctx.confissao.tabela_parcelas
    v.valor_confessado = formatarBrl(ctx.confissao.valor_confessado)
    v.avalistas = ctx.confissao.avalistas ?? null
    v.bem_garantia = ctx.confissao.bem_garantia ?? null
    v.foro = ctx.confissao.foro ?? null
    v.testemunhas = ctx.confissao.testemunhas ?? null
  }
  return v
}

/** Dados de exemplo para a pré-visualização na tela de modelos (§13). */
export function contextoDeExemplo(): ContextoNotificacao {
  return {
    destinatario: {
      razao_social: 'CONSTRUTORA EXEMPLO S.A.',
      cnpj: '11222333000181',
      endereco: { logradouro: 'Av. Paulista', numero: '1000', bairro: 'Bela Vista', municipio: 'São Paulo', uf: 'SP', cep: '01310-100' },
    },
    credor: { razao_social: 'CONSTRUCREDIT SECURITIZADORA S/A', cnpj: '43738268000138', dados_pagamento: 'PIX (CNPJ): 43.738.268/0001-38' },
    codigo: 'COB-2026-0001',
    rodada: 1,
    titulos: [
      {
        numero: '1234',
        nf: '35260911222333000181550010000012341000012345',
        cedente: 'FORNECEDOR EXEMPLO LTDA',
        spe_devedora: 'SPE EXEMPLO 1 LTDA',
        emissao: '2026-06-01',
        vencimento: '2026-07-10',
        dias_atraso: 78,
        valor_face: 48_500,
        valor_atualizado: 50_210.33,
      },
    ],
    mostrar_spe: true,
    valor_total_face: 48_500,
    valor_total_atualizado: 55_231.36,
    data_base: '2026-09-26',
    prazo_dias: 5,
    prazo_uteis: true,
    prazo_data: '2026-10-05',
    data_hoje: '2026-09-26',
    memoria_calculo: 'Principal R$ 48.500,00 + correção + juros + multa + honorários = R$ 55.231,36',
    confissao: {
      tabela_parcelas: '| Parcela | Vencimento | Valor |\n|---|---|---:|\n| 1/3 | 10/10/2026 | R$ 18.410,45 |',
      valor_confessado: 55_231.36,
      avalistas: 'FULANO DE TAL, CPF 123.456.789-09, casado, residente na Rua Exemplo, 10 — São Paulo/SP',
      bem_garantia: 'Imóvel matrícula nº 12.345 do 1º Registro de Imóveis de São Paulo/SP',
      foro: 'São Paulo/SP',
      testemunhas: '1. ______________________ CPF ___________\n\n2. ______________________ CPF ___________',
    },
  }
}
