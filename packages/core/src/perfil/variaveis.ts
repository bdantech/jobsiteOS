import type { Condicao } from '../mercado/filters.js'
import { categoriaNaturezaJuridica, CATEGORIA_NJ_LABELS } from './natureza-juridica.js'
import type { Trilha } from './schemas.js'

/**
 * O catálogo do Perfil (04f §3): o que é contrastado, como o valor cru vira uma
 * CATEGORIA legível, e — quando existe — por qual condição de regra essa
 * categoria pode ser expressa.
 *
 * Três decisões que este arquivo carrega:
 *
 * 1. TUDO VIRA CATEGORIA, inclusive número. Comparar médias de capital social
 *    entre 34 e 8 empresas é convidar um outlier a escrever a conclusão. Faixas
 *    são estáveis, são legíveis ("5 a 15 anos") e são o que a regra vai usar de
 *    qualquer forma.
 *
 * 2. A ORDEM DAS FAIXAS É DECLARADA, não inferida. Sem `chaves`, a barra
 *    ordenaria "10+" antes de "3–5" por acidente de amostragem.
 *
 * 3. `regra` é o que torna o um-clique possível. Uma variável sem `regra` pode
 *    virar achado, mas nunca vira sugestão: não há como expressá-la como termo
 *    de uma regra de camada ou de faixa, e um card com botão que não leva a lugar
 *    nenhum é pior que um card sem botão.
 */

/** A linha achatada que o worker monta. Valores crus, sem categorização. */
export type LinhaPerfil = Readonly<Record<string, unknown>>

export interface VariavelPerfil {
  id: string
  label: string
  /** Ordem e vocabulário das categorias. Ausente ⇒ categorias descobertas e ordenadas por nome. */
  chaves?: readonly string[]
  /** Valor cru → categoria. `null` = sem dado (sai do numerador E do denominador). */
  categorizar: (linha: LinhaPerfil) => string | null
  /** Só nas variáveis que existem como termo de regra. Sem isso, não vira sugestão. */
  regra?: {
    /** Id no catálogo do engine correspondente (mercado ou faixas). */
    variavel: string
    /** Categoria → condição que a captura. `null` quando a categoria não é expressável. */
    condicaoDe: (categoria: string) => Condicao | null
  }
  /** `ambas` aparece nas duas trilhas; `fornecedores` só na de NFs. */
  trilha: 'ambas' | Trilha
}

// ─── Auxiliares de faixa ────────────────────────────────────────────────────

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function bool(v: unknown): boolean | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return v
  if (v === 'true' || v === 't') return true
  if (v === 'false' || v === 'f') return false
  return null
}

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

export interface FaixaNumerica {
  chave: string
  /** Limite inferior, inclusivo. */
  de: number
  /** Limite superior, exclusivo. `null` = sem teto. */
  ate: number | null
}

/**
 * Faixas com limite inferior INCLUSIVO e superior EXCLUSIVO, sempre.
 *
 * Não é preciosismo: `capital_social >= 500000` é literalmente uma condição da
 * regra de SAM hoje, e uma faixa que dissesse "500 mil a 2 mi" incluindo o teto
 * produziria uma sugestão que erra por um centavo na fronteira que mais importa.
 */
function emFaixa(valor: number, faixas: readonly FaixaNumerica[]): string | null {
  for (const f of faixas) {
    if (valor >= f.de && (f.ate === null || valor < f.ate)) return f.chave
  }
  return null
}

function porFaixa(campo: string, faixas: readonly FaixaNumerica[]) {
  return (linha: LinhaPerfil): string | null => {
    const v = num(linha[campo])
    return v === null ? null : emFaixa(v, faixas)
  }
}

/** `>= piso da faixa` — o jeito de uma faixa virar um termo de regra numérico. */
function condicaoPisoDaFaixa(variavel: string, faixas: readonly FaixaNumerica[]) {
  return (categoria: string): Condicao | null => {
    const f = faixas.find((x) => x.chave === categoria)
    if (!f) return null
    return { variavel, operador: 'maior_ou_igual', valor: f.de }
  }
}

const chavesDe = (faixas: readonly FaixaNumerica[]): readonly string[] => faixas.map((f) => f.chave)

// ─── As faixas ──────────────────────────────────────────────────────────────
// Os cortes espelham os que as REGRAS já usam (idade ≥ 3, capital ≥ 500k e ≥ 2M).
// Um perfil cujas faixas não conversam com a régua vigente produz achados que não
// se traduzem em ajuste nenhum.

const FAIXAS_IDADE: readonly FaixaNumerica[] = [
  { chave: 'menos de 3 anos', de: 0, ate: 3 },
  { chave: '3 a 5 anos', de: 3, ate: 5 },
  { chave: '5 a 15 anos', de: 5, ate: 15 },
  { chave: '15 anos ou mais', de: 15, ate: null },
]

const FAIXAS_CAPITAL: readonly FaixaNumerica[] = [
  { chave: 'até 100 mil', de: 0, ate: 100_000 },
  { chave: '100 a 500 mil', de: 100_000, ate: 500_000 },
  { chave: '500 mil a 2 mi', de: 500_000, ate: 2_000_000 },
  { chave: '2 mi ou mais', de: 2_000_000, ate: null },
]

const FAIXAS_FUNCIONARIOS: readonly FaixaNumerica[] = [
  { chave: 'até 10', de: 0, ate: 11 },
  { chave: '11 a 50', de: 11, ate: 51 },
  { chave: '51 a 200', de: 51, ate: 201 },
  { chave: 'mais de 200', de: 201, ate: null },
]

const FAIXAS_FATURAMENTO: readonly FaixaNumerica[] = [
  { chave: 'até 5 mi', de: 0, ate: 5_000_000 },
  { chave: '5 a 30 mi', de: 5_000_000, ate: 30_000_000 },
  { chave: '30 a 100 mi', de: 30_000_000, ate: 100_000_000 },
  { chave: 'mais de 100 mi', de: 100_000_000, ate: null },
]

const FAIXAS_MRR: readonly FaixaNumerica[] = [
  { chave: 'até R$ 1 mil', de: 0, ate: 1_000 },
  { chave: 'R$ 1 a 5 mil', de: 1_000, ate: 5_000 },
  { chave: 'mais de R$ 5 mil', de: 5_000, ate: null },
]

const FAIXAS_USUARIOS_ERP: readonly FaixaNumerica[] = [
  { chave: 'até 5', de: 0, ate: 6 },
  { chave: '6 a 20', de: 6, ate: 21 },
  { chave: 'mais de 20', de: 21, ate: null },
]

const FAIXAS_CONTAGEM: readonly FaixaNumerica[] = [
  { chave: 'nenhuma', de: 0, ate: 1 },
  { chave: '1 a 2', de: 1, ate: 3 },
  { chave: '3 ou mais', de: 3, ate: null },
]

const FAIXAS_M2: readonly FaixaNumerica[] = [
  { chave: 'até 5 mil m²', de: 0, ate: 5_000 },
  { chave: '5 a 30 mil m²', de: 5_000, ate: 30_000 },
  { chave: 'mais de 30 mil m²', de: 30_000, ate: null },
]

const FAIXAS_SCORE: readonly FaixaNumerica[] = [
  { chave: 'abaixo de 40', de: 0, ate: 40 },
  { chave: '40 a 65', de: 40, ate: 65 },
  { chave: '65 ou mais', de: 65, ate: null },
]

const FAIXAS_VALOR_NF: readonly FaixaNumerica[] = [
  { chave: 'até R$ 10 mil', de: 0, ate: 10_000 },
  { chave: 'R$ 10 a 50 mil', de: 10_000, ate: 50_000 },
  { chave: 'R$ 50 a 200 mil', de: 50_000, ate: 200_000 },
  { chave: 'mais de R$ 200 mil', de: 200_000, ate: null },
]

const FAIXAS_PRAZO_NF: readonly FaixaNumerica[] = [
  { chave: 'menos de 15 dias', de: -3_650, ate: 15 },
  { chave: '15 a 30 dias', de: 15, ate: 30 },
  { chave: '30 a 60 dias', de: 30, ate: 60 },
  { chave: '60 dias ou mais', de: 60, ate: null },
]

const FAIXAS_RECEITA_NF: readonly FaixaNumerica[] = [
  { chave: 'até R$ 300', de: 0, ate: 300 },
  { chave: 'R$ 300 a 1 mil', de: 300, ate: 1_000 },
  { chave: 'mais de R$ 1 mil', de: 1_000, ate: null },
]

const FAIXAS_CRESCIMENTO: readonly FaixaNumerica[] = [
  { chave: 'encolheu', de: -100, ate: 0 },
  { chave: 'estável', de: 0, ate: 0.1 },
  { chave: 'cresceu até 30%', de: 0.1, ate: 0.3 },
  { chave: 'cresceu mais de 30%', de: 0.3, ate: null },
]

/**
 * Protesto RELATIVIZADO pelo capital social, e não em reais (§3).
 *
 * R$ 80 mil protestados numa empresa de R$ 100 mil de capital e numa de R$ 50
 * milhões são fatos completamente diferentes, e a versão absoluta os trata como
 * iguais. Sem capital não há razão — e a variável fica sem dado, o que é honesto.
 */
const FAIXAS_PROTESTO_RATIO: readonly FaixaNumerica[] = [
  { chave: 'até 5% do capital', de: 0, ate: 0.05 },
  { chave: '5% a 25%', de: 0.05, ate: 0.25 },
  { chave: 'mais de 25%', de: 0.25, ate: null },
]

const SIM_NAO = ['sim', 'não'] as const

function simNao(campo: string) {
  return (linha: LinhaPerfil): string | null => {
    const b = bool(linha[campo])
    return b === null ? null : b ? 'sim' : 'não'
  }
}

function condicaoBooleana(variavel: string) {
  return (categoria: string): Condicao | null =>
    categoria === 'sim' || categoria === 'não'
      ? { variavel, operador: 'igual', valor: categoria === 'sim' }
      : null
}

// ─── Variáveis de empresa (as duas trilhas) ─────────────────────────────────

const VARIAVEIS_EMPRESA: readonly VariavelPerfil[] = [
  {
    id: 'uf',
    label: 'UF',
    trilha: 'ambas',
    categorizar: (l) => texto(l.uf)?.toUpperCase() ?? null,
    regra: { variavel: 'uf', condicaoDe: (c) => ({ variavel: 'uf', operador: 'em', valor: [c] }) },
  },
  {
    id: 'municipio',
    label: 'Município',
    trilha: 'ambas',
    categorizar: (l) => texto(l.municipio),
    regra: {
      variavel: 'municipio',
      condicaoDe: (c) => ({ variavel: 'municipio', operador: 'em', valor: [c] }),
    },
  },
  {
    id: 'tipo',
    label: 'Tipo',
    trilha: 'ambas',
    chaves: ['construtora', 'incorporadora', 'fornecedor', 'subempreiteiro'],
    categorizar: (l) => texto(l.tipo),
    regra: { variavel: 'tipo', condicaoDe: (c) => ({ variavel: 'tipo', operador: 'em', valor: [c] }) },
  },
  {
    id: 'natureza_juridica_categoria',
    label: 'Natureza jurídica',
    trilha: 'ambas',
    chaves: Object.values(CATEGORIA_NJ_LABELS),
    categorizar: (l) => {
      const c = categoriaNaturezaJuridica(texto(l.natureza_juridica))
      return c ? CATEGORIA_NJ_LABELS[c] : null
    },
    // Sem `regra`: a categoria agrupa vários códigos, e o catálogo de filtros só
    // oferece o texto cru da Receita. Vira achado, nunca sugestão — melhor que
    // uma condição `contém "Limitada"` que casaria coisa errada.
  },
  {
    id: 'idade_anos',
    label: 'Idade da empresa',
    trilha: 'ambas',
    chaves: chavesDe(FAIXAS_IDADE),
    categorizar: porFaixa('idade_anos', FAIXAS_IDADE),
    regra: { variavel: 'idade_anos', condicaoDe: condicaoPisoDaFaixa('idade_anos', FAIXAS_IDADE) },
  },
  {
    id: 'capital_social',
    label: 'Capital social',
    trilha: 'ambas',
    chaves: chavesDe(FAIXAS_CAPITAL),
    categorizar: porFaixa('capital_social', FAIXAS_CAPITAL),
    regra: {
      variavel: 'capital_social',
      condicaoDe: condicaoPisoDaFaixa('capital_social', FAIXAS_CAPITAL),
    },
  },
  {
    id: 'porte_rfb',
    label: 'Porte (Receita)',
    trilha: 'ambas',
    chaves: ['ME', 'EPP', 'DEMAIS'],
    categorizar: (l) => texto(l.porte_rfb)?.toUpperCase() ?? null,
    regra: {
      variavel: 'porte_rfb',
      condicaoDe: (c) => ({ variavel: 'porte_rfb', operador: 'em', valor: [c] }),
    },
  },
  {
    /**
     * Regime tributário EFETIVO, e não a coluna `regime_tributario` sozinha.
     *
     * Aquela é preenchida à mão e está quase toda vazia; o que a Receita entrega
     * de graça é `opcao_simples` + `data_exclusao_simples`. "Saiu do Simples" é
     * o sinal comercial de verdade — é o que separa quem cresceu de quem nunca
     * chegou lá — e ele só existe combinando os dois campos.
     */
    id: 'regime_tributario',
    label: 'Regime tributário',
    trilha: 'ambas',
    chaves: ['Simples', 'Saiu do Simples', 'Presumido/Real', 'Desconhecido'],
    categorizar: (l) => {
      const declarado = texto(l.regime_tributario)
      if (declarado === 'presumido' || declarado === 'real') return 'Presumido/Real'
      if (declarado === 'simples') return 'Simples'
      if (bool(l.opcao_simples) === true) return 'Simples'
      if (texto(l.data_exclusao_simples)) return 'Saiu do Simples'
      if (bool(l.opcao_simples) === false) return 'Presumido/Real'
      return null
    },
  },
  {
    id: 'qtd_filiais',
    label: 'Filiais',
    trilha: 'ambas',
    chaves: chavesDe(FAIXAS_CONTAGEM),
    categorizar: porFaixa('qtd_filiais', FAIXAS_CONTAGEM),
    regra: { variavel: 'qtd_filiais', condicaoDe: condicaoPisoDaFaixa('qtd_filiais', FAIXAS_CONTAGEM) },
  },
  {
    id: 'grupo_spes_total',
    label: 'SPEs no grupo',
    trilha: 'ambas',
    chaves: chavesDe(FAIXAS_CONTAGEM),
    categorizar: porFaixa('grupo_spes_total', FAIXAS_CONTAGEM),
    regra: {
      variavel: 'grupo_spes_total',
      condicaoDe: condicaoPisoDaFaixa('grupo_spes_total', FAIXAS_CONTAGEM),
    },
  },
  {
    id: 'grupo_spes_24m',
    label: 'SPEs abertas em 24 meses',
    trilha: 'ambas',
    chaves: chavesDe(FAIXAS_CONTAGEM),
    categorizar: porFaixa('grupo_spes_24m', FAIXAS_CONTAGEM),
    regra: {
      variavel: 'grupo_spes_24m',
      condicaoDe: condicaoPisoDaFaixa('grupo_spes_24m', FAIXAS_CONTAGEM),
    },
  },
  {
    id: 'obras_ativas',
    label: 'Obras ativas',
    trilha: 'ambas',
    chaves: chavesDe(FAIXAS_CONTAGEM),
    categorizar: porFaixa('obras_ativas', FAIXAS_CONTAGEM),
    regra: {
      variavel: 'obras_ativas',
      condicaoDe: condicaoPisoDaFaixa('obras_ativas', FAIXAS_CONTAGEM),
    },
  },
  {
    id: 'obras_iniciadas_24m',
    label: 'Obras iniciadas em 24 meses',
    trilha: 'ambas',
    chaves: chavesDe(FAIXAS_CONTAGEM),
    categorizar: porFaixa('obras_iniciadas_24m', FAIXAS_CONTAGEM),
    regra: {
      variavel: 'obras_iniciadas_24m',
      condicaoDe: condicaoPisoDaFaixa('obras_iniciadas_24m', FAIXAS_CONTAGEM),
    },
  },
  {
    id: 'm2_em_execucao',
    label: 'm² em execução',
    trilha: 'ambas',
    chaves: chavesDe(FAIXAS_M2),
    categorizar: porFaixa('m2_em_execucao', FAIXAS_M2),
    regra: {
      variavel: 'm2_em_execucao',
      condicaoDe: condicaoPisoDaFaixa('m2_em_execucao', FAIXAS_M2),
    },
  },
  {
    id: 'erp_conhecido',
    label: 'ERP identificado',
    trilha: 'ambas',
    chaves: SIM_NAO,
    categorizar: (l) => (texto(l.erp_atual) ? 'sim' : 'não'),
    regra: { variavel: 'erp_conhecido', condicaoDe: condicaoBooleana('erp_conhecido') },
  },
  {
    id: 'erp_atual',
    label: 'ERP atual',
    trilha: 'ambas',
    categorizar: (l) => texto(l.erp_atual),
    regra: {
      variavel: 'erp_atual',
      condicaoDe: (c) => ({ variavel: 'erp_atual', operador: 'igual', valor: c }),
    },
  },
  {
    id: 'erp_mrr',
    label: 'MRR do ERP',
    trilha: 'ambas',
    chaves: chavesDe(FAIXAS_MRR),
    categorizar: porFaixa('erp_mrr', FAIXAS_MRR),
    regra: { variavel: 'erp_mrr', condicaoDe: condicaoPisoDaFaixa('erp_mrr', FAIXAS_MRR) },
  },
  {
    id: 'qtd_usuarios_erp',
    label: 'Usuários do ERP',
    trilha: 'ambas',
    chaves: chavesDe(FAIXAS_USUARIOS_ERP),
    categorizar: porFaixa('qtd_usuarios_erp', FAIXAS_USUARIOS_ERP),
    regra: {
      variavel: 'qtd_usuarios_erp',
      condicaoDe: condicaoPisoDaFaixa('qtd_usuarios_erp', FAIXAS_USUARIOS_ERP),
    },
  },
  {
    id: 'funcionarios',
    label: 'Funcionários',
    trilha: 'ambas',
    chaves: chavesDe(FAIXAS_FUNCIONARIOS),
    categorizar: porFaixa('funcionarios', FAIXAS_FUNCIONARIOS),
    regra: {
      variavel: 'funcionarios',
      condicaoDe: condicaoPisoDaFaixa('funcionarios', FAIXAS_FUNCIONARIOS),
    },
  },
  {
    id: 'funcionarios_crescimento_12m',
    label: 'Crescimento de equipe (12m)',
    trilha: 'ambas',
    chaves: chavesDe(FAIXAS_CRESCIMENTO),
    categorizar: porFaixa('funcionarios_crescimento_12m', FAIXAS_CRESCIMENTO),
    regra: {
      variavel: 'funcionarios_crescimento_12m',
      condicaoDe: condicaoPisoDaFaixa('funcionarios_crescimento_12m', FAIXAS_CRESCIMENTO),
    },
  },
  {
    id: 'faturamento_estimado',
    label: 'Faturamento estimado',
    trilha: 'ambas',
    chaves: chavesDe(FAIXAS_FATURAMENTO),
    categorizar: porFaixa('faturamento_estimado', FAIXAS_FATURAMENTO),
    regra: {
      variavel: 'faturamento_estimado',
      condicaoDe: condicaoPisoDaFaixa('faturamento_estimado', FAIXAS_FATURAMENTO),
    },
  },
  {
    id: 'tem_protesto',
    label: 'Tem protesto',
    trilha: 'ambas',
    chaves: SIM_NAO,
    categorizar: simNao('tem_protesto'),
    regra: { variavel: 'tem_protesto', condicaoDe: condicaoBooleana('tem_protesto') },
  },
  {
    id: 'protesto_ratio_capital',
    label: 'Protesto sobre o capital',
    trilha: 'ambas',
    chaves: chavesDe(FAIXAS_PROTESTO_RATIO),
    categorizar: (l) => {
      const valor = num(l.protesto_valor_total)
      const capital = num(l.capital_social)
      if (valor === null || capital === null || capital <= 0) return null
      return emFaixa(valor / capital, FAIXAS_PROTESTO_RATIO)
    },
  },
  {
    id: 'certificado_ativo',
    label: 'Certificado digital ativo',
    trilha: 'ambas',
    chaves: SIM_NAO,
    categorizar: simNao('certificado_ativo'),
  },
  {
    id: 'score_credito',
    label: 'Score de crédito',
    trilha: 'ambas',
    chaves: chavesDe(FAIXAS_SCORE),
    categorizar: porFaixa('score_credito', FAIXAS_SCORE),
    regra: {
      variavel: 'score_credito',
      condicaoDe: condicaoPisoDaFaixa('score_credito', FAIXAS_SCORE),
    },
  },
  {
    id: 'tipagem_antecipacao',
    label: 'Tipagem de antecipação',
    trilha: 'ambas',
    chaves: ['aquisicao', 'ativacao', 'recorrencia'],
    categorizar: (l) => texto(l.tipagem_antecipacao),
  },
]

// ─── Variáveis de NF (só a trilha de fornecedores) ──────────────────────────
// A unidade aqui é o FORNECEDOR, não a nota: as agregações (ticket médio, nº de
// sacados, NFs vivas) são calculadas no worker e chegam já achatadas na linha.

const VARIAVEIS_NF: readonly VariavelPerfil[] = [
  {
    id: 'nf_prazo_medio',
    label: 'Prazo típico das NFs',
    trilha: 'fornecedores',
    chaves: chavesDe(FAIXAS_PRAZO_NF),
    categorizar: porFaixa('nf_prazo_medio', FAIXAS_PRAZO_NF),
    regra: {
      variavel: 'dias_para_vencimento',
      condicaoDe: condicaoPisoDaFaixa('dias_para_vencimento', FAIXAS_PRAZO_NF),
    },
  },
  {
    id: 'nf_ticket_medio',
    label: 'Ticket médio das NFs',
    trilha: 'fornecedores',
    chaves: chavesDe(FAIXAS_VALOR_NF),
    categorizar: porFaixa('nf_ticket_medio', FAIXAS_VALOR_NF),
    regra: { variavel: 'valor', condicaoDe: condicaoPisoDaFaixa('valor', FAIXAS_VALOR_NF) },
  },
  {
    id: 'nf_receita_esperada_media',
    label: 'Receita esperada por NF',
    trilha: 'fornecedores',
    chaves: chavesDe(FAIXAS_RECEITA_NF),
    categorizar: porFaixa('nf_receita_esperada_media', FAIXAS_RECEITA_NF),
    regra: {
      variavel: 'receita_esperada',
      condicaoDe: condicaoPisoDaFaixa('receita_esperada', FAIXAS_RECEITA_NF),
    },
  },
  {
    id: 'nf_tipo_predominante',
    label: 'Tipo de nota predominante',
    trilha: 'fornecedores',
    chaves: ['NFe', 'NFSe'],
    categorizar: (l) => texto(l.nf_tipo_predominante),
    regra: {
      variavel: 'tipo_nf',
      condicaoDe: (c) => ({ variavel: 'tipo_nf', operador: 'igual', valor: c }),
    },
  },
  {
    id: 'nf_sacado_credito_status',
    label: 'Crédito do sacado nas NFs',
    trilha: 'fornecedores',
    categorizar: (l) => texto(l.nf_sacado_credito_status),
    regra: {
      variavel: 'sacado_credito_status',
      condicaoDe: (c) => ({ variavel: 'sacado_credito_status', operador: 'igual', valor: c }),
    },
  },
  {
    id: 'nf_limite_cobre',
    label: 'Limite do sacado cobre a nota',
    trilha: 'fornecedores',
    chaves: SIM_NAO,
    categorizar: simNao('nf_limite_cobre'),
    regra: {
      variavel: 'sacado_limite_cobre_nota',
      condicaoDe: condicaoBooleana('sacado_limite_cobre_nota'),
    },
  },
  {
    id: 'nf_faixa_predominante',
    label: 'Faixa atribuída',
    trilha: 'fornecedores',
    chaves: ['alta', 'boa', 'media', 'sem faixa'],
    categorizar: (l) => texto(l.nf_faixa_predominante) ?? 'sem faixa',
  },
  {
    id: 'nf_qtd_vivas',
    label: 'NFs vivas do fornecedor',
    trilha: 'fornecedores',
    chaves: chavesDe(FAIXAS_CONTAGEM),
    categorizar: porFaixa('nf_qtd_vivas', FAIXAS_CONTAGEM),
  },
  {
    id: 'nf_qtd_sacados',
    label: 'Sacados distintos',
    trilha: 'fornecedores',
    chaves: chavesDe(FAIXAS_CONTAGEM),
    categorizar: porFaixa('nf_qtd_sacados', FAIXAS_CONTAGEM),
  },
]

export const CATALOGO_PERFIL: readonly VariavelPerfil[] = [...VARIAVEIS_EMPRESA, ...VARIAVEIS_NF]

export function variaveisDaTrilha(trilha: Trilha): readonly VariavelPerfil[] {
  return CATALOGO_PERFIL.filter((v) => v.trilha === 'ambas' || v.trilha === trilha)
}

export function variavelPerfil(id: string): VariavelPerfil | undefined {
  return CATALOGO_PERFIL.find((v) => v.id === id)
}

/** Linha crua → linha categorizada, que é o que o contraste consome. */
export function categorizarLinha(
  linha: LinhaPerfil,
  variaveis: readonly VariavelPerfil[],
): Record<string, string | null> {
  const saida: Record<string, string | null> = {}
  for (const v of variaveis) saida[v.id] = v.categorizar(linha)
  return saida
}
