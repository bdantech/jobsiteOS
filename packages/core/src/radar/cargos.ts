/**
 * Seleção e prioridade dos cargos-alvo do Apollo (§4).
 *
 * A busca do Apollo (`mixed_people/api_search`) é GRÁTIS e devolve a empresa
 * inteira; o `bulk_match` é que cobra, por contato revelado. Então o filtro tem de
 * acontecer AQUI, entre as duas: varremos todo mundo sem pagar nada, escolhemos, e
 * só então revelamos os escolhidos.
 *
 * Filtrar no Apollo não funciona: `person_titles` e `person_seniorities` se
 * combinam por OR, então pedir "sócio, CFO" + "manager" traz todo manager da
 * empresa — foi assim que "Construction Manager" ficou com um terço dos contatos
 * pagos. `person_departments` nem existe na API. Aqui a regra é nossa e testável.
 *
 * Ordem de preferência:
 *   1. donos e financeiro (`prioritarios`) furam a fila;
 *   2. dentro de cada grupo, senioridade da maior para a menor;
 *   3. empatou, quem está num departamento-alvo vem antes.
 */

/** O que a busca do Apollo devolve limpo (nome e e-mail vêm mascarados — não servem aqui). */
export interface CandidatoCargo {
  title?: string
  seniority?: string
  departments?: string[]
}

/** Quem fura a fila. Basta casar UM dos três critérios. */
export interface GrupoPrioritario {
  titulos?: string[]
  departamentos?: string[]
  senioridades?: string[]
}

export interface CargosAlvo {
  /** Termos que qualificam pelo cargo. Match por trecho, ignorando acento e caixa. */
  titulos: string[]
  /** Termos de departamento. Só desempatam — não qualificam nem eliminam ninguém. */
  departamentos: string[]
  /** ORDEM = PRIORIDADE, da maior senioridade para a menor. */
  senioridades: string[]
  /**
   * Senioridades que entram SEM depender do título. Existe porque o alto escalão
   * costuma vir em inglês — "Chief Operating Officer" não casa 'COO', "Managing
   * Director" não casa 'diretor' — e um C-level descartado por causa da grafia é o
   * pior erro possível aqui. Não inclua 'manager': é o que traz a obra de volta.
   */
  senioridades_qualificam?: string[]
  /** Donos e financeiro. Entram mesmo com um título que não casa `titulos`. */
  prioritarios?: GrupoPrioritario
  max_contatos_por_empresa: number
  /** Teto de páginas na busca (100 por página). Protege contra empresa gigante. */
  max_paginas_busca?: number
}

/** Sem acento e sem caixa: "Diretor Financeiro" e "diretor financeiro" são o mesmo termo. */
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * Match por trecho, e não por igualdade: os cargos reais do Apollo vêm sujos —
 * "◾ Head of Procurement at LBX Construtora", "CFO e DRI", "Gerente Geral de Obras /
 * Gerente de Contrato". Exigir título exato descartaria todos esses.
 */
function casa(texto: string | undefined, termos: string[] | undefined): boolean {
  if (!texto || !termos?.length) return false
  const alvo = normalizar(texto)
  return termos.some((t) => {
    const n = normalizar(t)
    return n.length > 0 && alvo.includes(n)
  })
}

/** O Apollo devolve `master_finance`, `master_engineering_technical`, `c_suite`… */
function departamentoDe(p: CandidatoCargo): string {
  return (p.departments?.[0] ?? '').replace(/^master_/, '')
}

/** Dono ou financeiro: entra na frente de todo o resto. */
export function ehPrioritario(p: CandidatoCargo, cfg: CargosAlvo): boolean {
  const pr = cfg.prioritarios
  if (!pr) return false
  return (
    casa(p.title, pr.titulos) ||
    casa(departamentoDe(p), pr.departamentos) ||
    (!!p.seniority && (pr.senioridades ?? []).includes(p.seniority))
  )
}

/**
 * Entra quem casa a lista de cargos-alvo pelo TÍTULO, mais duas exceções que passam
 * com título fora da lista: os prioritários (um sócio aparece como "Owner Partner",
 * um financeiro como "Comptroller", sem casar termo nenhum) e o alto escalão de
 * `senioridades_qualificam`.
 *
 * Departamento de propósito NÃO qualifica: `master_operations` deixaria entrar todo
 * "Construction Manager" da obra, que é exatamente o que se quer evitar.
 */
export function qualifica(p: CandidatoCargo, cfg: CargosAlvo): boolean {
  if (p.seniority && (cfg.senioridades_qualificam ?? []).includes(p.seniority)) return true
  return casa(p.title, cfg.titulos) || ehPrioritario(p, cfg)
}

/**
 * Filtra e ordena. O worker corta em `max_contatos_por_empresa` logo depois, e é
 * esse corte que vira fatura — o topo da lista tem de ser quem realmente interessa.
 */
export function selecionarAlvos<T extends CandidatoCargo>(pessoas: readonly T[], cfg: CargosAlvo): T[] {
  const rankSenioridade = (p: T): number => {
    const i = cfg.senioridades.indexOf(p.seniority ?? '')
    return i === -1 ? cfg.senioridades.length : i
  }
  const grupo = (p: T): number => (ehPrioritario(p, cfg) ? 0 : 1)
  const foraDoDepartamento = (p: T): number => (casa(departamentoDe(p), cfg.departamentos) ? 0 : 1)

  // sort() é estável: empate triplo preserva a ordem em que o Apollo devolveu.
  return pessoas
    .filter((p) => qualifica(p, cfg))
    .slice()
    .sort(
      (a, b) =>
        grupo(a) - grupo(b) || rankSenioridade(a) - rankSenioridade(b) || foraDoDepartamento(a) - foraDoDepartamento(b),
    )
}
