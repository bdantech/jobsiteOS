import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  deduplicarCandidatas,
  ehEmailPessoal,
  resolverVinculo,
  similaridade,
  type Candidata,
  type DepsVinculo,
} from './vinculacao.ts'

const c = (id: string, cnpj: string, razao: string, extra: Partial<Candidata> = {}): Candidata => ({
  empresa_id: id,
  cnpj,
  razao_social: razao,
  nome_fantasia: null,
  dominio: null,
  uf: 'SP',
  ...extra,
})

const CFG = { aceite_automatico: 0.85, banda_inferior: 0.5, max_candidatas: 20 }

function deps(over: Partial<DepsVinculo> = {}): DepsVinculo & { pontuadas: number } {
  const d = {
    pontuadas: 0,
    porDominio: async () => [],
    porTelefone: async () => [],
    buscarParecidas: async () => [],
    cfg: CFG,
    ...over,
  }
  return d as DepsVinculo & { pontuadas: number }
}

test('e-mail pessoal não se força: humano, não resolvível, sem chamar ninguém', async () => {
  let chamou = false
  const r = await resolverVinculo(
    { canal: 'email', identificador: 'joao.obras@gmail.com', nome_sugerido: 'João Construtora Alfa' },
    deps({ porDominio: async () => ((chamou = true), []), pontuar: async () => ((chamou = true), []) }),
  )
  assert.equal(r.etapa, 'humano')
  assert.equal(r.nao_resolvivel, true)
  assert.equal(chamou, false)
  assert.equal(ehEmailPessoal('X <Fulano@Hotmail.com>'), true)
  assert.equal(ehEmailPessoal('fulano@construtoraalfa.com.br'), false)
})

test('domínio de uma empresa só: determinístico, de graça', async () => {
  const r = await resolverVinculo(
    { canal: 'email', identificador: 'compras@alfa.com.br', nome_sugerido: null },
    deps({ porDominio: async () => [c('e1', '11111111000101', 'ALFA CONSTRUTORA LTDA')] }),
  )
  assert.equal(r.etapa, 'deterministico')
  assert.equal(r.empresa_id, 'e1')
})

test('empresa duplicada na base (matriz + filial) é UMA candidata — e a determinística continua', async () => {
  const r = await resolverVinculo(
    { canal: 'email', identificador: 'fin@alfa.com.br', nome_sugerido: null },
    deps({
      porDominio: async () => [
        c('filial', '11111111000280', 'ALFA CONSTRUTORA LTDA'),
        c('matriz', '11111111000101', 'ALFA CONSTRUTORA LTDA'),
      ],
    }),
  )
  assert.equal(r.etapa, 'deterministico')
  assert.equal(r.empresa_id, 'matriz')
})

test('domínio compartilhado (contabilidade de várias): não determina — humano com as candidatas', async () => {
  const r = await resolverVinculo(
    { canal: 'email', identificador: 'fiscal@contabilxyz.com.br', nome_sugerido: 'Contábil XYZ' },
    deps({
      porDominio: async () => [
        c('a', '22222222000101', 'OBRA UM LTDA', { valor: 10 }),
        c('b', '33333333000101', 'OBRA DOIS LTDA', { valor: 90 }),
      ],
      pontuar: async () => {
        throw new Error('não devia pontuar domínio compartilhado')
      },
    }),
  )
  assert.equal(r.etapa, 'humano')
  assert.match(r.motivo, /compartilhado/)
  assert.deepEqual(r.candidatas.map((x) => x.empresa_id), ['b', 'a']) // por valor potencial
})

test('shortlist → Jev: um par acima do aceite e o resto longe → aceito pelo Jev', async () => {
  const cands = [c('a', '44444444000101', 'BETA ENGENHARIA'), c('b', '55555555000101', 'BETTA OBRAS')]
  const r = await resolverVinculo(
    { canal: 'whatsapp', identificador: '5511999990000', nome_sugerido: 'Beta Engenharia' },
    deps({ buscarParecidas: async () => cands, pontuar: async () => [{ empresa_id: 'a', probabilidade: 0.93 }, { empresa_id: 'b', probabilidade: 0.12 }] }),
  )
  assert.equal(r.etapa, 'jev')
  assert.equal(r.empresa_id, 'a')
})

test('banda cinzenta → Claude decide', async () => {
  const cands = [c('a', '44444444000101', 'BETA ENGENHARIA')]
  const r = await resolverVinculo(
    { canal: 'whatsapp', identificador: '5511999990000', nome_sugerido: 'Beta Eng' },
    deps({
      buscarParecidas: async () => cands,
      pontuar: async () => [{ empresa_id: 'a', probabilidade: 0.66 }],
      desempatar: async () => ({ empresa_id: 'a', motivo: 'Mesmo nome fantasia.' }),
    }),
  )
  assert.equal(r.etapa, 'claude')
  assert.equal(r.empresa_id, 'a')
})

test('par secundário na faixa 0,2–0,5 nunca é automático: humano', async () => {
  const cands = [c('a', '44444444000101', 'BETA ENGENHARIA')]
  const r = await resolverVinculo(
    { canal: 'whatsapp', identificador: '5511999990000', nome_sugerido: 'Bento' },
    deps({ buscarParecidas: async () => cands, pontuar: async () => [{ empresa_id: 'a', probabilidade: 0.35 }], desempatar: async () => ({ empresa_id: 'a', motivo: '' }) }),
  )
  assert.equal(r.etapa, 'humano')
})

test('dois pares acima do aceite: empate vai ao Claude, não ao primeiro da lista', async () => {
  let viu: string[] = []
  const cands = [c('a', '44444444000101', 'GAMA'), c('b', '66666666000101', 'GAMA SUL')]
  const r = await resolverVinculo(
    { canal: 'whatsapp', identificador: '5511999990000', nome_sugerido: 'Gama' },
    deps({
      buscarParecidas: async () => cands,
      pontuar: async () => [{ empresa_id: 'a', probabilidade: 0.9 }, { empresa_id: 'b', probabilidade: 0.88 }],
      desempatar: async (_e, cs) => ((viu = cs.map((x) => x.empresa_id)), { empresa_id: null, motivo: 'Não dá para saber.' }),
    }),
  )
  assert.deepEqual(viu, ['a', 'b'])
  assert.equal(r.etapa, 'humano')
})

test('telefone exato já cadastrado: determinístico', async () => {
  const r = await resolverVinculo(
    { canal: 'whatsapp', identificador: '+55 11 99999-0000', nome_sugerido: null },
    deps({ porTelefone: async (d) => (d === '5511999990000' ? [c('t', '77777777000101', 'DELTA')] : []) }),
  )
  assert.equal(r.empresa_id, 't')
})

test('deduplicar e similaridade', () => {
  assert.equal(deduplicarCandidatas([c('1', '11111111000280', 'X'), c('2', '11111111000361', 'X')]).length, 1)
  assert.equal(similaridade('Construtora Alfa Ltda', 'CONSTRUTORA ALFA'), 1)
  assert.ok(similaridade('Alfa Engenharia', 'Ômega Incorporações') < 0.2)
})
