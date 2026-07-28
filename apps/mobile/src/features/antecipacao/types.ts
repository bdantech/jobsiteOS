import type { Tables, Views } from '@jobsiteos/core'

/** Uma linha da view do funil — a superfície única do módulo. */
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
}

/** Notas + contexto de fornecedor, resolvido numa leitura só (nunca N+1 no celular). */
export interface PaginaFunil {
  notas: NotaFunil[]
  fornecedores: Map<string, FornecedorFunil>
  total: number
}

export interface DetalheSacado {
  sacado: SacadoFunil | null
  prospect: SacadoProspectar | null
  notas: NotaFunil[]
}

export interface DetalheFornecedor {
  fornecedor: FornecedorFunil | null
  notas: NotaFunil[]
  contatos: Contato[]
  toques: EventoEmpresa[]
  /** Template de WhatsApp da melhor faixa do fornecedor, já renderizado. */
  mensagemSugerida: string | null
}
