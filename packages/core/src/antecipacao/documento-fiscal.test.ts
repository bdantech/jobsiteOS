import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  detectarFormato,
  enderecoEmLinha,
  formatarChave,
  formatarDocumento,
  lerDocumentoFiscal,
} from './documento-fiscal.ts'

/**
 * O leitor alimenta um documento que alguém abre NO MEIO de uma ligação com o
 * fornecedor. As duas propriedades que importam:
 *
 *   1. o que está no XML aparece — endereço, IE, impostos, duplicatas;
 *   2. o que NÃO está não quebra a tela. Nada aqui pode lançar.
 */

const NFE = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe versao="4.00" Id="NFe35260712345678000190550010000088211000088219">
      <ide>
        <cUF>35</cUF><natOp>VENDA DE MERCADORIA</natOp><mod>55</mod>
        <serie>1</serie><nNF>8821</nNF>
        <dhEmi>2026-07-23T10:15:00-03:00</dhEmi><dhSaiEnt>2026-07-23T14:00:00-03:00</dhSaiEnt>
        <tpNF>1</tpNF><tpAmb>1</tpAmb>
      </ide>
      <emit>
        <CNPJ>98765432000110</CNPJ>
        <xNome>FORNECEDOR EXEMPLO SA</xNome><xFant>FORNECEDOR</xFant>
        <enderEmit>
          <xLgr>RUA DAS INDUSTRIAS</xLgr><nro>1500</nro><xCpl>GALPAO 3</xCpl>
          <xBairro>DISTRITO INDUSTRIAL</xBairro><xMun>SAO PAULO</xMun><UF>SP</UF>
          <CEP>04578000</CEP><fone>1130001000</fone>
        </enderEmit>
        <IE>123456789012</IE>
      </emit>
      <dest>
        <CNPJ>12345678000190</CNPJ>
        <xNome>CONSTRUTORA EXEMPLO LTDA</xNome>
        <enderDest>
          <xLgr>AV PAULISTA</xLgr><nro>1000</nro><xBairro>BELA VISTA</xBairro>
          <xMun>SAO PAULO</xMun><UF>SP</UF><CEP>01310100</CEP>
        </enderDest>
        <IE>987654321098</IE>
        <email>financeiro@construtora.com</email>
      </dest>
      <det nItem="1">
        <prod>
          <cProd>A-100</cProd><xProd>CIMENTO CP-II 50KG</xProd><NCM>25232910</NCM>
          <CFOP>5102</CFOP><uCom>SC</uCom><qCom>100.0000</qCom>
          <vUnCom>32.5000</vUnCom><vProd>3250.00</vProd>
        </prod>
        <imposto>
          <ICMS><ICMS00><vBC>3250.00</vBC><pICMS>18.00</pICMS><vICMS>585.00</vICMS></ICMS00></ICMS>
          <IPI><IPITrib><vIPI>0.00</vIPI></IPITrib></IPI>
        </imposto>
      </det>
      <total>
        <ICMSTot>
          <vBC>3250.00</vBC><vICMS>585.00</vICMS><vProd>15230.55</vProd>
          <vFrete>120.00</vFrete><vDesc>0.00</vDesc><vIPI>0.00</vIPI>
          <vPIS>25.13</vPIS><vCOFINS>115.75</vCOFINS><vNF>15230.55</vNF>
        </ICMSTot>
      </total>
      <transp>
        <modFrete>0</modFrete>
        <transporta><CNPJ>11222333000181</CNPJ><xNome>TRANSPORTES RAPIDOS LTDA</xNome></transporta>
        <vol><qVol>10</qVol><esp>PALLET</esp><pesoL>5000.000</pesoL><pesoB>5100.000</pesoB></vol>
      </transp>
      <cobr>
        <fat><nFat>8821</nFat><vOrig>15230.55</vOrig><vLiq>15230.55</vLiq></fat>
        <dup><nDup>001</nDup><dVenc>2026-08-22</dVenc><vDup>15230.55</vDup></dup>
      </cobr>
      <infAdic><infCpl>PEDIDO 4471 &amp; OBRA TORRE NORTE</infCpl></infAdic>
    </infNFe>
  </NFe>
  <protNFe><infProt><nProt>135260000123456</nProt><dhRecbto>2026-07-23T10:20:00-03:00</dhRecbto></infProt></protNFe>
</nfeProc>`

const NFSE = `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS35260712345678000190000000000123">
    <nNFSe>123</nNFSe>
    <dhProc>2026-07-24T09:00:00-03:00</dhProc>
    <cMunIncid>3550308</cMunIncid>
    <vLiq>9500.00</vLiq>
    <emit><CNPJ>98765432000110</CNPJ><xNome>PRESTADORA DE SERVICOS SA</xNome><IM>12345</IM></emit>
    <DPS>
      <infDPS Id="DPS3550308298765432000110000010000000045">
        <serie>00001</serie><nDPS>45</nDPS>
        <dhEmi>2026-07-24T08:55:00-03:00</dhEmi><dCompet>2026-07-01</dCompet>
        <prest>
          <CNPJ>98765432000110</CNPJ><xNome>PRESTADORA DE SERVICOS SA</xNome><IM>12345</IM>
          <enderNac><xLgr>RUA DOS SERVICOS</xLgr><nro>200</nro><xBairro>CENTRO</xBairro>
            <xMun>SAO PAULO</xMun><UF>SP</UF><CEP>01001000</CEP></enderNac>
        </prest>
        <toma>
          <CNPJ>12345678000190</CNPJ><xNome>CONSTRUTORA EXEMPLO LTDA</xNome>
          <enderNac><xLgr>AV PAULISTA</xLgr><nro>1000</nro><xMun>SAO PAULO</xMun><UF>SP</UF></enderNac>
        </toma>
        <serv>
          <locPrest><cLocPrestacao>3550308</cLocPrestacao></locPrest>
          <cServ><cTribNac>070101</cTribNac><xDescServ>EXECUCAO DE ESTRUTURA DE CONCRETO</xDescServ></cServ>
        </serv>
        <valores>
          <vServPrest><vServ>10000.00</vServ></vServPrest>
          <trib><tribMun><tpRetISSQN>1</tpRetISSQN><pAliq>5.00</pAliq><vISSQN>500.00</vISSQN></tribMun></trib>
        </valores>
        <xInfComp>MEDICAO 3 - OBRA TORRE NORTE</xInfComp>
      </infDPS>
    </DPS>
  </infNFSe>
</NFSe>`

// ─── Detecção ───────────────────────────────────────────────────────────────

test('distingue NFe, NFS-e nacional e o que não é nenhum dos dois', () => {
  assert.equal(detectarFormato(NFE), 'nfe')
  assert.equal(detectarFormato(NFSE), 'nfse')
  assert.equal(detectarFormato('<qualquer/>'), 'desconhecido')
  assert.equal(detectarFormato(''), 'desconhecido')
  assert.equal(detectarFormato(null), 'desconhecido')
})

test('NFS-e municipal ANTIGA é recusada com explicação, não desenhada errado', () => {
  const municipal = '<CompNfse><Nfse><InfNfse><Numero>10</Numero></InfNfse></Nfse></CompNfse>'
  const d = lerDocumentoFiscal(municipal)
  assert.equal(d.formato, 'desconhecido')
  assert.match(d.formato === 'desconhecido' ? d.motivo : '', /municipal antigo/i)
})

// ─── NFe ────────────────────────────────────────────────────────────────────

test('NFe: identificação e protocolo', () => {
  const d = lerDocumentoFiscal(NFE)
  assert.equal(d.formato, 'nfe')
  if (d.formato !== 'nfe') return
  assert.equal(d.chaveAcesso, '35260712345678000190550010000088211000088219')
  assert.equal(d.numero, '8821')
  assert.equal(d.serie, '1')
  assert.equal(d.modelo, '55')
  assert.equal(d.naturezaOperacao, 'VENDA DE MERCADORIA')
  assert.equal(d.tipoOperacao, 'saida')
  assert.equal(d.ambiente, 'producao')
  assert.equal(d.protocolo, '135260000123456')
})

test('NFe: emitente e destinatário com endereço e IE', () => {
  const d = lerDocumentoFiscal(NFE)
  if (d.formato !== 'nfe') return assert.fail('esperava nfe')
  assert.equal(d.emitente.nome, 'FORNECEDOR EXEMPLO SA')
  assert.equal(d.emitente.fantasia, 'FORNECEDOR')
  assert.equal(d.emitente.documento, '98765432000110')
  assert.equal(d.emitente.tipoDocumento, 'CNPJ')
  assert.equal(d.emitente.inscricaoEstadual, '123456789012')
  assert.equal(d.emitente.endereco.municipio, 'SAO PAULO')
  assert.equal(d.emitente.endereco.cep, '04578000')
  assert.equal(d.destinatario.nome, 'CONSTRUTORA EXEMPLO LTDA')
  assert.equal(d.destinatario.email, 'financeiro@construtora.com')
})

test('NFe: item com imposto vindo do bloco aninhado (ICMS00 dentro de ICMS)', () => {
  const d = lerDocumentoFiscal(NFE)
  if (d.formato !== 'nfe') return assert.fail('esperava nfe')
  const [item] = d.itens
  assert.equal(item?.codigo, 'A-100')
  assert.equal(item?.ncm, '25232910')
  assert.equal(item?.cfop, '5102')
  assert.equal(item?.quantidade, 100)
  assert.equal(item?.valorUnitario, 32.5)
  assert.equal(item?.baseIcms, 3250)
  assert.equal(item?.aliquotaIcms, 18)
  assert.equal(item?.valorIcms, 585)
})

test('NFe: totais, fatura, duplicatas e transporte', () => {
  const d = lerDocumentoFiscal(NFE)
  if (d.formato !== 'nfe') return assert.fail('esperava nfe')
  assert.equal(d.totais.valorTotal, 15230.55)
  assert.equal(d.totais.valorFrete, 120)
  assert.equal(d.totais.valorCofins, 115.75)
  assert.equal(d.fatura?.numero, '8821')
  assert.deepEqual(d.duplicatas, [{ numero: '001', vencimento: '2026-08-22', valor: 15230.55 }])
  assert.equal(d.transporte.transportadora, 'TRANSPORTES RAPIDOS LTDA')
  assert.equal(d.transporte.pesoBruto, 5100)
})

test('NFe: entidades são desescapadas nas informações complementares', () => {
  const d = lerDocumentoFiscal(NFE)
  if (d.formato !== 'nfe') return assert.fail('esperava nfe')
  assert.equal(d.informacoesComplementares, 'PEDIDO 4471 & OBRA TORRE NORTE')
})

// ─── NFS-e nacional ─────────────────────────────────────────────────────────

test('NFS-e: identificação, prestador e tomador', () => {
  const d = lerDocumentoFiscal(NFSE)
  assert.equal(d.formato, 'nfse')
  if (d.formato !== 'nfse') return
  assert.equal(d.numero, '123')
  assert.equal(d.serie, '00001')
  assert.equal(d.competencia, '2026-07-01')
  assert.equal(d.prestador.nome, 'PRESTADORA DE SERVICOS SA')
  assert.equal(d.prestador.inscricaoMunicipal, '12345')
  assert.equal(d.prestador.endereco.municipio, 'SAO PAULO')
  assert.equal(d.tomador.nome, 'CONSTRUTORA EXEMPLO LTDA')
  assert.equal(d.tomador.documento, '12345678000190')
})

test('NFS-e: serviço e valores, com ISS não retido', () => {
  const d = lerDocumentoFiscal(NFSE)
  if (d.formato !== 'nfse') return assert.fail('esperava nfse')
  assert.equal(d.servico.codigoTributacaoNacional, '070101')
  assert.equal(d.servico.descricao, 'EXECUCAO DE ESTRUTURA DE CONCRETO')
  assert.equal(d.valores.valorServico, 10000)
  assert.equal(d.valores.aliquota, 5)
  assert.equal(d.valores.valorIss, 500)
  assert.equal(d.valores.issRetido, false, 'tpRetISSQN = 1 significa NÃO retido')
  assert.equal(d.valores.valorLiquido, 9500)
})

test('NFS-e: tpRetISSQN diferente de 1 é retenção', () => {
  const d = lerDocumentoFiscal(NFSE.replace('<tpRetISSQN>1</tpRetISSQN>', '<tpRetISSQN>2</tpRetISSQN>'))
  if (d.formato !== 'nfse') return assert.fail('esperava nfse')
  assert.equal(d.valores.issRetido, true)
})

// ─── Robustez: nada pode lançar ─────────────────────────────────────────────

test('XML ausente vira um aviso legível, não uma exceção', () => {
  for (const entrada of [null, undefined, '', '   ']) {
    const d = lerDocumentoFiscal(entrada)
    assert.equal(d.formato, 'desconhecido')
    assert.match(d.formato === 'desconhecido' ? d.motivo : '', /sem XML|não tem XML/i)
  }
})

test('NFe truncada no meio não quebra — devolve o que deu para ler', () => {
  const truncada = NFE.slice(0, NFE.indexOf('<det nItem="1">'))
  const d = lerDocumentoFiscal(truncada)
  assert.equal(d.formato, 'nfe')
  if (d.formato !== 'nfe') return
  assert.equal(d.numero, '8821')
  assert.deepEqual(d.itens, [])
  assert.equal(d.totais.valorTotal, null)
})

test('namespace com prefixo não atrapalha', () => {
  const comNs = NFE.replace(/<(\/?)(nNF|xNome|vNF|xProd)>/g, '<$1ns2:$2>')
  const d = lerDocumentoFiscal(comNs)
  if (d.formato !== 'nfe') return assert.fail('esperava nfe')
  assert.equal(d.numero, '8821')
  assert.equal(d.totais.valorTotal, 15230.55)
})

// ─── Formatação ─────────────────────────────────────────────────────────────

test('formata CNPJ, CPF e chave de acesso', () => {
  assert.equal(formatarDocumento('98765432000110'), '98.765.432/0001-10')
  assert.equal(formatarDocumento('12345678901'), '123.456.789-01')
  assert.equal(formatarDocumento(null), '—')
  // A chave é lida em blocos de 4 — é assim que ela sai impressa no DANFE.
  assert.equal(
    formatarChave('35260712345678000190550010000088211000088219'),
    '3526 0712 3456 7800 0190 5500 1000 0088 2110 0008 8219',
  )
})

test('endereço em linha ignora o que estiver vazio', () => {
  const d = lerDocumentoFiscal(NFE)
  if (d.formato !== 'nfe') return assert.fail('esperava nfe')
  assert.equal(
    enderecoEmLinha(d.emitente.endereco),
    'RUA DAS INDUSTRIAS, 1500, GALPAO 3 — DISTRITO INDUSTRIAL — SAO PAULO / SP',
  )
  assert.equal(
    enderecoEmLinha({
      logradouro: null, numero: null, complemento: null, bairro: null,
      municipio: null, uf: null, cep: null, telefone: null,
    }),
    '—',
  )
})
