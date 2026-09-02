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
  /**
   * Corta ANTES de qualquer regra de entrada, inclusive prioritários. Para áreas que
   * nunca decidem antecipação: RH, marketing, vendas, TI. Sem isto, "Diretora Gente
   * & Cultura" e "Business Partner" entram por 'diretor' e 'partner'.
   */
  excluir_titulos?: string[]
  /** Idem, por departamento do Apollo (`human_resources`, `sales`…). */
  excluir_departamentos?: string[]
  /**
   * ORDEM = PRIORIDADE, da maior senioridade para a menor. Só ordena: quem está
   * fora da lista (ou sem senioridade nenhuma) vai para o fim da fila, não é
   * eliminado — eliminar por aqui descartava diretor que o Apollo marcou 'senior'.
   */
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
 *
 * Mas trecho puro é armadilha com sigla: `includes('coo')` casa "COOrdenador de
 * Recrutamento", e foi assim que duas pessoas de RH entraram num lote pago. Então:
 *
 * - termo curto (≤4, as siglas — COO, CFO, CEO, BP): tem de ser palavra isolada;
 * - termo longo: basta INICIAR uma palavra, para 'diretor' casar "Diretora".
 *
 * Nos dois casos o match começa em limite de palavra — 'finance' não casa
 * "refinanciamento".
 */
const TAMANHO_SIGLA = 4

function casaUm(alvoNormalizado: string, termo: string): boolean {
  const t = normalizar(termo).trim()
  if (!t) return false
  const escapado = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const fim = t.length <= TAMANHO_SIGLA ? '(?![a-z0-9])' : ''
  return new RegExp(`(?<![a-z0-9])${escapado}${fim}`).test(alvoNormalizado)
}

function casa(texto: string | undefined, termos: string[] | undefined): boolean {
  if (!texto || !termos?.length) return false
  const alvo = normalizar(texto)
  return termos.some((t) => casaUm(alvo, t))
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

/** Vetado por área, independente de cargo ou senioridade. Vence todas as outras regras. */
export function ehExcluido(p: CandidatoCargo, cfg: CargosAlvo): boolean {
  return casa(p.title, cfg.excluir_titulos) || casa(departamentoDe(p), cfg.excluir_departamentos)
}

/**
 * Entra quem casa a lista de cargos-alvo pelo TÍTULO, mais duas exceções que passam
 * com título fora da lista: os prioritários (um sócio aparece como "Owner Partner",
 * um financeiro como "Comptroller", sem casar termo nenhum) e o alto escalão de
 * `senioridades_qualificam`.
 *
 * A única barreira que vem ANTES dessas portas é a área vetada (`excluir_*`): RH e
 * vendas não decidem antecipação.
 *
 * ── A SENIORIDADE DEIXOU DE ELIMINAR ───────────────────────────────────────
 * Havia aqui uma allow-list: sem `seniority` dentro de `cfg.senioridades`, ninguém
 * passava — nem casando o título, nem como prioritário. A intenção era barrar
 * estagiário e analista, e o efeito colateral era grande demais: o Apollo classifica
 * boa parte dos cargos brasileiros como 'senior' ou não classifica, e um "Diretor
 * Financeiro" marcado assim era descartado em silêncio. Foi o que fez 12 empresas
 * terminarem com "nenhuma pessoa nos cargos-alvo" tendo 742 pessoas à vista.
 *
 * `cfg.senioridades` continua existindo e continua importando — mas como ORDEM, em
 * `selecionarAlvos`: quem tem senioridade reconhecida sobe, quem não tem desce para
 * o fim da fila. Como o corte pago acontece em `max_contatos_por_empresa`, o efeito
 * prático é que os desconhecidos só são revelados quando não há gente melhor.
 *
 * Isso NÃO vale para os prioritários, que são a primeira chave da ordenação: um
 * "Finance Department Intern" casa 'finance' e vai para o topo da fila paga. Quem
 * quiser barrá-lo tem `excluir_titulos`, que é a ferramenta certa para isso — ela
 * olha o cargo, e não um rótulo que o provedor pode não ter posto.
 *
 * Departamento de propósito NÃO qualifica: `master_operations` deixaria entrar todo
 * "Construction Manager" da obra, que é exatamente o que se quer evitar.
 */
export function qualifica(p: CandidatoCargo, cfg: CargosAlvo): boolean {
  if (ehExcluido(p, cfg)) return false
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
