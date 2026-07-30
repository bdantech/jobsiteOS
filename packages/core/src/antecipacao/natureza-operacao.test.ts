import assert from 'node:assert/strict'
import { test } from 'node:test'
import { avaliarNatureza, motivoNaoOperavel } from './natureza-operacao.ts'

/**
 * Toda natureza citada aqui é real — saiu de `natOp` das notas da base. O risco
 * desta regra é assimétrico e nos dois sentidos: deixar passar uma remessa põe
 * ruído caro no topo do Kanban; ocultar uma venda esconde receita e ninguém
 * descobre. Por isso os dois lados têm teste.
 */

const operavel = (n: string): boolean => avaliarNatureza(n).operavel

// ─── Devem ser ocultadas ────────────────────────────────────────────────────

test('remessas reais, em todas as variações da base', () => {
  for (const n of [
    'SIMPLES REMESSA',
    'Nota Fiscal Remessa',
    'REMESSA PARA LOCACAO',
    'REMESSA P/LOCACAO',
    '5908-REMESSA P/LOCACAO',
    'Remessa de bem por conta de contrato de comodato',
    'REMESSA PARA INDUSTRIALIZACAO POR ENCOMENDA',
    'REMESSA PARA CONSERTO',
    'Remessa de Amostra Gratis',
    'REMESSA EM BONIFICACAO, DOAÇÃO OU BRINDE',
    'Remessa para consignacao',
    'REMESSA DE MERC. OU BEM PARA DEMONSTRACAO',
    'REMESSA DE MOSTRUARIO',
    'REMESSA DE VASILHAME OU SACARIA',
    'REMESSA PALETE',
    '6910 - REMESSA BONIFICACAO',
    'Remessa',
  ]) {
    assert.equal(operavel(n), false, `deveria ocultar: ${n}`)
  }
})

test('devoluções reais, inclusive as que contêm a palavra "venda"', () => {
  for (const n of [
    'Devolução de Venda',
    'DEVOLUCAO DE VENDA',
    'DevoluCAo',
    'Devolucao de venda de producao',
    'DEVOLUCAO DE VENDA DE MERCADORIA ADQUIRIDA OU RECEBIDA DE TE',
    'Nota fiscal de devolução de mercadoria',
    'DEVOLUÇÃO DE EQUIPAMENTO',
    'DEVOLUCAO DE COMPRAS',
  ]) {
    assert.equal(operavel(n), false, `deveria ocultar: ${n}`)
  }
})

test('retornos, transferências, comodato e bonificação', () => {
  for (const n of [
    'RETORNO DE LOCACAO',
    'RETORNO DE CONSERTO',
    'RETORNO  VASILHAMES',
    'INDUSTRIALIZACAO/RETORNO',
    'NF DE TRANSFERENCIA',
    'TRANSFERENCIA DE BEM DO ATIVO IMOBILIZADO',
    'Entrada Bens Em Comodato',
    'EMPRESTIMO COMODATO',
    'Retorno de Comodato',
    'BONIFICACAO',
    'SAIDA - BONIFICACAO GOIAS',
    'BONIFICACAO, DOACAO OU BRINDE',
    'SAIDA BONIF./BRINDE',
    'AMOSTRA GRATIS',
  ]) {
    assert.equal(operavel(n), false, `deveria ocultar: ${n}`)
  }
})

// ─── NÃO podem ser ocultadas ────────────────────────────────────────────────

test('vendas reais seguem operáveis', () => {
  for (const n of [
    'VENDA',
    'VDA PROD. PROPRIA',
    'VENDA DE MERCADORIA ADQUIRIDA OU RECEBIDA DE TERCEIROS',
    'Vnd prod.est.opr.c/pr.suj.reg.sub.trib.cnd.sub.tri',
    'VENDAS DE COMBUST E LUBRIFICANTES',
    'Venda de mercadoria a nao contribuinte',
    'VENDA NO ESTADO',
    'VND COMERCIALIZACAO',
    'Venda (Simples Nacional)',
  ]) {
    assert.equal(operavel(n), true, `não deveria ocultar: ${n}`)
  }
})

test('industrialização NÃO oculta: "venda para industrializacao" é venda', () => {
  // 18 + 11 notas na base, e um serviço de industrialização prestado é operável.
  assert.equal(operavel('Venda de producao para industrializacao - demais produtos'), true)
  assert.equal(operavel('Venda de Producao Para Industrializacao - Pao Frances'), true)
  assert.equal(operavel('INDUSTRIALIZACAO EFETUADA PARA OUTRA EMPRESA'), true)
  assert.equal(operavel('VENDA DE MERCADORIA INDUSTRIALIZADA'), true)
  // Mas a REMESSA para industrialização cai por 'remessa'.
  assert.equal(operavel('REMESSA PARA INDUSTRIALIZACAO'), false)
})

test('"SIMPLES FATURAMENTO" é o par financeiro da remessa e é operável', () => {
  assert.equal(operavel('SIMPLES FATURAMENTO'), true)
  assert.equal(operavel('Simples faturamento de Venda para Entrega Futura'), true)
  assert.equal(operavel('Lancto Simples Faturamento Decorrente Venda Entrega Futura'), true)
})

test('serviço de locação, conserto e reparo é operável quando não é remessa', () => {
  assert.equal(operavel('Prestacao de servico de locacao de equipamento'), true)
  assert.equal(operavel('Servico de conserto e reparo'), true)
})

test('natureza ausente não oculta nada — toda NFS-e cairia', () => {
  assert.equal(operavel(''), true)
  assert.equal(avaliarNatureza(null).operavel, true)
  assert.equal(avaliarNatureza(undefined).operavel, true)
  assert.equal(avaliarNatureza('   ').operavel, true)
})

// ─── Motivo legível ─────────────────────────────────────────────────────────

test('o termo que desqualificou é devolvido, para a tela poder explicar', () => {
  assert.equal(avaliarNatureza('Devolução de Venda').termo, 'devolucao')
  assert.equal(avaliarNatureza('SIMPLES REMESSA').termo, 'remessa')
  assert.equal(avaliarNatureza('VENDA').termo, null)
})

test('motivo em prosa', () => {
  assert.match(motivoNaoOperavel('devolucao') ?? '', /^Devolucao — natureza/)
  assert.equal(motivoNaoOperavel(null), null)
})
