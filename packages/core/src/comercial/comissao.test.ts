import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  comissaoNfConvertida,
  comissaoReuniao,
  comissaoVolumePassivo,
  competenciaDe,
  donoNaData,
  estornoDe,
  regraVigente,
  type JanelaCarteira,
  type RegraComissao,
} from './comissao.ts'

/**
 * Estes testes protegem duas afirmações sobre o PASSADO, e é por elas que alguém
 * contesta a folha: a regra que valia no dia do evento, e o dono que era dono no dia do
 * evento. Um sistema que responde "hoje" às duas perguntas paga a pessoa errada, com o
 * valor errado, e parece certo enquanto nada muda.
 */

const REGRA_SDR: RegraComissao = {
  id: 'r-sdr-2026',
  tipo_vendedor: 'sdr',
  vendedor_id: null,
  parametros: { valor_por_reuniao: 100 },
  vigente_de: '2026-01-01',
  vigente_ate: null,
}

// ─── Vigência da regra ──────────────────────────────────────────────────────

test('a regra é a que valia NA DATA DO EVENTO, não a de hoje', () => {
  const antiga: RegraComissao = { ...REGRA_SDR, id: 'antiga', parametros: { valor_por_reuniao: 80 }, vigente_de: '2025-01-01', vigente_ate: '2025-12-31' }
  const nova: RegraComissao = { ...REGRA_SDR, id: 'nova', vigente_de: '2026-01-01' }

  assert.equal(regraVigente([antiga, nova], { id: 'v1', tipo: 'sdr' }, '2025-06-10')?.id, 'antiga')
  assert.equal(regraVigente([antiga, nova], { id: 'v1', tipo: 'sdr' }, '2026-06-10')?.id, 'nova')
})

test('override pessoal vence a regra padrão do tipo', () => {
  const padrao: RegraComissao = { ...REGRA_SDR, id: 'padrao' }
  const meu: RegraComissao = { ...REGRA_SDR, id: 'meu', vendedor_id: 'v1', parametros: { valor_por_reuniao: 150 } }
  assert.equal(regraVigente([padrao, meu], { id: 'v1', tipo: 'sdr' }, '2026-06-10')?.id, 'meu')
  // E o override de OUTRA pessoa não vale para mim.
  assert.equal(regraVigente([padrao, meu], { id: 'v2', tipo: 'sdr' }, '2026-06-10')?.id, 'padrao')
})

test('evento anterior à primeira regra não gera lançamento nenhum', () => {
  // Inventar um default aqui produziria dinheiro que ninguém aprovou, e que só
  // apareceria quando alguém conferisse a folha inteira.
  const r = regraVigente([REGRA_SDR], { id: 'v1', tipo: 'sdr' }, '2025-11-30')
  assert.equal(r, null)
  assert.equal(comissaoReuniao(r, { lead_id: 'l1', vendedor_id: 'v1', agendada_em: '2025-11-30', empresa: 'X' }), null)
})

test('vigência é inclusiva nas duas pontas', () => {
  const r: RegraComissao = { ...REGRA_SDR, vigente_de: '2026-03-01', vigente_ate: '2026-03-31' }
  assert.ok(regraVigente([r], { id: 'v1', tipo: 'sdr' }, '2026-03-01'))
  assert.ok(regraVigente([r], { id: 'v1', tipo: 'sdr' }, '2026-03-31'))
  assert.equal(regraVigente([r], { id: 'v1', tipo: 'sdr' }, '2026-04-01'), null)
})

// ─── Atribuição temporal ────────────────────────────────────────────────────

const JANELAS: JanelaCarteira[] = [
  { vendedor_id: 'ana', empresa_id: 'e1', papel: 'originacao', desde: '2026-01-01T00:00:00Z', ate: '2026-04-01T00:00:00Z' },
  { vendedor_id: 'bruno', empresa_id: 'e1', papel: 'originacao', desde: '2026-04-01T00:00:00Z', ate: null },
]

test('quem recebe é quem era dono NA DATA — trocar a carteira não reescreve março', () => {
  assert.equal(donoNaData(JANELAS, 'e1', 'originacao', '2026-03-15T12:00:00Z'), 'ana')
  assert.equal(donoNaData(JANELAS, 'e1', 'originacao', '2026-05-15T12:00:00Z'), 'bruno')
})

test('a virada é semiaberta: quem sai não leva o evento do instante da troca', () => {
  // Sem isso as duas pessoas reivindicam o mesmo evento, e as duas têm razão.
  assert.equal(donoNaData(JANELAS, 'e1', 'originacao', '2026-04-01T00:00:00Z'), 'bruno')
  assert.equal(donoNaData(JANELAS, 'e1', 'originacao', '2026-03-31T23:59:59Z'), 'ana')
})

test('papel errado ou empresa errada não devolve dono por engano', () => {
  assert.equal(donoNaData(JANELAS, 'e1', 'gestao_passiva', '2026-03-15T12:00:00Z'), null)
  assert.equal(donoNaData(JANELAS, 'e2', 'originacao', '2026-03-15T12:00:00Z'), null)
})

// ─── Os três cálculos ───────────────────────────────────────────────────────

test('SDR: valor fixo, competência do mês da REUNIÃO', () => {
  const l = comissaoReuniao(REGRA_SDR, {
    lead_id: 'l1', vendedor_id: 'v1', agendada_em: '2026-03-20T14:00:00Z', empresa: 'Construtora X',
  })
  assert.equal(l?.valor, 100)
  assert.equal(l?.competencia, '2026-03-01')
  assert.equal(l?.origem_id, 'l1')
})

test('originador: por milhão convertido, com centavos fechados', () => {
  const regra: RegraComissao = { id: 'r', tipo_vendedor: 'originador', vendedor_id: null, parametros: { valor_por_milhao: 550 }, vigente_de: '2026-01-01', vigente_ate: null }
  const l = comissaoNfConvertida(regra, {
    antecipacao_id: 'a-9', vendedor_id: 'v1', convertida_em: '2026-03-02T00:00:00Z',
    gross_value: 1_750_000, empresa: 'Y',
  })
  // 1,75M × 550 = 962,50 — e é este arredondamento que impede drift ao somar o mês.
  assert.equal(l?.valor, 962.5)
  assert.equal(l?.origem_tipo, 'nf_convertida')
})

test('volume zero não vira lançamento de R$ 0,00', () => {
  // Uma linha de zero na folha é ruído que a pessoa tem de conferir para descobrir
  // que não era nada.
  const regra: RegraComissao = { id: 'r', tipo_vendedor: 'vendedor', vendedor_id: null, parametros: { valor_por_milhao: 300 }, vigente_de: '2026-01-01', vigente_ate: null }
  assert.equal(
    comissaoVolumePassivo(regra, { vendedor_id: 'v1', empresa_id: 'e1', competencia: '2026-03-01', volume: 0, empresa: 'Z' }),
    null,
  )
})

test('o agregado de volume tem chave estável — apurar duas vezes não paga duas vezes', () => {
  const regra: RegraComissao = { id: 'r', tipo_vendedor: 'vendedor', vendedor_id: null, parametros: { valor_por_milhao: 300 }, vigente_de: '2026-01-01', vigente_ate: null }
  const a = comissaoVolumePassivo(regra, { vendedor_id: 'v1', empresa_id: 'e1', competencia: '2026-03-01', volume: 2_000_000, empresa: 'Z' })
  const b = comissaoVolumePassivo(regra, { vendedor_id: 'v1', empresa_id: 'e1', competencia: '2026-03-01', volume: 2_000_000, empresa: 'Z' })
  assert.equal(a?.origem_id, 'volume:e1:2026-03')
  assert.equal(a?.origem_id, b?.origem_id) // o unique do banco recusa a segunda
  assert.equal(a?.valor, 600)
})

// ─── Clawback ───────────────────────────────────────────────────────────────

test('estorno é o espelho negativo, na competência em que foi DESCOBERTO', () => {
  // Reabrir a competência do original reescreveria uma folha possivelmente já paga.
  const e = estornoDe(
    { vendedor_id: 'v1', origem_id: 'a-9', valor: 962.5, descricao: 'NF convertida — Y' },
    '2026-06-10T09:00:00Z',
  )
  assert.equal(e.valor, -962.5)
  assert.equal(e.competencia, '2026-06-01')
  assert.equal(e.origem_tipo, 'estorno')
  // Chave própria: o estorno não colide com o lançamento que ele reverte.
  assert.equal(e.origem_id, 'estorno:a-9')
})

test('estornar duas vezes é impedido pela chave, não pela sorte', () => {
  const um = estornoDe({ vendedor_id: 'v1', origem_id: 'a-9', valor: 100, descricao: 'x' }, '2026-06-10')
  const dois = estornoDe({ vendedor_id: 'v1', origem_id: 'a-9', valor: 100, descricao: 'x' }, '2026-06-20')
  assert.equal(um.origem_id, dois.origem_id)
})

test('competência é o primeiro dia do mês do evento', () => {
  assert.equal(competenciaDe('2026-03-31T23:00:00Z'), '2026-03-01')
  assert.equal(competenciaDe('2026-01-01T00:00:00Z'), '2026-01-01')
})
