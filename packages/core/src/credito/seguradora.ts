/**
 * A seguradora, atrás de uma interface (04d §4.2).
 *
 * O prompt pede "provedor plugável" e o motivo é concreto: a Atradius é a de hoje, não a
 * definição do problema. Trocar de seguradora (ou operar duas) tem de ser escrever um
 * arquivo novo, não refatorar a esteira.
 *
 * A interface vive no CORE e a implementação no worker porque só o worker tem as
 * credenciais — e porque este arquivo precisa ser importável pela web (para os tipos das
 * telas) sem arrastar um cliente HTTP junto.
 *
 * ── A regra de custo, que é de desenho e não de implementação ──────────────────
 * `resolverBuyer` PODE SER COBRADO pela seguradora. Por isso ele não aparece em nenhum
 * caminho de lote, varredura ou pré-cálculo: a única chamada está no envio de uma
 * análise, que é um clique humano deliberado. O backfill (§4.3) usa `listarPortfolio` e
 * `listarDecisoes`, que leem o que a apólice JÁ tem, e só chama `detalharBuyer` para
 * buyers que vieram nessas listas. Busca aberta de buyer não existe neste arquivo — e é
 * por isso que não existe um método para ela.
 */

export type EstagioSeguradora =
  | 'em_analise'
  | 'aprovada'
  | 'aprovada_parcial'
  | 'negada'
  | 'expirada'
  | 'cancelada'

export interface BuyerSeguradora {
  buyer_id: string
  /** Identificador nacional devolvido pela seguradora — no Brasil, o CNPJ. */
  identificador_nacional: string | null
  nome: string | null
  rating: string | null
}

export interface DecisaoSeguradora {
  case_id: string
  buyer_id: string
  estagio: EstagioSeguradora
  limite_aprovado: number | null
  moeda: string
  /** Data de validade da cobertura, em AAAA-MM-DD. */
  expira_em: string | null
  decidida_em: string | null
  motivo: string | null
  rating: string | null
}

export interface PedidoCobertura {
  buyer_id: string
  limite_solicitado: number
  moeda: string
  /** Referência nossa, para reconciliar o retorno com a linha da esteira. */
  referencia_externa: string
}

/**
 * Toda operação devolve um resultado discriminado em vez de lançar: o job precisa
 * distinguir "a seguradora respondeu que não" de "não consegui falar com a seguradora",
 * e uma exceção genérica apaga essa diferença justamente onde ela decide se o item é
 * retentado ou encerrado.
 */
export type ResultadoSeguradora<T> =
  | { ok: true; dados: T }
  | { ok: false; erro: string; recuperavel: boolean }

export interface Seguradora {
  readonly id: string
  readonly nome: string
  /** False quando faltam credenciais. A esteira usa isto para explicar em vez de falhar. */
  configurada(): boolean

  /**
   * Resolve o buyer pelo identificador nacional (CNPJ). **PODE SER COBRADO.**
   * Só é chamado no envio de uma análise — nunca em lote, nunca especulativamente.
   */
  resolverBuyer(cnpj: string): Promise<ResultadoSeguradora<BuyerSeguradora | null>>

  /** Detalha um buyer que JÁ veio de uma listagem da apólice. */
  detalharBuyer(buyerId: string): Promise<ResultadoSeguradora<BuyerSeguradora | null>>

  /** Submete o pedido de cobertura. */
  pedirCobertura(pedido: PedidoCobertura): Promise<ResultadoSeguradora<{ case_id: string }>>

  /** Estado atual de um pedido. Usado pelo poll. */
  consultarDecisao(caseId: string): Promise<ResultadoSeguradora<DecisaoSeguradora | null>>

  /** Limites vigentes na apólice. Leitura do que já existe — não descobre buyer novo. */
  listarPortfolio(cursor?: string): Promise<
    ResultadoSeguradora<{ itens: DecisaoSeguradora[]; proximoCursor: string | null }>
  >

  /** Decisões da apólice (histórico e pendentes). Mesma restrição do portfólio. */
  listarDecisoes(
    desde?: string,
    cursor?: string,
  ): Promise<ResultadoSeguradora<{ itens: DecisaoSeguradora[]; proximoCursor: string | null }>>
}

/** Mapeia o estágio devolvido pela seguradora para o vocabulário da esteira. */
export function estagioDaDecisao(e: EstagioSeguradora): string {
  return e
}

/**
 * Uma redução de limite é um evento próprio, e não um caso dentro de "atualizada":
 * a seguradora cortando cobertura que já tinha concedido é o sinal de risco mais forte
 * que este sistema recebe de fora, e ele não pode depender de alguém estar olhando a
 * esteira no dia certo.
 */
export function houveReducaoDeLimite(
  anterior: number | null | undefined,
  novo: number | null | undefined,
): boolean {
  const a = Number(anterior ?? 0)
  const n = Number(novo ?? 0)
  return a > 0 && n < a
}
