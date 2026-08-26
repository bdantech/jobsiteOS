import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BETA_PADRAO,
  PRIORIDADES_REPORT,
  STATUS_BUG,
  STATUS_MELHORIA,
  STATUS_REPORT,
  STATUS_REPORT_EM_ANDAMENTO,
  STATUS_REPORT_LABELS,
  STATUS_REPORT_TERMINAIS,
  atualizarReportSchema,
  criarReportSchema,
  definirBetaSchema,
  ehStatusTerminal,
  lerEstadoBeta,
  ordenarPorPrioridade,
  statusDoTipo,
  statusPertenceAoTipo,
} from './schemas.ts'

/*
 * O CHECK cruzado `reports_status_do_tipo` (migração 0141) e as listas deste
 * arquivo são a mesma régua escrita duas vezes. Estes testes são o que impede as
 * duas de andarem separadas: se alguém acrescentar um status só aqui, o banco
 * recusa a gravação com um erro de constraint no meio de um clique.
 */
test('as duas esteiras não se misturam', () => {
  assert.equal(statusPertenceAoTipo('bug', 'em_correcao'), true)
  assert.equal(statusPertenceAoTipo('bug', 'entregue'), false)
  assert.equal(statusPertenceAoTipo('melhoria', 'entregue'), true)
  assert.equal(statusPertenceAoTipo('melhoria', 'em_correcao'), false)
  // "aberto", "em_analise" e "duplicado" são das duas.
  for (const comum of ['aberto', 'em_analise', 'duplicado']) {
    assert.equal(statusPertenceAoTipo('bug', comum), true, comum)
    assert.equal(statusPertenceAoTipo('melhoria', comum), true, comum)
  }
})

test('a união cobre exatamente as duas esteiras, sem sobra nem falta', () => {
  const uniao = new Set<string>([...STATUS_BUG, ...STATUS_MELHORIA])
  assert.deepEqual([...uniao].sort(), [...STATUS_REPORT].sort())
})

test('todo status tem rótulo e todo rótulo tem status', () => {
  assert.deepEqual(Object.keys(STATUS_REPORT_LABELS).sort(), [...STATUS_REPORT].sort())
})

test('terminal e em-andamento são conjuntos disjuntos, e "aberto" não está em nenhum', () => {
  for (const s of STATUS_REPORT_TERMINAIS) {
    assert.equal(STATUS_REPORT_EM_ANDAMENTO.includes(s), false, s)
  }
  assert.equal(ehStatusTerminal('aberto'), false)
  assert.equal(STATUS_REPORT_EM_ANDAMENTO.includes('aberto' as never), false)
  // Somados com "aberto", os dois cobrem tudo: nenhum status fica fora da conta
  // do painel, que é como um report some do topo sem ter sido resolvido.
  const cobertos = new Set<string>([...STATUS_REPORT_TERMINAIS, ...STATUS_REPORT_EM_ANDAMENTO, 'aberto'])
  assert.deepEqual([...cobertos].sort(), [...STATUS_REPORT].sort())
})

test('statusDoTipo devolve a esteira que o seletor do admin deve oferecer', () => {
  assert.deepEqual([...statusDoTipo('bug')], [...STATUS_BUG])
  assert.deepEqual([...statusDoTipo('melhoria')], [...STATUS_MELHORIA])
})

test('a ordenação por prioridade põe crítica primeiro e "sem prioridade" por último', () => {
  const linhas = [
    { p: null },
    { p: 'media' },
    { p: 'critica' },
    { p: 'baixa' },
    { p: 'alta' },
  ]
  const ordenado = [...linhas].sort((a, b) => ordenarPorPrioridade(a.p, b.p)).map((l) => l.p)
  assert.deepEqual(ordenado, ['critica', 'alta', 'media', 'baixa', null])
})

test('uma prioridade desconhecida cai para o fim em vez de furar a fila', () => {
  assert.equal(ordenarPorPrioridade('urgentissimo', 'baixa') > 0, true)
  for (const p of PRIORIDADES_REPORT) {
    assert.equal(ordenarPorPrioridade(p, 'inventada') < 0, true, p)
  }
})

// ─── Entradas ───────────────────────────────────────────────────────────────

const CONTEXTO = {
  rota: '/comercial/fornecedores',
  url: 'https://app.example/comercial/fornecedores',
  plataforma: 'web' as const,
  user_agent: 'Mozilla/5.0',
  viewport: '1440×900',
  app_versao: '0.1.0',
}

test('título e descrição vêm aparados, e o espaço em branco não conta como conteúdo', () => {
  const r = criarReportSchema.parse({
    tipo: 'bug',
    titulo: '   Kanban não abre   ',
    descricao: '   A tela fica branca.   ',
    contexto: CONTEXTO,
  })
  assert.equal(r.titulo, 'Kanban não abre')
  assert.equal(r.descricao, 'A tela fica branca.')

  assert.throws(() =>
    criarReportSchema.parse({ tipo: 'bug', titulo: '     ', descricao: 'x'.repeat(10), contexto: CONTEXTO }),
  )
})

test('duplicado sem o original é recusado antes de chegar ao banco', () => {
  assert.throws(
    () =>
      atualizarReportSchema.parse({
        report_id: '11111111-1111-4111-8111-111111111111',
        status: 'duplicado',
      }),
    /original/i,
  )
  atualizarReportSchema.parse({
    report_id: '11111111-1111-4111-8111-111111111111',
    status: 'duplicado',
    duplicado_de: '22222222-2222-4222-8222-222222222222',
  })
})

test('prioridade ausente e prioridade nula são coisas diferentes', () => {
  const semChave = atualizarReportSchema.parse({ report_id: '11111111-1111-4111-8111-111111111111' })
  assert.equal('prioridade' in semChave, false)

  const comNulo = atualizarReportSchema.parse({
    report_id: '11111111-1111-4111-8111-111111111111',
    prioridade: null,
  })
  assert.equal('prioridade' in comNulo, true)
  assert.equal(comNulo.prioridade, null)
})

test('ligar o beta sem texto é recusado; desligar sem texto não é', () => {
  assert.throws(() => definirBetaSchema.parse({ habilitado: true, texto: '   ' }), /vazia/i)
  const desligado = definirBetaSchema.parse({ habilitado: false, texto: '' })
  assert.equal(desligado.habilitado, false)
})

// ─── Leitura do estado ──────────────────────────────────────────────────────

test('o banner desligado é o estado seguro para todo jsonb que não faz sentido', () => {
  for (const lixo of [null, undefined, 'true', 42, [], { habilitado: 'sim', texto: 'oi' }]) {
    assert.equal(lerEstadoBeta(lixo).habilitado, false, JSON.stringify(lixo))
  }
})

test('habilitado com texto vazio não liga uma tarja em branco na empresa inteira', () => {
  const r = lerEstadoBeta({ habilitado: true, texto: '   ' })
  assert.equal(r.habilitado, false)
  assert.equal(r.texto, BETA_PADRAO.texto)
})

test('o estado válido passa aparado', () => {
  const r = lerEstadoBeta({ habilitado: true, texto: '  Plataforma em beta.  ' })
  assert.deepEqual(r, { habilitado: true, texto: 'Plataforma em beta.' })
})
