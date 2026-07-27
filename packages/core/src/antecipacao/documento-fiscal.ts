/**
 * O leitor RICO do XML fiscal — o que alimenta o visualizador tipo-DANFE.
 *
 * `nfe-xml.ts` extrai o punhado de campos que o SYNC precisa (chave, valor,
 * vencimento, itens). Isto aqui é outra pergunta: "desenhe o documento como o
 * fornecedor o vê". Precisa de endereço, inscrição estadual, natureza da
 * operação, impostos, transporte, protocolo de autorização — coisas que o funil
 * nunca consulta e que o olho humano procura primeiro.
 *
 * Dois formatos, porque são dois documentos diferentes:
 *   NFe   — modelo 55, o XML do portal fiscal. Layout DANFE.
 *   NFSe  — padrão NACIONAL (o novo, `infNFSe`/`DPS`). Não é o layout municipal
 *           antigo, que varia de prefeitura para prefeitura e não tem esquema
 *           único — esse não é suportado, e o leitor diz isso em vez de fingir.
 *
 * Segue a mesma disciplina de `nfe-xml.ts`: sem dependência (o core vai para o
 * browser E para o app), tolerante a namespace, e NADA lança — um XML estranho
 * vira um documento com campos vazios e um aviso, nunca uma tela quebrada.
 */

// ─── Varredura de tags (mesma base de nfe-xml.ts) ───────────────────────────

function re(nome: string, flags: string): RegExp {
  return new RegExp(`<(?:\\w+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nome}>`, flags)
}

const ENTIDADES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
}

function desescapar(t: string): string {
  return t
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => ENTIDADES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
}

/** Conteúdo da primeira ocorrência da tag. Aceita vários nomes: o primeiro que existir. */
function txt(xml: string, ...nomes: string[]): string | null {
  for (const nome of nomes) {
    const m = re(nome, '').exec(xml)
    if (m?.[1] !== undefined) {
      const v = desescapar(m[1]).trim()
      // Um bloco aninhado casaria aqui; só interessa folha (sem '<' dentro).
      if (v !== '' && !v.includes('<')) return v
    }
  }
  return null
}

/** O bloco (com filhos) da primeira ocorrência. */
function bloco(xml: string, ...nomes: string[]): string | null {
  for (const nome of nomes) {
    const m = re(nome, '').exec(xml)
    if (m?.[1] !== undefined) return m[1]
  }
  return null
}

function blocos(xml: string, nome: string): string[] {
  const r = re(nome, 'g')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = r.exec(xml)) !== null) if (m[1] !== undefined) out.push(m[1])
  return out
}

function num(v: string | null): number | null {
  if (v === null) return null
  const n = Number(v.replace(/\s/g, ''))
  return Number.isFinite(n) ? n : null
}

function digitos(v: string | null): string | null {
  if (v === null) return null
  const d = v.replace(/\D/g, '')
  return d === '' ? null : d
}

// ─── O documento ────────────────────────────────────────────────────────────

export interface EnderecoFiscal {
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  municipio: string | null
  uf: string | null
  cep: string | null
  telefone: string | null
}

export interface ParteFiscal {
  nome: string | null
  fantasia: string | null
  documento: string | null
  /** 'CNPJ' | 'CPF' — o que veio no XML. */
  tipoDocumento: 'CNPJ' | 'CPF' | null
  inscricaoEstadual: string | null
  inscricaoMunicipal: string | null
  email: string | null
  endereco: EnderecoFiscal
}

export interface ItemFiscal {
  ordem: number
  codigo: string | null
  descricao: string | null
  ncm: string | null
  cest: string | null
  cfop: string | null
  unidade: string | null
  quantidade: number | null
  valorUnitario: number | null
  valorTotal: number | null
  baseIcms: number | null
  valorIcms: number | null
  aliquotaIcms: number | null
  valorIpi: number | null
}

export interface DuplicataFiscal {
  numero: string | null
  vencimento: string | null
  valor: number | null
}

export interface TotaisNfe {
  baseIcms: number | null
  valorIcms: number | null
  baseIcmsSt: number | null
  valorIcmsSt: number | null
  valorProdutos: number | null
  valorFrete: number | null
  valorSeguro: number | null
  valorDesconto: number | null
  valorOutros: number | null
  valorIpi: number | null
  valorPis: number | null
  valorCofins: number | null
  valorTotal: number | null
}

export interface DocumentoNfe {
  formato: 'nfe'
  chaveAcesso: string | null
  numero: string | null
  serie: string | null
  modelo: string | null
  naturezaOperacao: string | null
  tipoOperacao: 'entrada' | 'saida' | null
  emitidaEm: string | null
  saidaEm: string | null
  ambiente: 'producao' | 'homologacao' | null
  protocolo: string | null
  protocoloEm: string | null
  emitente: ParteFiscal
  destinatario: ParteFiscal
  itens: ItemFiscal[]
  totais: TotaisNfe
  fatura: { numero: string | null; valorOriginal: number | null; valorLiquido: number | null } | null
  duplicatas: DuplicataFiscal[]
  transporte: {
    modalidade: string | null
    transportadora: string | null
    documentoTransportadora: string | null
    volumes: number | null
    especie: string | null
    pesoLiquido: number | null
    pesoBruto: number | null
  }
  informacoesComplementares: string | null
  informacoesFisco: string | null
}

export interface DocumentoNfse {
  formato: 'nfse'
  chaveAcesso: string | null
  numero: string | null
  serie: string | null
  emitidaEm: string | null
  competencia: string | null
  processadaEm: string | null
  municipioIncidencia: string | null
  prestador: ParteFiscal
  tomador: ParteFiscal
  servico: {
    codigoTributacaoNacional: string | null
    codigoTributacaoMunicipal: string | null
    descricao: string | null
    municipioPrestacao: string | null
  }
  valores: {
    valorServico: number | null
    valorDeducoes: number | null
    baseCalculo: number | null
    aliquota: number | null
    valorIss: number | null
    issRetido: boolean | null
    valorLiquido: number | null
  }
  informacoesComplementares: string | null
}

export interface DocumentoNaoSuportado {
  formato: 'desconhecido'
  /** O que dizer ao usuário — some no lugar de um documento em branco. */
  motivo: string
}

export type DocumentoFiscal = DocumentoNfe | DocumentoNfse | DocumentoNaoSuportado

// ─── Detecção ───────────────────────────────────────────────────────────────

/**
 * Marcadores da NFS-e MUNICIPAL antiga (ABRASF e derivados). Checados PRIMEIRO,
 * e a ordem é o ponto: `InfNfse` (municipal) e `infNFSe` (nacional) são a mesma
 * string sob comparação case-insensitive. Detectar o nacional antes classificaria
 * toda NFS-e municipal como nacional e desenharia um documento em branco com ar
 * de correto — que é pior do que dizer "não sei ler este layout".
 *
 * O discriminador confiável é o RPS: o padrão nacional o substituiu pelo DPS.
 */
const MARCADORES_MUNICIPAL = /<(?:\w+:)?(CompNfse|ListaNfse|IdentificacaoRps|InfRps|Rps)\b/i

/** Padrão NACIONAL: `DPS` (Declaração de Prestação de Serviços) é exclusivo dele. */
const MARCADORES_NACIONAL = /<(?:\w+:)?(infDPS|DPS)\b/i

export function detectarFormato(xml: string | null | undefined): DocumentoFiscal['formato'] {
  if (!xml || xml.trim() === '') return 'desconhecido'
  if (MARCADORES_MUNICIPAL.test(xml)) return 'desconhecido'
  if (MARCADORES_NACIONAL.test(xml)) return 'nfse'
  if (/<(?:\w+:)?infNFe\b/i.test(xml)) return 'nfe'
  // `infNFSe` sozinho, sem DPS e sem marcador municipal: é o nacional com o DPS
  // omitido (acontece em consultas resumidas).
  if (/<(?:\w+:)?infNFSe\b/.test(xml)) return 'nfse'
  return 'desconhecido'
}

// ─── Partes ─────────────────────────────────────────────────────────────────

function lerEndereco(x: string | null): EnderecoFiscal {
  const b = x ?? ''
  return {
    logradouro: txt(b, 'xLgr', 'logradouro'),
    numero: txt(b, 'nro', 'numero'),
    complemento: txt(b, 'xCpl', 'complemento'),
    bairro: txt(b, 'xBairro', 'bairro'),
    municipio: txt(b, 'xMun', 'municipio'),
    uf: txt(b, 'UF', 'uf'),
    cep: txt(b, 'CEP', 'cep'),
    telefone: txt(b, 'fone', 'telefone'),
  }
}

function lerParte(x: string | null): ParteFiscal {
  const b = x ?? ''
  const cnpj = digitos(txt(b, 'CNPJ'))
  const cpf = digitos(txt(b, 'CPF'))
  return {
    nome: txt(b, 'xNome', 'xNomeFantasia', 'razaoSocial'),
    fantasia: txt(b, 'xFant', 'xNomeFantasia'),
    documento: cnpj ?? cpf,
    tipoDocumento: cnpj ? 'CNPJ' : cpf ? 'CPF' : null,
    inscricaoEstadual: txt(b, 'IE'),
    inscricaoMunicipal: txt(b, 'IM'),
    email: txt(b, 'email'),
    endereco: lerEndereco(bloco(b, 'enderEmit', 'enderDest', 'enderNac', 'endereco', 'end')),
  }
}

const PARTE_VAZIA: ParteFiscal = {
  nome: null,
  fantasia: null,
  documento: null,
  tipoDocumento: null,
  inscricaoEstadual: null,
  inscricaoMunicipal: null,
  email: null,
  endereco: {
    logradouro: null,
    numero: null,
    complemento: null,
    bairro: null,
    municipio: null,
    uf: null,
    cep: null,
    telefone: null,
  },
}

// ─── NFe ────────────────────────────────────────────────────────────────────

function lerNfe(xml: string): DocumentoNfe {
  const inf = bloco(xml, 'infNFe') ?? xml
  const ide = bloco(inf, 'ide') ?? ''
  const total = bloco(inf, 'ICMSTot') ?? ''
  const cobr = bloco(inf, 'cobr') ?? ''
  const fat = bloco(cobr, 'fat')
  const transp = bloco(inf, 'transp') ?? ''
  const infAdic = bloco(inf, 'infAdic') ?? ''
  const prot = bloco(xml, 'infProt') ?? ''

  const idAttr = /<(?:\w+:)?infNFe[^>]*\bId\s*=\s*"([^"]+)"/i.exec(xml)?.[1] ?? null
  const chave = idAttr ? digitos(idAttr) : null

  const tpNF = txt(ide, 'tpNF')
  const tpAmb = txt(ide, 'tpAmb')

  const itens: ItemFiscal[] = blocos(inf, 'det').map((det, i) => {
    const nItem = num(/<(?:\w+:)?det[^>]*\bnItem\s*=\s*"(\d+)"/i.exec(det)?.[1] ?? null)
    const prod = bloco(det, 'prod') ?? det
    const imposto = bloco(det, 'imposto') ?? ''
    const icms = bloco(imposto, 'ICMS') ?? ''
    const ipi = bloco(imposto, 'IPI') ?? ''
    return {
      ordem: nItem ?? i + 1,
      codigo: txt(prod, 'cProd'),
      descricao: txt(prod, 'xProd'),
      ncm: txt(prod, 'NCM'),
      cest: txt(prod, 'CEST'),
      cfop: txt(prod, 'CFOP'),
      unidade: txt(prod, 'uCom'),
      quantidade: num(txt(prod, 'qCom')),
      valorUnitario: num(txt(prod, 'vUnCom')),
      valorTotal: num(txt(prod, 'vProd')),
      baseIcms: num(txt(icms, 'vBC')),
      valorIcms: num(txt(icms, 'vICMS')),
      aliquotaIcms: num(txt(icms, 'pICMS')),
      valorIpi: num(txt(ipi, 'vIPI')),
    }
  })

  return {
    formato: 'nfe',
    chaveAcesso: chave && chave.length === 44 ? chave : null,
    numero: txt(ide, 'nNF'),
    serie: txt(ide, 'serie'),
    modelo: txt(ide, 'mod'),
    naturezaOperacao: txt(ide, 'natOp'),
    tipoOperacao: tpNF === '0' ? 'entrada' : tpNF === '1' ? 'saida' : null,
    emitidaEm: txt(ide, 'dhEmi', 'dEmi'),
    saidaEm: txt(ide, 'dhSaiEnt', 'dSaiEnt'),
    ambiente: tpAmb === '1' ? 'producao' : tpAmb === '2' ? 'homologacao' : null,
    protocolo: txt(prot, 'nProt'),
    protocoloEm: txt(prot, 'dhRecbto'),
    emitente: lerParte(bloco(inf, 'emit')),
    destinatario: lerParte(bloco(inf, 'dest')),
    itens,
    totais: {
      baseIcms: num(txt(total, 'vBC')),
      valorIcms: num(txt(total, 'vICMS')),
      baseIcmsSt: num(txt(total, 'vBCST')),
      valorIcmsSt: num(txt(total, 'vST')),
      valorProdutos: num(txt(total, 'vProd')),
      valorFrete: num(txt(total, 'vFrete')),
      valorSeguro: num(txt(total, 'vSeg')),
      valorDesconto: num(txt(total, 'vDesc')),
      valorOutros: num(txt(total, 'vOutro')),
      valorIpi: num(txt(total, 'vIPI')),
      valorPis: num(txt(total, 'vPIS')),
      valorCofins: num(txt(total, 'vCOFINS')),
      valorTotal: num(txt(total, 'vNF')),
    },
    fatura: fat
      ? {
          numero: txt(fat, 'nFat'),
          valorOriginal: num(txt(fat, 'vOrig')),
          valorLiquido: num(txt(fat, 'vLiq')),
        }
      : null,
    duplicatas: blocos(cobr, 'dup').map((d) => ({
      numero: txt(d, 'nDup'),
      vencimento: txt(d, 'dVenc'),
      valor: num(txt(d, 'vDup')),
    })),
    transporte: {
      modalidade: txt(transp, 'modFrete'),
      transportadora: txt(bloco(transp, 'transporta') ?? '', 'xNome'),
      documentoTransportadora: digitos(txt(bloco(transp, 'transporta') ?? '', 'CNPJ', 'CPF')),
      volumes: num(txt(bloco(transp, 'vol') ?? '', 'qVol')),
      especie: txt(bloco(transp, 'vol') ?? '', 'esp'),
      pesoLiquido: num(txt(bloco(transp, 'vol') ?? '', 'pesoL')),
      pesoBruto: num(txt(bloco(transp, 'vol') ?? '', 'pesoB')),
    },
    informacoesComplementares: txt(infAdic, 'infCpl'),
    informacoesFisco: txt(infAdic, 'infAdFisco'),
  }
}

// ─── NFS-e nacional ─────────────────────────────────────────────────────────

function lerNfse(xml: string): DocumentoNfse {
  const inf = bloco(xml, 'infNFSe') ?? xml
  // O DPS (Declaração de Prestação de Serviços) carrega o que o prestador
  // declarou; o infNFSe carrega o que o município gerou. Os dois coexistem, e
  // campos como emitente aparecem em ambos — por isso a busca é em cascata.
  const dps = bloco(inf, 'infDPS') ?? bloco(xml, 'infDPS') ?? ''
  const serv = bloco(dps, 'serv') ?? ''
  const cServ = bloco(serv, 'cServ') ?? ''
  const valores = bloco(dps, 'valores') ?? bloco(inf, 'valores') ?? ''
  const vServPrest = bloco(valores, 'vServPrest') ?? valores
  const trib = bloco(valores, 'trib') ?? ''
  const tribMun = bloco(trib, 'tribMun') ?? ''
  const idAttr =
    /<(?:\w+:)?infNFSe[^>]*\bId\s*=\s*"([^"]+)"/i.exec(xml)?.[1] ??
    /<(?:\w+:)?infDPS[^>]*\bId\s*=\s*"([^"]+)"/i.exec(xml)?.[1] ??
    null

  const issRetido = txt(tribMun, 'tpRetISSQN')

  return {
    formato: 'nfse',
    chaveAcesso: txt(inf, 'chaveAcesso') ?? (idAttr ? digitos(idAttr) : null),
    numero: txt(inf, 'nNFSe') ?? txt(dps, 'nDPS'),
    serie: txt(dps, 'serie'),
    emitidaEm: txt(dps, 'dhEmi') ?? txt(inf, 'dhProc'),
    competencia: txt(dps, 'dCompet'),
    processadaEm: txt(inf, 'dhProc'),
    municipioIncidencia: txt(inf, 'cMunIncid', 'cLocIncid'),
    prestador: lerParte(bloco(dps, 'prest') ?? bloco(inf, 'emit')),
    tomador: lerParte(bloco(dps, 'toma')),
    servico: {
      codigoTributacaoNacional: txt(cServ, 'cTribNac'),
      codigoTributacaoMunicipal: txt(cServ, 'cTribMun'),
      descricao: txt(cServ, 'xDescServ'),
      municipioPrestacao: txt(bloco(serv, 'locPrest') ?? '', 'cLocPrestacao', 'cMunPrestacao'),
    },
    valores: {
      valorServico: num(txt(vServPrest, 'vServ')),
      valorDeducoes: num(txt(valores, 'vDedRed', 'vDed')),
      baseCalculo: num(txt(inf, 'vBC', 'vBCISSQN')),
      aliquota: num(txt(tribMun, 'pAliq') ?? txt(inf, 'pAliqAplic')),
      valorIss: num(txt(tribMun, 'vISSQN') ?? txt(inf, 'vISSQN')),
      // 1 = não retido; qualquer outro código é uma forma de retenção.
      issRetido: issRetido === null ? null : issRetido !== '1',
      valorLiquido: num(txt(inf, 'vLiq', 'vLiqNFSe')),
    },
    informacoesComplementares: txt(dps, 'xInfComp') ?? txt(inf, 'xInfComp'),
  }
}

// ─── A porta de entrada ─────────────────────────────────────────────────────

/**
 * XML → documento pronto para desenhar. NUNCA lança: um XML corrompido vira
 * `desconhecido` com um motivo legível, porque a alternativa é uma tela branca
 * no meio de uma ligação com o fornecedor.
 */
export function lerDocumentoFiscal(xml: string | null | undefined): DocumentoFiscal {
  if (!xml || xml.trim() === '') {
    return {
      formato: 'desconhecido',
      motivo: 'Esta nota não tem XML guardado. O sync guarda o XML sempre — uma nota sem ele veio sem XML do endpoint.',
    }
  }

  try {
    const formato = detectarFormato(xml)
    if (formato === 'nfe') return lerNfe(xml)
    if (formato === 'nfse') return lerNfse(xml)

    // NFS-e municipal antiga: cada prefeitura tem o seu layout, e não existe
    // esquema único para desenhar. Dizer isso é mais útil que desenhar errado.
    if (MARCADORES_MUNICIPAL.test(xml)) {
      return {
        formato: 'desconhecido',
        motivo:
          'NFS-e em layout municipal antigo. Só o padrão NACIONAL é suportado — os layouts de prefeitura não têm esquema único. O XML bruto continua disponível abaixo.',
      }
    }

    return {
      formato: 'desconhecido',
      motivo: 'Formato não reconhecido: o XML não parece uma NFe (modelo 55) nem uma NFS-e nacional.',
    }
  } catch (erro) {
    return {
      formato: 'desconhecido',
      motivo: `Não foi possível ler o XML: ${erro instanceof Error ? erro.message : String(erro)}`,
    }
  }
}

// ─── Formatação compartilhada pelos dois visualizadores ─────────────────────

export function formatarDocumento(doc: string | null | undefined): string {
  if (!doc) return '—'
  const d = doc.replace(/\D/g, '')
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return doc
}

export function formatarCep(cep: string | null | undefined): string {
  if (!cep) return '—'
  const d = cep.replace(/\D/g, '')
  return d.length === 8 ? d.replace(/^(\d{5})(\d{3})$/, '$1-$2') : cep
}

/** A chave de acesso é lida em blocos de 4 — é assim que ela aparece no DANFE. */
export function formatarChave(chave: string | null | undefined): string {
  if (!chave) return '—'
  return chave.replace(/(\d{4})(?=\d)/g, '$1 ').trim()
}

export function enderecoEmLinha(e: EnderecoFiscal): string {
  const rua = [e.logradouro, e.numero, e.complemento].filter(Boolean).join(', ')
  const cidade = [e.municipio, e.uf].filter(Boolean).join(' / ')
  return [rua, e.bairro, cidade].filter(Boolean).join(' — ') || '—'
}
