import { z } from 'zod'

/**
 * The filter engine. ONE tree format, three consumers:
 *   - camada rules   (camada_regras.definicao)
 *   - the Explorador (ad-hoc filters over the mercado_explorador view)
 *   - segmentos      (segmentos.definicao)
 *
 * TWO compilers, and the split is a security boundary, not a convenience:
 *
 *   compileToPostgrest()  → a PostgREST filter string. Runs under RLS through
 *                           supabase-js. This is what the BROWSER uses. No SQL
 *                           ever leaves the client, so there is no SQL to inject
 *                           into: the worst a hostile tree can do is ask for rows
 *                           the RLS policies already refuse.
 *
 *   compileToSql()        → { text, values } with $n placeholders. Used ONLY by
 *                           apps/worker, which holds a direct pg connection and
 *                           the service role, for bulk reclassification of ~2M
 *                           rows (a PostgREST round trip per row is not an
 *                           option). Never expose this over HTTP.
 *
 * Both compile from the SAME validated tree, so a rule previewed in the browser
 * and applied by the worker cannot disagree — which is the whole point of the
 * dry-run count in §5.1.
 *
 * Values are NEVER interpolated into SQL. Identifiers come from the catalog
 * below and nowhere else: a variable that is not in the catalog fails zod
 * validation before either compiler sees it.
 */

// ─── Operadores ─────────────────────────────────────────────────────────────

export const OPERADORES = [
  'igual',
  'diferente',
  'maior_que',
  'maior_ou_igual',
  'menor_que',
  'menor_ou_igual',
  'contem',          // texto: ILIKE %valor%
  'comeca_com',      // texto: ILIKE valor%
  'em',              // valor ∈ lista
  'nao_em',
  'entre',           // [min, max], inclusivo
  'definido',        // is not null
  'nao_definido',    // is null
  'contem_algum',    // array && lista  (ex: cnae_grupos && {41,42,43})
] as const

export const operadorSchema = z.enum(OPERADORES)
export type Operador = z.infer<typeof operadorSchema>

export const OPERADOR_LABELS: Record<Operador, string> = {
  igual: 'é igual a',
  diferente: 'é diferente de',
  maior_que: 'é maior que',
  maior_ou_igual: 'é maior ou igual a',
  menor_que: 'é menor que',
  menor_ou_igual: 'é menor ou igual a',
  contem: 'contém',
  comeca_com: 'começa com',
  em: 'está em',
  nao_em: 'não está em',
  entre: 'está entre',
  definido: 'está preenchido',
  nao_definido: 'está vazio',
  contem_algum: 'contém algum de',
}

/** Operators that take no `valor` at all. */
const OPERADORES_SEM_VALOR: readonly Operador[] = ['definido', 'nao_definido']

// ─── Tipos de variável ──────────────────────────────────────────────────────

export const TIPOS_VARIAVEL = ['texto', 'numero', 'data', 'booleano', 'enum', 'lista_texto'] as const
export type TipoVariavel = (typeof TIPOS_VARIAVEL)[number]

const OPERADORES_POR_TIPO: Record<TipoVariavel, readonly Operador[]> = {
  texto: ['igual', 'diferente', 'contem', 'comeca_com', 'em', 'nao_em', 'definido', 'nao_definido'],
  numero: [
    'igual',
    'diferente',
    'maior_que',
    'maior_ou_igual',
    'menor_que',
    'menor_ou_igual',
    'entre',
    'definido',
    'nao_definido',
  ],
  data: ['maior_ou_igual', 'menor_ou_igual', 'entre', 'definido', 'nao_definido'],
  booleano: ['igual'],
  enum: ['igual', 'diferente', 'em', 'nao_em', 'definido', 'nao_definido'],
  lista_texto: ['contem_algum'],
}

export interface VariavelCatalogo {
  id: string
  label: string
  tipo: TipoVariavel
  /** Column on the `mercado_explorador` view. Absent ⇒ the variable is derived (see `derivada`). */
  coluna?: string
  /** Allowed values, for `enum`. */
  opcoes?: readonly string[]
  /**
   * Human labels for `opcoes`, when the stored value is a code nobody reads.
   *
   * The value is what gets written into the rule and compiled to SQL, so it has to
   * stay the code — natureza jurídica `2062` survives a relabelling of the RFB
   * table, "Sociedade Empresária Limitada" does not. But a dropdown of 92 numbers
   * is unusable, so the UI (and `descrever`) look the label up here. Absent ⇒ the
   * value IS the label, which is the case for every enum that stores a slug.
   */
  rotulos?: Readonly<Record<string, string>>
  descricao?: string
  /**
   * Derived variables do not map 1:1 onto a column — they rewrite the condition
   * into one over a DIFFERENT column, which is why they must emit a resolved
   * condition (carrying `coluna`) and not another Condicao: the column they
   * target — `data_inicio_atividade` — is deliberately not a catalog variable,
   * so a Condicao naming it could never be resolved.
   *
   * `idade_anos >= 3` becomes `data_inicio_atividade <= (hoje - 3 anos)`, which
   * is correct AND indexable, and needs no nightly job to stop an `idade` column
   * from going stale.
   */
  derivada?: (cond: Condicao, hoje: Date) => CondicaoResolvida
}

// ─── Derivações ─────────────────────────────────────────────────────────────

function anosAtras(hoje: Date, anos: number): string {
  const d = new Date(hoje)
  d.setFullYear(d.getFullYear() - anos)
  return d.toISOString().slice(0, 10)
}

/** Comparing AGE inverts the comparison on the DATE: older ⇒ earlier start date. */
const INVERSAO_IDADE: Partial<Record<Operador, Operador>> = {
  maior_que: 'menor_que',
  maior_ou_igual: 'menor_ou_igual',
  menor_que: 'maior_que',
  menor_ou_igual: 'maior_ou_igual',
  igual: 'igual',
}

function derivarIdadeAnos(cond: Condicao, hoje: Date): CondicaoResolvida {
  if (cond.operador === 'definido' || cond.operador === 'nao_definido') {
    return { coluna: 'data_inicio_atividade', operador: cond.operador }
  }

  if (cond.operador === 'entre') {
    const [min, max] = cond.valor as [number, number]
    // idade ∈ [min, max]  ⇔  data_inicio ∈ [hoje-max, hoje-min]
    return {
      coluna: 'data_inicio_atividade',
      operador: 'entre',
      valor: [anosAtras(hoje, max), anosAtras(hoje, min)],
    }
  }

  const invertido = INVERSAO_IDADE[cond.operador]
  if (!invertido) {
    throw new FiltroError(`Operador "${cond.operador}" não se aplica a idade_anos.`)
  }

  return {
    coluna: 'data_inicio_atividade',
    operador: invertido,
    valor: anosAtras(hoje, Number(cond.valor)),
  }
}

/** `erp_conhecido = true` ⇔ `erp_atual is not null`. No stored boolean to go stale. */
function derivarErpConhecido(cond: Condicao): CondicaoResolvida {
  const querConhecido = cond.valor === true || cond.valor === 'true'
  return {
    coluna: 'erp_atual',
    operador: querConhecido ? 'definido' : 'nao_definido',
  }
}

/** `tem_dominio = true` ⇔ `dominio is not null`. Mesmo padrão de erp_conhecido. */
function derivarTemDominio(cond: Condicao): CondicaoResolvida {
  const querComDominio = cond.valor === true || cond.valor === 'true'
  return {
    coluna: 'dominio',
    operador: querComDominio ? 'definido' : 'nao_definido',
  }
}

// ─── Catálogo de variáveis ──────────────────────────────────────────────────
// Every entry MUST name a real column on `mercado_explorador` (migration 0012)
// or be `derivada`. The catalog is the whitelist: nothing else can reach SQL.

export const CATALOGO: readonly VariavelCatalogo[] = [
  // Cadastro (Receita)
  {
    id: 'situacao_cadastral',
    label: 'Situação cadastral',
    tipo: 'enum',
    coluna: 'situacao_cadastral',
    opcoes: ['ativa', 'suspensa', 'inapta', 'baixada', 'nula'],
  },
  {
    id: 'cnae_principal',
    label: 'CNAE principal',
    tipo: 'texto',
    coluna: 'cnae_principal',
    descricao: 'Código CNAE principal, 7 dígitos sem pontuação (ex: 4110700).',
  },
  {
    id: 'cnae_qualquer',
    label: 'CNAE (principal ou secundário)',
    tipo: 'lista_texto',
    coluna: 'cnaes_todos',
    descricao:
      'Códigos CNAE exatos. Casa se QUALQUER CNAE da empresa (principal ou secundário) estiver na lista.',
  },
  {
    id: 'cnae_grupo',
    label: 'Divisão CNAE',
    tipo: 'lista_texto',
    coluna: 'cnae_grupos',
    descricao:
      'Divisão de 2 dígitos (41 = construção de edifícios, 42 = obras de infraestrutura, ' +
      '43 = serviços especializados). Casa se qualquer CNAE da empresa pertencer à divisão.',
  },
  { id: 'natureza_juridica', label: 'Natureza jurídica', tipo: 'texto', coluna: 'natureza_juridica' },
  {
    id: 'porte_rfb',
    label: 'Porte (Receita)',
    tipo: 'enum',
    coluna: 'porte_rfb',
    opcoes: ['ME', 'EPP', 'DEMAIS'],
  },
  { id: 'capital_social', label: 'Capital social', tipo: 'numero', coluna: 'capital_social' },
  {
    id: 'idade_anos',
    label: 'Idade (anos)',
    tipo: 'numero',
    descricao: 'Anos desde o início de atividade.',
    derivada: derivarIdadeAnos,
  },
  { id: 'uf', label: 'UF', tipo: 'texto', coluna: 'uf' },
  { id: 'municipio', label: 'Município', tipo: 'texto', coluna: 'municipio' },
  { id: 'opcao_simples', label: 'Optante do Simples', tipo: 'booleano', coluna: 'opcao_simples' },
  {
    id: 'saiu_simples_apos',
    label: 'Saiu do Simples após',
    tipo: 'data',
    coluna: 'data_exclusao_simples',
    descricao: 'Sair do Simples costuma indicar crescimento de faturamento.',
  },
  { id: 'qtd_filiais', label: 'Qtd. de filiais', tipo: 'numero', coluna: 'qtd_filiais' },

  // Grupo econômico
  { id: 'is_spe', label: 'É SPE', tipo: 'booleano', coluna: 'is_spe' },
  { id: 'grupo_spes_total', label: 'SPEs no grupo (total)', tipo: 'numero', coluna: 'grupo_spes_total' },
  {
    id: 'grupo_spes_24m',
    label: 'SPEs abertas no grupo (24m)',
    tipo: 'numero',
    coluna: 'grupo_spes_24m',
    descricao: 'SPEs abertas nos últimos 24 meses — proxy de velocidade de lançamento.',
  },
  { id: 'grupo_ufs', label: 'UFs do grupo', tipo: 'lista_texto', coluna: 'grupo_ufs' },

  // Obras (CNO)
  { id: 'obras_ativas', label: 'Obras ativas', tipo: 'numero', coluna: 'obras_ativas' },
  { id: 'm2_em_execucao', label: 'm² em execução', tipo: 'numero', coluna: 'm2_em_execucao' },
  {
    id: 'obras_iniciadas_24m',
    label: 'Obras iniciadas (24m)',
    tipo: 'numero',
    coluna: 'obras_iniciadas_24m',
  },

  // ERP (inteligência competitiva)
  {
    id: 'erp_atual',
    label: 'ERP atual',
    tipo: 'texto',
    coluna: 'erp_atual',
    descricao: 'Qual ERP a empresa usa hoje.',
  },
  {
    id: 'erp_conhecido',
    label: 'ERP identificado',
    tipo: 'booleano',
    descricao: 'Verdadeiro quando sabemos qual ERP a empresa usa.',
    derivada: derivarErpConhecido,
  },
  {
    id: 'erp_mrr',
    label: 'MRR do ERP',
    tipo: 'numero',
    coluna: 'erp_mrr',
    descricao:
      'Valor mensal que a empresa paga pelo ERP que usa hoje. NÃO é receita da ONE OS — ' +
      'só coincide com ela quando o ERP atual é o Brik.',
  },
  { id: 'qtd_usuarios_erp', label: 'Usuários do ERP', tipo: 'numero', coluna: 'qtd_usuarios_erp' },
  {
    id: 'ratio_usuarios_ativos',
    label: 'Uso do ERP (ativos / contratados)',
    tipo: 'numero',
    coluna: 'ratio_usuarios_ativos',
    descricao: 'Razão entre usuários ativos e contratados. Baixo = ERP subutilizado, bom sinal de churn.',
  },
  {
    id: 'churn_erp_concorrente',
    label: 'Churn em ERP concorrente',
    tipo: 'booleano',
    coluna: 'churn_erp_concorrente',
  },

  // Sinais
  {
    id: 'no_grafo_sefaz',
    label: 'No grafo SEFAZ',
    tipo: 'booleano',
    coluna: 'grafo_sefaz',
    descricao: 'Placeholder — a ingestão desse sinal vem em um módulo posterior.',
  },
  { id: 'tem_contato', label: 'Tem contato conhecido', tipo: 'booleano', coluna: 'tem_contato' },

  // Eixos
  {
    id: 'camada',
    label: 'Camada',
    tipo: 'enum',
    coluna: 'camada',
    opcoes: ['universo', 'tam', 'sam', 'som'],
    descricao: 'Classificação de mercado. Não confundir com estágio.',
  },
  {
    id: 'estagio',
    label: 'Estágio',
    tipo: 'enum',
    coluna: 'estagio',
    opcoes: ['mercado', 'lead', 'prospect', 'cliente', 'ex_cliente'],
    descricao: 'Histórico de relacionamento. Só existe para empresas promovidas.',
  },
  {
    id: 'tipo',
    label: 'Tipo',
    tipo: 'enum',
    coluna: 'tipo',
    opcoes: ['construtora', 'incorporadora', 'fornecedor', 'subempreiteiro'],
    descricao:
      'Quatro valores desde o 04c. Nada foi reclassificado: construtora segue sendo o default, ' +
      'e incorporadora/subempreiteiro são refinados à mão.',
  },

  // Faturamento & equipe (04c) — colunas em mercado_explorador via migration 0069
  {
    id: 'faturamento_estimado',
    label: 'Faturamento estimado',
    tipo: 'numero',
    coluna: 'faturamento_estimado',
    descricao:
      'Valor VIGENTE, que pode ser declarado pelo cliente ou estimado pelo modelo. ' +
      'Filtre junto com faturamento_origem quando a procedência importar.',
  },
  {
    id: 'faturamento_origem',
    label: 'Origem do faturamento',
    tipo: 'enum',
    coluna: 'faturamento_origem',
    opcoes: ['declarado_cliente', 'apollo', 'apollo_search', 'lista', 'modelo', 'bracket_simples'],
    descricao: 'De onde veio o número. `declarado_cliente` é o único que não é estimativa.',
  },
  {
    id: 'faturamento_confianca',
    label: 'Confiança do faturamento',
    tipo: 'enum',
    coluna: 'faturamento_confianca',
    opcoes: ['alta', 'media', 'baixa'],
    descricao: 'Alta = dois ou mais modelos concordando. Baixa = só a faixa do Simples.',
  },
  {
    id: 'funcionarios',
    label: 'Funcionários',
    tipo: 'numero',
    coluna: 'funcionarios',
    descricao:
      'Headcount vigente. Fontes tipo Apollo SUBCONTAM mão de obra de canteiro — o número ' +
      'serve para comparar empresas entre si, não como quadro real.',
  },
  {
    id: 'funcionarios_origem',
    label: 'Origem dos funcionários',
    tipo: 'enum',
    coluna: 'funcionarios_origem',
    opcoes: ['declarado_cliente', 'apollo', 'apollo_search', 'lista'],
    descricao: '`apollo_search` conta perfis indexados e subconta mais ainda que `apollo`.',
  },
  {
    id: 'funcionarios_crescimento_12m',
    label: 'Crescimento de equipe (12m)',
    tipo: 'numero',
    coluna: 'funcionarios_crescimento_12m',
    descricao:
      'Variação do headcount em 12 meses, como fração (0,25 = +25%). Nulo com menos de ' +
      'dois pontos na série — e nulo NÃO é zero.',
  },
  {
    id: 'regime_tributario',
    label: 'Regime tributário',
    tipo: 'enum',
    coluna: 'regime_tributario',
    opcoes: ['simples', 'presumido', 'real'],
    descricao: 'Preenchido à mão. Não é inferido a partir do Simples da Receita.',
  },

  // Crédito (04d) — colunas em mercado_explorador via migration 0073
  {
    id: 'limite_potencial',
    label: 'Limite potencial',
    tipo: 'numero',
    coluna: 'limite_potencial',
    descricao:
      'Quanto de limite esta empresa provavelmente sustentaria, a partir do faturamento ' +
      'estimado e da proporção calibrada na carteira. NULO quando falta faturamento ou ' +
      'calibração — e nulo não é zero.',
  },
  {
    id: 'receita_mensal_prevista',
    label: 'Receita mensal prevista',
    tipo: 'numero',
    coluna: 'receita_mensal_prevista',
    descricao:
      'Receita financeira + TAC que o limite potencial geraria por mês, no giro médio da ' +
      'carteira. É receita da ONE OS, ao contrário do MRR do ERP.',
  },
  {
    id: 'valor_esperado_mensal',
    label: 'Valor esperado mensal',
    tipo: 'numero',
    coluna: 'valor_esperado_mensal',
    descricao:
      'Receita prevista × chance de concessão. É a régua de priorização: R$ esperados por ' +
      'mês, que já desconta a probabilidade de o crédito não sair.',
  },
  {
    id: 'score_credito',
    label: 'Score de crédito',
    tipo: 'numero',
    coluna: 'score_credito',
    descricao:
      '0–100, renormalizado sobre os fatores AVALIÁVEIS. Nulo quando a completude dos ' +
      'dados não alcança o mínimo — nesse caso a faixa é `dados_insuficientes`.',
  },
  {
    id: 'faixa_score',
    label: 'Faixa do score',
    tipo: 'enum',
    coluna: 'faixa_score',
    opcoes: ['alta', 'media', 'improvavel', 'dados_insuficientes'],
    descricao: 'Alta ≥ 65 · média ≥ corte de concessão · improvável abaixo dele.',
  },
  {
    id: 'chance_concessao',
    label: 'Chance de concessão',
    tipo: 'numero',
    coluna: 'chance_concessao',
    descricao: 'Probabilidade derivada da faixa (alta 0,8 · média 0,5 · improvável 0,1).',
  },
  {
    id: 'tem_analise_vigente',
    label: 'Tem análise de crédito vigente',
    tipo: 'booleano',
    coluna: 'tem_analise_vigente',
    descricao: 'Aprovada (total ou parcial) e ainda dentro da validade.',
  },
  {
    id: 'analise_estagio',
    label: 'Estágio da análise',
    tipo: 'enum',
    coluna: 'analise_estagio',
    opcoes: [
      'rascunho', 'solicitada', 'docs_pendentes', 'enviada_seguradora', 'em_analise',
      'aprovada', 'aprovada_parcial', 'negada', 'expirada', 'cancelada',
    ],
    descricao: 'Estágio da análise mais recente deste CNPJ.',
  },

  // Radar (enriquecimento) — colunas em mercado_explorador via migration 0031
  {
    id: 'tem_dominio',
    label: 'Tem domínio',
    tipo: 'booleano',
    descricao: 'Verdadeiro quando já resolvemos o domínio web da empresa.',
    derivada: derivarTemDominio,
  },
  {
    id: 'dominio_confianca',
    label: 'Confiança do domínio',
    tipo: 'enum',
    coluna: 'dominio_confianca',
    opcoes: ['alta', 'media', 'baixa'],
  },
  {
    id: 'dominio_consultado_em',
    label: 'Domínio consultado em',
    tipo: 'data',
    coluna: 'dominio_consultado_em',
    descricao: 'Quando o domínio foi resolvido/validado. Usado para excluir por TTL.',
  },
  { id: 'qtd_contatos', label: 'Qtd. de contatos', tipo: 'numero', coluna: 'qtd_contatos' },
  {
    id: 'contatos_enriquecidos_em',
    label: 'Contatos enriquecidos em',
    tipo: 'data',
    coluna: 'contatos_enriquecidos_em',
    descricao: 'Data do enriquecimento de contatos mais recente. Usado para excluir por TTL.',
  },
  {
    id: 'tem_protesto',
    label: 'Tem protesto',
    tipo: 'booleano',
    coluna: 'tem_protesto',
    descricao: 'Última consulta de protesto indicou protesto. Nulo = nunca consultado.',
  },
  {
    id: 'protestos_consultados_em',
    label: 'Protestos consultados em',
    tipo: 'data',
    coluna: 'protestos_consultados_em',
    descricao: 'Data da última consulta de protesto. Usado para excluir por TTL.',
  },
  {
    id: 'e_cliente_onepay',
    label: 'É cliente Onepay',
    tipo: 'booleano',
    coluna: 'e_cliente_onepay',
    descricao: 'Empresa presente na base de clientes Onepay (sync diário).',
  },
  {
    id: 'dias_sem_antecipar',
    label: 'Dias sem antecipar',
    tipo: 'numero',
    coluna: 'dias_sem_antecipar',
    descricao: 'Dias desde a última antecipação (clientes Onepay).',
  },
  {
    id: 'consumed_pct',
    label: 'Limite consumido (%)',
    tipo: 'numero',
    coluna: 'consumed_pct',
    descricao: 'Fração do limite de crédito consumida (0 a 1). Clientes Onepay.',
  },

  // Antecipação (§3.1) — colunas em mercado_explorador via migration 0049
  {
    id: 'fora_recorte_cnae',
    label: 'Fora do recorte de CNAE',
    tipo: 'booleano',
    coluna: 'fora_recorte_cnae',
    descricao:
      'Empresa que entrou pelo lookup cadastral de fornecedores de NF e cujo CNAE não é de ' +
      'construção. A regra do TAM exige false: eles existem no staging para o funil de ' +
      'Antecipação, mas não sobem na pirâmide comercial.',
  },
  {
    id: 'origem_ingestao',
    label: 'Origem da ingestão',
    tipo: 'enum',
    coluna: 'origem_ingestao',
    opcoes: ['receita_dump', 'lookup', 'lista'],
    descricao: 'Como o CNPJ entrou na base: dump da Receita, lookup cadastral ou importação de lista.',
  },
]

// ─── A árvore ───────────────────────────────────────────────────────────────

export class FiltroError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FiltroError'
  }
}

export interface Condicao {
  variavel: string
  operador: Operador
  valor?: unknown
}

export interface Grupo {
  operador: 'e' | 'ou'
  condicoes: No[]
}

export type No = Condicao | Grupo

export function isGrupo(no: No): no is Grupo {
  return 'condicoes' in no
}

// ─── Forma resolvida ────────────────────────────────────────────────────────
// After normalization every leaf names a COLUMN, not a variable. This is the
// only shape the compilers ever see, which means neither of them can be handed
// an unresolved variable — a whole class of bug (and the one the tests caught)
// stops being expressible.

export interface CondicaoResolvida {
  coluna: string
  operador: Operador
  valor?: unknown
}

interface GrupoResolvido {
  operador: 'e' | 'ou'
  condicoes: NoResolvido[]
}

type NoResolvido = CondicaoResolvida | GrupoResolvido

function isGrupoResolvido(no: NoResolvido): no is GrupoResolvido {
  return 'condicoes' in no
}

export type NoResolvidoJson =
  | { op: 'e' | 'ou'; c: NoResolvidoJson[] }
  | { col: string; op: Operador; v?: unknown }

export interface SqlCompilado {
  /** WHERE clause body, with $1..$n placeholders. Never contains a literal value. */
  text: string
  values: unknown[]
}

// ─── Os três compiladores, independentes de catálogo ────────────────────────
// They only ever see the RESOLVED shape, so they cannot be handed a variable —
// which is why they live outside the factory and are shared by every engine.

/**
 * PostgREST treats , ( ) . : and " as syntax. A value carrying any of them —
 * "CONSTRUTORA SILVA, IRMÃOS & CIA (SP)" is an ordinary razão social — would
 * otherwise be read as extra conditions. Double-quoting neutralizes them; the
 * inner " and \ must themselves be escaped.
 */
function pgrstValor(valor: unknown): string {
  const s = String(valor)
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function pgrstLista(valor: unknown): string {
  const itens = (valor as unknown[]).map(pgrstValor).join(',')
  return `(${itens})`
}

/** For array columns PostgREST wants {a,b}, and the braces form has its own quoting. */
function pgrstArray(valor: unknown): string {
  const itens = (valor as unknown[]).map((v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
  return `{${itens.join(',')}}`
}

function pgrstCondicao(cond: CondicaoResolvida): string {
  const col = cond.coluna

  switch (cond.operador) {
    case 'igual':
      return `${col}.eq.${pgrstValor(cond.valor)}`
    case 'diferente':
      return `${col}.neq.${pgrstValor(cond.valor)}`
    case 'maior_que':
      return `${col}.gt.${pgrstValor(cond.valor)}`
    case 'maior_ou_igual':
      return `${col}.gte.${pgrstValor(cond.valor)}`
    case 'menor_que':
      return `${col}.lt.${pgrstValor(cond.valor)}`
    case 'menor_ou_igual':
      return `${col}.lte.${pgrstValor(cond.valor)}`
    case 'contem':
      // PostgREST's like/ilike wildcard is *, not %.
      return `${col}.ilike.${pgrstValor(`*${String(cond.valor)}*`)}`
    case 'comeca_com':
      return `${col}.ilike.${pgrstValor(`${String(cond.valor)}*`)}`
    case 'em':
      return `${col}.in.${pgrstLista(cond.valor)}`
    case 'nao_em':
      return `not.${col}.in.${pgrstLista(cond.valor)}`
    case 'entre': {
      const [min, max] = cond.valor as [unknown, unknown]
      return `and(${col}.gte.${pgrstValor(min)},${col}.lte.${pgrstValor(max)})`
    }
    case 'definido':
      return `${col}.not.is.null`
    case 'nao_definido':
      return `${col}.is.null`
    case 'contem_algum':
      return `${col}.ov.${pgrstArray(cond.valor)}`
  }
}

function pgrstNo(no: NoResolvido): string {
  if (!isGrupoResolvido(no)) return pgrstCondicao(no)
  const partes = no.condicoes.map(pgrstNo).join(',')
  return `${no.operador === 'e' ? 'and' : 'or'}(${partes})`
}

function sqlNo(no: NoResolvido, values: unknown[]): string {
  if (isGrupoResolvido(no)) {
    const partes = no.condicoes.map((c) => sqlNo(c, values))
    return `(${partes.join(no.operador === 'e' ? ' and ' : ' or ')})`
  }

  // The identifier came from the catalog — never from user input — so it cannot
  // carry SQL. Values ALWAYS go through a placeholder; there is no code path
  // here that concatenates one into `text`.
  const col = no.coluna
  const p = (v: unknown): string => {
    values.push(v)
    return `$${values.length}`
  }

  switch (no.operador) {
    case 'igual':
      return `${col} = ${p(no.valor)}`
    case 'diferente':
      return `${col} is distinct from ${p(no.valor)}`
    case 'maior_que':
      return `${col} > ${p(no.valor)}`
    case 'maior_ou_igual':
      return `${col} >= ${p(no.valor)}`
    case 'menor_que':
      return `${col} < ${p(no.valor)}`
    case 'menor_ou_igual':
      return `${col} <= ${p(no.valor)}`
    case 'contem':
      return `${col} ilike ${p(`%${String(no.valor)}%`)}`
    case 'comeca_com':
      return `${col} ilike ${p(`${String(no.valor)}%`)}`
    case 'em':
      return `${col} = any(${p(no.valor)})`
    case 'nao_em':
      return `(${col} is null or ${col} <> all(${p(no.valor)}))`
    case 'entre': {
      const [min, max] = no.valor as [unknown, unknown]
      return `${col} between ${p(min)} and ${p(max)}`
    }
    case 'definido':
      return `${col} is not null`
    case 'nao_definido':
      return `${col} is null`
    case 'contem_algum':
      return `${col} && ${p(no.valor)}`
  }
}

function serializarResolvido(no: NoResolvido): NoResolvidoJson {
  if (isGrupoResolvido(no)) {
    return { op: no.operador, c: no.condicoes.map(serializarResolvido) }
  }
  return no.valor === undefined
    ? { col: no.coluna, op: no.operador }
    : { col: no.coluna, op: no.operador, v: no.valor }
}

// ─── A fábrica ──────────────────────────────────────────────────────────────

/**
 * ONE engine per CATALOG, and the catalog is the whitelist.
 *
 * The engine used to be a module-level singleton bound to `CATALOGO`, and that
 * was fine while the Mercado's `mercado_explorador` was the only surface with
 * filterable columns. The Antecipação funnel has its own — `notas_funil`, whose
 * variables (sacado_credito_status, dias_para_vencimento…) mean nothing over a
 * company row, and whose columns do not exist on the Mercado view. Merging the
 * two catalogs would let a faixa rule reference `obras_ativas` and compile to a
 * column the funnel view does not have — an error nobody sees until the nightly
 * reclassification fails on 40.000 notes.
 *
 * So: one factory, two instances, one set of compilers. The safety property is
 * unchanged — a variable outside THIS engine's catalog fails zod before any
 * compiler sees it.
 */
export interface FiltroEngine {
  catalogo: readonly VariavelCatalogo[]
  variavelIds: readonly string[]
  variavel: (id: string) => VariavelCatalogo | undefined
  operadoresDe: (id: string) => readonly Operador[]
  /** Any node: a bare condition or a group. */
  filtroSchema: z.ZodType<No>
  /** Rules and segments always store a top-level GROUP, never a bare condition. */
  arvoreSchema: z.ZodType<Grupo>
  parseArvore: (input: unknown) => Grupo
  compileToPostgrest: (arvore: unknown, hoje?: Date) => string
  compileToSql: (arvore: unknown, hoje?: Date) => SqlCompilado
  resolverParaJson: (arvore: unknown, hoje?: Date) => NoResolvidoJson
  descrever: (no: No, nivel?: number) => string
}

export function criarFiltroEngine(catalogo: readonly VariavelCatalogo[]): FiltroEngine {
  const porId = new Map(catalogo.map((v) => [v.id, v]))

  const condicaoSchema: z.ZodType<Condicao> = z
    .object({
      variavel: z.string(),
      operador: operadorSchema,
      valor: z.unknown().optional(),
    })
    .superRefine((cond, ctx) => {
      const v = porId.get(cond.variavel)
      if (!v) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Variável desconhecida: "${cond.variavel}".`,
        })
        return
      }

      if (!OPERADORES_POR_TIPO[v.tipo].includes(cond.operador)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Operador "${OPERADOR_LABELS[cond.operador]}" não se aplica a "${v.label}".`,
        })
        return
      }

      const precisaValor = !OPERADORES_SEM_VALOR.includes(cond.operador)
      if (precisaValor && (cond.valor === undefined || cond.valor === null)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${v.label}" precisa de um valor.` })
        return
      }

      if (cond.operador === 'entre') {
        if (!Array.isArray(cond.valor) || cond.valor.length !== 2) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `"${v.label}" com "está entre" precisa de exatamente dois valores.`,
          })
        }
        return
      }

      if (['em', 'nao_em', 'contem_algum'].includes(cond.operador)) {
        if (!Array.isArray(cond.valor) || cond.valor.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `"${v.label}" precisa de uma lista com ao menos um valor.`,
          })
        }
        return
      }

      if (v.tipo === 'enum' && v.opcoes && precisaValor) {
        const valores = Array.isArray(cond.valor) ? cond.valor : [cond.valor]
        for (const val of valores) {
          if (!v.opcoes.includes(String(val))) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `"${String(val)}" não é um valor válido para "${v.label}".`,
            })
          }
        }
      }

      if (v.tipo === 'numero' && precisaValor) {
        const valores = Array.isArray(cond.valor) ? cond.valor : [cond.valor]
        for (const val of valores) {
          if (typeof val !== 'number' || !Number.isFinite(val)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `"${v.label}" precisa de um número.`,
            })
          }
        }
      }
    })

  const filtroSchema: z.ZodType<No> = z.lazy(() =>
    z.union([
      z.object({
        operador: z.enum(['e', 'ou']),
        condicoes: z.array(filtroSchema).min(1, 'Um grupo precisa de ao menos uma condição.'),
      }),
      condicaoSchema,
    ]),
  )

  const arvoreSchema = z.object({
    operador: z.enum(['e', 'ou']),
    condicoes: z.array(filtroSchema).min(1),
  }) as unknown as z.ZodType<Grupo>

  function parseArvore(input: unknown): Grupo {
    const r = arvoreSchema.safeParse(input)
    if (!r.success) {
      throw new FiltroError(r.error.issues.map((i) => i.message).join(' '))
    }
    return r.data
  }

  /** Expands derived variables. Every compiler runs this first, so they cannot diverge. */
  function normalizar(no: No, hoje: Date): NoResolvido {
    if (isGrupo(no)) {
      return { operador: no.operador, condicoes: no.condicoes.map((c) => normalizar(c, hoje)) }
    }

    const v = porId.get(no.variavel)
    if (!v) throw new FiltroError(`Variável desconhecida: "${no.variavel}".`)

    if (v.derivada) return v.derivada(no, hoje)

    if (!v.coluna) {
      // Unreachable: the catalog test asserts every entry has a column or a
      // derivation. A guard, not a user-facing error.
      throw new FiltroError(`Variável "${no.variavel}" não tem coluna e não foi derivada.`)
    }

    return { coluna: v.coluna, operador: no.operador, valor: no.valor }
  }

  return {
    catalogo,
    variavelIds: catalogo.map((v) => v.id),
    variavel: (id) => porId.get(id),
    operadoresDe: (id) => {
      const v = porId.get(id)
      return v ? OPERADORES_POR_TIPO[v.tipo] : []
    },
    filtroSchema,
    arvoreSchema,
    parseArvore,

    /**
     * Returns the string to hand to `.or()`:
     *
     *   const filtro = compileToPostgrest(arvore)
     *   supabase.from('mercado_explorador').select('*', { count: 'exact' }).or(filtro)
     *
     * `.or()` on a single top-level and(...) is logically that and(...), which is
     * why a top-level AND group is not a special case.
     */
    compileToPostgrest: (arvore, hoje = new Date()) => pgrstNo(normalizar(parseArvore(arvore), hoje)),

    compileToSql: (arvore, hoje = new Date()) => {
      const raiz = normalizar(parseArvore(arvore), hoje)
      const values: unknown[] = []
      const text = sqlNo(raiz, values)
      return { text, values }
    },

    /**
     * A MESMA árvore normalizada, mas serializada em JSON compacto para viajar até uma
     * função Postgres (mercado_explorar / mercado_contar_exato) que a compila lá dentro,
     * sob SECURITY DEFINER. Por que não usar compileToPostgrest direto na view? Porque a
     * view roda sob RLS, e o operador ILIKE da BUSCA não é leakproof — sob RLS o planner
     * é proibido de usar o índice de trigrama e varre o universo inteiro (timeout). A RPC
     * definer roda sem RLS (portão feito uma vez), então o trigrama volta a valer.
     *
     * Sai JÁ resolvido (coluna, não variável): a derivação de idade_anos → data e a
     * checagem de catálogo acontecem AQUI, no TS que tem o catálogo; a função Postgres só
     * precisa casar coluna (contra uma whitelist) e operador.
     */
    resolverParaJson: (arvore, hoje = new Date()) =>
      serializarResolvido(normalizar(parseArvore(arvore), hoje)),

    descrever: function descrever(no: No, nivel = 0): string {
      if (isGrupo(no)) {
        const juncao = no.operador === 'e' ? ' E ' : ' OU '
        const partes = no.condicoes.map((c) => descrever(c, nivel + 1))
        const texto = partes.join(juncao)
        return nivel === 0 ? texto : `(${texto})`
      }

      const v = porId.get(no.variavel)
      const label = v?.label ?? no.variavel
      const op = OPERADOR_LABELS[no.operador]

      // A regra descrita é lida por gente (resumo do card, log da reclassificação).
      // "Natureza jurídica é igual a 2062" só faz sentido para quem decorou a tabela.
      const legivel = (valor: unknown) => v?.rotulos?.[String(valor)] ?? String(valor)

      if (OPERADORES_SEM_VALOR.includes(no.operador)) return `${label} ${op}`
      if (Array.isArray(no.valor)) {
        return no.operador === 'entre'
          ? `${label} ${op} ${no.valor[0]} e ${no.valor[1]}`
          : `${label} ${op} ${no.valor.map(legivel).join(', ')}`
      }
      return `${label} ${op} ${legivel(no.valor)}`
    },
  }
}

// ─── O engine do Mercado ────────────────────────────────────────────────────
// The original, unqualified names still mean the Mercado engine: every existing
// caller (Explorador, pirâmide, segmentos, lotes do Radar) keeps working, and a
// second engine has to be asked for by name.

export const mercadoEngine: FiltroEngine = criarFiltroEngine(CATALOGO)

export const VARIAVEL_IDS = mercadoEngine.variavelIds
export const filtroSchema = mercadoEngine.filtroSchema
export const arvoreSchema = mercadoEngine.arvoreSchema

export function variavel(id: string): VariavelCatalogo | undefined {
  return mercadoEngine.variavel(id)
}

export function operadoresDe(id: string): readonly Operador[] {
  return mercadoEngine.operadoresDe(id)
}

export function parseArvore(input: unknown): Grupo {
  return mercadoEngine.parseArvore(input)
}

export function compileToPostgrest(arvore: unknown, hoje: Date = new Date()): string {
  return mercadoEngine.compileToPostgrest(arvore, hoje)
}

export function compileToSql(arvore: unknown, hoje: Date = new Date()): SqlCompilado {
  return mercadoEngine.compileToSql(arvore, hoje)
}

export function resolverParaJson(arvore: unknown, hoje: Date = new Date()): NoResolvidoJson {
  return mercadoEngine.resolverParaJson(arvore, hoje)
}

/** Leitura humana (UI: "regra atual", card de confirmação da IA). */
export function descrever(no: No, nivel = 0): string {
  return mercadoEngine.descrever(no, nivel)
}
