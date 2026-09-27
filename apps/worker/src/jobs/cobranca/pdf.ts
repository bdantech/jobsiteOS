import PDFDocument from 'pdfkit'

/**
 * Markdown → PDF para a Cobrança (Prompt 07 §5, §7.2, §9.3): notificação extrajudicial,
 * minuta de confissão, e os PDFs que o dossiê de sinistro monta sozinho.
 *
 * ── POR QUE UM RENDERIZADOR PRÓPRIO, E NÃO UM NAVEGADOR ─────────────────────
 * A mesma conta do report semanal (jobs/reports/pdf.ts): Chromium no Alpine custa
 * centenas de MB de imagem e de RAM num contêiner que é o executor de todos os jobs.
 * Os modelos de cobrança usam um pedaço pequeno do Markdown — títulos, parágrafos,
 * **negrito**, listas e as tabelas do `{{tabela_titulos}}` e da memória de cálculo —, e
 * esse pedaço cabe aqui.
 *
 * ── A QUEBRA DE LINHA SIMPLES VALE ──────────────────────────────────────────
 * No Markdown padrão, duas linhas seguidas viram um parágrafo só. Numa carta isso
 * estraga exatamente o que não pode estragar: "**Valor de face:** …" e "**Valor
 * atualizado:** …" colados na mesma linha, o bloco de assinatura desmontado, o
 * `{{dados_pagamento}}` (banco, agência, conta, PIX) virando uma frase corrida. Aqui a
 * quebra simples é quebra de linha, como no comentário do GitHub; parágrafo novo é
 * linha em branco.
 *
 * ── WINANSI ─────────────────────────────────────────────────────────────────
 * Helvetica é das 14 fontes padrão do PDF: nada embutido, nada faltando no Alpine. O
 * preço é a codificação WinAnsi — seta, "diferente de", sinal de menos tipográfico e
 * emoji viram lixo SEM ERRO NENHUM (o report semanal já saiu assim uma vez). Numa
 * notificação extrajudicial, lixo no meio de um valor é uma carta que o devedor usa
 * para contestar. Por isso TODO texto passa por `paraWinAnsi` antes de chegar ao pdfkit.
 */

// ─── WinAnsi ────────────────────────────────────────────────────────────────

/** Os 27 caracteres da faixa 0x80–0x9F do cp1252, que o pdfkit mapeia sozinho. */
const EXTRAS_CP1252 = new Set(
  '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split(''),
)

/** O equivalente legível do que a WinAnsi não tem. */
const TROCAS: Record<string, string> = {
  '→': '->',
  '←': '<-',
  '⇒': '=>',
  '↔': '<->',
  '≠': '<>',
  '≤': '<=',
  '≥': '>=',
  '−': '-',
  '‐': '-',
  '‑': '-',
  '‒': '-',
  '✓': 'OK',
  '✔': 'OK',
  '✗': 'X',
  '✘': 'X',
  '≈': '~',
  '′': "'",
  '″': '"',
  ' ': ' ', // espaço estreito sem quebra (o Intl usa em alguns formatos)
  ' ': ' ',
  ' ': ' ',
}

/**
 * Traz o texto para o que a Helvetica padrão sabe desenhar. Acentos do português, `º`,
 * `ª`, `§`, `·`, `×` e as aspas curvas estão na WinAnsi e passam intactos; o resto é
 * trocado por um equivalente ASCII, perde o diacrítico (NFD) ou vira `?` — nunca some
 * em silêncio, para que a falta seja visível na prova.
 */
export function paraWinAnsi(texto: string): string {
  let out = ''
  for (const ch of texto) {
    const cp = ch.codePointAt(0)!
    if (ch === '\n' || ch === '\t') {
      out += ch
      continue
    }
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || EXTRAS_CP1252.has(ch)) {
      out += ch
      continue
    }
    const troca = TROCAS[ch]
    if (troca !== undefined) {
      out += troca
      continue
    }
    // invisíveis (zero-width, BOM, controle) somem; não há o que desenhar
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || (cp >= 0x200b && cp <= 0x200f) || cp === 0xfeff) continue
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
    const b = base.codePointAt(0) ?? 0
    out += base.length > 0 && ((b >= 0x20 && b <= 0x7e) || (b >= 0xa0 && b <= 0xff)) ? base : '?'
  }
  return out
}

// ─── O leitor de Markdown (puro, testado) ───────────────────────────────────

export interface Trecho {
  texto: string
  negrito: boolean
  italico: boolean
}

export type Alinhamento = 'left' | 'right' | 'center'

export type Bloco =
  | { tipo: 'titulo'; nivel: 1 | 2 | 3; trechos: Trecho[] }
  | { tipo: 'paragrafo'; linhas: Trecho[][] }
  /** `numeros`: o número ESCRITO de cada item — "2. ____" sozinho continua sendo o 2. */
  | { tipo: 'lista'; ordenada: boolean; itens: Trecho[][]; numeros: number[] }
  | { tipo: 'tabela'; cabecalho: string[]; alinhamentos: Alinhamento[]; linhas: string[][] }
  | { tipo: 'regua' }

const RE_TITULO = /^(#{1,6})\s+(.*)$/
const RE_ITEM = /^\s*[-*•]\s+(.*)$/
const RE_ITEM_NUM = /^\s*(?:\d+)[.)]\s+(.*)$/
const RE_REGUA = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/
const RE_SEPARADOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

/**
 * `**negrito**` e `*itálico*`. O sublinhado NÃO é marcação aqui: a linha de assinatura
 * das minutas é `_____________ CREDORA`, e lê-la como ênfase apagaria a linha.
 */
export function lerInline(texto: string): Trecho[] {
  const out: Trecho[] = []
  const re = /\*\*(.+?)\*\*|\*(?![\s*])(.+?)(?<![\s*])\*/g
  let ultimo = 0
  for (const m of texto.matchAll(re)) {
    if (m.index! > ultimo) out.push({ texto: texto.slice(ultimo, m.index), negrito: false, italico: false })
    if (m[1] !== undefined) out.push({ texto: m[1], negrito: true, italico: false })
    else out.push({ texto: m[2]!, negrito: false, italico: true })
    ultimo = m.index! + m[0].length
  }
  if (ultimo < texto.length) out.push({ texto: texto.slice(ultimo), negrito: false, italico: false })
  return out.filter((t) => t.texto.length > 0)
}

function celulas(linha: string): string[] {
  let s = linha.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

function alinhamentoDe(sep: string): Alinhamento {
  const s = sep.trim()
  if (s.startsWith(':') && s.endsWith(':')) return 'center'
  if (s.endsWith(':')) return 'right'
  return 'left'
}

/** Quebra forçada do Markdown (`\` ou dois espaços no fim) — aqui toda quebra já vale. */
const semQuebraForcada = (l: string) => l.replace(/(\\|\s{2,})$/, '')

export function lerMarkdown(md: string): Bloco[] {
  const linhas = md.replace(/\r\n?/g, '\n').split('\n')
  const blocos: Bloco[] = []
  let i = 0

  while (i < linhas.length) {
    const linha = linhas[i]!
    if (linha.trim() === '') {
      i++
      continue
    }

    const t = linha.match(RE_TITULO)
    if (t) {
      blocos.push({ tipo: 'titulo', nivel: Math.min(t[1]!.length, 3) as 1 | 2 | 3, trechos: lerInline(t[2]!.trim()) })
      i++
      continue
    }

    if (RE_REGUA.test(linha)) {
      blocos.push({ tipo: 'regua' })
      i++
      continue
    }

    // Tabela: cabeçalho + separador. Sem o separador não é tabela (é o GFM).
    if (linha.trim().startsWith('|') && i + 1 < linhas.length && RE_SEPARADOR.test(linhas[i + 1]!) && linhas[i + 1]!.includes('-')) {
      const cabecalho = celulas(linha)
      const seps = celulas(linhas[i + 1]!)
      const alinhamentos = cabecalho.map((_, k) => alinhamentoDe(seps[k] ?? ''))
      const corpo: string[][] = []
      i += 2
      while (i < linhas.length && linhas[i]!.trim().startsWith('|')) {
        const c = celulas(linhas[i]!)
        corpo.push(cabecalho.map((_, k) => c[k] ?? ''))
        i++
      }
      blocos.push({ tipo: 'tabela', cabecalho, alinhamentos, linhas: corpo })
      continue
    }

    const ehItem = RE_ITEM.test(linha)
    const ehNum = !ehItem && RE_ITEM_NUM.test(linha)
    if (ehItem || ehNum) {
      const re = ehItem ? RE_ITEM : RE_ITEM_NUM
      const itens: Trecho[][] = []
      const numeros: number[] = []
      while (i < linhas.length && re.test(linhas[i]!)) {
        itens.push(lerInline(semQuebraForcada(linhas[i]!.match(re)![1]!.trim())))
        numeros.push(ehNum ? Number(linhas[i]!.trim().match(/^\d+/)![0]) : itens.length)
        i++
      }
      blocos.push({ tipo: 'lista', ordenada: ehNum, itens, numeros })
      continue
    }

    const par: Trecho[][] = []
    while (i < linhas.length) {
      const l = linhas[i]!
      if (
        l.trim() === '' ||
        RE_TITULO.test(l) ||
        RE_REGUA.test(l) ||
        RE_ITEM.test(l) ||
        RE_ITEM_NUM.test(l) ||
        (l.trim().startsWith('|') && i + 1 < linhas.length && RE_SEPARADOR.test(linhas[i + 1]!))
      ) {
        break
      }
      par.push(lerInline(semQuebraForcada(l.trim())))
      i++
    }
    blocos.push({ tipo: 'paragrafo', linhas: par })
  }

  return blocos
}

// ─── Larguras de coluna (puro, testado) ─────────────────────────────────────

/**
 * Distribui a largura útil entre as colunas. Cada coluna quer a largura natural do seu
 * maior conteúdo e não aceita menos que a sua maior PALAVRA — abaixo disso o pdfkit
 * quebra o número no meio ("R$ 48.500,0" / "0"). Sobrando espaço, ele vai
 * proporcionalmente; faltando, as colunas de texto longo (cedente, SPE) é que dobram
 * de linha, e não os valores.
 */
export function distribuirLarguras(naturais: number[], minimos: number[], total: number): number[] {
  const n = naturais.length
  if (n === 0) return []
  const nat = naturais.map((v, k) => Math.max(v, minimos[k] ?? 0))
  const somaNat = nat.reduce((s, v) => s + v, 0)
  if (somaNat <= total) {
    const extra = total - somaNat
    return nat.map((v) => v + (extra * v) / somaNat)
  }
  const somaMinBruto = minimos.reduce((s, v) => s + v, 0)
  if (somaMinBruto >= total) {
    // Nem as palavras cabem: corta só as colunas MAIS LARGAS, até um teto comum. Os
    // valores (curtos) ficam inteiros; a chave de acesso de 44 dígitos é que dobra.
    const ordem = [...minimos].sort((a, b) => a - b)
    let restante = total
    let teto = 0
    for (let k = 0; k < ordem.length; k++) {
      const t = restante / (ordem.length - k)
      if (ordem[k]! >= t) {
        teto = t
        break
      }
      restante -= ordem[k]!
      teto = ordem[k]!
    }
    return minimos.map((v) => Math.min(v, teto))
  }
  const mins = minimos
  const somaMin = somaMinBruto
  const folga = total - somaMin
  const desejo = nat.map((v, k) => v - mins[k]!)
  const somaDesejo = desejo.reduce((s, v) => s + v, 0)
  return mins.map((v, k) => v + (somaDesejo > 0 ? (folga * desejo[k]!) / somaDesejo : folga / n))
}

// ─── O desenho ──────────────────────────────────────────────────────────────

const COR = { ink: '#18181b', mut: '#71717a', line: '#d4d4d8', head: '#f4f4f5' } as const
const FONTE = { normal: 'Helvetica', forte: 'Helvetica-Bold', italico: 'Helvetica-Oblique', forteItalico: 'Helvetica-BoldOblique' } as const
/** A4 em pontos; margens de carta (25 mm × 20 mm). */
const PAG = { largura: 595.28, altura: 841.89, topo: 62, base: 62, lado: 56.7 }
const CONTEUDO = PAG.largura - PAG.lado * 2
const CORPO = 10
const PAD = 3

type Doc = InstanceType<typeof PDFDocument>

function fonteDe(t: Pick<Trecho, 'negrito' | 'italico'>): string {
  if (t.negrito && t.italico) return FONTE.forteItalico
  if (t.negrito) return FONTE.forte
  if (t.italico) return FONTE.italico
  return FONTE.normal
}

const limiteY = (doc: Doc) => doc.page.height - doc.page.margins.bottom

/** Uma linha lógica com trechos de fontes diferentes, quebrando dentro da largura. */
function escreverTrechos(
  doc: Doc,
  trechos: Trecho[],
  x: number,
  largura: number,
  tamanho: number,
  align: 'left' | 'justify' | 'center',
  forcarNegrito = false,
): void {
  const ts = trechos.map((t) => ({ ...t, texto: paraWinAnsi(t.texto), negrito: t.negrito || forcarNegrito }))
  /*
   * O pdfkit engole o espaço INICIAL de um trecho em modo `continued`: "**Notificante:**
   * ACME" saía "Notificante:ACME". O espaço é devolvido ao FIM do trecho anterior, onde
   * ele sobrevive.
   */
  for (let k = 1; k < ts.length; k++) {
    const m = ts[k]!.texto.match(/^\s+/)
    if (m) {
      ts[k - 1]!.texto += m[0]
      ts[k]!.texto = ts[k]!.texto.slice(m[0].length)
    }
  }
  /*
   * E uma palavra partida entre dois trechos ("**R$ 55.231,36**, atualizada") é colada no
   * trecho de ANTES: o pdfkit trata a fronteira de trecho como ponto de quebra, e a
   * vírgula ia parar sozinha no começo da linha seguinte. Uma vírgula em negrito é
   * invisível; uma linha começando por vírgula, não.
   */
  for (let k = 1; k < ts.length; k++) {
    const anterior = ts[k - 1]!
    if (anterior.texto === '' || /\s$/.test(anterior.texto)) continue
    const m = ts[k]!.texto.match(/^[^\s]+/)
    if (m) {
      anterior.texto += m[0]
      ts[k]!.texto = ts[k]!.texto.slice(m[0].length)
    }
  }
  const vivos = ts.filter((t) => t.texto.length > 0)
  if (vivos.length === 0) {
    doc.font(FONTE.normal).fontSize(tamanho).text(' ', x, doc.y, { width: largura })
    return
  }
  // Justificar uma linha de fontes misturadas abre buracos entre os trechos; só a linha
  // de uma fonte só é justificada.
  const alinhar = align === 'justify' && vivos.length > 1 ? 'left' : align
  vivos.forEach((t, k) => {
    doc.font(fonteDe(t)).fontSize(tamanho).fillColor(COR.ink)
    const opts = { width: largura, align: alinhar, lineGap: 2, continued: k < vivos.length - 1 }
    if (k === 0) doc.text(t.texto, x, doc.y, opts)
    else doc.text(t.texto, opts)
  })
}

/** Célula: `**tudo em negrito**` vira negrito; marcação no meio só perde os asteriscos. */
function celula(bruto: string): { texto: string; negrito: boolean } {
  const m = bruto.match(/^\*\*(.*)\*\*$/)
  const texto = paraWinAnsi((m ? m[1]! : bruto).replace(/\*\*/g, ''))
  return { texto: texto === '' ? ' ' : texto, negrito: Boolean(m) }
}

function tabela(doc: Doc, b: Extract<Bloco, { tipo: 'tabela' }>): void {
  const n = b.cabecalho.length
  const tamanho = n > 7 ? 7 : n > 5 ? 7.5 : 8.5
  const cab = b.cabecalho.map((c) => ({ texto: paraWinAnsi(c.replace(/\*\*/g, '')) || ' ', negrito: true }))
  const corpo = b.linhas.map((l) => l.map(celula))

  const naturais: number[] = []
  const minimos: number[] = []
  for (let k = 0; k < n; k++) {
    let nat = 0
    let min = 0
    const todas = [cab[k]!, ...corpo.map((l) => l[k]!)]
    for (const c of todas) {
      doc.font(c.negrito ? FONTE.forte : FONTE.normal).fontSize(tamanho)
      nat = Math.max(nat, doc.widthOfString(c.texto))
      // Só o espaço comum separa palavras: o `R$ 48.500,00` do Intl leva espaço SEM
      // quebra, e o pdfkit o trata como uma palavra só — que precisa caber inteira.
      // E a palavra é medida COM o espaço que a segue: é assim que o quebrador do pdfkit
      // decide se ela cabe, e medir sem ele cortava "EXEMPLO" em "EXE" / "MPLO".
      for (const palavra of c.texto.split(/[ \t\n]+/)) min = Math.max(min, doc.widthOfString(`${palavra} `))
    }
    // uma coluna nunca pede mais que metade da página: texto longo dobra de linha
    naturais.push(Math.min(nat, CONTEUDO * 0.5) + PAD * 2 + 1)
    minimos.push(Math.min(min, CONTEUDO * 0.3) + PAD * 2 + 1)
  }
  const larguras = distribuirLarguras(naturais, minimos, CONTEUDO)

  const alturaDa = (linha: { texto: string; negrito: boolean }[]) =>
    Math.max(
      ...linha.map((c, k) => {
        doc.font(c.negrito ? FONTE.forte : FONTE.normal).fontSize(tamanho)
        return doc.heightOfString(c.texto, { width: larguras[k]! - PAD * 2 })
      }),
    ) + PAD * 2

  const desenhar = (linha: { texto: string; negrito: boolean }[], y: number, h: number, cabecalho: boolean) => {
    if (cabecalho) {
      doc.save().rect(PAG.lado, y, CONTEUDO, h).fill(COR.head).restore()
    }
    let x = PAG.lado
    linha.forEach((c, k) => {
      doc.font(c.negrito ? FONTE.forte : FONTE.normal).fontSize(tamanho).fillColor(cabecalho ? COR.mut : COR.ink)
      doc.text(c.texto, x + PAD, y + PAD, { width: larguras[k]! - PAD * 2, align: cabecalho ? 'left' : b.alinhamentos[k] ?? 'left' })
      x += larguras[k]!
    })
    doc.save().lineWidth(0.5).strokeColor(COR.line).moveTo(PAG.lado, y + h).lineTo(PAG.lado + CONTEUDO, y + h).stroke().restore()
  }

  const hCab = alturaDa(cab)
  let y = doc.y
  if (y + hCab * 2 > limiteY(doc)) {
    doc.addPage()
    y = doc.page.margins.top
  }
  desenhar(cab, y, hCab, true)
  y += hCab

  for (const linha of corpo) {
    const h = alturaDa(linha)
    // Linha que não cabe vai inteira para a página seguinte, com o cabeçalho repetido:
    // uma tabela de títulos que continua sem cabeçalho obriga o leitor a voltar a folha.
    if (y + h > limiteY(doc)) {
      doc.addPage()
      y = doc.page.margins.top
      desenhar(cab, y, hCab, true)
      y += hCab
    }
    desenhar(linha, y, h, false)
    y += h
  }
  doc.x = PAG.lado
  doc.y = y + 6
}

function garantirEspaco(doc: Doc, altura: number): void {
  if (doc.y + altura > limiteY(doc)) doc.addPage()
}

export interface OpcoesPdf {
  /** Vai nas propriedades do arquivo. */
  titulo: string
  /** Texto do rodapé de toda página, antes do "página X de Y". */
  rodape?: string
}

/** O Markdown vira PDF. Resolve com os bytes; o chamador calcula o hash e guarda. */
export function markdownParaPdf(md: string, opcoes: OpcoesPdf): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: PAG.topo, bottom: PAG.base, left: PAG.lado, right: PAG.lado },
    bufferPages: true,
    info: { Title: paraWinAnsi(opcoes.titulo), Author: 'ONE OS' },
  })

  const pedacos: Buffer[] = []
  const pronto = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => pedacos.push(c))
    doc.on('end', () => resolve(Buffer.concat(pedacos)))
    doc.on('error', reject)
  })

  const blocos = lerMarkdown(md)
  blocos.forEach((b, idx) => {
    switch (b.tipo) {
      case 'titulo': {
        const tamanho = b.nivel === 1 ? 14 : b.nivel === 2 ? 11.5 : 10.5
        garantirEspaco(doc, tamanho * 4)
        if (idx > 0) doc.moveDown(b.nivel === 1 ? 0.8 : 0.6)
        escreverTrechos(doc, b.trechos, PAG.lado, CONTEUDO, tamanho, b.nivel === 1 ? 'center' : 'left', true)
        doc.moveDown(b.nivel === 1 ? 0.6 : 0.35)
        break
      }
      case 'paragrafo': {
        for (const l of b.linhas) escreverTrechos(doc, l, PAG.lado, CONTEUDO, CORPO, 'justify')
        doc.moveDown(0.55)
        break
      }
      case 'lista': {
        b.itens.forEach((item, k) => {
          const marcador = b.ordenada ? `${b.numeros[k] ?? k + 1}.` : '•'
          garantirEspaco(doc, CORPO * 2)
          const y = doc.y
          doc.font(FONTE.normal).fontSize(CORPO).fillColor(COR.ink).text(marcador, PAG.lado + 4, y, { width: 14 })
          doc.y = y
          escreverTrechos(doc, item, PAG.lado + 18, CONTEUDO - 18, CORPO, 'left')
          doc.moveDown(0.15)
        })
        doc.moveDown(0.45)
        break
      }
      case 'tabela': {
        tabela(doc, b)
        doc.moveDown(0.4)
        break
      }
      case 'regua': {
        garantirEspaco(doc, 12)
        const y = doc.y + 4
        doc.save().lineWidth(0.5).strokeColor(COR.line).moveTo(PAG.lado, y).lineTo(PAG.lado + CONTEUDO, y).stroke().restore()
        doc.y = y + 8
        break
      }
    }
  })

  /*
   * O rodapé escreve ABAIXO da margem inferior, e o pdfkit trata isso como "não cabe" e
   * abre uma página nova (o report semanal saiu com nove páginas em vez de três por
   * isso). Zerar a margem enquanto escreve e devolvê-la em seguida é o jeito suportado.
   */
  const faixa = doc.bufferedPageRange()
  for (let p = faixa.start; p < faixa.start + faixa.count; p++) {
    doc.switchToPage(p)
    const margem = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    const y = PAG.altura - 36
    doc.font(FONTE.normal).fontSize(7).fillColor(COR.mut)
    if (opcoes.rodape) {
      doc.text(paraWinAnsi(opcoes.rodape), PAG.lado, y, { width: CONTEUDO * 0.8, lineBreak: false, ellipsis: true })
    }
    doc.text(`${p - faixa.start + 1} de ${faixa.count}`, PAG.lado + CONTEUDO * 0.8, y, {
      width: CONTEUDO * 0.2,
      align: 'right',
      lineBreak: false,
    })
    doc.page.margins.bottom = margem
  }

  doc.end()
  return pronto
}
