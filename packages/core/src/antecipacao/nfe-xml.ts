/**
 * Parser de XML de NFe — mínimo, tolerante e SEM DEPENDÊNCIA.
 *
 * Vive em packages/core, e não no worker, porque o módulo de Pricing vai reler
 * exatamente estes itens (`notas_fiscais.raw_xml` é guardado sempre justamente
 * para isso). Duas implementações do mesmo parse dariam dois preços.
 *
 * Por que não uma lib de XML: `packages/core` é importado pelo bundle do browser
 * E pelo app mobile. Um parser genérico (fast-xml-parser, xml2js) custa dezenas
 * de KB e resolve um problema que não temos — a NFe é um layout FECHADO e nós
 * lemos seis tags dele. O que precisamos é: achar blocos por nome de tag,
 * ignorar namespace, desescapar entidades. É isso que está aqui.
 *
 * O que este parser NÃO faz, de propósito: validar assinatura, validar schema,
 * ou confiar no resultado. Toda falha vira `erro` no retorno; quem chama LOGA e
 * SEGUE — uma nota com XML estranho continua entrando no funil, porque o valor e
 * o vencimento vêm também do endpoint. O XML fica guardado para reprocessar.
 */

export interface NotaItemXml {
  ordem: number
  codigo: string | null
  descricao: string | null
  ncm: string | null
  cfop: string | null
  unidade: string | null
  quantidade: number | null
  valor_unitario: number | null
  valor_total: number | null
}

export interface ParcelaXml {
  numero: string | null
  vencimento: string | null // YYYY-MM-DD
  valor: number | null
}

/**
 * Qual dos três documentos chegou.
 *
 * `resumo` e `nfse` existem porque a plataforma passou a mandar os dois, e cada um
 * esconde um campo em outro lugar:
 *
 *   nfe     `<nfeProc>`/`<infNFe>` — o layout completo, com itens e cobrança.
 *   resumo  `<resNFe>` — o que a SEFAZ entrega ANTES da manifestação. Tem chave,
 *           emitente e valor; não tem destinatário, itens nem duplicata. Vira `nfe`
 *           sozinho quando a nota é manifestada, e é por isso que ele precisa ser
 *           RELIDO e não só aceito.
 *   nfse    `<infNFSe>`/`<infDPS>` — padrão nacional. O valor mora em `vServ`, e não
 *           em `ICMSTot/vNF`. Ler só a tag da NFe aqui devolvia `valor_total: null`,
 *           que é exatamente o descarte `sem_valor`.
 */
export type LayoutFiscal = 'nfe' | 'resumo' | 'nfse' | 'desconhecido'

export interface NfeParseado {
  layout: LayoutFiscal
  /** Chave de acesso: 44 dígitos na NFe e no resumo, 50 na NFS-e nacional. */
  access_key: string | null
  numero: string | null
  serie: string | null
  emitida_em: string | null
  valor_total: number | null
  emitente_cnpj: string | null
  destinatario_cnpj: string | null
  parcelas: ParcelaXml[]
  itens: NotaItemXml[]
  /** `natOp` da NFe. Decide se a nota é operável (remessa/devolução não são). */
  natureza_operacao: string | null
  /**
   * Todo o texto livre onde um vencimento pode estar escrito em prosa: `infCpl` da
   * NFe e `xDescServ`/`xInfComp` da NFS-e. Concatenado porque quem lê procura a
   * data, não se importa de qual tag ela veio.
   */
  texto_livre: string | null
  erro: string | null
}

// ─── Varredura de tags ──────────────────────────────────────────────────────

/**
 * Um nome de tag pode vir com prefixo de namespace (`ns2:dVenc`). O `(?:\w+:)?`
 * cobre isso. Nomes de tag da NFe são ASCII, então não há armadilha de unicode.
 */
function tagRe(nome: string, flags: string): RegExp {
  return new RegExp(`<(?:\\w+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nome}>`, flags)
}

const ENTIDADES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
}

function desescapar(texto: string): string {
  return texto
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => ENTIDADES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
}

/**
 * Conteúdo da PRIMEIRA ocorrência da tag dentro de `xml`, ou null.
 *
 * Exportado (junto com `blocos`) porque o extrator de contatos do 04l lê OUTRAS tags
 * do mesmo XML — `emit/enderEmit/fone`, `emit/email`, `infCpl`. Reescrever "achar tag
 * ignorando namespace" lá seria a segunda implementação do mesmo parse, e a NFe traz
 * prefixo de namespace em uma parcela pequena e imprevisível das notas: a cópia
 * funcionaria em todos os testes e falharia calada justamente nessas.
 */
export function texto(xml: string, nome: string): string | null {
  const m = tagRe(nome, '').exec(xml)
  if (!m?.[1]) return null
  const v = desescapar(m[1]).trim()
  return v === '' ? null : v
}

/** Conteúdo de TODAS as ocorrências (blocos: det, dup, obsCont). */
export function blocos(xml: string, nome: string): string[] {
  const re = tagRe(nome, 'g')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    if (m[1] !== undefined) out.push(m[1])
  }
  return out
}

/**
 * A NFe usa ponto decimal e nunca separador de milhar. Um valor que não case
 * isso é dado corrompido, e vira null em vez de NaN — NaN vazaria para uma
 * coluna numeric e derrubaria o insert do lote inteiro.
 */
function numero(valor: string | null): number | null {
  if (valor === null) return null
  const n = Number(valor.replace(/\s/g, ''))
  return Number.isFinite(n) ? n : null
}

function somenteDigitos(valor: string | null): string | null {
  if (valor === null) return null
  const d = valor.replace(/\D/g, '')
  return d === '' ? null : d
}

/** A NFe grava data ISO (YYYY-MM-DD) ou dhEmi com fuso. Só a parte da data importa. */
function data(valor: string | null): string | null {
  if (valor === null) return null
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(valor.trim())
  return m?.[1] ?? null
}

// ─── O parse ────────────────────────────────────────────────────────────────

const VAZIO: NfeParseado = {
  layout: 'desconhecido',
  access_key: null,
  numero: null,
  serie: null,
  emitida_em: null,
  valor_total: null,
  emitente_cnpj: null,
  destinatario_cnpj: null,
  parcelas: [],
  itens: [],
  natureza_operacao: null,
  texto_livre: null,
  erro: null,
}

/**
 * Qual layout chegou, pela tag raiz — e a ORDEM importa.
 *
 * `resNFe` é testado antes de `infNFe` porque o resumo vem dentro de um
 * `<procEventoNFe>` que também cita a chave; e `infNFSe`/`infDPS` vêm por último
 * porque a NFS-e nacional não tem nenhuma das duas primeiras.
 */
export function detectarLayoutFiscal(xml: string): LayoutFiscal {
  if (/<(?:\w+:)?resNFe\b/.test(xml)) return 'resumo'
  if (/<(?:\w+:)?infNFe\b/.test(xml)) return 'nfe'
  if (/<(?:\w+:)?(?:infNFSe|infDPS)\b/.test(xml)) return 'nfse'
  return 'desconhecido'
}

/**
 * A chave só vale no comprimento certo: 44 na NFe, 50 na NFS-e nacional. Um `Id`
 * truncado que passasse daqui viraria uma linha nova em `notas_fiscais` com uma
 * chave que nunca mais casa com a nota de verdade.
 */
function chaveValida(bruta: string | null, ...tamanhos: number[]): string | null {
  return bruta && tamanhos.includes(bruta.length) ? bruta : null
}

/**
 * O RESUMO (`resNFe`): o que a SEFAZ entrega ao destinatário antes da
 * manifestação. Traz chave, emitente e valor — e NÃO traz destinatário, itens nem
 * duplicata, porque esses só existem no XML completo. Quem preenche o
 * destinatário é o JSON do endpoint, que sabe de qual empresa da plataforma é a
 * nota.
 */
function lerResumo(xml: string): NfeParseado {
  const res = tagRe('resNFe', '').exec(xml)?.[1] ?? xml
  return {
    ...VAZIO,
    layout: 'resumo',
    access_key: chaveValida(somenteDigitos(texto(res, 'chNFe')), 44),
    emitida_em: texto(res, 'dhEmi'),
    valor_total: numero(texto(res, 'vNF')),
    emitente_cnpj: somenteDigitos(texto(res, 'CNPJ')),
  }
}

/**
 * A NFS-e NACIONAL, só os campos do sync — o leitor rico continua em
 * `documento-fiscal.ts`, que é outra pergunta (desenhar o documento).
 *
 * O valor é `vServPrest/vServ`, com `vLiq` atrás: `vServ` é o valor do serviço,
 * que é o que se antecipa; `vLiq` já desconta retenção e seria um número menor
 * que o da nota. Ter os dois evita a nota sem valor quando o município só
 * preenche um.
 */
function lerNfse(xml: string): NfeParseado {
  const inf = tagRe('infNFSe', '').exec(xml)?.[1] ?? xml
  const dps = tagRe('infDPS', '').exec(inf)?.[1] ?? tagRe('infDPS', '').exec(xml)?.[1] ?? ''
  const prest = tagRe('prest', '').exec(dps)?.[1] ?? tagRe('emit', '').exec(inf)?.[1] ?? ''
  const toma = tagRe('toma', '').exec(dps)?.[1] ?? ''
  const valores = tagRe('valores', '').exec(dps)?.[1] ?? tagRe('valores', '').exec(inf)?.[1] ?? ''
  const vServPrest = tagRe('vServPrest', '').exec(valores)?.[1] ?? valores

  const idAttr =
    /<(?:\w+:)?infNFSe[^>]*\bId\s*=\s*"([^"]+)"/i.exec(xml)?.[1] ??
    /<(?:\w+:)?infDPS[^>]*\bId\s*=\s*"([^"]+)"/i.exec(xml)?.[1] ??
    null

  return {
    ...VAZIO,
    layout: 'nfse',
    access_key: chaveValida(
      somenteDigitos(texto(inf, 'chaveAcesso')) ?? somenteDigitos(idAttr),
      44,
      50,
    ),
    numero: texto(inf, 'nNFSe') ?? texto(dps, 'nDPS'),
    serie: texto(dps, 'serie'),
    emitida_em: texto(dps, 'dhEmi') ?? texto(inf, 'dhProc'),
    valor_total: numero(texto(vServPrest, 'vServ')) ?? numero(texto(inf, 'vLiq')),
    emitente_cnpj: somenteDigitos(texto(prest, 'CNPJ')),
    destinatario_cnpj: somenteDigitos(texto(toma, 'CNPJ')),
    // A NFS-e não tem bloco de cobrança: a descrição do serviço é o único lugar
    // onde um vencimento pode estar escrito, e é o que a cascata de vencimento lê.
    texto_livre:
      [texto(xml, 'xDescServ'), texto(xml, 'xInfComp')]
        .filter((t): t is string => Boolean(t))
        .join(' \n ') || null,
  }
}

export function parseNfeXml(xml: string | null | undefined): NfeParseado {
  const vazio = VAZIO

  if (!xml || xml.trim() === '') return { ...vazio, erro: 'XML ausente.' }

  const layout = detectarLayoutFiscal(xml)
  if (layout === 'resumo' || layout === 'nfse') {
    try {
      return layout === 'resumo' ? lerResumo(xml) : lerNfse(xml)
    } catch (erro) {
      return { ...vazio, layout, erro: erro instanceof Error ? erro.message : String(erro) }
    }
  }

  try {
    const ide = tagRe('ide', '').exec(xml)?.[1] ?? xml
    const emit = tagRe('emit', '').exec(xml)?.[1] ?? ''
    const dest = tagRe('dest', '').exec(xml)?.[1] ?? ''
    const total = tagRe('ICMSTot', '').exec(xml)?.[1] ?? ''

    // infNFe/@Id vem como "NFe35240712345678000190550010000012341000012348".
    const idAttr = /<(?:\w+:)?infNFe[^>]*\bId\s*=\s*"([^"]+)"/i.exec(xml)?.[1] ?? null
    const accessKey = idAttr ? (somenteDigitos(idAttr) ?? null) : null

    const parcelas: ParcelaXml[] = blocos(xml, 'dup').map((dup) => ({
      numero: texto(dup, 'nDup'),
      vencimento: data(texto(dup, 'dVenc')),
      valor: numero(texto(dup, 'vDup')),
    }))

    const itens: NotaItemXml[] = blocos(xml, 'det').map((det, indice) => {
      // `nItem` é o número oficial do item; o índice é só o fallback.
      const nItem = numero(/<(?:\w+:)?det[^>]*\bnItem\s*=\s*"(\d+)"/i.exec(det)?.[1] ?? null)
      const prod = tagRe('prod', '').exec(det)?.[1] ?? det
      return {
        ordem: nItem ?? indice + 1,
        codigo: texto(prod, 'cProd'),
        descricao: texto(prod, 'xProd'),
        ncm: texto(prod, 'NCM'),
        cfop: texto(prod, 'CFOP'),
        unidade: texto(prod, 'uCom'),
        quantidade: numero(texto(prod, 'qCom')),
        valor_unitario: numero(texto(prod, 'vUnCom')),
        valor_total: numero(texto(prod, 'vProd')),
      }
    })

    // Texto livre das duas famílias, na ordem em que costuma trazer o vencimento.
    // A NFS-e nacional não tem bloco de cobrança: `xDescServ` é o único lugar onde
    // a data aparece, e é por isso que 99,5% delas caíam em emissão + 30.
    const textoLivre =
      [texto(xml, 'infCpl'), texto(xml, 'xDescServ'), texto(xml, 'xInfComp')]
        .filter((t): t is string => Boolean(t))
        .join(' \n ') || null

    return {
      layout,
      access_key: chaveValida(accessKey, 44),
      numero: texto(ide, 'nNF'),
      serie: texto(ide, 'serie'),
      emitida_em: texto(ide, 'dhEmi') ?? texto(ide, 'dEmi'),
      valor_total: numero(texto(total, 'vNF')),
      emitente_cnpj: somenteDigitos(texto(emit, 'CNPJ')),
      destinatario_cnpj: somenteDigitos(texto(dest, 'CNPJ')),
      parcelas,
      itens,
      natureza_operacao: texto(ide, 'natOp'),
      texto_livre: textoLivre,
      erro: null,
    }
  } catch (erro) {
    // Um regex catastrófico ou um XML gigante não pode derrubar o sync inteiro.
    return { ...vazio, layout, erro: erro instanceof Error ? erro.message : String(erro) }
  }
}

/**
 * A primeira parcela EM ABERTO — na prática, a primeira que vence a partir de
 * hoje; se todas já venceram, a última (é a que ainda representa a dívida).
 * Parcelas sem data são ignoradas: uma duplicata sem dVenc não é um vencimento.
 */
export function vencimentoDasParcelas(
  parcelas: readonly ParcelaXml[],
  hoje: Date = new Date(),
): string | null {
  const comData = parcelas
    .filter((p): p is ParcelaXml & { vencimento: string } => Boolean(p.vencimento))
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento))

  if (comData.length === 0) return null

  const hojeIso = hoje.toISOString().slice(0, 10)
  const emAberto = comData.find((p) => p.vencimento >= hojeIso)
  return (emAberto ?? comData[comData.length - 1])?.vencimento ?? null
}
