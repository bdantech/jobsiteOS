import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  agruparAlertas,
  carimbo,
  chaveDoAviso,
  formatarAvalistas,
  formatarTestemunhas,
  reiteracaoDevida,
  tipoInsolvenciaDaClasse,
  valoresDaMemoria,
  type AlertaDeTitulo,
} from './regras.ts'

/**
 * O relógio tem centenas de títulos "abertos" vencidos (a produção não informa a
 * liquidação), e é isso que torna a agregação obrigatória: o teste que importa é o de
 * que N títulos de um grupo no mesmo marco viram UM aviso.
 */

function alerta(p: Partial<AlertaDeTitulo> & { chave?: string; nivel?: 'aviso' | 'alto' | 'critico'; dias?: number }): AlertaDeTitulo {
  return {
    prazo_id: p.prazo_id ?? 'p1',
    titulo_id: p.titulo_id ?? 't1',
    numero: null,
    sacado_matriz_cnpj: p.sacado_matriz_cnpj ?? '11222333000181',
    sacado_nome: p.sacado_nome ?? 'CONSTRUTORA X',
    empresa_id: null,
    valor_face: p.valor_face ?? 100,
    cobranca_id: p.cobranca_id ?? null,
    cobranca_codigo: p.cobranca_codigo ?? null,
    responsavel_id: p.responsavel_id ?? null,
    alerta: {
      chave: p.chave ?? 'parada_cobertura',
      marco: 'parada_cobertura',
      nivel: p.nivel ?? 'aviso',
      data_marco: '2026-10-10',
      dias_restantes: p.dias ?? 10,
      mensagem: `faltam ${p.dias ?? 10}`,
    },
  }
}

test('títulos do mesmo grupo no mesmo marco viram UM aviso, com soma e responsáveis', () => {
  const g = agruparAlertas([
    alerta({ prazo_id: 'a', valor_face: 100.1, cobranca_id: 'c1', cobranca_codigo: 'COB-1', responsavel_id: 'u1', dias: 12 }),
    alerta({ prazo_id: 'b', valor_face: 200.2, cobranca_id: 'c1', cobranca_codigo: 'COB-1', responsavel_id: 'u1', dias: 5 }),
    alerta({ prazo_id: 'c', valor_face: 50, cobranca_id: 'c2', cobranca_codigo: 'COB-2', responsavel_id: 'u2', dias: 8 }),
  ])
  assert.equal(g.length, 1)
  assert.equal(g[0]!.itens.length, 3)
  assert.equal(g[0]!.valor, 350.3)
  assert.equal(g[0]!.dias_restantes, 5)
  assert.equal(g[0]!.mensagem, 'faltam 5')
  assert.deepEqual(g[0]!.cobranca_ids, ['c1', 'c2'])
  assert.deepEqual(g[0]!.responsaveis, ['u1', 'u2'])
})

test('marcos e grupos diferentes são avisos diferentes; o crítico vem primeiro', () => {
  const g = agruparAlertas([
    alerta({ chave: 'parada_cobertura' }),
    alerta({ chave: 'notificacao_critica', nivel: 'critico', dias: 3 }),
    alerta({ chave: 'parada_cobertura', sacado_matriz_cnpj: '99888777000166' }),
  ])
  assert.equal(g.length, 3)
  assert.equal(g[0]!.nivel, 'critico')
})

test('a chave do crítico leva o dia (repete todo dia); a dos outros não', () => {
  assert.equal(
    chaveDoAviso({ chave: 'notificacao_critica', nivel: 'critico', sacado_matriz_cnpj: '1' }, '2026-09-26'),
    'apolice:notificacao_critica:1:2026-09-26',
  )
  assert.equal(chaveDoAviso({ chave: 'parada_cobertura', nivel: 'aviso', sacado_matriz_cnpj: '1' }, '2026-09-26'), 'apolice:parada_cobertura:1')
})

test('insolvência pela classe: falência e RJ sim, recuperação extrajudicial não', () => {
  assert.equal(tipoInsolvenciaDaClasse('Falência de Empresários, Sociedades Empresáriais'), 'falencia')
  assert.equal(tipoInsolvenciaDaClasse('Autofalência'), 'falencia')
  assert.equal(tipoInsolvenciaDaClasse('RECUPERAÇÃO JUDICIAL'), 'recuperacao_judicial')
  assert.equal(tipoInsolvenciaDaClasse('Recuperação Extrajudicial'), null)
  assert.equal(tipoInsolvenciaDaClasse('Execução de Título Extrajudicial'), null)
  assert.equal(tipoInsolvenciaDaClasse(null), null)
})

test('reiteração: devida depois do prazo, e não quando a próxima rodada já começou', () => {
  const base = { ultima_rodada_enviada: 1, enviada_em: '2026-09-01T12:00:00Z', maior_rodada: 1, hoje: '2026-09-16', dias_para_reiteracao: 15 }
  assert.equal(reiteracaoDevida(base), true)
  assert.equal(reiteracaoDevida({ ...base, hoje: '2026-09-15' }), false)
  assert.equal(reiteracaoDevida({ ...base, maior_rodada: 2 }), false)
  assert.equal(reiteracaoDevida({ ...base, ultima_rodada_enviada: null }), false)
})

test('avalistas e testemunhas da minuta', () => {
  assert.equal(formatarAvalistas([]), null)
  const a = formatarAvalistas([{ nome: 'FULANO', cpf: '12345678909', estado_civil: 'casado', endereco: 'Rua X, 1' }])!
  assert.match(a, /CPF sob o nº 123\.456\.789-09/)
  assert.match(formatarTestemunhas([]), /1\. _+\nNome: _+/)
  assert.match(formatarTestemunhas([{ nome: 'B', cpf: '12345678909' }]), /Nome: B · CPF 123\.456\.789-09/)
})

test('memória: subtotal por id, e linha malformada é ignorada', () => {
  const m = valoresDaMemoria({ memoria: [{ operacao_id: 'x', subtotal: 10.5 }, { operacao_id: 'y' } as never] })
  assert.equal(m.get('x')!.subtotal, 10.5)
  assert.equal(m.has('y'), false)
  assert.equal(valoresDaMemoria(null).size, 0)
})

test('carimbo sem separadores', () => {
  assert.equal(carimbo(new Date('2026-09-26T09:15:00.123Z')), '20260926T091500Z')
})
