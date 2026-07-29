/**
 * Prioridade dos cargos-alvo do Apollo (§4).
 *
 * Isto decide QUEM entra nos slots pagos: a busca do Apollo devolve até 25 pessoas
 * de graça, e só as `max_contatos_por_empresa` primeiras vão para o bulk_match, que
 * cobra por contato revelado. Ordenar errado não quebra nada visível — só gasta o
 * orçamento com quem não interessa. Na primeira leva, sem ordenação nenhuma,
 * "Construction Manager" levou 24% dos contatos revelados enquanto CFOs entravam
 * por sorte de posição na resposta.
 *
 * Mora no core, e não no worker, porque é regra de negócio pura e testável — o
 * worker só faz o IO em volta.
 */

/** O mínimo que a ordenação precisa; o resto do payload do Apollo é irrelevante aqui. */
export interface CandidatoCargo {
  seniority?: string
  departments?: string[]
}

export interface PrioridadeCargos {
  /** Ordem = prioridade. A primeira senioridade da lista ganha os primeiros slots. */
  senioridades: string[]
  /** Só desempata (ver `foraDoDepartamentoAlvo`) — nunca elimina. */
  departamentos: string[]
}

/**
 * Departamento NUNCA filtra, só desempata: sócios e diretores costumam vir com
 * `departments` vazio no Apollo, e cortá-los por isso descartaria justamente os
 * melhores alvos. (Também não dá para filtrar na API: `person_departments` não é
 * parâmetro do People Search — o Apollo o descarta em silêncio.)
 *
 * O Apollo devolve `master_finance`, `master_engineering_technical`, `c_suite`…,
 * enquanto o settings guarda o termo curto ('finance'); casa nos dois sentidos.
 */
function foraDoDepartamentoAlvo(p: CandidatoCargo, departamentos: string[]): number {
  const dep = (p.departments?.[0] ?? '').replace(/^master_/, '')
  if (!dep) return 1
  return departamentos.some((d) => d && (dep.includes(d) || d.includes(dep))) ? 0 : 1
}

/** Senioridade fora da lista vai para o fim, nunca para o começo. */
function rankSenioridade(p: CandidatoCargo, senioridades: string[]): number {
  const i = senioridades.indexOf(p.seniority ?? '')
  return i === -1 ? senioridades.length : i
}

/** Ordena por senioridade e, em empate, por departamento-alvo. Estável e não muta a entrada. */
export function ordenarPorAlvo<T extends CandidatoCargo>(pessoas: readonly T[], alvo: PrioridadeCargos): T[] {
  return [...pessoas].sort(
    (a, b) =>
      rankSenioridade(a, alvo.senioridades) - rankSenioridade(b, alvo.senioridades) ||
      foraDoDepartamentoAlvo(a, alvo.departamentos) - foraDoDepartamentoAlvo(b, alvo.departamentos),
  )
}
