import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  consolidarCapa,
  creditosDoHeader,
  fontePrincipal,
  identificarPartes,
  normalizarEnvolvidos,
  normalizarPolo,
  normalizarTipoMovimentacao,
  proximaPagina,
  varrerCursor,
  type EscavadorProcesso,
} from './escavador.ts'

const NOSSO = '11222333000181'
const DEVEDOR = '11444777000161'

const PROCESSO: EscavadorProcesso = {
  numero_cnj: '0000070-07.2026.8.19.0001',
  titulo_polo_ativo: 'ONE OS FIDC',
  titulo_polo_passivo: 'Construtora Alfa',
  data_ultima_movimentacao: '2026-08-01T00:00:00-03:00',
  quantidade_movimentacoes: 42,
  status_predito: 'ATIVO',
  fontes_tribunais_estao_arquivadas: false,
  estado_origem: { sigla: 'RJ' },
  unidade_origem: { nome: '2ª Vara Empresarial', cidade: 'Rio de Janeiro' },
  fontes: [
    {
      grau: 2,
      sistema: 'PJE',
      url: 'https://tj.example/2g',
      tribunal: { sigla: 'TJRJ', nome: 'Tribunal de Justiça do RJ' },
      capa: { classe: 'Apelação', orgao_julgador: '3ª Câmara Cível', valor_causa: 999 },
      envolvidos: [{ nome: 'ONE OS FIDC', polo: 'ATIVO', cnpj: NOSSO }],
    },
    {
      grau: 1,
      sistema: 'EPROC',
      url: 'https://tj.example/1g',
      tribunal: { sigla: 'TJRJ', nome: 'Tribunal de Justiça do RJ' },
      capa: {
        classe: 'Execução de Título Extrajudicial',
        assunto: 'Duplicata',
        area: 'Cível',
        orgao_julgador: '2ª Vara Empresarial',
        valor_causa: { valor: 1_250_000.5, moeda: 'R$' },
        data_distribuicao: '2026-01-15T00:00:00-03:00',
        segredo_justica: false,
        fisico: false,
      },
      envolvidos: [
        { nome: 'ONE OS FIDC', polo: 'ATIVO', cnpj: NOSSO, tipo: 'Exequente' },
        {
          nome: 'Construtora Alfa Ltda',
          polo: 'PASSIVO',
          cnpj: DEVEDOR,
          tipo: 'Executado',
          advogados: [{ nome: 'Dra. Marina', oab: { numero: 12345, uf: 'RJ' } }],
        },
      ],
    },
  ],
}

test('a fonte principal é a de MENOR grau', () => {
  assert.equal(fontePrincipal(PROCESSO.fontes)?.grau, 1)
  // Fonte sem grau vai para o fim: null ordenado como zero venceria o primeiro grau.
  assert.equal(fontePrincipal([{ grau: null, sigla: 'X' }, { grau: 1, sigla: 'Y' }])?.sigla, 'Y')
  assert.equal(fontePrincipal([]), null)
  assert.equal(fontePrincipal(null), null)
})

test('a capa consolidada vem do primeiro grau, não do recurso', () => {
  const c = consolidarCapa(PROCESSO)!
  assert.equal(c.classe, 'Execução de Título Extrajudicial')
  assert.equal(c.orgao_julgador, '2ª Vara Empresarial')
  assert.equal(c.grau, 1)
  assert.equal(c.sistema, 'EPROC')
  assert.equal(c.url_tribunal, 'https://tj.example/1g')
  // O valor da causa do 2º grau (999) NÃO pode vencer o da vara de origem.
  assert.equal(c.valor_causa, 1_250_000.5)
})

test('a comarca vem da unidade de origem, e a UF do estado', () => {
  const c = consolidarCapa(PROCESSO)!
  assert.equal(c.comarca, 'Rio de Janeiro')
  assert.equal(c.uf, 'RJ')
})

test('datas de capa viram AAAA-MM-DD; lixo vira null', () => {
  const c = consolidarCapa(PROCESSO)!
  assert.equal(c.data_distribuicao, '2026-01-15')
  assert.equal(c.data_ultima_movimentacao, '2026-08-01')
  assert.equal(c.data_arquivamento, null)
  const ruim = consolidarCapa({ ...PROCESSO, fontes: [{ grau: 1, capa: { data_distribuicao: 'ontem' } }] })!
  assert.equal(ruim.data_distribuicao, null)
})

test('o CNJ é normalizado para a máscara', () => {
  const c = consolidarCapa({ ...PROCESSO, numero_cnj: '00000700720268190001' })!
  assert.equal(c.numero_cnj, '0000070-07.2026.8.19.0001')
})

test('processo sem número não vira linha', () => {
  assert.equal(consolidarCapa({ ...PROCESSO, numero_cnj: null }), null)
})

test('processo sem fonte nenhuma ainda consolida o que o topo sabe', () => {
  const c = consolidarCapa({ ...PROCESSO, fontes: [] })!
  assert.equal(c.classe, null)
  assert.equal(c.titulo_polo_passivo, 'Construtora Alfa')
  assert.equal(c.status_predito, 'ATIVO')
})

test('envolvidos são deduplicados por (nome, polo) entre as fontes', () => {
  const es = normalizarEnvolvidos(PROCESSO.fontes)
  assert.equal(es.length, 2)
  assert.equal(es.filter((e) => e.nome === 'ONE OS FIDC').length, 1)
})

test('o CNPJ que só uma fonte trouxe é COMPLETADO, não perdido', () => {
  const es = normalizarEnvolvidos([
    { grau: 2, envolvidos: [{ nome: 'Construtora Alfa Ltda', polo: 'PASSIVO' }] },
    { grau: 1, envolvidos: [{ nome: 'Construtora Alfa Ltda', polo: 'PASSIVO', cnpj: DEVEDOR }] },
  ])
  assert.equal(es.length, 1)
  assert.equal(es[0]!.cpf_cnpj, DEVEDOR)
})

test('a OAB é lida de `oab` ou do primeiro item de `oabs`', () => {
  const es = normalizarEnvolvidos(PROCESSO.fontes)
  const devedor = es.find((e) => e.nome === 'Construtora Alfa Ltda')!
  assert.deepEqual(devedor.advogados, [{ nome: 'Dra. Marina', oab_numero: '12345', oab_uf: 'RJ' }])

  const outro = normalizarEnvolvidos([
    { envolvidos: [{ nome: 'X', polo: 'ATIVO', advogados: [{ nome: 'Dr. Y', oabs: [{ numero: '9', uf: 'SP' }] }] }] },
  ])
  assert.equal(outro[0]!.advogados[0]!.oab_numero, '9')
})

test('polo é normalizado; o desconhecido é null, nunca um chute', () => {
  assert.equal(normalizarPolo('ATIVO'), 'ativo')
  // O Escavador escreve o papel processual em vez do polo com frequência, e em caixas
  // diferentes conforme o tribunal de origem.
  assert.equal(normalizarPolo('Executado'), 'passivo')
  assert.equal(normalizarPolo('EXECUTADO'), 'passivo')
  assert.equal(normalizarPolo('Réu'), 'passivo')
  assert.equal(normalizarPolo('Exequente'), 'ativo')
  assert.equal(normalizarPolo('TERCEIRO'), null)
  assert.equal(normalizarPolo(null), null)
})

test('o devedor é procurado no polo OPOSTO ao nosso, por CNPJ', () => {
  const r = identificarPartes(normalizarEnvolvidos(PROCESSO.fontes), [NOSSO])
  assert.equal(r.nosso_cnpj, NOSSO)
  assert.equal(r.polo_nosso, 'ativo')
  assert.deepEqual(r.cnpjs_devedores, [DEVEDOR])
})

test('sem o nosso CNPJ no processo não há polo oposto — e não há devedor chutado', () => {
  const r = identificarPartes(normalizarEnvolvidos(PROCESSO.fontes), ['99999999000191'])
  assert.equal(r.nosso_cnpj, null)
  assert.equal(r.polo_nosso, null)
  assert.deepEqual(r.cnpjs_devedores, [])
})

test('o nosso próprio CNPJ nunca entra como devedor', () => {
  const envolvidos = normalizarEnvolvidos([
    {
      grau: 1,
      envolvidos: [
        { nome: 'ONE OS FIDC', polo: 'PASSIVO', cnpj: NOSSO },
        { nome: 'Securitizadora', polo: 'ATIVO', cnpj: '11222333000262' },
      ],
    },
  ])
  const r = identificarPartes(envolvidos, [NOSSO, '11222333000262'])
  assert.equal(r.polo_nosso, 'passivo')
  assert.deepEqual(r.cnpjs_devedores, [])
})

test('CPF de pessoa física no polo oposto não vira empresa devedora', () => {
  const envolvidos = normalizarEnvolvidos([
    {
      grau: 1,
      envolvidos: [
        { nome: 'ONE OS FIDC', polo: 'ATIVO', cnpj: NOSSO },
        { nome: 'Fulano Avalista', polo: 'PASSIVO', cpf: '12345678901' },
      ],
    },
  ])
  assert.deepEqual(identificarPartes(envolvidos, [NOSSO]).cnpjs_devedores, [])
})

test('o cursor é a URL inteira de links.next, ou null', () => {
  assert.equal(proximaPagina({ links: { next: 'https://api/x?cursor=abc' } }), 'https://api/x?cursor=abc')
  assert.equal(proximaPagina({ links: { next: null } }), null)
  assert.equal(proximaPagina({ links: {} }), null)
  assert.equal(proximaPagina(null), null)
})

test('créditos ausentes contam zero, nunca NaN', () => {
  const h = (v: string | null) => ({ get: () => v })
  assert.equal(creditosDoHeader(h('3')), 3)
  assert.equal(creditosDoHeader(h(null)), 0)
  assert.equal(creditosDoHeader(h('n/a')), 0)
})

test('tipo de movimentação desconhecido cai em ANDAMENTO', () => {
  assert.equal(normalizarTipoMovimentacao('PUBLICAÇÃO'), 'PUBLICACAO')
  assert.equal(normalizarTipoMovimentacao('publicacao'), 'PUBLICACAO')
  assert.equal(normalizarTipoMovimentacao('ANDAMENTO'), 'ANDAMENTO')
  assert.equal(normalizarTipoMovimentacao(null), 'ANDAMENTO')
})

// ─── Varredura por cursor ───────────────────────────────────────────────────

/** Fábrica de uma API paginada falsa: cada página devolve itens e o próximo link. */
function apiFalsa(paginas: Record<string, { itens: number[]; next: string | null }>) {
  const chamadas: string[] = []
  return {
    chamadas,
    buscar: async (url: string) => {
      chamadas.push(url)
      const p = paginas[url]
      if (!p) throw new Error(`página inesperada: ${url}`)
      return { dados: { items: p.itens, links: { next: p.next } }, creditos: 1 }
    },
  }
}

const extrairItens = (p: unknown): number[] => ((p as { items?: number[] }).items ?? [])

test('varre todas as páginas e soma os créditos', async () => {
  const api = apiFalsa({
    '/p1': { itens: [1, 2], next: '/p2' },
    '/p2': { itens: [3], next: '/p3' },
    '/p3': { itens: [4, 5], next: null },
  })
  const r = await varrerCursor<number>('/p1', api.buscar, extrairItens)
  assert.deepEqual(r.itens, [1, 2, 3, 4, 5])
  assert.equal(r.paginas, 3)
  assert.equal(r.creditos, 3)
  assert.equal(r.truncado, false)
})

test('uma página só, sem next', async () => {
  const api = apiFalsa({ '/p1': { itens: [1], next: null } })
  const r = await varrerCursor<number>('/p1', api.buscar, extrairItens)
  assert.deepEqual(r.itens, [1])
  assert.equal(r.truncado, false)
})

test('CURSOR REPETIDO para a varredura em vez de girar para sempre', async () => {
  // A segunda página aponta de volta para a primeira: sem a defesa, isto seria um
  // laço infinito gastando crédito a 460 chamadas por minuto.
  const api = apiFalsa({
    '/p1': { itens: [1], next: '/p2' },
    '/p2': { itens: [2], next: '/p1' },
  })
  const r = await varrerCursor<number>('/p1', api.buscar, extrairItens)
  assert.deepEqual(r.itens, [1, 2])
  // Duas chamadas e não três: a terceira seria /p1 de novo.
  assert.deepEqual(api.chamadas, ['/p1', '/p2'])
  // Truncado, e não "concluído": a diferença entre "acabaram os processos" e
  // "paramos de olhar" é o que quem chama registra.
  assert.equal(r.truncado, true)
})

test('o teto de páginas trunca e não estoura', async () => {
  const paginas: Record<string, { itens: number[]; next: string | null }> = {}
  for (let i = 1; i <= 10; i++) paginas[`/p${i}`] = { itens: [i], next: `/p${i + 1}` }
  paginas['/p11'] = { itens: [11], next: null }

  const api = apiFalsa(paginas)
  const r = await varrerCursor<number>('/p1', api.buscar, extrairItens, 3)
  assert.equal(r.paginas, 3)
  assert.deepEqual(r.itens, [1, 2, 3])
  assert.equal(r.truncado, true)
})

test('página vazia no meio não interrompe a varredura', async () => {
  const api = apiFalsa({
    '/p1': { itens: [1], next: '/p2' },
    '/p2': { itens: [], next: '/p3' },
    '/p3': { itens: [3], next: null },
  })
  const r = await varrerCursor<number>('/p1', api.buscar, extrairItens)
  assert.deepEqual(r.itens, [1, 3])
  assert.equal(r.truncado, false)
})

// ─── O valor da causa, contra o retorno REAL do Escavador ───────────────────

/**
 * O payload destes testes é o que a API devolveu de verdade numa descoberta de
 * 31/08/2026. Eles existem porque a regra antiga ("ponto seguido de três dígitos
 * é milhar") lia `"722332.8400"` como 7.223.328.400 — dez mil vezes o valor real,
 * num campo que aparece na tela e vai para o parecer da IA.
 */
test('valor da causa: quatro casas decimais com ponto, o formato do Escavador', () => {
  const c = consolidarCapa({
    numero_cnj: '1001425-65.2025.8.26.0100',
    fontes: [{
      grau: 1,
      capa: { valor_causa: { valor: '722332.8400', moeda: 'R$', valor_formatado: 'R$ 722.332,84' } },
    },],
  } as never)
  assert.equal(c?.valor_causa, 722332.84)
})

test('valor da causa: vírgula manda, e o ponto vira milhar', () => {
  const c = consolidarCapa({
    numero_cnj: '1001425-65.2025.8.26.0100',
    fontes: [{ grau: 1, capa: { valor_causa: { valor: '1.250.000,50' } } },],
  } as never)
  assert.equal(c?.valor_causa, 1250000.5)
})

test('valor da causa: grupos perfeitos de três, sem decimal, continuam milhar', () => {
  const c = consolidarCapa({
    numero_cnj: '1001425-65.2025.8.26.0100',
    fontes: [{ grau: 1, capa: { valor_causa: '1.250.000' } }],
  } as never)
  assert.equal(c?.valor_causa, 1250000)
})

test('valor da causa: número já numérico passa direto', () => {
  const c = consolidarCapa({
    numero_cnj: '1001425-65.2025.8.26.0100',
    fontes: [{ grau: 1, capa: { valor_causa: 999.5 } }],
  } as never)
  assert.equal(c?.valor_causa, 999.5)
})

test('valor da causa: ausente é null, e não zero', () => {
  // "Não informado" não é "de graça": um zero somaria na carteira como se o
  // processo não valesse nada.
  const c = consolidarCapa({
    numero_cnj: '1001425-65.2025.8.26.0100',
    fontes: [{ grau: 1, capa: {} }],
  } as never)
  assert.equal(c?.valor_causa, null)
})

test('valor da causa: lixo não vira NaN no banco', () => {
  const c = consolidarCapa({
    numero_cnj: '1001425-65.2025.8.26.0100',
    fontes: [{ grau: 1, capa: { valor_causa: 'não informado' } }],
  } as never)
  assert.equal(c?.valor_causa, null)
})
