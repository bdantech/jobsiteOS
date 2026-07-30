import assert from 'node:assert/strict'
import { test } from 'node:test'
import { vencimentoDeTextoLivre, vencimentosDeTextoLivre } from './vencimento-texto.ts'

/**
 * Os textos deste arquivo são REAIS: vieram de `xDescServ` e `infCpl` de notas da
 * base, escolhidos entre as que caíam no fallback de emissão + 30. É contra eles
 * que o parser vale algo — um parser de vencimento validado só com exemplo
 * inventado acerta o exemplo inventado.
 *
 * A assimetria que guia as escolhas: perder um vencimento custa cair no fallback,
 * que é o que já acontecia. INVENTAR um vencimento envenena a decisão de operar e a
 * receita esperada. Na dúvida, o parser devolve nada.
 */

const EMISSAO = '2026-07-15'
const HOJE = new Date('2026-07-20T12:00:00Z')

const venc = (texto: string, emissao = EMISSAO): string | null =>
  vencimentoDeTextoLivre(texto, emissao, HOJE)?.vencimento ?? null

// ─── Casos reais que DEVEM ser lidos ────────────────────────────────────────

test('real: "Vencimentos: 26/08/2026 R$ 1.560,00 BOLETO"', () => {
  const t =
    'Plotagens adesivos etiquetas - Impressões Digitais Dados adicionais: Solicitação: SC18458 ' +
    'Solicitante: Vitor DADOS BANCÁRIOS BANCO SICREDI (748) AG.: 2602 CC : 54786-7 ' +
    'Dressel Comunicação Visual Ltda CNPJ: 00.963.945/0001-09 Vencimentos: 26/08/2026 R$ 1.560,00 BOLETO'
  assert.equal(venc(t), '2026-08-26')
})

test('real: bullet "•Vencimento: 05/06/2026"', () => {
  const t =
    '•Nome da Obra: LINHA UNNI •Endereço da Obra: R. Raimundo da Cunha Matos, 420 ' +
    '•Valor a Faturar: R$ 6.080,00 •Vencimento: 05/06/2026 •Dados bancários'
  assert.equal(venc(t, '2026-06-01'), '2026-06-05')
})

test('real: mês de um dígito "Vencimento: 10/9/2026"', () => {
  assert.equal(venc('Exames Laboratoriais conforme contrato. Vencimento: 10/9/2026'), '2026-09-10')
})

test('real: separador ponto "Vencimento: 25.08.2026"', () => {
  const t =
    '|SERVICOS REPARO 270,52|EQUIPAMENTOS| No valor total de R$ 270.52, ' +
    'Venc. fixo dia 25 mes subseqt. | Vencimento: 25.08.2026|O PERCENTUAL APROXIMADO'
  assert.equal(venc(t), '2026-08-25')
})

test('real: minúsculo, depois de "Medicão" e "Junho/2026"', () => {
  const t =
    'Obra a26000 - (SPE) JR TAQUARAL / OBRA Número de inscrição da obra 90.021.67306/70 ' +
    'Ref. Medicão serviços grua de pequeno porte Junho/2026 vencimento 05/08/2026 JR TAQUARAL'
  assert.equal(venc(t), '2026-08-05')
})

test('real: "VENCIMENTO 10/08/2026 (25% Final 1 - 2° Parcela)"', () => {
  const t =
    'ELABORAÇÃO DE MANUAL DE USO, OPERAÇÃO E MANUTENÇÃO OBRA: Edf. Piazza - ' +
    'VENCIMENTO 10/08/2026 (25% Final 1 - 2° Parcela) - VALOR LÍQUIDO A PAGAR R$1.625,00'
  assert.equal(venc(t), '2026-08-10')
})

test('real: sem ano — "VENCIMENTO: 17/08" completa pela emissão', () => {
  const t =
    'MÃO DE OBRA REF. OPERAÇÃO COM GUINDASTE CONFORME PC: 1213/2300 BM: 9 - 230, 234 e 236/2026 ' +
    'PERIODO: 01/06/2026 a 30/06/2026 CNO: 90.018.31621/76 Obra: OI1044 - ALEMOA ' +
    'MÃO DE OBRA: R$ 23.076,10 - VENCIMENTO: 17/08'
  assert.equal(venc(t), '2026-08-17')
})

test('sem ano, virada de ano: emitida em dezembro, vence em janeiro', () => {
  assert.equal(venc('Vencimento: 10/01', '2026-12-20'), '2027-01-10')
})

// ─── Casos reais que NÃO devem produzir data ────────────────────────────────

test('real: "ATÉ 48 HORAS ÚTEIS" não é vencimento', () => {
  const t =
    'SERVIÇO DE LANÇAMENTO DE ARGAMASSA PARA CONTRAPISO PARA OBRA: VILA GONZAGA, ' +
    'CEI: 90.02439768/77, CEP 55015-325. O ACEITE AOS TERMOS DA PRESENTE NOTA FISCAL DE SERVIÇO ' +
    'DEVERÁ SER CONFIRMADO ATÉ 48 HORAS ÚTEIS, APÓS O RECEBIMENTO'
  assert.equal(venc(t), null)
})

test('real: "Condicoes de Pagamento: PIX/TED/DOC" sem data alguma', () => {
  const t =
    'TROCAS DE PNEUS 100,00 ALINHAMENTO E BALANCEAMENTO 250,00 PIS - R$ 5,77 ' +
    'Valor Liquido da Nota Fiscal - R$ 350,00 Condicoes de Pagamento: PIX/TED/DOC ' +
    'Contato: 50660 - Depto: 400 O.S.: 007197 - Placa: GDH0H92'
  assert.equal(venc(t), null)
})

test('data sem rótulo nenhum é ignorada', () => {
  assert.equal(venc('Obra iniciada em 10/08/2026 conforme cronograma aprovado.'), null)
})

test('rótulo negativo mais próximo vence o de vencimento', () => {
  // "Emissão" está mais perto da data que "pagamento".
  assert.equal(venc('Condições de pagamento conforme contrato. Data de emissão: 20/08/2026'), null)
})

test('período de competência não é vencimento', () => {
  assert.equal(venc('Vencimento conforme contrato. PERIODO: 01/06/2026 a 30/06/2026'), null)
})

test('"Parcela 1/3" é fração, não 1º de março', () => {
  assert.equal(venc('Parcela 1/3 conforme acordado.'), null)
  assert.equal(venc('Pagamento parcela 1/12 do contrato.'), null)
})

test('data anterior à emissão não é vencimento', () => {
  assert.equal(venc('Vencimento: 10/01/2020'), null)
})

test('data absurdamente distante é cláusula de contrato, não vencimento', () => {
  assert.equal(venc('Vencimento do contrato: 10/08/2035'), null)
})

test('31/02 não existe e não vira 03/03', () => {
  assert.equal(venc('Vencimento: 31/02/2026'), null)
})

test('texto vazio, nulo e sem data', () => {
  assert.equal(venc(''), null)
  assert.equal(vencimentoDeTextoLivre(null, EMISSAO, HOJE), null)
  assert.equal(vencimentoDeTextoLivre(undefined, EMISSAO, HOJE), null)
  assert.equal(venc('Serviço prestado conforme contrato.'), null)
})

// ─── Várias parcelas ────────────────────────────────────────────────────────

test('várias datas: escolhe a primeira em aberto', () => {
  const t = 'Vencimento 1a parcela: 18/07/2026 Vencimento 2a parcela: 18/08/2026 Vencimento 3a: 18/09/2026'
  const r = vencimentosDeTextoLivre(t, EMISSAO)
  assert.deepEqual(r.datas, ['2026-07-18', '2026-08-18', '2026-09-18'])
  // HOJE é 20/07: a de 18/07 já venceu.
  assert.equal(venc(t), '2026-08-18')
})

test('todas vencidas: fica a última, que é a dívida que resta', () => {
  const t = 'Vencimento 1a parcela: 16/07/2026 Vencimento 2a parcela: 17/07/2026'
  assert.equal(venc(t), '2026-07-17')
})

// ─── Prazo em dias ──────────────────────────────────────────────────────────

test('prazo em dias vira data sobre a emissão', () => {
  const r = vencimentoDeTextoLivre('CONDICOES DE PAGAMENTO: 28 DIAS', EMISSAO, HOJE)
  assert.equal(r?.vencimento, '2026-08-12')
  assert.equal(r?.origem, 'prazo')
})

test('prazo múltiplo "30/60/90 dias" gera as três e escolhe a primeira em aberto', () => {
  const r = vencimentosDeTextoLivre('PRAZO: 30/60/90 DIAS', EMISSAO)
  assert.deepEqual(r.datas, ['2026-08-14', '2026-09-13', '2026-10-13'])
  assert.equal(r.origem, 'prazo')
})

test('data explícita tem precedência sobre prazo em dias', () => {
  const r = vencimentoDeTextoLivre('Pagamento: 30 dias — Vencimento: 20/08/2026', EMISSAO, HOJE)
  assert.equal(r?.vencimento, '2026-08-20')
  assert.equal(r?.origem, 'data')
})

test('"30 dias de garantia" não é prazo de pagamento', () => {
  assert.equal(venc('Garantia de 30 dias sobre o serviço executado.'), null)
})

test('sem emissão, prazo em dias não tem base e é ignorado', () => {
  assert.equal(vencimentoDeTextoLivre('Pagamento: 28 dias', null, HOJE), null)
})

// ─── À vista ────────────────────────────────────────────────────────────────

test('real: "COND.PAGAMENTO: PAGAMENTO A VISTA" vence na emissão', () => {
  const t =
    'PEDIDO: OV CIMENTO MARCACAO CLIENTE: ENCOMENDA: 8915982/010 CLIENTE: 70660 ' +
    'COND.VENDA: FOB COND.PAGAMENTO: PAGAMENTO A VISTA VALOR/QUILO: 0,0003532'
  const r = vencimentoDeTextoLivre(t, EMISSAO, HOJE)
  assert.equal(r?.vencimento, EMISSAO)
  assert.equal(r?.origem, 'a_vista')
})

test('real: "Condicao de Pagto:001 - A VISTA"', () => {
  const r = vencimentoDeTextoLivre('Pedido(s): 046625 | Condicao de Pagto:001 - A VISTA R521439', EMISSAO, HOJE)
  assert.equal(r?.origem, 'a_vista')
})

test('"avista" junto e "contra apresentacao" também contam', () => {
  assert.equal(vencimentoDeTextoLivre('Pagamento avista', EMISSAO, HOJE)?.origem, 'a_vista')
  assert.equal(vencimentoDeTextoLivre('Pagamento contra apresentacao', EMISSAO, HOJE)?.origem, 'a_vista')
})

test('data explícita e prazo têm precedência sobre à vista', () => {
  assert.equal(vencimentoDeTextoLivre('Pagamento a vista. Vencimento: 20/08/2026', EMISSAO, HOJE)?.origem, 'data')
})

test('"a vista" sem rótulo de pagamento por perto não conta', () => {
  // "à vista de todos" e afins: sem rótulo, é prosa.
  assert.equal(vencimentoDeTextoLivre('Serviço executado a vista do fiscal da obra', EMISSAO, HOJE), null)
})

test('"dados bancários para pagamento" sem data continua sem vencimento', () => {
  const t =
    'Serviços de engenharia dados bancários para pagamento: Banco: DOCK IP S.A. - 301 ' +
    'ATALINE LUIS LOPES DE MOURA LTDA CNPJ: 49.150.525/0001-00 (PIX)'
  assert.equal(venc(t), null)
})
