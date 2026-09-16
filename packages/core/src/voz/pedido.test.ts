import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  acaoDoDesfecho,
  diasAteOVencimento,
  montarPedidoDeLigacao,
  podeLigar,
  type FatosDaLigacao,
} from './pedido.ts'
import { pedidoLigacaoSchema, resultadoLigacaoSchema } from './schemas.ts'

const AGORA = new Date('2026-09-16T13:00:00Z')

const FATOS: FatosDaLigacao = {
  killSwitch: false,
  suprimido: false,
  contato: {
    nome: 'Sandra Lopes',
    cargo: 'Proprietária',
    telefone_e164: '+5531988776655',
    email: 'sandra@valeverde.com.br',
    base_legal: 'dado_publico_nfe',
    no_procon: false,
  },
  nota: {
    access_key: '35260912345678000190550010000088121234567890',
    numero: '008812',
    serie: '1',
    emitida_em: '2026-09-12T10:00:00-03:00',
    vencimento: '2026-11-11',
    vencimento_origem: 'xml',
    valor: 62000,
    taxa_am: 3.49,
    taxa_padrao: false,
    valor_desconto: 4327.6,
    valor_iof: 388.12,
    valor_liquido: 57284.28,
    cancelada: false,
  },
  fornecedor: {
    razao_social: 'Esquadrias Vale Verde Ltda',
    nome_fantasia: 'Vale Verde Esquadrias',
    cnpj: '33444555000166',
  },
  sacado: {
    razao_social: 'Incorporadora Monte Azul Ltda',
    cnpj: '55666777000188',
    prazo_medio_pagamento_dias: 87,
    pontualidade_pct_12m: 71.2,
  },
  cadastro: { ativo: false, pendencias: ['contrato social', 'dados bancários'] },
  validade_proposta: '2026-09-19',
  agora: AGORA,
}

const com = (mudanca: Partial<FatosDaLigacao>): FatosDaLigacao => ({ ...FATOS, ...mudanca })
const comNota = (mudanca: Partial<FatosDaLigacao['nota']>): FatosDaLigacao =>
  com({ nota: { ...FATOS.nota, ...mudanca } })
const comContato = (mudanca: Partial<NonNullable<FatosDaLigacao['contato']>>): FatosDaLigacao =>
  com({ contato: { ...FATOS.contato!, ...mudanca } })

test('a nota completa passa', () => {
  assert.deepEqual(podeLigar(FATOS), { pode: true })
})

test('o pedido sai no formato que a fila da Ana aceita', () => {
  const r = montarPedidoDeLigacao(FATOS)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.doesNotThrow(() => pedidoLigacaoSchema.parse(r.pedido))
  assert.equal(r.pedido.id_externo, FATOS.nota.access_key)
  assert.equal(r.pedido.telefone, '+5531988776655')
  assert.equal(r.pedido.oferta.recebiveis[0]?.prazo_dias, 56)
  assert.equal(r.pedido.oferta.recebiveis[0]?.data_emissao, '2026-09-12')
  assert.equal(r.pedido.oferta.resumo_oferta.valor_liquido_total, 57284.28)
})

test('a supressão vem antes de tudo que não seja o kill switch', () => {
  const tudoErrado = com({
    suprimido: true,
    killSwitch: false,
    contato: null,
    nota: { ...FATOS.nota, valor_iof: null },
  })
  assert.deepEqual(podeLigar(tudoErrado), { pode: false, motivo: 'suprimido' })
  assert.deepEqual(podeLigar({ ...tudoErrado, killSwitch: true }), {
    pode: false,
    motivo: 'kill_switch',
  })
})

test('contato sem base legal não recebe ligação', () => {
  assert.deepEqual(podeLigar(comContato({ base_legal: null })), {
    pode: false,
    motivo: 'sem_base_legal',
  })
})

test('número no Procon nunca é ligado', () => {
  assert.deepEqual(podeLigar(comContato({ no_procon: true })), { pode: false, motivo: 'no_procon' })
})

test('telefone precisa estar em E.164 brasileiro', () => {
  for (const tel of ['(31) 98877-6655', '31988776655', '5531988776655', '+13125551234']) {
    assert.deepEqual(
      podeLigar(comContato({ telefone_e164: tel })),
      { pode: false, motivo: 'telefone_invalido' },
      `aceitou ${tel}`,
    )
  }
})

test('vencimento estimado não vira ligação', () => {
  // A Ana diz a data em voz alta; estimada, ela erra na frente do cliente.
  assert.deepEqual(podeLigar(comNota({ vencimento_origem: 'estimado' })), {
    pode: false,
    motivo: 'vencimento_estimado',
  })
  assert.deepEqual(podeLigar(comNota({ vencimento_origem: 'endpoint' })), { pode: true })
})

test('nota vencida ou vencendo hoje não tem o que antecipar', () => {
  assert.deepEqual(podeLigar(comNota({ vencimento: '2026-09-16' })), { pode: false, motivo: 'vencida' })
  assert.deepEqual(podeLigar(comNota({ vencimento: '2026-09-15' })), { pode: false, motivo: 'vencida' })
  assert.deepEqual(podeLigar(comNota({ vencimento: '2026-09-17' })), { pode: true })
})

test('taxa do default não pode ser dita como condição', () => {
  assert.deepEqual(podeLigar(comNota({ taxa_padrao: true })), { pode: false, motivo: 'taxa_padrao' })
  assert.deepEqual(podeLigar(comNota({ taxa_am: null })), { pode: false, motivo: 'sem_taxa' })
})

test('sem IOF calculado a ligação não sai', () => {
  // O líquido do funil hoje é `valor − receita_esperada`, sem IOF: a Ana
  // prometeria mais do que a proposta paga.
  assert.deepEqual(podeLigar(comNota({ valor_iof: null })), { pode: false, motivo: 'sem_iof' })
  assert.deepEqual(podeLigar(comNota({ valor_liquido: null })), { pode: false, motivo: 'sem_liquido' })
  assert.deepEqual(podeLigar(comNota({ valor_desconto: null })), { pode: false, motivo: 'sem_desconto' })
})

test('nota cancelada, não operável ou sem número não vira ligação', () => {
  assert.deepEqual(podeLigar(comNota({ cancelada: true })), { pode: false, motivo: 'nota_cancelada' })
  assert.deepEqual(podeLigar(comNota({ operavel: false })), { pode: false, motivo: 'nao_operavel' })
  assert.deepEqual(podeLigar(comNota({ operavel: true })), { pode: true })
  assert.deepEqual(podeLigar(comNota({ numero: null })), { pode: false, motivo: 'sem_numero_da_nota' })
})

test('montar devolve o mesmo motivo que o portão recusou', () => {
  const r = montarPedidoDeLigacao(comContato({ no_procon: true }))
  assert.deepEqual(r, { ok: false, motivo: 'no_procon' })
})

test('dias até o vencimento não escorrega no fuso', () => {
  // 21h em São Paulo já é o dia seguinte em UTC: contar em UTC cru daria um dia a menos.
  const noiteEmSp = new Date('2026-09-17T00:30:00Z')
  assert.equal(diasAteOVencimento('2026-09-17', noiteEmSp), 0)
  assert.equal(diasAteOVencimento('2026-11-11', AGORA), 56)
})

test('o desfecho manda o que fazer, e o desconhecido não faz nada sozinho', () => {
  assert.equal(acaoDoDesfecho('pediu_para_nao_contatar'), 'suprimir')
  assert.equal(acaoDoDesfecho('cadastro_iniciado'), 'fechar_nota')
  assert.equal(acaoDoDesfecho('antecipacao_solicitada'), 'fechar_nota')
  assert.equal(acaoDoDesfecho('pessoa_errada'), 'higienizar_contato')
  assert.equal(acaoDoDesfecho('retorno_agendado'), 'reagendar')
  assert.equal(acaoDoDesfecho('recusa'), 'nada')
  assert.equal(acaoDoDesfecho(null), 'nada')
})

test('o resultado da Ana é lido mesmo com campo novo que ainda não mapeamos', () => {
  const corpo = {
    evento: 'ligacao.encerrada',
    ligacao_id: 'lig_86d8ced500e1',
    id_externo: '35260912345678000190550010000088121234567890',
    status: 'concluida',
    telefone: '+5531988776655',
    outcome: 'cadastro_iniciado',
    campo_que_ainda_nao_existe: true,
    chamada: { call_id: 'call_f8f04cfbd5de', resumo: 'aceitou iniciar o cadastro', duracao_s: 151.2 },
  }
  const r = resultadoLigacaoSchema.parse(corpo)
  assert.equal(r.outcome, 'cadastro_iniciado')
  assert.equal(r.chamada?.call_id, 'call_f8f04cfbd5de')
})

test('resultado com desfecho fora da lista é recusado, não adivinhado', () => {
  assert.throws(() =>
    resultadoLigacaoSchema.parse({
      evento: 'ligacao.encerrada',
      ligacao_id: 'lig_1',
      id_externo: 'x',
      status: 'concluida',
      telefone: '+5531988776655',
      outcome: 'inventado',
    }),
  )
})
