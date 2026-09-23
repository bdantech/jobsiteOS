import type { Tables, Views } from '@jobsiteos/core'

/** Uma linha do funil de Sacados por NF — a mesma superfície da web. */
export type SacadoProspeccao = Views<'sacados_prospeccao_view'>
export type QuebraFornecedor = Tables<'sacados_prospeccao_fornecedores'>

export interface PainelProspeccao {
  tem_acesso: boolean
  escopo?: 'todos' | 'originador'
  sacados?: number
  volume_observado?: number
  valor_operavel?: number
  valor_esperado_mensal?: number
  travados_na_esteira?: number
  sem_dono?: number
}

export interface NotaDoCard {
  access_key: string
  numero: string | null
  serie: string | null
  fornecedor_cnpj: string
  fornecedor_nome: string | null
  valor: number
  emitida_em: string | null
  vencimento: string | null
  dias_para_vencimento: number | null
  operavel: boolean
}

export interface NotasDoCard {
  cnpj_sacado: string
  prazo_minimo_operavel_dias: number
  prazo_minimo_origem: 'medido' | 'configurado' | null
  notas: NotaDoCard[]
}

/**
 * Só o pedaço da config que o celular usa. O resto da régua é `webOnly` (§8) — e
 * carregar aqui o que não se pode editar seria peso sem uso numa rede de obra.
 */
export interface ConfigProspeccao {
  janelas: { janela_emissao_dias: number; janela_recorrencia_meses: number }
  motivos_descarte: { id: string; label: string }[]
  templates: { abordagem_fornecedor: string; pedido_ponte: string }
}

/**
 * Um pedido de apresentação — o originador pede ao fornecedor que o apresente ao
 * sacado (ou o contrário, e é para isso que existe `direcao`).
 */
export interface PedidoApresentacao {
  id: string
  fornecedor_cnpj: string | null
  sacado_cnpj: string | null
  mensagem: string | null
  status: string | null
  direcao: string | null
  criado_em: string | null
  respondido_em: string | null
}
