import {
  FiltroError,
  OPERADOR_LABELS,
  isGrupo,
  type Condicao,
  type FiltroEngine,
  type Grupo,
  type No,
  type Operador,
  type VariavelCatalogo,
} from '@jobsiteos/core'

/**
 * Edições imutáveis sobre a árvore de filtros, endereçadas por CAMINHO (os
 * índices a percorrer desde a raiz). O construtor nunca muta: toda mudança produz
 * uma árvore nova, que é o que permite ao React re-renderizar a partir dela e o
 * que faz "cancelar" ser um no-op em vez de um undo.
 *
 * NADA aqui decide o que é legal — o CATÁLOGO do engine decide. Este módulo é
 * genérico sobre o engine justamente porque existem dois: o do Mercado (sobre
 * `mercado_explorador`) e o das faixas da Antecipação (sobre `notas_funil`). O
 * construtor visual é o mesmo; o vocabulário não.
 */

export type Caminho = readonly number[]

// ─── Operadores: independem de catálogo ─────────────────────────────────────

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

/**
 * A forma de `valor` é função de (tipo, operador) e de nada mais. Mudar qualquer
 * um dos dois quase sempre torna o valor antigo a FORMA errada (um número onde
 * agora se espera um par), então ele é reconstruído em vez de coagido.
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

// ─── Navegação e edição: independem de catálogo ─────────────────────────────

function ehGrupo(no: No): no is Grupo {
  return isGrupo(no)
}

/** O primeiro passo de um caminho e o resto dele, ou null para o caminho vazio. */
function passo(caminho: Caminho): { indice: number; resto: Caminho } | null {
  const indice = caminho[0]
  if (indice === undefined) return null
  return { indice, resto: caminho.slice(1) }
}

/** Substitui o nó em `caminho`. Um caminho vazio substitui a raiz. */
export function substituir(raiz: Grupo, caminho: Caminho, novo: No): Grupo {
  const p = passo(caminho)
  // A raiz é sempre um grupo — o arvoreSchema do engine exige isso.
  if (!p) return ehGrupo(novo) ? novo : raiz

  const alvo = raiz.condicoes[p.indice]
  if (alvo === undefined) return raiz

  const substituido: No =
    p.resto.length === 0 ? novo : ehGrupo(alvo) ? substituir(alvo, p.resto, novo) : alvo

  const condicoes = [...raiz.condicoes]
  condicoes[p.indice] = substituido
  return { ...raiz, condicoes }
}

/** Remove o nó em `caminho`. Nunca esvazia um grupo abaixo de uma condição. */
export function remover(raiz: Grupo, caminho: Caminho): Grupo {
  const p = passo(caminho)
  if (!p) return raiz

  if (p.resto.length === 0) {
    // Um grupo com zero condições falha na validação, então a última linha de um
    // grupo não é removível — a UI desabilita o botão, e isto é o backstop.
    if (raiz.condicoes.length <= 1) return raiz
    return { ...raiz, condicoes: raiz.condicoes.filter((_, i) => i !== p.indice) }
  }

  const alvo = raiz.condicoes[p.indice]
  if (alvo === undefined || !ehGrupo(alvo)) return raiz

  const condicoes = [...raiz.condicoes]
  condicoes[p.indice] = remover(alvo, p.resto)
  return { ...raiz, condicoes }
}

/** Acrescenta um nó ao GRUPO em `caminho`. */
export function adicionar(raiz: Grupo, caminho: Caminho, no: No): Grupo {
  const p = passo(caminho)
  if (!p) return { ...raiz, condicoes: [...raiz.condicoes, no] }

  const alvo = raiz.condicoes[p.indice]
  if (alvo === undefined || !ehGrupo(alvo)) return raiz

  const condicoes = [...raiz.condicoes]
  condicoes[p.indice] = adicionar(alvo, p.resto, no)
  return { ...raiz, condicoes }
}

/** Alterna um grupo entre E e OU. */
export function trocarOperadorGrupo(raiz: Grupo, caminho: Caminho, operador: 'e' | 'ou'): Grupo {
  const p = passo(caminho)
  if (!p) return { ...raiz, operador }

  const alvo = raiz.condicoes[p.indice]
  if (alvo === undefined || !ehGrupo(alvo)) return raiz

  const condicoes = [...raiz.condicoes]
  condicoes[p.indice] = trocarOperadorGrupo(alvo, p.resto, operador)
  return { ...raiz, condicoes }
}

// ─── O que depende do catálogo ──────────────────────────────────────────────

export interface HelpersArvore {
  primeiroOperador: (id: string) => Operador
  condicaoPadrao: (variavelId?: string) => Condicao
  grupoPadrao: () => Grupo
  /** Tudo de errado com a árvore, em pt-BR. Vazio ⇒ seguro pré-visualizar e salvar. */
  problemasDaArvore: (raiz: Grupo) => string[]
  /** Uma `definicao` gravada (jsonb) pode ser anterior a uma mudança de catálogo. */
  arvoreDeJson: (definicao: unknown) => Grupo | null
}

export function criarHelpersArvore(engine: FiltroEngine): HelpersArvore {
  /**
   * O catálogo é um array não vazio e toda entrada aceita ao menos um operador
   * (o teste do engine garante), mas `noUncheckedIndexedAccess` não sabe disso.
   * Estas duas funções estreitam uma vez, aqui, em vez de em cada chamada.
   */
  function variavelOuPrimeira(id?: string): VariavelCatalogo {
    const v = (id !== undefined ? engine.variavel(id) : undefined) ?? engine.catalogo[0]
    if (!v) throw new Error('O catálogo de filtros está vazio.')
    return v
  }

  function primeiroOperador(id: string): Operador {
    const operador = engine.operadoresDe(id)[0]
    if (!operador) throw new Error(`A variável "${id}" não aceita nenhum operador.`)
    return operador
  }

  function condicaoPadrao(variavelId?: string): Condicao {
    const v = variavelOuPrimeira(variavelId)
    const operador = primeiroOperador(v.id)
    return { variavel: v.id, operador, valor: valorPadrao(v, operador) }
  }

  function grupoPadrao(): Grupo {
    return { operador: 'e', condicoes: [condicaoPadrao()] }
  }

  /**
   * O zod do engine rejeita valor ausente, lista vazia e tipo errado — mas NÃO
   * string vazia: `uf igual ""` é uma árvore válida que compila para `uf.eq.""` e
   * silenciosamente não casa nada. Uma linha meio preenchida é um erro, não um
   * filtro, então é pega AQUI, antes de o dry-run rodar e reportar um zero
   * confiante e errado.
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

    const v = engine.variavel(no.variavel)
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

  return {
    primeiroOperador,
    condicaoPadrao,
    grupoPadrao,
    problemasDaArvore(raiz: Grupo): string[] {
      const problemas: string[] = []
      problemasDoNo(raiz, problemas)
      if (problemas.length > 0) return problemas

      // O engine tem a última palavra: mesmo schema que o servidor re-roda.
      try {
        engine.parseArvore(raiz)
      } catch (error) {
        problemas.push(error instanceof FiltroError ? error.message : 'Regra inválida.')
      }
      return problemas
    },
    arvoreDeJson(definicao: unknown): Grupo | null {
      try {
        return engine.parseArvore(definicao)
      } catch {
        return null
      }
    },
  }
}
