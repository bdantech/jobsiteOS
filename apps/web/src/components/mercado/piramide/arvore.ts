import {
  CATALOGO,
  FiltroError,
  OPERADOR_LABELS,
  isGrupo,
  operadoresDe,
  parseArvore,
  variavel,
  type Condicao,
  type Grupo,
  type No,
  type Operador,
  type VariavelCatalogo,
} from '@jobsiteos/core'

/**
 * Immutable edits over the filter tree, addressed by PATH (the indices to walk
 * from the root). The builder never mutates: every change produces a new tree,
 * which is what lets React re-render from it and what lets "cancelar" be a
 * no-op instead of an undo.
 *
 * NOTHING here decides what is legal — the catalog and `operadoresDe()` do. The
 * builder only ever offers operators the engine accepts, so a tree that fails
 * validation on save is not something a user can produce by clicking.
 */

export type Caminho = readonly number[]

// ─── Operadores sem valor / com lista ───────────────────────────────────────

const SEM_VALOR: readonly Operador[] = ['definido', 'nao_definido']
const COM_LISTA: readonly Operador[] = ['em', 'nao_em', 'contem_algum']

export function pedeValor(operador: Operador): boolean {
  return !SEM_VALOR.includes(operador)
}

export function pedeLista(operador: Operador): boolean {
  return COM_LISTA.includes(operador)
}

export function pedeIntervalo(operador: Operador): boolean {
  return operador === 'entre'
}

export function labelOperador(operador: Operador): string {
  return OPERADOR_LABELS[operador]
}

// ─── Valores padrão ─────────────────────────────────────────────────────────

/**
 * The shape of `valor` is a function of (tipo, operador) and of nothing else.
 * Change either and the old value is almost always the wrong SHAPE (a number
 * where a pair is now expected), so it is rebuilt rather than coerced.
 */
export function valorPadrao(v: VariavelCatalogo, operador: Operador): unknown {
  if (!pedeValor(operador)) return undefined
  if (pedeIntervalo(operador)) return v.tipo === 'numero' ? [0, 0] : ['', '']
  if (pedeLista(operador)) return []

  switch (v.tipo) {
    case 'booleano':
      return true
    case 'numero':
      return 0
    case 'enum':
      return v.opcoes?.[0] ?? ''
    default:
      return ''
  }
}

/**
 * The catalog is a non-empty `as const` array and every entry has at least one
 * legal operator (the engine's own test asserts it), but `noUncheckedIndexedAccess`
 * does not know that. These two narrow it once, here, instead of at every call.
 */
function variavelOuPrimeira(id?: string): VariavelCatalogo {
  const v = (id !== undefined ? variavel(id) : undefined) ?? CATALOGO[0]
  if (!v) throw new Error('O catálogo de filtros está vazio.')
  return v
}

export function primeiroOperador(id: string): Operador {
  const operador = operadoresDe(id)[0]
  if (!operador) throw new Error(`A variável "${id}" não aceita nenhum operador.`)
  return operador
}

export function condicaoPadrao(variavelId?: string): Condicao {
  const v = variavelOuPrimeira(variavelId)
  const operador = primeiroOperador(v.id)
  return { variavel: v.id, operador, valor: valorPadrao(v, operador) }
}

export function grupoPadrao(): Grupo {
  return { operador: 'e', condicoes: [condicaoPadrao()] }
}

// ─── Navegação e edição ─────────────────────────────────────────────────────

function ehGrupo(no: No): no is Grupo {
  return isGrupo(no)
}

/** The first step of a path and the rest of it, or null for the empty path. */
function passo(caminho: Caminho): { indice: number; resto: Caminho } | null {
  const indice = caminho[0]
  if (indice === undefined) return null
  return { indice, resto: caminho.slice(1) }
}

/** Replaces the node at `caminho`. An empty path replaces the root. */
export function substituir(raiz: Grupo, caminho: Caminho, novo: No): Grupo {
  const p = passo(caminho)
  // The root is always a group — the engine's arvoreSchema demands it.
  if (!p) return ehGrupo(novo) ? novo : raiz

  const alvo = raiz.condicoes[p.indice]
  if (alvo === undefined) return raiz

  const substituido: No =
    p.resto.length === 0 ? novo : ehGrupo(alvo) ? substituir(alvo, p.resto, novo) : alvo

  const condicoes = [...raiz.condicoes]
  condicoes[p.indice] = substituido
  return { ...raiz, condicoes }
}

/** Removes the node at `caminho`. Never empties a group below one condition. */
export function remover(raiz: Grupo, caminho: Caminho): Grupo {
  const p = passo(caminho)
  if (!p) return raiz

  if (p.resto.length === 0) {
    // A group with zero conditions fails validation ("um grupo precisa de ao
    // menos uma condição"), so the last row of a group is not removable — the
    // UI disables the button, and this is the backstop.
    if (raiz.condicoes.length <= 1) return raiz
    return { ...raiz, condicoes: raiz.condicoes.filter((_, i) => i !== p.indice) }
  }

  const alvo = raiz.condicoes[p.indice]
  if (alvo === undefined || !ehGrupo(alvo)) return raiz

  const condicoes = [...raiz.condicoes]
  condicoes[p.indice] = remover(alvo, p.resto)
  return { ...raiz, condicoes }
}

/** Appends a node to the GROUP at `caminho`. */
export function adicionar(raiz: Grupo, caminho: Caminho, no: No): Grupo {
  const p = passo(caminho)
  if (!p) return { ...raiz, condicoes: [...raiz.condicoes, no] }

  const alvo = raiz.condicoes[p.indice]
  if (alvo === undefined || !ehGrupo(alvo)) return raiz

  const condicoes = [...raiz.condicoes]
  condicoes[p.indice] = adicionar(alvo, p.resto, no)
  return { ...raiz, condicoes }
}

/** Flips a group between E and OU. */
export function trocarOperadorGrupo(raiz: Grupo, caminho: Caminho, operador: 'e' | 'ou'): Grupo {
  const p = passo(caminho)
  if (!p) return { ...raiz, operador }

  const alvo = raiz.condicoes[p.indice]
  if (alvo === undefined || !ehGrupo(alvo)) return raiz

  const condicoes = [...raiz.condicoes]
  condicoes[p.indice] = trocarOperadorGrupo(alvo, p.resto, operador)
  return { ...raiz, condicoes }
}

// ─── Validação ──────────────────────────────────────────────────────────────

/**
 * The engine's zod schema rejects a missing value, an empty list and a wrong
 * type — but NOT an empty string: `uf igual ""` is a valid tree that compiles to
 * `uf.eq.""` and quietly matches nothing. A half-filled row is a mistake, not a
 * filter, so it is caught here BEFORE the dry-run count is run against 2M rows
 * and reports a confident, wrong zero.
 */
function vazio(valor: unknown): boolean {
  return valor === undefined || valor === null || (typeof valor === 'string' && valor.trim() === '')
}

function problemasDoNo(no: No, problemas: string[]): void {
  if (ehGrupo(no)) {
    if (no.condicoes.length === 0) {
      problemas.push('Um grupo precisa de ao menos uma condição.')
      return
    }
    for (const filho of no.condicoes) problemasDoNo(filho, problemas)
    return
  }

  const v = variavel(no.variavel)
  if (!v) {
    problemas.push(`Variável desconhecida: "${no.variavel}".`)
    return
  }

  if (!pedeValor(no.operador)) return

  if (pedeLista(no.operador)) {
    const lista = Array.isArray(no.valor) ? no.valor : []
    if (lista.length === 0) problemas.push(`"${v.label}" precisa de ao menos um valor.`)
    else if (lista.some(vazio)) problemas.push(`"${v.label}" tem um valor em branco na lista.`)
    return
  }

  if (pedeIntervalo(no.operador)) {
    const par = Array.isArray(no.valor) ? no.valor : []
    if (par.length !== 2 || par.some(vazio)) {
      problemas.push(`"${v.label}" precisa dos dois extremos do intervalo.`)
    }
    return
  }

  if (vazio(no.valor)) problemas.push(`"${v.label}" precisa de um valor.`)
}

/** Everything wrong with the tree, in pt-BR. Empty ⇒ safe to preview and save. */
export function problemasDaArvore(raiz: Grupo): string[] {
  const problemas: string[] = []
  problemasDoNo(raiz, problemas)

  if (problemas.length > 0) return problemas

  // The engine has the last word: same schema the server re-runs on save.
  try {
    parseArvore(raiz)
  } catch (error) {
    problemas.push(error instanceof FiltroError ? error.message : 'Regra inválida.')
  }

  return problemas
}

/**
 * A stored `definicao` (jsonb) is untyped and may predate a catalog change — a
 * rule whose variable was removed must render as "inválida", not crash the page.
 */
export function arvoreDeJson(definicao: unknown): Grupo | null {
  try {
    return parseArvore(definicao)
  } catch {
    return null
  }
}
