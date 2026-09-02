import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CUSTOS_PADRAO,
  avaliarOrcamento,
  deveParar,
  lacunasDeContato,
  planejarDescobertaSobDemanda,
  type EstadoFornecedor,
} from './cascata.ts'

const BASE: EstadoFornecedor = {
  dominio: null,
  funcionarios: null,
  faturamento_estimado: null,
  porte_rfb: 'ME',
  municipio: 'Sorocaba',
  uf: 'SP',
  razao_social: 'SERRALHERIA X LTDA',
  melhor_confianca: null,
}

test('ME sem domínio: Nova Vida e Claude rodam, Apollo não', () => {
  const p = planejarDescobertaSobDemanda(BASE)
  const rodam = p.etapas.filter((e) => e.rodara).map((e) => e.provedor)
  assert.deepEqual(rodam, ['novavida', 'claude_busca'])
  // Arredondado a centavos: 0.35 + 0.1 dá 0.44999999999999996 em float, e um custo
  // exibido como "R$ 0,45" precisa ser o mesmo número que o orçamento debita.
  assert.equal(p.custo_estimado, 0.45)
  const apollo = p.etapas.find((e) => e.provedor === 'apollo')
  assert.match(apollo?.motivo ?? '', /Porte ME/)
})

test('com domínio mas 4 funcionários, o Apollo continua fora — é o gasto sem retorno do §4.2b', () => {
  const p = planejarDescobertaSobDemanda({ ...BASE, dominio: 'serralheriax.com.br', funcionarios: 4 })
  const apollo = p.etapas.find((e) => e.provedor === 'apollo')
  assert.equal(apollo?.rodara, false)
  assert.match(apollo?.motivo ?? '', /Porte abaixo do mínimo \(10 funcionários\)/)
})

test('porte DESCONHECIDO não é porte pequeno: `porte_rfb` decide quando falta headcount', () => {
  /*
   * Este era o defeito total, não um caso: dos 530 fornecedores do funil, ZERO têm
   * `funcionarios` (nenhum tem ficha em `empresas` — não estar na plataforma é a
   * definição deles). Com "desconhecido = pequeno", o Apollo era pulado para todo
   * mundo, sempre, e o registro dizia "porte abaixo do mínimo" sobre uma empresa cujo
   * porte ninguém tinha medido.
   */
  const demais = planejarDescobertaSobDemanda({
    ...BASE,
    dominio: 'i3m.com.br',
    porte_rfb: 'DEMAIS',
  })
  assert.equal(demais.etapas.find((e) => e.provedor === 'apollo')?.rodara, true)

  const epp = planejarDescobertaSobDemanda({ ...BASE, dominio: 'x.com.br', porte_rfb: 'EPP' })
  const pulado = epp.etapas.find((e) => e.provedor === 'apollo')
  assert.equal(pulado?.rodara, false)
  assert.match(pulado?.motivo ?? '', /Porte EPP/)

  // Sem porte NENHUM continua fora: aí realmente não se sabe nada.
  const nada = planejarDescobertaSobDemanda({ ...BASE, dominio: 'x.com.br', porte_rfb: null })
  assert.equal(nada.etapas.find((e) => e.provedor === 'apollo')?.rodara, false)
})

test('sem domínio, o Apollo desce para DEPOIS da busca — é ela que acha o domínio', () => {
  /*
   * A I3M Engenharia: o Apollo pulou por "sem domínio resolvido" às 14:20:17, e treze
   * segundos depois a busca do Claude devolveu `i3m.com.br`. Na ordem antiga ele
   * seria pulado no segundo clique também, e no terceiro.
   */
  const semDominio = planejarDescobertaSobDemanda({ ...BASE, porte_rfb: 'DEMAIS' })
  assert.deepEqual(
    semDominio.etapas.map((e) => e.provedor),
    ['novavida', 'claude_busca', 'apollo'],
  )
  assert.equal(semDominio.apollo_depende_da_busca, true)

  // COM domínio, a ordem da spec (§4.2 a/b/c) vale como está.
  const comDominio = planejarDescobertaSobDemanda({
    ...BASE,
    dominio: 'i3m.com.br',
    porte_rfb: 'DEMAIS',
  })
  assert.deepEqual(
    comDominio.etapas.map((e) => e.provedor),
    ['novavida', 'apollo', 'claude_busca'],
  )
  assert.equal(comDominio.apollo_depende_da_busca, false)
})

test('domínio + porte: os três rodam e o custo é a soma dos três', () => {
  const p = planejarDescobertaSobDemanda({ ...BASE, dominio: 'construtoray.com.br', funcionarios: 40 })
  assert.deepEqual(
    p.etapas.filter((e) => e.rodara).map((e) => e.provedor),
    ['novavida', 'apollo', 'claude_busca'],
  )
  assert.equal(
    p.custo_estimado,
    Math.round((CUSTOS_PADRAO.novavida + CUSTOS_PADRAO.apollo + CUSTOS_PADRAO.claude_busca) * 100) / 100,
  )
})

test('faturamento estimado substitui o headcount quando o headcount falta', () => {
  const p = planejarDescobertaSobDemanda(
    { ...BASE, dominio: 'x.com.br', funcionarios: null, faturamento_estimado: 20_000_000 },
    { apolloMinimoFaturamento: 5_000_000 },
  )
  assert.equal(p.etapas.find((e) => e.provedor === 'apollo')?.rodara, true)
})

test('já tendo contato de confiança alta, o clique inteiro não roda e custa zero', () => {
  const p = planejarDescobertaSobDemanda({ ...BASE, dominio: 'x.com.br', funcionarios: 50, melhor_confianca: 'alta' })
  assert.equal(p.custo_estimado, 0)
  assert.equal(p.etapas.every((e) => !e.rodara), true)
  assert.match(p.etapas[0]?.motivo ?? '', /confiança alta/)
})

test('confiança média não bloqueia — média é justamente o que se está tentando melhorar', () => {
  const p = planejarDescobertaSobDemanda({ ...BASE, melhor_confianca: 'media' })
  assert.ok(p.custo_estimado > 0)
})

test('desligar parar_ao_encontrar_alta faz tudo rodar mesmo com alta', () => {
  const p = planejarDescobertaSobDemanda(
    { ...BASE, dominio: 'x.com.br', funcionarios: 50, melhor_confianca: 'alta' },
    { pararAoEncontrarAlta: false },
  )
  assert.equal(p.etapas.filter((e) => e.rodara).length, 3)
  assert.equal(p.pode_custar_menos, false)
})

test('o custo estimado é TETO: com parada ligada, o clique pode custar menos', () => {
  const p = planejarDescobertaSobDemanda(BASE)
  assert.equal(p.pode_custar_menos, true)
})

test('deveParar só para em alta', () => {
  assert.equal(deveParar('alta'), true)
  assert.equal(deveParar('media'), false)
  assert.equal(deveParar(null), false)
  assert.equal(deveParar('alta', false), false)
})

test('o orçamento é do originador e o clique que estoura não cabe', () => {
  const o = avaliarOrcamento(49, 50, 1.65)
  assert.equal(o.cabe, false) // 49 + 1,65 = 50,65
  assert.equal(o.saldo, 1)
  assert.equal(o.alerta, true)
  // Um centavo abaixo do teto ainda cabe: o corte é no que ESTOURA, não no que chega perto.
  assert.equal(avaliarOrcamento(48, 50, 1.65).cabe, true)
  assert.equal(avaliarOrcamento(10, 50, 1.65).cabe, true)
  assert.equal(avaliarOrcamento(10, 50, 1.65).alerta, false)
})

test('teto zero não vira alerta permanente nem divisão por zero', () => {
  const o = avaliarOrcamento(0, 0, 1)
  assert.equal(o.cabe, false)
  assert.equal(o.alerta, false)
  assert.equal(o.saldo, 0)
})

// ─── Segunda passada ────────────────────────────────────────────────────────

test('sem contato nenhum, a lacuna é "qualquer" e vale aprofundar', () => {
  const l = lacunasDeContato([])
  assert.deepEqual(l.faltam, ['qualquer'])
  assert.equal(l.vale_aprofundar, true)
  assert.deepEqual(l.temos, [])
})

test('só um contato@ genérico: falta pessoa e celular, e vale aprofundar', () => {
  // É o caso real da I3M: a primeira busca trouxe site, fixo, e-mail e Instagram —
  // nenhum com nome de gente.
  const l = lacunasDeContato([
    { tipo: 'email', valor: 'contato@i3m.com.br', confianca: 'media' },
    { tipo: 'telefone', valor: '+559221264713', confianca: 'media' },
  ])
  assert.deepEqual(l.faltam, ['pessoa', 'celular'])
  assert.equal(l.vale_aprofundar, true)
  assert.equal(l.temos.length, 2)
})

test('o que a validação reprovou entra como FALHOU, não como temos', () => {
  const l = lacunasDeContato([
    { tipo: 'email', valor: 'vendas@dominiomorto.com.br', confianca: 'media', valido: false },
    { tipo: 'telefone', valor: '+5511987654321', confianca: 'alta', nome_pessoa: 'Ana' },
  ])
  assert.deepEqual(l.falharam, ['email: vendas@dominiomorto.com.br'])
  assert.equal(l.temos.length, 1)
  // Dizer o que NÃO funcionou é o que impede a segunda busca de trazê-lo de volta.
  assert.match(l.temos[0] as string, /Ana/)
})

test('pessoa com celular e sem e-mail: VALE aprofundar — falta o e-mail', () => {
  /*
   * Esta regra já foi o contrário, e travava o botão no caso mais comum de todos: um
   * contato de confiança alta achado pela varredura noturna, sem e-mail e sem segunda
   * pessoa. O originador ficava sem caminho para procurar o decisor, que é justamente
   * o que a busca funda faz. Quem decide gastar R$ 0,25 é quem clica.
   */
  const l = lacunasDeContato([
    { tipo: 'telefone', valor: '+5511987654321', confianca: 'alta', nome_pessoa: 'João Silva' },
  ])
  assert.deepEqual(l.faltam, ['email'])
  assert.equal(l.vale_aprofundar, true)
})

test('nada faltando é o único caso que ainda recusa', () => {
  const l = lacunasDeContato([
    { tipo: 'whatsapp', valor: '+5511987654321', confianca: 'alta', nome_pessoa: 'Maria' },
    { tipo: 'email', valor: 'maria@x.com.br', confianca: 'media' },
  ])
  assert.deepEqual(l.faltam, [])
  assert.equal(l.vale_aprofundar, false)
})

test('WhatsApp conta como canal direto tanto quanto o celular', () => {
  const l = lacunasDeContato([
    { tipo: 'whatsapp', valor: '+5511987654321', confianca: 'alta', nome_pessoa: 'Maria' },
    { tipo: 'email', valor: 'maria@x.com.br', confianca: 'media' },
  ])
  assert.deepEqual(l.faltam, [])
  assert.equal(l.vale_aprofundar, false)
})

test('um fixo em nome de pessoa não é canal direto: celular continua faltando', () => {
  const l = lacunasDeContato([
    { tipo: 'telefone', valor: '+551133334444', confianca: 'alta', nome_pessoa: 'Carlos' },
    { tipo: 'email', valor: 'carlos@x.com.br', confianca: 'media' },
  ])
  assert.deepEqual(l.faltam, ['celular'])
  assert.equal(l.vale_aprofundar, true)
})
