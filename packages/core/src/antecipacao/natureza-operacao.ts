/**
 * Nota operável ou não, pela natureza da operação.
 *
 * Remessa, devolução, retorno, transferência e comodato NÃO representam crédito a
 * receber: a mercadoria circula, mas ninguém deve nada a ninguém no fim. Elas
 * entravam no funil com valor cheio — e uma "REMESSA DE MERC. OU BEM PARA
 * DEMONSTRACAO" de R$ 1,6 milhão no topo do Kanban não é oportunidade, é ruído
 * caro: alguém liga para um fornecedor oferecer antecipação de uma nota que não
 * existe como dívida.
 *
 * A lista saiu das naturezas REAIS da base, e o que ela deixa de fora é tão
 * importante quanto o que inclui:
 *
 * - `industrializacao` está FORA de propósito. "Venda de producao para
 *   industrializacao" e "INDUSTRIALIZACAO EFETUADA PARA OUTRA EMPRESA" são venda e
 *   serviço — operáveis. Só a *remessa* para industrialização não é, e essa já cai
 *   por 'remessa'.
 * - `faturamento` também fica fora: "SIMPLES FATURAMENTO" de venda para entrega
 *   futura é exatamente a nota que gera a duplicata. É o par financeiro da remessa.
 * - `conserto`, `reparo` e `locacao` idem: sozinhos descreveriam um SERVIÇO
 *   prestado, que é operável. Na base eles só aparecem depois de "remessa" ou
 *   "retorno", que já bloqueiam.
 */

/**
 * Termos que tornam a nota não operável. Casam por trecho, sem acento nem caixa —
 * as naturezas reais vêm em toda grafia possível ("DevoluCAo", "Devolução de Venda",
 * "6910 - REMESSA BONIFICACAO").
 */
export const TERMOS_NAO_OPERAVEL = [
  'remessa',
  'devolucao',
  'devolvida',
  'retorno',
  'transferencia',
  'comodato',
  'emprestimo',
  'bonificacao',
  'bonif.',
  'doacao',
  'brinde',
  'amostra',
  'consignacao',
  'demonstracao',
  'mostruario',
  'vasilhame',
  'sacaria',
] as const

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export interface AvaliacaoNatureza {
  operavel: boolean
  /** O termo que a desqualificou, para a interface poder explicar por que sumiu. */
  termo: string | null
}

/**
 * Nunca devolve "não operável" para natureza ausente: nota sem `natOp` (toda NFS-e,
 * por exemplo) segue operável. A ausência de informação não é motivo para esconder
 * uma nota — só a presença de um termo que a desqualifique.
 */
export function avaliarNatureza(natureza: string | null | undefined): AvaliacaoNatureza {
  if (!natureza || natureza.trim() === '') return { operavel: true, termo: null }
  const n = normalizar(natureza)
  for (const termo of TERMOS_NAO_OPERAVEL) {
    if (n.includes(normalizar(termo))) return { operavel: false, termo }
  }
  return { operavel: true, termo: null }
}

/** Frase pronta para a interface: "Devolução — a nota não representa crédito a receber". */
export function motivoNaoOperavel(termo: string | null): string | null {
  if (!termo) return null
  const rotulo = termo.charAt(0).toUpperCase() + termo.slice(1).replace(/\.$/, '')
  return `${rotulo} — natureza da operação não gera crédito a receber.`
}
