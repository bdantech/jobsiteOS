import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseNfeXml, vencimentoDasParcelas } from './nfe-xml.ts'

/**
 * O parser é a semente do Pricing: os itens que ele extrai hoje são os que vão
 * precificar depois. Estes testes travam as três coisas que quebram em silêncio —
 * namespace, entidade e valor mal formado — e a regra de "primeira parcela em
 * aberto", que é o que define o vencimento de metade das notas.
 */

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe versao="4.00" Id="NFe35240712345678000190550010000012341000012348">
      <ide><nNF>1234</nNF><serie>1</serie><dhEmi>2026-07-01T10:30:00-03:00</dhEmi></ide>
      <emit><CNPJ>12345678000190</CNPJ><xNome>FORNECEDOR &amp; CIA LTDA</xNome></emit>
      <dest><CNPJ>98.765.432/0001-10</CNPJ><xNome>CONSTRUTORA MODELO</xNome></dest>
      <det nItem="1">
        <prod>
          <cProd>A-100</cProd>
          <xProd>CIMENTO CP-II 50KG</xProd>
          <NCM>25232910</NCM>
          <CFOP>5102</CFOP>
          <uCom>SC</uCom>
          <qCom>100.0000</qCom>
          <vUnCom>32.5000</vUnCom>
          <vProd>3250.00</vProd>
        </prod>
      </det>
      <det nItem="2">
        <prod>
          <cProd>B-200</cProd>
          <xProd>ACO CA-50 &lt;12mm&gt;</xProd>
          <NCM>72141000</NCM>
          <CFOP>5102</CFOP>
          <uCom>KG</uCom>
          <qCom>500.0000</qCom>
          <vUnCom>7.9000</vUnCom>
          <vProd>3950.00</vProd>
        </prod>
      </det>
      <cobr>
        <dup><nDup>001</nDup><dVenc>2026-06-15</dVenc><vDup>3600.00</vDup></dup>
        <dup><nDup>002</nDup><dVenc>2026-08-15</dVenc><vDup>3600.00</vDup></dup>
      </cobr>
      <total><ICMSTot><vNF>7200.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
</nfeProc>`

test('extrai identificação, CNPJs e valor total', () => {
  const r = parseNfeXml(XML)
  assert.equal(r.erro, null)
  assert.equal(r.access_key, '35240712345678000190550010000012341000012348')
  assert.equal(r.numero, '1234')
  assert.equal(r.serie, '1')
  assert.equal(r.valor_total, 7200)
  assert.equal(r.emitente_cnpj, '12345678000190')
  // O CNPJ do destinatário vinha pontuado — a normalização é do parser.
  assert.equal(r.destinatario_cnpj, '98765432000110')
})

test('extrai itens com quantidade e valores numéricos', () => {
  const { itens } = parseNfeXml(XML)
  assert.equal(itens.length, 2)
  assert.deepEqual(itens[0], {
    ordem: 1,
    codigo: 'A-100',
    descricao: 'CIMENTO CP-II 50KG',
    ncm: '25232910',
    cfop: '5102',
    unidade: 'SC',
    quantidade: 100,
    valor_unitario: 32.5,
    valor_total: 3250,
  })
})

test('desescapa entidades na descrição do item', () => {
  const { itens } = parseNfeXml(XML)
  // &lt;12mm&gt; tem de virar <12mm>, senão a descrição do Pricing carrega markup.
  assert.equal(itens[1]?.descricao, 'ACO CA-50 <12mm>')
})

test('ignora namespace no nome da tag', () => {
  const comNs = XML.replace(/<(\/?)(nNF|dVenc|vNF)>/g, '<$1ns2:$2>')
  const r = parseNfeXml(comNs)
  assert.equal(r.numero, '1234')
  assert.equal(r.valor_total, 7200)
  assert.equal(r.parcelas.length, 2)
})

test('extrai todas as parcelas do cobr/dup', () => {
  const { parcelas } = parseNfeXml(XML)
  assert.deepEqual(parcelas, [
    { numero: '001', vencimento: '2026-06-15', valor: 3600 },
    { numero: '002', vencimento: '2026-08-15', valor: 3600 },
  ])
})

test('a primeira parcela EM ABERTO é o vencimento', () => {
  const { parcelas } = parseNfeXml(XML)
  // Em 2026-07-13 a primeira (junho) já venceu; vale a de agosto.
  assert.equal(vencimentoDasParcelas(parcelas, new Date('2026-07-13T00:00:00Z')), '2026-08-15')
  // Antes de qualquer vencimento, vale a primeira.
  assert.equal(vencimentoDasParcelas(parcelas, new Date('2026-05-01T00:00:00Z')), '2026-06-15')
})

test('todas vencidas: vale a última, que é a dívida que resta', () => {
  const { parcelas } = parseNfeXml(XML)
  assert.equal(vencimentoDasParcelas(parcelas, new Date('2026-12-01T00:00:00Z')), '2026-08-15')
})

test('parcela sem data não é um vencimento', () => {
  assert.equal(vencimentoDasParcelas([{ numero: '1', vencimento: null, valor: 10 }]), null)
  assert.equal(vencimentoDasParcelas([]), null)
})

test('XML ausente ou vazio devolve erro em vez de lançar', () => {
  for (const entrada of [null, undefined, '', '   ']) {
    const r = parseNfeXml(entrada)
    assert.equal(r.erro, 'XML ausente.')
    assert.deepEqual(r.itens, [])
    assert.deepEqual(r.parcelas, [])
  }
})

test('XML sem os blocos esperados não quebra o sync', () => {
  // O contrato é: falha de parse LOGA e SEGUE. Nada aqui pode lançar.
  const r = parseNfeXml('<qualquerCoisa><semNada/></qualquerCoisa>')
  assert.equal(r.erro, null)
  assert.equal(r.access_key, null)
  assert.equal(r.valor_total, null)
  assert.deepEqual(r.itens, [])
})

test('valor mal formado vira null, nunca NaN', () => {
  // NaN vazaria para uma coluna numeric e derrubaria o insert do lote inteiro.
  const r = parseNfeXml(
    `<infNFe Id="NFe1"><det nItem="1"><prod><vProd>mil reais</vProd><qCom></qCom></prod></det></infNFe>`,
  )
  assert.equal(r.itens[0]?.valor_total, null)
  assert.equal(r.itens[0]?.quantidade, null)
})

test('access_key com tamanho errado é descartada', () => {
  // 44 dígitos ou nada: uma chave curta seria uma chave natural inválida, e a
  // idempotência do sync depende dela.
  const r = parseNfeXml('<infNFe Id="NFe123"><ide><nNF>9</nNF></ide></infNFe>')
  assert.equal(r.access_key, null)
  assert.equal(r.numero, '9')
})

test('item sem nItem cai no índice da ordem', () => {
  const r = parseNfeXml(
    `<infNFe Id="NFe1"><det><prod><cProd>X</cProd></prod></det><det><prod><cProd>Y</cProd></prod></det></infNFe>`,
  )
  assert.deepEqual(
    r.itens.map((i) => [i.ordem, i.codigo]),
    [
      [1, 'X'],
      [2, 'Y'],
    ],
  )
})
