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
  /** Procedência do FATURAMENTO (o rótulo). */
  origem: string
  tipo: string | null
  funcionarios: number | null
  /** Procedência do HEADCOUNT (o sinal). É independente da de cima. */
  funcionarios_origem: string | null
  erp_mrr: string | null
  qtd_usuarios_erp: number | null
}

/**
 * Contagens que se comparam com a da base. O Apollo mede a base inteira; um
 * declarante que informou o próprio quadro mede a mesma coisa que o Apollo tenta
 * medir. `publicacao` (pessoal graduado) e `lista` não entram.
 */
const CONTAGENS_COMPATIVEIS = new Set(['apollo', 'apollo_search', 'declarado_cliente'])

export interface AmostraComOrigem extends AmostraCalibracao {
  origem_faturamento: 'declarado_cliente' | 'publicacao'
}

/**
 * O faturamento pode vir do cliente ou de ranking publicado. O SINAL, não.
 *
 * O headcount só entra quando a CONTAGEM é compatível com a da base. O ranking
 * informa PESSOAL GRADUADO e a base é medida pelo Apollo, que conta perfis do
 * LinkedIn. Nas 4 empresas onde temos as duas, a razão Apollo/graduado deu 3,43 —
 * com p10 em 1,98 e p90 em 5,75. Isso é espalhamento, não fator de conversão.
 * Calibrar em graduado e aplicar em Apollo multiplicaria a estimativa da base por
 * volta de 6, em silêncio.
 *
 * A regra olha `funcionarios_origem`, e NÃO a origem do faturamento — as duas são
 * independentes, e supor o contrário foi um bug real. Dois declarantes apareceram na
 * lista da revista: o faturamento deles continuou sendo o declarado (declarado vence
 * publicado no cache), mas o headcount virou graduado. Eles marcavam R$ 6,74 mi por
 * pessoa contra R$ 551 mil dos outros quinze, e teriam puxado a régua de headcount
 * em +44% sozinhos.
 *
 * MRR e usuários do ERP atravessam sempre: saem do NOSSO sistema em qualquer
 * procedência — só o rótulo (o faturamento) muda de fonte.
 */
export function montarAmostra(linha: LinhaAmostra): AmostraComOrigem {
  const publicada = linha.origem === 'publicacao'
  const contagemServe = CONTAGENS_COMPATIVEIS.has(linha.funcionarios_origem ?? '')

  return {
    tipo: linha.tipo,
    faturamento_declarado: Number(linha.valor),
    funcionarios: contagemServe ? linha.funcionarios : null,
    erp_mrr: linha.erp_mrr === null ? null : Number(linha.erp_mrr),
    qtd_usuarios_erp: linha.qtd_usuarios_erp,
    origem_faturamento: publicada ? 'publicacao' : 'declarado_cliente',
  }
}
