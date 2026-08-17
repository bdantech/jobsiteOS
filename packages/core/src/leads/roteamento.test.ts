import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  decidirDestino,
  escolherSdrInbound,
  haDivergenciaDePapel,
  inferirPapel,
  rotearInbound,
  rotuloDaIntencao,
  type CandidatoInbound,
  type SdrCandidato,
} from './roteamento.ts'
import { normalizarCampos, normalizarUtm, utmDaUrl, validarSubmissao, type Campo } from './schemas.ts'

// ─── Diagnóstico e divergência de papel ─────────────────────────────────────

test('CNAE de construção é contratante; o resto é prestador', () => {
  assert.equal(inferirPapel('4120-4/00'), 'contratante')
  assert.equal(inferirPapel('41204'), 'contratante')
  assert.equal(inferirPapel('6810-2/01'), 'contratante', 'incorporação também contrata')
  assert.equal(inferirPapel('4321-5/00'), 'prestador', 'instalação elétrica é fornecedor de obra')
  assert.equal(inferirPapel('4744-0/99'), 'prestador')
})

test('sem CNAE o papel é indefinido — e indefinido nunca diverge', () => {
  assert.equal(inferirPapel(null), 'indefinido')
  assert.equal(inferirPapel(''), 'indefinido')
  assert.equal(
    haDivergenciaDePapel('sacado', null),
    false,
    'antes de a cadastral chegar não há do que divergir',
  )
})

test('declarou contratante e o CNAE diz prestador: diverge', () => {
  assert.equal(haDivergenciaDePapel('sacado', '4321-5/00'), true)
})

test('declarou cedente e o CNAE diz construtora: diverge', () => {
  assert.equal(haDivergenciaDePapel('cedente', '4120-4/00'), true)
})

test('quando concordam, não diverge', () => {
  assert.equal(haDivergenciaDePapel('sacado', '4120-4/00'), false)
  assert.equal(haDivergenciaDePapel('cedente', '4321-5/00'), false)
})

/** `erp` não fala de papel: quem quer sistema de gestão pode ser qualquer um dos dois. */
test('intenção de ERP nunca diverge', () => {
  assert.equal(haDivergenciaDePapel('erp', '4120-4/00'), false)
  assert.equal(haDivergenciaDePapel('erp', '4321-5/00'), false)
})

test('cedente marca a empresa como alvo de aquisição; os outros não', () => {
  assert.equal(rotuloDaIntencao('cedente').tipagemAntecipacao, 'aquisicao')
  assert.equal(rotuloDaIntencao('sacado').tipagemAntecipacao, null)
  assert.equal(rotuloDaIntencao('erp').tipagemAntecipacao, null)
  assert.equal(rotuloDaIntencao(null).tag, 'inbound')
})

// ─── Escolha do SDR ─────────────────────────────────────────────────────────

function sdr(over: Partial<SdrCandidato> = {}): SdrCandidato {
  return {
    id: 'a',
    nome: 'Ana',
    direcao: 'both',
    ufs: [],
    faturamentoMin: null,
    faturamentoMax: null,
    carga: 0,
    ...over,
  }
}

test('quem só faz outbound não recebe inbound', () => {
  const r = escolherSdrInbound([sdr({ id: 'out', direcao: 'out' })], { uf: 'SP', faturamento: null })
  assert.equal(r, null)
})

test('entre dois que cobrem, ganha o de menor carga', () => {
  const r = escolherSdrInbound(
    [sdr({ id: 'cheio', nome: 'Bia', carga: 30 }), sdr({ id: 'vazio', nome: 'Caio', carga: 2 })],
    { uf: 'SP', faturamento: null },
  )
  assert.equal(r?.id, 'vazio')
})

test('território filtra por UF e por faixa de faturamento', () => {
  // `grandes` não tem UF (cobre todas) mas só atende de 10 mi para cima. As cargas
  // são distintas de propósito: assim cada asserção testa o FILTRO, e não o
  // desempate por nome — que já tem teste próprio.
  const candidatos = [
    sdr({ id: 'sp', nome: 'SP', ufs: ['SP'], carga: 1 }),
    sdr({ id: 'mg', nome: 'MG', ufs: ['MG'], carga: 4 }),
    sdr({ id: 'grandes', nome: 'Grandes', faturamentoMin: 10_000_000, carga: 9 }),
  ]
  assert.equal(escolherSdrInbound(candidatos, { uf: 'SP', faturamento: null })?.id, 'sp')
  assert.equal(
    escolherSdrInbound(candidatos, { uf: 'RJ', faturamento: 50_000_000 })?.id,
    'grandes',
    'fora de SP e MG, só o de faixa alta cobre',
  )
  // Ninguém cobre: UF errada para os dois territoriais, valor abaixo do mínimo do
  // terceiro. Ainda assim alguém atende — é a regra do inbound.
  assert.equal(escolherSdrInbound(candidatos, { uf: 'RJ', faturamento: 200_000 })?.id, 'sp')
})

/**
 * O caso que decide se este funil vale alguma coisa: o lead já quer falar com a gente.
 * Deixá-lo órfão porque ninguém configurou o território de RS seria jogar fora a única
 * vantagem do inbound sobre o outbound.
 */
test('sem ninguém cobrindo o território, alguém atende mesmo assim', () => {
  const r = escolherSdrInbound(
    [sdr({ id: 'sp', nome: 'SP', ufs: ['SP'], carga: 9 }), sdr({ id: 'mg', nome: 'MG', ufs: ['MG'], carga: 1 })],
    { uf: 'RS', faturamento: null },
  )
  assert.equal(r?.id, 'mg', 'cai no menos carregado, não em ninguém')
})

test('empate de carga desempata pelo nome, para o resultado ser estável', () => {
  const a = escolherSdrInbound([sdr({ id: '1', nome: 'Zeca' }), sdr({ id: '2', nome: 'Ana' })], {
    uf: null,
    faturamento: null,
  })
  assert.equal(a?.nome, 'Ana')
})

// ─── A cascata completa ─────────────────────────────────────────────────────

function cand(over: Partial<CandidatoInbound> = {}): CandidatoInbound {
  return { ...sdr(), ehSdr: true, ...over }
}

test('havendo SDR de inbound, é ele e sem aviso nenhum', () => {
  const r = rotearInbound([cand({ id: 'sdr1', direcao: 'both' })], { uf: 'SP', faturamento: null }, null)
  assert.equal(r.vendedorId, 'sdr1')
  assert.equal(r.nivel, 'sdr_inbound')
  assert.equal(r.aviso, null)
})

test('SDR marcado só como outbound ainda recebe — o funil de reuniões é a tela dele', () => {
  const r = rotearInbound([cand({ id: 'so-out', direcao: 'out' })], { uf: 'SP', faturamento: null }, null)
  assert.equal(r.vendedorId, 'so-out')
  assert.equal(r.nivel, 'sdr_qualquer')
  assert.match(r.aviso ?? '', /inbound/i)
})

/**
 * O caso REAL que motivou a cascata: na primeira submissão da base o único vendedor
 * cadastrado era um originador. O roteador devolveu null e o lead virou empresa e
 * contato sem aparecer em funil algum — silenciosamente.
 */
test('sem SDR nenhum, cai no vendedor de destino do formulário, com aviso', () => {
  const r = rotearInbound(
    [cand({ id: 'originador', ehSdr: false })],
    { uf: 'SP', faturamento: null },
    'originador',
  )
  assert.equal(r.vendedorId, 'originador')
  assert.equal(r.nivel, 'destino_do_formulario')
  assert.match(r.aviso ?? '', /cadastre um sdr/i, 'o aviso tem de dizer o que consertar')
})

test('sem SDR e sem destino no formulário, o lead ainda assim tem dono', () => {
  const r = rotearInbound(
    [cand({ id: 'a', nome: 'Ana', ehSdr: false, carga: 7 }), cand({ id: 'b', nome: 'Bia', ehSdr: false, carga: 1 })],
    { uf: 'SP', faturamento: null },
    null,
  )
  assert.equal(r.vendedorId, 'b')
  assert.equal(r.nivel, 'ultimo_recurso')
  assert.ok(r.aviso, 'um degrau improvisado tem de parecer improvisado')
})

test('sem vendedor ativo nenhum, admite que não há dono — e diz', () => {
  const r = rotearInbound([], { uf: 'SP', faturamento: null }, null)
  assert.equal(r.vendedorId, null)
  assert.equal(r.nivel, 'ninguem')
  assert.match(r.aviso ?? '', /à mão/i)
})

test('o destino do formulário não passa na frente de um SDR de verdade', () => {
  const r = rotearInbound(
    [cand({ id: 'sdr1', nome: 'SDR' }), cand({ id: 'chefe', nome: 'Chefe', ehSdr: false })],
    { uf: 'SP', faturamento: null },
    'chefe',
  )
  assert.equal(r.vendedorId, 'sdr1')
})

// ─── Supressão ──────────────────────────────────────────────────────────────

test('supressão não bloqueia inbound — manda para revisão humana', () => {
  const d = decidirDestino({ suprimido: true, motivoSupressao: 'solicitacao_lgpd' })
  assert.equal(d.status, 'revisao')
  assert.equal(d.criarLead, false, 'em revisão ninguém é acionado antes da decisão humana')
  assert.match(d.motivoRevisao ?? '', /supressão/i)
})

test('sem supressão, processa e cria o lead', () => {
  const d = decidirDestino({ suprimido: false })
  assert.equal(d.status, 'processada')
  assert.equal(d.criarLead, true)
})

// ─── Validação e spam ───────────────────────────────────────────────────────

const CAMPOS: Campo[] = [
  { key: 'cnpj', label: 'CNPJ', tipo: 'cnpj', obrigatorio: true, ordem: 0 },
  { key: 'email', label: 'E-mail', tipo: 'email', obrigatorio: true, ordem: 1 },
  { key: 'nome', label: 'Nome', tipo: 'texto', obrigatorio: false, ordem: 2 },
]

const CNPJ_OK = '11222333000181'

test('o honeypot descarta em SILÊNCIO, antes de validar qualquer coisa', () => {
  const r = validarSubmissao({ dados: { cnpj: 'lixo' }, _hp: 'http://spam' }, CAMPOS, false)
  assert.equal(r.ok, false)
  assert.equal(r.motivo, 'spam_honeypot')
  assert.equal(r.silencioso, true, 'o bot não pode aprender o que o denunciou')
})

test('preenchido em menos de 2s é bot, e também em silêncio', () => {
  const r = validarSubmissao({ dados: { cnpj: CNPJ_OK, email: 'a@b.com' }, _ms: 300 }, CAMPOS, false)
  assert.equal(r.motivo, 'spam_rapido_demais')
  assert.equal(r.silencioso, true)
})

test('humano lento passa', () => {
  const r = validarSubmissao({ dados: { cnpj: CNPJ_OK, email: 'a@b.com' }, _ms: 45_000 }, CAMPOS, false)
  assert.equal(r.ok, true)
  assert.equal(r.cnpj, CNPJ_OK)
})

test('CNPJ com dígito verificador errado não passa — e o erro é visível', () => {
  const r = validarSubmissao({ dados: { cnpj: '11222333000199' } }, CAMPOS, false)
  assert.equal(r.motivo, 'cnpj_invalido')
  assert.equal(r.silencioso, false, 'quem errou o CNPJ precisa saber')
})

test('CNPJ aceita máscara — a pessoa digita com ponto e barra', () => {
  const r = validarSubmissao({ dados: { cnpj: '11.222.333/0001-81', email: 'a@b.com' } }, CAMPOS, false)
  assert.equal(r.ok, true)
  assert.equal(r.cnpj, CNPJ_OK)
})

test('e-mail digitado errado é recusado; ausente cai na regra de obrigatório', () => {
  assert.equal(validarSubmissao({ dados: { cnpj: CNPJ_OK, email: 'a@b' } }, CAMPOS, false).motivo, 'email_invalido')
  const semEmail = validarSubmissao({ dados: { cnpj: CNPJ_OK } }, CAMPOS, false)
  assert.equal(semEmail.motivo, 'campo_obrigatorio')
  assert.equal(semEmail.campo, 'email')
})

test('consentimento obrigatório e não aceito recusa', () => {
  const r = validarSubmissao({ dados: { cnpj: CNPJ_OK, email: 'a@b.com' } }, CAMPOS, true)
  assert.equal(r.motivo, 'consentimento_ausente')
  const ok = validarSubmissao(
    { dados: { cnpj: CNPJ_OK, email: 'a@b.com' }, consentimento_aceito: true },
    CAMPOS,
    true,
  )
  assert.equal(ok.ok, true)
})

// ─── Campos e UTM ───────────────────────────────────────────────────────────

test('CNPJ é sempre o primeiro campo e sempre obrigatório, mesmo se removerem', () => {
  const r = normalizarCampos([
    { key: 'nome', label: 'Nome', tipo: 'texto', obrigatorio: false, ordem: 5 },
    { key: 'email', label: 'E-mail', tipo: 'email', obrigatorio: true, ordem: 2 },
  ])
  assert.equal(r[0]?.key, 'cnpj')
  assert.equal(r[0]?.obrigatorio, true)
  assert.deepEqual(
    r.map((c) => c.key),
    ['cnpj', 'email', 'nome'],
    'o resto segue a ordem pedida, renumerada',
  )
})

test('tentar marcar o CNPJ como opcional não funciona', () => {
  const r = normalizarCampos([{ key: 'cnpj', label: 'CNPJ', tipo: 'cnpj', obrigatorio: false, ordem: 3 }])
  assert.equal(r[0]?.obrigatorio, true)
  assert.equal(r.length, 1)
})

test('UTM vira minúscula e sem espaço — senão Google e google viram duas campanhas', () => {
  const u = normalizarUtm({ utm_source: '  Google ', utm_campaign: 'LP_SP', utm_medium: '' })
  assert.equal(u.utm_source, 'google')
  assert.equal(u.utm_campaign, 'lp_sp')
  assert.equal(u.utm_medium, undefined, 'string vazia não vira UTM')
})

test('UTM sai da URL da página hospedeira, e URL quebrada não derruba nada', () => {
  const u = utmDaUrl('https://brik.com.br/lp?utm_source=Meta&utm_campaign=Abril&x=1')
  assert.equal(u.utm_source, 'meta')
  assert.equal(u.utm_campaign, 'abril')
  assert.deepEqual(utmDaUrl('não é url'), {})
  assert.deepEqual(utmDaUrl(null), {})
})
