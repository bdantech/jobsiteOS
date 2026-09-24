import type { Tables, Views } from '@jobsiteos/core'

/**
 * Uma OPORTUNIDADE do funil — nota fiscal, pré-autorização ou título do Sienge.
 *
 * O funil deixou de ser uma lista de notas no 04s. `funil_oportunidades` é a
 * união das três fontes e dá o formato; quem PAGINA lê a view da FONTE e junta
 * no cliente (`juntarPaginas`), porque o `union all` é barreira de otimização e
 * já tirou o funil do ar uma vez — 1,85 ms viraram 8.382 ms.
 */
export type Oportunidade = Views<'funil_oportunidades'>

/**
 * A linha de `notas_funil`, que continua existindo para as telas que são SOBRE A
 * NOTA: o detalhe do fornecedor e o do sacado listam notas fiscais, não os três
 * tipos. É a mesma divisão que a web faz.
 */
export type NotaFunil = Views<'notas_funil'>
export type FornecedorFunil = Views<'antecipacao_fornecedores'>
export type SacadoFunil = Views<'antecipacao_sacados'>
export type SacadoProspectar = Views<'antecipacao_sacados_a_prospectar'>
export type Contato = Tables<'contatos'>
export type EventoEmpresa = Tables<'empresa_eventos'>

export interface FiltrosFunil {
  estagio: string
  faixa?: string
  tipagem?: string
  termo?: string
  /** Só as notas roteadas para esta carteira — o funil de NFs do originador. */
  vendedorId?: string
}

/** Oportunidades + contexto de fornecedor, numa leitura só (nunca N+1 no celular). */
export interface PaginaFunil {
  oportunidades: Oportunidade[]
  fornecedores: Map<string, FornecedorFunil>
  total: number
}

export interface DetalheSacado {
  sacado: SacadoFunil | null
  prospect: SacadoProspectar | null
  notas: Oportunidade[]
}

export interface DetalheFornecedor {
  fornecedor: FornecedorFunil | null
  notas: Oportunidade[]
  contatos: Contato[]
  toques: EventoEmpresa[]
  /** Template de WhatsApp da melhor faixa do fornecedor, já renderizado. */
  mensagemSugerida: string | null
}
