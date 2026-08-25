import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agregarContatosDoFornecedor, contatosDoXmlNfe } from './contatos-xml.ts'

/**
 * Os XMLs abaixo são recortes REAIS da base (anonimizados só no que era pessoal).
 * Um fixture inventado testaria o parser contra a NFe que imaginamos, e a NFe que
 * imaginamos não tem `Email do Destinatario` no meio do `infCpl`.
 */

const EMIT_REAL =
  '<emit><CNPJ>21148435000158</CNPJ><xNome>MINERACAO APARECIDA LTDA</xNome>' +
  '<xFant>MINERACAO APARECIDA</xFant><enderEmit><xLgr>ROD PRESIDENTE DUTRA, KM 75</xLgr>' +
  '<nro>0</nro><xBairro>ITAGUASSU</xBairro><xMun>APARECIDA</xMun><UF>SP</UF>' +
  '<fone>1231041930</fone></enderEmit><IE>174094695110</IE></emit>'

const DEST_COM_FONE =
  '<dest><CNPJ>11222333000144</CNPJ><xNome>CONSTRUTORA CLIENTE LTDA</xNome>' +
  '<enderDest><xMun>SAO PAULO</xMun><UF>SP</UF><fone>1140028922</fone></enderDest></dest>'

function nfe(corpo: string, numero = '1234'): { numero: string; emitida_em: string; raw_xml: string } {
  return { numero, emitida_em: '2026-08-01', raw_xml: `<NFe><infNFe>${corpo}</infNFe></NFe>` }
}

test('o telefone do emitente entra com confiança alta; o do destinatário não entra', () => {
  const achados = contatosDoXmlNfe(nfe(EMIT_REAL + DEST_COM_FONE))
  const tels = achados.filter((c) => c.tipo === 'telefone')
  assert.deepEqual(
    tels.map((t) => t.valor),
    ['+551231041930'],
  )
  assert.equal(tels[0]?.confianca, 'alta')
  assert.match(tels[0]?.evidencia ?? '', /emit\/enderEmit\/fone/)
  // O `4002-8922` do dest é o nosso cliente. Se ele aparecer aqui, o originador liga
  // para a construtora perguntando pelo fornecedor dela.
  assert.equal(achados.some((c) => c.valor === '+551140028922'), false)
})

test('e-mail do emitente vira contato E candidato a domínio', () => {
  const emit = EMIT_REAL.replace('</enderEmit>', '</enderEmit><email>vendas@mineracaoaparecida.com.br</email>')
  const achados = contatosDoXmlNfe(nfe(emit))
  assert.equal(achados.find((c) => c.tipo === 'email')?.valor, 'vendas@mineracaoaparecida.com.br')
  assert.equal(achados.find((c) => c.tipo === 'site')?.valor, 'mineracaoaparecida.com.br')
})

test('e-mail em provedor genérico não vira domínio da empresa', () => {
  const emit = EMIT_REAL.replace('</enderEmit>', '</enderEmit><email>mineracao.aparecida@gmail.com</email>')
  const achados = contatosDoXmlNfe(nfe(emit))
  assert.equal(achados.find((c) => c.tipo === 'email')?.valor, 'mineracao.aparecida@gmail.com')
  assert.equal(achados.some((c) => c.tipo === 'site'), false)
})

test('"Email do Destinatario" no infCpl é o contato do sacado, e é descartado', () => {
  // Recorte real: este e-mail está no XML do FORNECEDOR e é da incorporadora.
  const cpl =
    '<infAdic><infCpl>Email do Destinatario: fernandabin@imincorporadora.com.br; ' +
    'Inf. Contribuinte: I-Documento emitido por ME ou EPP.</infCpl></infAdic>'
  const achados = contatosDoXmlNfe(nfe(EMIT_REAL + cpl))
  assert.equal(achados.some((c) => c.valor.includes('imincorporadora')), false)
})

test('o PIX do emitente no infCpl entra, com confiança média e o trecho como evidência', () => {
  const cpl =
    '<infAdic><infCpl>DE ACORDO COM A PROPOSTA 37279; Banco Itau. Ag: 0738 C/C: 80001-0 ' +
    'CNPJ: 08.155.708/0001-23 Eletrotecnica Lara Eireli EPP PIX: financeiro@laramotores.com.br</infCpl></infAdic>'
  const achados = contatosDoXmlNfe(nfe(EMIT_REAL + cpl))
  const email = achados.find((c) => c.valor === 'financeiro@laramotores.com.br')
  assert.ok(email, 'o e-mail do emitente no texto livre precisa entrar')
  assert.equal(email.confianca, 'media')
  assert.match(email.evidencia, /infCpl/)
})

test('CNPJ e número de pedido no texto livre não viram telefone', () => {
  const cpl =
    '<infAdic><infCpl>REMESSA: 0814863473 - PEDIDO: 0004884055 02/06/2026 ' +
    'CNPJ: 08.155.708/0001-23</infCpl></infAdic>'
  const achados = contatosDoXmlNfe(nfe(EMIT_REAL + cpl))
  assert.deepEqual(
    achados.filter((c) => c.tipo === 'telefone').map((c) => c.valor),
    ['+551231041930'], // só o do emitente
  )
})

test('a mesma informação em N notas soma frequência e guarda a data mais recente', () => {
  const notas = [
    { numero: '1', emitida_em: '2026-06-01', raw_xml: `<NFe>${EMIT_REAL}</NFe>` },
    { numero: '2', emitida_em: '2026-07-15', raw_xml: `<NFe>${EMIT_REAL}</NFe>` },
    { numero: '3', emitida_em: '2026-08-20', raw_xml: `<NFe>${EMIT_REAL}</NFe>` },
  ]
  const [tel] = agregarContatosDoFornecedor(notas)
  assert.equal(tel?.valor, '+551231041930')
  assert.equal(tel?.frequencia, 3)
  assert.equal(tel?.ultima_vez_visto, '2026-08-20')
})

test('o texto livre não rebaixa o campo estruturado', () => {
  // O mesmo número aparece uma vez em `fone` (alta) e cinco vezes no infCpl (média).
  const cpl = '<infAdic><infCpl>Contato: (12) 3104-1930</infCpl></infAdic>'
  const notas = [
    { numero: '1', emitida_em: '2026-08-01', raw_xml: `<NFe>${EMIT_REAL}${cpl}</NFe>` },
    ...Array.from({ length: 5 }, (_, i) => ({
      numero: String(i + 2),
      emitida_em: '2026-08-02',
      raw_xml: `<NFe><emit><CNPJ>21148435000158</CNPJ></emit>${cpl}</NFe>`,
    })),
  ]
  const [tel] = agregarContatosDoFornecedor(notas)
  assert.equal(tel?.confianca, 'alta')
  assert.equal(tel?.frequencia, 6)
})

test('a exclusão por domínio do sacado vale para o texto livre', () => {
  const cpl = '<infAdic><infCpl>Enviar boleto para financeiro@construtoracliente.com.br</infCpl></infAdic>'
  const achados = contatosDoXmlNfe(nfe(EMIT_REAL + cpl), {
    dominiosExcluidos: ['www.construtoracliente.com.br'],
  })
  assert.equal(achados.some((c) => c.valor.includes('construtoracliente')), false)
})

test('nota sem XML não quebra nem inventa', () => {
  assert.deepEqual(contatosDoXmlNfe({ numero: '1', emitida_em: '2026-08-01', raw_xml: null }), [])
  assert.deepEqual(agregarContatosDoFornecedor([]), [])
})

test('nota real SEM contato nenhum não inventa telefone a partir de valor ou percentual', () => {
  /*
   * Recorte real das quatro notas mais recentes do maior fornecedor do funil (BM
   * Fundição, R$ 6,7 MM/mês de potencial): o `<emit>` não tem `<fone>` nem `<email>`,
   * e o `infCpl` só traz valores em reais e percentuais. É a armadilha clássica —
   * "R$71.595,75" e "(31,45%)" têm a forma de coisas com dígitos agrupados, e um
   * padrão frouxo de telefone as pegaria.
   *
   * Zero é a resposta certa, e é ela que empurra o card para `sem_contato` em vez de
   * dar ao originador um número que não existe.
   */
  const emit =
    '<emit><CNPJ>41397834000160</CNPJ><xNome>BM FUNDICAO SOCIEDADE UNIPESSOAL LTDA</xNome>' +
    '<enderEmit><xLgr>RUA JOAQUIM PEDRO RIBEIRO</xLgr><nro>350</nro><xMun>GUAXUPE</xMun>' +
    '<UF>MG</UF><CEP>37800000</CEP></enderEmit><IE>0040109060024</IE></emit>'
  const cpls = [
    'Val Aprox Tributos R$71.595,75 (31,45%) Fonte: IBPT ;',
    'Pagamento a vista;PAGAMENTO TOTAL DE DEVOLUCAO NFE 20935 DE 12/08/2026.|Val Aprox Tributos R$98.987,43 (31,45%) Fonte: IBPT ;',
    'Val Aprox Tributos R$157.250,00 (31,45%) Fonte: IBPT ;',
    'Pagamento a vista;Val Aprox Tributos R$786.259,80 (31,45%) Fonte: IBPT ;',
  ]
  const notas = cpls.map((c, i) => ({
    numero: String(9500 + i),
    emitida_em: '2026-08-19',
    raw_xml: `<NFe><infNFe>${emit}<infAdic><infCpl>${c}</infCpl></infAdic></infNFe></NFe>`,
  }))
  assert.deepEqual(agregarContatosDoFornecedor(notas, { dddPadrao: '35' }), [])
})

test('o parser ignora prefixo de namespace, que é onde uma cópia do regex falharia', () => {
  const comNs = '<ns2:emit><ns2:enderEmit><ns2:fone>1231041930</ns2:fone></ns2:enderEmit></ns2:emit>'
  const achados = contatosDoXmlNfe(nfe(comNs))
  assert.equal(achados[0]?.valor, '+551231041930')
})
