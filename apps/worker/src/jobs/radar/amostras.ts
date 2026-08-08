import type { AmostraCalibracao } from '../../../../../packages/core/src/radar/faturamento.js'

/**
 * A linha crua da consulta de amostras, e a regra de como ela vira amostra.
 *
 * Mora fora do estimador.ts porque é a única parte daquele caminho que dá para
 * testar sem banco — e é justamente a parte que, se estiver errada, erra em
 * silêncio: uma amostra montada com o sinal errado não falha, ela só desloca a
 * régua de 4 mil empresas.
 */

export interface LinhaAmostra {
  cnpj: string
  /** `numeric` do Postgres chega como string. */
  valor: string
  origem: string
  tipo: string | null
  funcionarios: number | null
  erp_mrr: string | null
  qtd_usuarios_erp: number | null
}

export interface AmostraComOrigem extends AmostraCalibracao {
  origem_faturamento: 'declarado_cliente' | 'publicacao'
}

/**
 * O faturamento pode vir do cliente ou de ranking publicado. O SINAL, não.
 *
 * `funcionarios` é descartado nas amostras publicadas: o ranking informa PESSOAL
 * GRADUADO e a base é medida pelo Apollo, que conta perfis do LinkedIn. Nas 4
 * empresas onde temos os dois, a razão Apollo/graduado deu 3,43 — com p10 em 1,98 e
 * p90 em 5,75. Isso é espalhamento, não fator de conversão: não dá para corrigir um
 * no outro. Calibrar em graduado e aplicar em Apollo multiplicaria a estimativa da
 * base por volta de 6, em silêncio.
 *
 * MRR e usuários do ERP atravessam porque saem do NOSSO sistema nas duas
 * procedências — só o rótulo (o faturamento) muda de fonte.
 */
export function montarAmostra(linha: LinhaAmostra): AmostraComOrigem {
  const publicada = linha.origem === 'publicacao'

  return {
    tipo: linha.tipo,
    faturamento_declarado: Number(linha.valor),
    funcionarios: publicada ? null : linha.funcionarios,
    erp_mrr: linha.erp_mrr === null ? null : Number(linha.erp_mrr),
    qtd_usuarios_erp: linha.qtd_usuarios_erp,
    origem_faturamento: publicada ? 'publicacao' : 'declarado_cliente',
  }
}
