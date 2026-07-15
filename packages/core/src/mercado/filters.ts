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
    opcoes: ['construtora', 'fornecedor'],
  },
]

const POR_ID = new Map(CATALOGO.map((v) => [v.id, v]))

export function variavel(id: string): VariavelCatalogo | undefined {
  return POR_ID.get(id)
}

export const VARIAVEL_IDS = CATALOGO.map((v) => v.id)

export function operadoresDe(id: string): readonly Operador[] {
  const v = POR_ID.get(id)
  if (!v) return []
  return OPERADORES_POR_TIPO[v.tipo]
}

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

const condicaoSchema: z.ZodType<Condicao> = z
  .object({
    variavel: z.string(),
    operador: operadorSchema,
    valor: z.unknown().optional(),
  })
  .superRefine((cond, ctx) => {
    const v = POR_ID.get(cond.variavel)
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

export const filtroSchema: z.ZodType<No> = z.lazy(() =>
  z.union([
    z.object({
      operador: z.enum(['e', 'ou']),
      condicoes: z.array(filtroSchema).min(1, 'Um grupo precisa de ao menos uma condição.'),
    }),
    condicaoSchema,
  ]),
)

/** Rules and segments always store a top-level GROUP, never a bare condition. */
export const arvoreSchema = z.object({
  operador: z.enum(['e', 'ou']),
  condicoes: z.array(filtroSchema).min(1),
})

export function parseArvore(input: unknown): Grupo {
  const r = arvoreSchema.safeParse(input)
  if (!r.success) {
    throw new FiltroError(r.error.issues.map((i) => i.message).join(' '))
  }
  return r.data as Grupo
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

/** Expands derived variables. Both compilers run this first, so they cannot diverge. */
function normalizar(no: No, hoje: Date): NoResolvido {
  if (isGrupo(no)) {
    return { operador: no.operador, condicoes: no.condicoes.map((c) => normalizar(c, hoje)) }
  }

  const v = POR_ID.get(no.variavel)
  if (!v) throw new FiltroError(`Variável desconhecida: "${no.variavel}".`)

  if (v.derivada) return v.derivada(no, hoje)

  if (!v.coluna) {
    // Unreachable: the catalog test asserts every entry has a column or a
    // derivation. A guard, not a user-facing error.
    throw new FiltroError(`Variável "${no.variavel}" não tem coluna e não foi derivada.`)
  }

  return { coluna: v.coluna, operador: no.operador, valor: no.valor }
}

// ─── Compilador 1: PostgREST (browser, sob RLS) ─────────────────────────────

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

/**
 * Returns the string to hand to `.or()`:
 *
 *   const filtro = compileToPostgrest(arvore)
 *   supabase.from('mercado_explorador').select('*', { count: 'exact' }).or(filtro)
 *
 * `.or()` on a single top-level and(...) is logically that and(...), which is
 * why a top-level AND group is not a special case.
 */
export function compileToPostgrest(arvore: unknown, hoje: Date = new Date()): string {
  const raiz = normalizar(parseArvore(arvore), hoje)
  return pgrstNo(raiz)
}

// ─── Compilador 2: SQL parametrizado (worker, confiável) ────────────────────

export interface SqlCompilado {
  /** WHERE clause body, with $1..$n placeholders. Never contains a literal value. */
  text: string
  values: unknown[]
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

export function compileToSql(arvore: unknown, hoje: Date = new Date()): SqlCompilado {
  const raiz = normalizar(parseArvore(arvore), hoje)
  const values: unknown[] = []
  const text = sqlNo(raiz, values)
  return { text, values }
}

// ─── Leitura humana (UI: "regra atual", card de confirmação da IA) ──────────

export function descrever(no: No, nivel = 0): string {
  if (isGrupo(no)) {
    const juncao = no.operador === 'e' ? ' E ' : ' OU '
    const partes = no.condicoes.map((c) => descrever(c, nivel + 1))
    const texto = partes.join(juncao)
    return nivel === 0 ? texto : `(${texto})`
  }

  const v = POR_ID.get(no.variavel)
  const label = v?.label ?? no.variavel
  const op = OPERADOR_LABELS[no.operador]

  if (OPERADORES_SEM_VALOR.includes(no.operador)) return `${label} ${op}`
  if (Array.isArray(no.valor)) {
    return no.operador === 'entre'
      ? `${label} ${op} ${no.valor[0]} e ${no.valor[1]}`
      : `${label} ${op} ${no.valor.join(', ')}`
  }
  return `${label} ${op} ${String(no.valor)}`
}
