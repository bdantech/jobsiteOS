import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  agregarSacado,
  entraNaProspeccao,
  margemEstimada,
  prazoMinimoOperavel,
  valorEsperadoMensal,
  type NotaDoSacado,
} from './metricas.ts'

const HOJE = new Date('2026-09-20T12:00:00Z')
const PRAZO_MINIMO = 25 // 15 dias de esteira + 10 de margem

function nf(p: Partial<NotaDoSacado>): NotaDoSacado {
  return {
    fornecedor_cnpj: '11111111000191',
    fornecedor_nome: 'FORNECEDOR A',
    valor: 100_000,
    emitida_em: '2026-09-10',
    vencimento: '2026-12-10',
    dias_para_vencimento: 81,
    ...p,
  }
}

test('volume de 30 dias e média de 6 meses medem coisas diferentes, e é isso que ordena a lista', () => {
  const m = agregarSacado(
    [
      nf({ valor: 300_000, emitida_em: '2026-09-10' }),
      nf({ valor: 300_000, emitida_em: '2026-07-15' }),
      nf({ valor: 300_000, emitida_em: '2026-05-02' }),
      // Fora da janela de recorrência (março é o 7º mês para trás): não entra em nada.
      nf({ valor: 900_000, emitida_em: '2026-02-01' }),
    ],
    { hoje: HOJE, prazoMinimoOperavel: PRAZO_MINIMO },
  )

  assert.equal(m.volume_30d, 300_000)
  assert.equal(m.qtd_nfs_30d, 1)
  // 900 mil em seis meses = 150 mil/mês. Dividir pelos três meses COM nota daria
  // 300 mil e faria um fluxo trimestral parecer mensal.
  assert.equal(m.media_mensal_6m, 150_000)
  assert.equal(m.meses_com_emissao_6m, 3)
  // A nota de fevereiro continua sendo o sinal de vida mais antigo, mas a mais recente
  // é que manda em `ultima_nf_em`.
  assert.equal(m.ultima_nf_em, '2026-09-10')
})

test('NF SEM PRAZO SUFICIENTE entra no volume e fica fora do operável', () => {
  const m = agregarSacado(
    [
      nf({ valor: 500_000, dias_para_vencimento: 12 }), // a mediana real da base
      nf({ valor: 80_000, dias_para_vencimento: 81 }),
    ],
    { hoje: HOJE, prazoMinimoOperavel: PRAZO_MINIMO },
  )

  assert.equal(m.volume_30d, 580_000)
  // É o número que impede alguém de trabalhar um card de R$ 580 mil por duas semanas
  // e descobrir no fim que só R$ 80 mil sobreviveriam à análise.
  assert.equal(m.valor_operavel, 80_000)
})

test('nota sem vencimento não conta como operável — "não sabemos" não é "sim"', () => {
  const m = agregarSacado(
    [nf({ valor: 200_000, vencimento: null, dias_para_vencimento: null })],
    { hoje: HOJE, prazoMinimoOperavel: PRAZO_MINIMO },
  )
  assert.equal(m.volume_30d, 200_000)
  assert.equal(m.valor_operavel, 0)
})

test('o prazo restante é contado contra HOJE, não contra a emissão', () => {
  // 90 dias de prazo, emitida há 80: restam 10, e ela não sobrevive à esteira.
  const m = agregarSacado(
    [nf({ valor: 400_000, emitida_em: '2026-09-01', vencimento: '2026-09-30', dias_para_vencimento: null })],
    { hoje: HOJE, prazoMinimoOperavel: PRAZO_MINIMO },
  )
  assert.equal(m.valor_operavel, 0)
  assert.equal(m.prazo_medio_dias, 29)
})

test('MÚLTIPLOS FORNECEDORES são uma oportunidade com mais evidência, não três cards', () => {
  const m = agregarSacado(
    [
      nf({ fornecedor_cnpj: '11111111000191', fornecedor_nome: 'FORNECEDOR A', valor: 400_000 }),
      nf({ fornecedor_cnpj: '22222222000172', fornecedor_nome: 'FORNECEDOR B', valor: 250_000 }),
      nf({ fornecedor_cnpj: '22222222000172', fornecedor_nome: 'FORNECEDOR B', valor: 50_000, emitida_em: '2026-08-05' }),
      nf({ fornecedor_cnpj: '33333333000153', fornecedor_nome: 'FORNECEDOR C', valor: 90_000 }),
    ],
    {
      hoje: HOJE,
      prazoMinimoOperavel: PRAZO_MINIMO,
      carteiraDoOriginador: new Set(['22222222000172']),
    },
  )

  assert.equal(m.qtd_fornecedores, 3)
  assert.equal(m.volume_30d, 740_000)
  // A quebra vem ordenada pelo valor do período: é a ordem em que se decide por quem
  // abordar, e o maior é a porta de entrada mais forte.
  assert.deepEqual(
    m.fornecedores.map((f) => f.fornecedor_cnpj),
    ['11111111000191', '22222222000172', '33333333000153'],
  )
  const b = m.fornecedores.find((f) => f.fornecedor_cnpj === '22222222000172')!
  assert.equal(b.valor_30d, 250_000)
  assert.equal(b.meses_com_emissao_6m, 2)
  assert.equal(b.na_carteira_do_originador, true)
  assert.equal(m.fornecedores[0]!.na_carteira_do_originador, false)
})

test('sem informar a carteira, o selo fica UNDEFINED — silêncio não é "não está"', () => {
  const m = agregarSacado([nf({})], { hoje: HOJE, prazoMinimoOperavel: PRAZO_MINIMO })
  assert.equal(m.fornecedores[0]!.na_carteira_do_originador, undefined)
})

test('FORNECEDOR QUE DEIXOU DE SER SEGUIDO some do total e da quebra na mesma passada', () => {
  const todas = [
    nf({ fornecedor_cnpj: '11111111000191', valor: 400_000 }),
    nf({ fornecedor_cnpj: '22222222000172', valor: 250_000 }),
  ]
  const antes = agregarSacado(todas, { hoje: HOJE, prazoMinimoOperavel: PRAZO_MINIMO })
  // O agregador não conhece a regra de "seguido": quem some é a ENTRADA. É o que
  // garante que o total e a quebra não possam discordar sobre quem contou.
  const depois = agregarSacado(
    todas.filter((n) => n.fornecedor_cnpj !== '22222222000172'),
    { hoje: HOJE, prazoMinimoOperavel: PRAZO_MINIMO },
  )

  assert.equal(antes.volume_30d, 650_000)
  assert.equal(antes.qtd_fornecedores, 2)
  assert.equal(depois.volume_30d, 400_000)
  assert.equal(depois.qtd_fornecedores, 1)
  assert.equal(depois.fornecedores.length, 1)
})

test('SACADO QUE VIRA CLIENTE NO MEIO: o corte de entrada é sobre o que restou de notas', () => {
  // As notas em que ele já aparece como cadastrado saem da consulta do job — o que
  // sobra é o histórico de quando ele ainda não era. Se o que sobra não passa do corte,
  // ele não volta a entrar: a saída para `aprovado` é definitiva.
  const m = agregarSacado([nf({ valor: 8_000 })], { hoje: HOJE, prazoMinimoOperavel: PRAZO_MINIMO })
  assert.equal(entraNaProspeccao(m, 30_000), false)
  assert.equal(entraNaProspeccao({ volume_30d: 30_000, qtd_nfs_30d: 1 }, 30_000), true)
  // Nenhuma nota na janela nunca entra, por mais alto que o histórico tenha sido.
  assert.equal(entraNaProspeccao({ volume_30d: 0, qtd_nfs_30d: 0 }, 0), false)
})

test('a margem sai dos mesmos parâmetros que precificam o potencial no Crédito', () => {
  // 2,5% a.m. por 45 dias = 3,75%; TAC de 150 sobre ticket de 25 mil = 0,6%.
  const m = margemEstimada({ taxa_padrao_am: 2.5, prazo_medio_dias: 45, tac: 150, valor_medio_nf: 25_000 })
  assert.equal(Math.round(m * 10_000) / 10_000, 0.0435)
})

test('ticket médio zerado não explode a margem: a TAC simplesmente não entra', () => {
  const m = margemEstimada({ taxa_padrao_am: 2.5, prazo_medio_dias: 30, tac: 150, valor_medio_nf: 0 })
  assert.equal(Math.round(m * 1_000) / 1_000, 0.025)
})

test('valor esperado combina fluxo, chance e margem — e sem chance vale zero, não NaN', () => {
  assert.equal(valorEsperadoMensal(200_000, 0.5, 0.0435), 4_350)
  assert.equal(valorEsperadoMensal(200_000, null, 0.0435), 0)
  assert.equal(valorEsperadoMensal(null, 0.8, 0.0435), 0)
})

test('o prazo mínimo só usa a esteira MEDIDA quando há amostra que a sustente', () => {
  const config = { tempo_esteira_dias: 15, margem_prazo_dias: 10, esteira_base_minima: 10 }

  // 7 análises decididas (o estado real em 20/09/2026) e mediana de horas: cair nela
  // marcaria como operável toda nota que vence amanhã.
  assert.deepEqual(prazoMinimoOperavel({ dias: 0, base: 7 }, config), {
    dias: 25,
    origem: 'configurado',
  })
  assert.deepEqual(prazoMinimoOperavel({ dias: 22, base: 40 }, config), {
    dias: 32,
    origem: 'medido',
  })
  assert.deepEqual(prazoMinimoOperavel({ dias: null, base: 90 }, config), {
    dias: 25,
    origem: 'configurado',
  })
})
