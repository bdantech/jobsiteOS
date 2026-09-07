import PDFDocument from 'pdfkit'
import {
  ETAPA_FUNIL_LABELS,
  brlCurto,
  direcaoDa,
  maiorVazamento,
  nomeDoArquivo,
  textoDaRegua,
  textoDoRetrato,
  variacaoTexto,
  type IndicadorReport,
  type ReportSemanal,
} from '../../../../../packages/core/src/reports/semanal.js'

/**
 * O PDF do Report Semanal (04q §4), desenhado com pdfkit.
 *
 * ─── POR QUE NÃO É UM NAVEGADOR RENDERIZANDO O WIREFRAME ────────────────────
 * O worker roda em `node:22-alpine`. Puppeteer ali exige o Chromium do apk (+~200 MB na
 * imagem) e uns 300-500 MB de RAM por render, num contêiner que já faz as cargas da
 * Receita — e ele é o executor de TODOS os jobs, deployado direto da main. O custo de um
 * deploy que não cabe é o backend inteiro fora do ar.
 *
 * O preço desta escolha está aqui e é honesto: o layout do wireframe foi reimplementado em
 * primitivas de desenho, e há duas fontes de verdade visual a manter. Por isso o padrão do
 * §4 virou CONSTANTES nomeadas logo abaixo, e não números soltos no meio do código: quando
 * a paleta mudar no wireframe, muda em um lugar aqui.
 *
 * ─── O PADRÃO, QUE É EXIGÊNCIA E NÃO GOSTO ──────────────────────────────────
 * Limpo e editorial. Título de seção discreto, em caixa alta com tracking. Número grande em
 * fonte tabular. Muito espaço em branco. Paleta contida — zinc como base, o verde só como
 * acento e sinal positivo, vermelho só para alerta. Sem borda pesada, sem sombra, sem
 * preenchimento decorativo. Régua de 1px só onde separa.
 *
 * A regra editorial que decide o que entra: CADA ELEMENTO RESPONDE A UMA PERGUNTA. Se não
 * responde, sai.
 */

// ─── O sistema, num lugar só ────────────────────────────────────────────────

const COR = {
  ink: '#18181b',
  mut: '#71717a',
  mut2: '#a1a1aa',
  line: '#e4e4e7',
  line2: '#d4d4d8',
  accent: '#1a7a4a',
  up: '#15803d',
  down: '#b91c1c',
  warn: '#b45309',
} as const

/*
 * As 14 fontes padrao do PDF usam a codificacao WinAnsi, que NAO tem seta, "diferente de"
 * nem o sinal de menos tipografico. O primeiro PDF saiu com "Distribuidos !' Contatados"
 * no meio do maior vazamento: o glifo ausente virou lixo, sem erro nenhum.
 *
 * Embutir uma fonte Unicode resolveria e custaria um .ttf no repositorio e no container.
 * Para tres caracteres, o ASCII equivalente e mais barato e nao quebra em silencio na
 * proxima vez. Acentos e o ponto medio estao no WinAnsi e continuam valendo.
 */
const SETA = '>'
const DIFERENTE = '<>'
const MENOS = '-'

/** A4 em pontos, com as margens do wireframe (13mm x 12mm). */
const PAG = { largura: 595.28, altura: 841.89, topo: 36.85, lado: 34.02 }
const CONTEUDO = PAG.largura - PAG.lado * 2

type Doc = InstanceType<typeof PDFDocument>

/** Helvetica é uma das 14 fontes padrão do PDF: nada é embutido e nada falta no Alpine. */
const FONTE = { normal: 'Helvetica', forte: 'Helvetica-Bold' } as const

function linha(doc: Doc, y: number, cor: string = COR.line, espessura = 0.5): void {
  doc.save().lineWidth(espessura).strokeColor(cor)
    .moveTo(PAG.lado, y).lineTo(PAG.largura - PAG.lado, y).stroke().restore()
}

/** Título de seção: caixa alta, 8pt, tracking largo, régua fina embaixo. */
function secao(doc: Doc, titulo: string, dica?: string): void {
  const y = doc.y
  doc.font(FONTE.forte).fontSize(7.5).fillColor(COR.mut)
    .text(titulo.toUpperCase(), PAG.lado, y, { continued: Boolean(dica), characterSpacing: 0.9 })
  if (dica) {
    doc.font(FONTE.normal).fontSize(7).fillColor(COR.mut2)
      .text(`   ${dica}`, { align: 'left', characterSpacing: 0 })
  }
  linha(doc, doc.y + 2)
  doc.moveDown(0.7)
}

function texto(doc: Doc, s: string, opts: { tamanho?: number; cor?: string; forte?: boolean } = {}): void {
  doc.font(opts.forte ? FONTE.forte : FONTE.normal)
    .fontSize(opts.tamanho ?? 8.5)
    .fillColor(opts.cor ?? COR.ink)
    .text(s, PAG.lado, doc.y, { width: CONTEUDO })
}

/**
 * A cor de uma variação. Verde e vermelho seguem o SIGNIFICADO, não o sinal — subir no
 * valor expirado é vermelho, cair é verde. É a mesma `direcaoDa` que a tela usa.
 */
function corDaDirecao(v: number | null, subirEPior: boolean): string {
  const d = direcaoDa(v, subirEPior)
  return d === 'melhor' ? COR.up : d === 'pior' ? COR.down : COR.mut2
}

/** A faixa de quatro KPIs. Número grande, rótulo pequeno, contexto embaixo. */
function faixaKpis(
  doc: Doc,
  itens: { rotulo: string; valor: string; contexto: string; cor?: string }[],
): void {
  const y0 = doc.y
  const larg = (CONTEUDO - 6 * (itens.length - 1)) / itens.length
  itens.forEach((k, i) => {
    const x = PAG.lado + i * (larg + 6)
    doc.save().lineWidth(0.5).strokeColor(COR.line2)
      .roundedRect(x, y0, larg, 44, 3).stroke().restore()
    doc.font(FONTE.forte).fontSize(6.5).fillColor(COR.mut)
      .text(k.rotulo.toUpperCase(), x + 6, y0 + 6, { width: larg - 12, characterSpacing: 0.5 })
    doc.font(FONTE.forte).fontSize(13).fillColor(COR.ink)
      .text(k.valor, x + 6, y0 + 16, { width: larg - 12 })
    doc.font(FONTE.normal).fontSize(6.8).fillColor(k.cor ?? COR.mut)
      .text(k.contexto, x + 6, y0 + 33, { width: larg - 12 })
  })
  doc.y = y0 + 44
  doc.moveDown(0.8)
}

interface Coluna {
  chave: string
  titulo: string
  largura: number
  alinhar?: 'left' | 'right'
  forte?: boolean
}

/**
 * Tabela com régua de 1px só entre linhas. Sem grade, sem zebra, sem borda externa.
 *
 * A CALHA de 6pt entre colunas não é respiro estético: sem ela, um valor alinhado à
 * direita termina exatamente onde começa o texto alinhado à esquerda da coluna seguinte, e
 * os dois se encostam. Na primeira prova saiu "1514 inbound · 1 outbound" onde deviam
 * estar "15" e "14 inbound · 1 outbound" — dois números virando um, sem erro nenhum.
 */
const CALHA = 6

function tabela(doc: Doc, colunas: Coluna[], linhas: Record<string, string>[], max = 12): void {
  const total = colunas.reduce((s, c) => s + c.largura, 0)
  const util = CONTEUDO - CALHA * (colunas.length - 1)
  const escala = util / total
  let y = doc.y

  let x = PAG.lado
  for (const c of colunas) {
    const w = c.largura * escala
    doc.font(FONTE.forte).fontSize(6.5).fillColor(COR.mut)
      .text(c.titulo.toUpperCase(), x, y, {
        width: w, align: c.alinhar ?? 'right', characterSpacing: 0.5, lineBreak: false, ellipsis: true,
      })
    x += w + CALHA
  }
  y += 10
  linha(doc, y, COR.line2)
  y += 3

  for (const l of linhas.slice(0, max)) {
    x = PAG.lado
    for (const c of colunas) {
      const w = c.largura * escala
      doc.font(c.forte ? FONTE.forte : FONTE.normal).fontSize(8).fillColor(COR.ink)
        /* `height` além de `lineBreak: false`: sem ele um texto longo demais ainda desce
           uma segunda linha e ATRAVESSA a linha de baixo da tabela. Com a altura travada,
           o pdfkit corta com reticências, que é o comportamento certo numa célula. */
        .text(l[c.chave] ?? '—', x, y, {
          width: w, height: 10, align: c.alinhar ?? 'right', ellipsis: true, lineBreak: false,
        })
      x += w + CALHA
    }
    y += 12
    linha(doc, y - 3)
  }
  doc.y = y + 2
}

/** Uma linha de indicador com as três janelas. É a régua do §1, em texto. */
function linhaIndicador(ind: IndicadorReport, formatar: (n: number) => string): Record<string, string> {
  return {
    metrica: ind.metrica,
    semana: formatar(ind.semana),
    var_semana: variacaoTexto(ind.var_semana_pct),
    mes: formatar(ind.mes),
    media: ind.doze_media_semanal === null ? '—' : formatar(ind.doze_media_semanal),
    regua: textoDaRegua(ind),
  }
}

/**
 * O rodape, e a razao de ele mexer na margem.
 *
 * Ele escreve a 30pt do pe da folha, ABAIXO da margem inferior do documento — e o pdfkit
 * trata isso como "o conteudo nao cabe" e abre uma pagina nova. O primeiro PDF saiu com
 * NOVE paginas em vez de tres, uma em branco depois de cada rodape.
 *
 * Zerar a margem enquanto se escreve o rodape, e devolve-la em seguida, e a forma
 * suportada de dizer "eu sei onde estou desenhando".
 */
function rodape(doc: Doc, r: ReportSemanal, pagina: number, de: number): void {
  const margem = doc.page.margins.bottom
  doc.page.margins.bottom = 0
  const y = PAG.altura - 30
  linha(doc, y, COR.line)
  /* A DATA DE GERAÇÃO no rodapé de toda página.
     Este arquivo circula por e-mail e é citado meses depois. Sem o carimbo, duas versões
     da mesma semana — uma gerada na segunda, outra regerada em novembro — são
     indistinguíveis na mesa de quem está lendo. */
  doc.font(FONTE.normal).fontSize(6.5).fillColor(COR.mut2)
    .text(`ONE OS · Report semanal · semana ${r.periodo.semana_iso}/${r.periodo.ano}` +
          ` · gerado em ${dataHora(r.periodo.gerado_em)}`,
          PAG.lado, y + 5, { width: CONTEUDO * 0.72, lineBreak: false })
    .text(`${pagina} de ${de}`, PAG.lado + CONTEUDO * 0.72, y + 5,
          { width: CONTEUDO * 0.28, align: 'right', lineBreak: false })
  doc.page.margins.bottom = margem
}

function cabecalho(doc: Doc, r: ReportSemanal): void {
  const y = PAG.topo
  doc.font(FONTE.forte).fontSize(6.5).fillColor(COR.mut)
    .text('ONE OS · COMERCIAL', PAG.lado, y, { characterSpacing: 1.2 })
  doc.font(FONTE.forte).fontSize(14).fillColor(COR.ink)
    .text('Report Semanal Executivo', PAG.lado, y + 10)

  const p = r.periodo
  doc.font(FONTE.forte).fontSize(8.5).fillColor(COR.ink)
    .text(`Semana ${p.semana_iso} · ${dm(p.inicio)} a ${dm(p.fim)}`,
          PAG.lado + CONTEUDO / 2, y + 2, { width: CONTEUDO / 2, align: 'right' })
  doc.font(FONTE.normal).fontSize(7).fillColor(COR.mut)
    .text(`Mês corrente parcial: ${p.mes_dias_decorridos} de ${p.mes_dias_total} dias`,
          PAG.lado + CONTEUDO / 2, y + 14, { width: CONTEUDO / 2, align: 'right' })
    .text(`Base de comparação: ${mesAno(p.base_12m_de)} – ${mesAno(p.base_12m_ate)}`,
          PAG.lado + CONTEUDO / 2, y + 23, { width: CONTEUDO / 2, align: 'right' })

  /* De quando é cada metade do documento. Metade dos números é FLUXO da janela (VOP,
     volume, receita, comissão) e metade é ESTOQUE (carteira, filas, cobertura), e sem esta
     linha as duas se leem como se fossem a mesma coisa. */
  doc.font(FONTE.normal).fontSize(6.5).fillColor(COR.mut2)
    .text(textoDoRetrato(p), PAG.lado, y + 32, { width: CONTEUDO, lineBreak: false })

  doc.save().lineWidth(1.4).strokeColor(COR.ink)
    .moveTo(PAG.lado, y + 44).lineTo(PAG.largura - PAG.lado, y + 44).stroke().restore()
  doc.y = y + 52
}

/**
 * Número em pt-BR. `String(43.1)` põe PONTO decimal, e o report saiu com "43.1%" e
 * "18.9 d" numa página em que todo o resto usa vírgula.
 */
/** "Media" com acento: a chave do banco é `media`, o rótulo é "Média". */
const FAIXA_LABEL: Record<string, string> = {
  alta: 'Alta', boa: 'Boa', media: 'Média', sem_faixa: 'Sem faixa',
}

const num = (v: number | null | undefined, casas = 1): string =>
  v === null || v === undefined || !Number.isFinite(Number(v))
    ? '—'
    : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas })

const pct = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : `${num(v)}%`)

const dm = (iso: string) => {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a?.slice(2) ?? ''}`
}
/**
 * O instante da geração, no fuso de São Paulo.
 *
 * `toLocaleString` sem `timeZone` usa o do CONTÊINER, que roda em UTC — o report gerado às
 * 6h de segunda sairia carimbado com 9h, e um leitor atento concluiria que o job atrasou
 * três horas.
 */
const dataHora = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

const mesAno = (iso: string) => {
  const [a, m] = iso.split('-')
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  return `${nomes[Number(m) - 1] ?? m}/${a?.slice(2) ?? ''}`
}

// ─── O documento ────────────────────────────────────────────────────────────

export function gerarPdfSemanal(r: ReportSemanal, resumoIa: string | null): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: PAG.topo, bottom: 40, left: PAG.lado, right: PAG.lado },
    info: { Title: nomeDoArquivo(r.periodo), Author: 'ONE OS' },
  })

  const pedacos: Buffer[] = []
  const pronto = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => pedacos.push(c))
    doc.on('end', () => resolve(Buffer.concat(pedacos)))
    doc.on('error', reject)
  })

  // ── Página 1: leitura executiva ─────────────────────────────────────────
  cabecalho(doc, r)

  if (resumoIa) {
    const y0 = doc.y
    doc.font(FONTE.forte).fontSize(6.5).fillColor(COR.accent)
      .text('RESUMO DA SEMANA', PAG.lado + 10, y0 + 8, { characterSpacing: 1 })
    doc.font(FONTE.normal).fontSize(8.5).fillColor(COR.ink)
      .text(resumoIa, PAG.lado + 10, doc.y + 3, { width: CONTEUDO - 20, lineGap: 1.5 })
    const y1 = doc.y + 8
    /* Só a barra da esquerda, e não uma caixa: a borda de quatro lados vira peso visual
       numa página que depende de espaço em branco para respirar. */
    doc.save().lineWidth(2).strokeColor(COR.accent)
      .moveTo(PAG.lado, y0 + 4).lineTo(PAG.lado, y1).stroke().restore()
    doc.y = y1
    doc.moveDown(1)
  }

  const k = r.operacao.kpis
  secao(doc, 'Os quatro números', textoDaRegua(k.volume_convertido))
  faixaKpis(doc, [
    {
      rotulo: 'Volume convertido',
      valor: brlCurto(k.volume_convertido.semana),
      contexto: `${variacaoTexto(k.volume_convertido.var_semana_pct)} vs média semanal`,
      cor: corDaDirecao(k.volume_convertido.var_semana_pct, false),
    },
    {
      rotulo: 'VOP operado',
      valor: brlCurto(k.vop_operado.semana),
      contexto: `${variacaoTexto(k.vop_operado.var_semana_pct)} vs média semanal`,
      cor: corDaDirecao(k.vop_operado.var_semana_pct, false),
    },
    {
      rotulo: 'Receita gerada',
      valor: brlCurto(k.receita.semana),
      contexto: `${variacaoTexto(k.receita.var_semana_pct)} vs média semanal`,
      cor: corDaDirecao(k.receita.var_semana_pct, false),
    },
    {
      rotulo: 'Limite ocioso',
      valor: brlCurto(k.limite_ocioso.foto),
      // Estoque, e a data junto: no PDF é o do FIM da janela, na tela é o de agora — e a
      // diferença entre os dois foi de R$ 2,9 mi em uma semana.
      contexto: `saldo em ${dm(k.limite_ocioso.em)}, sem série`,
      cor: COR.mut,
    },
  ])

  // Funil da semana + o maior vazamento.
  const fs = r.comercial.funil.semana
  secao(doc, 'Funil comercial da semana')
  if (fs) {
    const etapas = (['distribuidos', 'contatados', 'com_fit', 'agendados', 'realizados', 'ganhos'] as const)
    const maior = Math.max(...etapas.map((e) => fs[e]), 1)
    const larg = (CONTEUDO - 3 * 5) / 6
    const base = doc.y + 46
    etapas.forEach((e, i) => {
      const x = PAG.lado + i * (larg + 3)
      /* Etapa ZERADA nao ganha barra: um retangulo de 2px na linha de base parece traco de
         grade, e cinco deles em fila fazem o funil parecer quebrado em vez de vazio. */
      const h = fs[e] > 0 ? Math.max((fs[e] / maior) * 34, 3) : 0
      if (h > 0) {
        doc.save().fillColor(COR.accent).roundedRect(x, base - h, larg, h, 2).fill().restore()
      }
      doc.font(FONTE.forte).fontSize(10).fillColor(COR.ink)
        .text(String(fs[e]), x, base + 3, { width: larg, align: 'center' })
      doc.font(FONTE.normal).fontSize(6).fillColor(COR.mut)
        .text(ETAPA_FUNIL_LABELS[e], x, base + 15, { width: larg, align: 'center' })
    })
    doc.y = base + 26

    const vaz = maiorVazamento(fs, r.comercial.funil.doze)
    if (vaz) {
      const y0 = doc.y + 4
      doc.save().lineWidth(2).strokeColor(COR.warn)
        .moveTo(PAG.lado, y0).lineTo(PAG.lado, y0 + 22).stroke().restore()
      doc.font(FONTE.normal).fontSize(8).fillColor(COR.ink).text(
        `Maior vazamento: ${ETAPA_FUNIL_LABELS[vaz.de]} ${SETA} ${ETAPA_FUNIL_LABELS[vaz.para]}. ` +
        `${vaz.perdidos} não passaram (${pct(vaz.passagem_pct)} de passagem` +
        (vaz.passagem_12m_pct !== null ? `, contra ${pct(vaz.passagem_12m_pct)} em 12 meses` : '') + ').',
        PAG.lado + 8, y0 + 4, { width: CONTEUDO - 16 },
      )
      doc.y = y0 + 26
    }
  } else {
    texto(doc, 'Nenhum lead distribuído nesta semana.', { cor: COR.mut })
  }
  doc.moveDown(0.8)

  const a = r.operacao.antecipacao
  secao(doc, 'Antecipação', 'VOP é a base de comissão')
  tabela(doc,
    [
      { chave: 'metrica', titulo: 'Indicador', largura: 34, alinhar: 'left', forte: true },
      { chave: 'semana', titulo: 'Semana', largura: 20 },
      { chave: 'var_semana', titulo: 'vs média', largura: 16 },
      { chave: 'mes', titulo: 'Mês (parcial)', largura: 20 },
      { chave: 'media', titulo: 'Média semanal', largura: 20 },
      { chave: 'regua', titulo: 'Base', largura: 20 },
    ],
    [
      { ...linhaIndicador(a.volume, brlCurto), metrica: 'Volume convertido' },
      { ...linhaIndicador(a.vop, brlCurto), metrica: 'VOP operado' },
      { ...linhaIndicador(a.receita, brlCurto), metrica: 'Receita (spread)' },
      {
        metrica: 'Ticket médio', semana: brlCurto(a.ticket_medio_semana), var_semana: '—',
        mes: brlCurto(a.ticket_medio_mes), media: '—', regua: `${a.operacoes_semana} operações`,
      },
      {
        metrica: 'Prazo médio', semana: `${num(a.prazo_medio_semana)} d`, var_semana: '—',
        mes: `${num(a.prazo_medio_mes)} d`, media: `${num(a.prazo_medio_12m)} d`,
        regua: `${a.cedentes_semana} cedentes`,
      },
    ],
  )

  rodape(doc, r, 1, 3)

  // ── Página 2: funil de NF, comercial e crédito ──────────────────────────
  doc.addPage()
  cabecalho(doc, r)

  secao(doc, 'Funil de notas fiscais', 'conversão medida na coorte da janela')
  tabela(doc,
    [
      { chave: 'faixa', titulo: 'Faixa', largura: 22, alinhar: 'left', forte: true },
      { chave: 'entradas', titulo: 'Entradas', largura: 18 },
      { chave: 'valor', titulo: 'Valor', largura: 24 },
      { chave: 'conv', titulo: 'Conversão', largura: 18 },
      { chave: 'conv12', titulo: 'Conversão 12m', largura: 20 },
    ],
    r.operacao.nf.por_faixa.map((f) => ({
      faixa: FAIXA_LABEL[f.faixa] ?? f.faixa,
      entradas: num(f.entradas_semana, 0),
      valor: brlCurto(f.valor_semana),
      conv: pct(f.conversao_semana_pct),
      conv12: pct(f.conversao_12m_pct),
    })),
  )
  doc.moveDown(0.5)

  const exp = r.operacao.nf.valor_expirado
  const trav = r.operacao.nf.travadas
  doc.font(FONTE.normal).fontSize(8).fillColor(COR.ink).text(
    `Expirou sem trabalho: ${brlCurto(exp.semana)} (${variacaoTexto(exp.var_semana_pct)} vs média). ` +
    `Antecipações travadas: ${trav.total}, somando ${brlCurto(trav.valor)}.`,
    PAG.lado, doc.y, { width: CONTEUDO },
  )
  doc.moveDown(1)

  const c = r.comercial.comercial
  secao(doc, 'Comercial')
  tabela(doc,
    [
      { chave: 'k', titulo: 'Indicador', largura: 40, alinhar: 'left', forte: true },
      { chave: 'v', titulo: 'Semana', largura: 20 },
      { chave: 'n', titulo: 'Observação', largura: 40, alinhar: 'left' },
    ],
    [
      { k: 'Leads distribuídos', v: String(c.leads_semana), n: `${c.leads_inbound} inbound · ${c.leads_outbound} outbound` },
      { k: 'Taxa de fit', v: pct(c.fit_pct), n: `${c.fit_avaliados} avaliados na semana` },
      { k: 'Reuniões agendadas', v: String(c.reunioes_agendadas.semana), n: textoDaRegua(c.reunioes_agendadas) },
      { k: 'Reuniões realizadas', v: String(c.reunioes_realizadas), n: '' },
      { k: 'No-shows não remarcados', v: String(c.no_shows_nao_remarcados), n: 'em aberto, acumulado' },
      { k: 'MOUs', v: String(c.mous), n: '' },
      {
        k: `Ciclo 1º contato ${SETA} 1ª operação`,
        v: c.ciclo_medio_dias === null ? '—' : `${c.ciclo_medio_dias} d`,
        n: c.ciclo_medio_base === 0 ? 'ninguém completou o ciclo ainda' : `sobre ${c.ciclo_medio_base} negócio(s)`,
      },
    ],
  )
  doc.moveDown(0.8)

  const cr = r.comercial.credito
  secao(doc, 'Crédito')
  tabela(doc,
    [
      { chave: 'k', titulo: 'Indicador', largura: 40, alinhar: 'left', forte: true },
      { chave: 'v', titulo: 'Semana', largura: 20 },
      { chave: 'n', titulo: 'Observação', largura: 40, alinhar: 'left' },
    ],
    [
      { k: 'Solicitadas', v: String(cr.solicitadas_semana), n: '' },
      { k: 'Aprovadas / negadas', v: `${cr.aprovadas_semana} / ${cr.negadas_semana}`, n: cr.aprovacao_pct === null ? '' : `${pct(cr.aprovacao_pct)} de aprovação` },
      { k: 'Limite concedido', v: brlCurto(cr.limite_concedido.semana), n: textoDaRegua(cr.limite_concedido) },
      {
        k: 'Tempo na esteira',
        v: cr.esteira_dias === null ? '—' : `${num(cr.esteira_dias)} d`,
        /* A base viaja junto: uma média de uma análise não é uma média, e o leitor tem
           de poder descontar isso sozinho. */
        n: cr.esteira_base <= 3
          ? `base de ${cr.esteira_base}; as importadas não medem`
          : `sobre ${cr.esteira_base} análises`,
      },
      { k: 'Gargalo', v: cr.esteira_gargalo ?? '—', n: 'estágio com mais análises paradas' },
      { k: 'Divergências com a seguradora', v: String(cr.divergencias_seguradora), n: `limite operacional ${DIFERENTE} aprovado` },
    ],
  )

  rodape(doc, r, 2, 3)

  // ── Página 3: carteira, certificados, time e atenção ────────────────────
  doc.addPage()
  cabecalho(doc, r)

  const ca = r.carteira.carteira
  secao(doc, 'Carteira')
  faixaKpis(doc, [
    { rotulo: 'Clientes', valor: String(ca.clientes), contexto: `${ca.operaram_semana} operaram na semana` },
    { rotulo: 'Limite ocioso', valor: brlCurto(ca.limite_ocioso), contexto: `de ${brlCurto(ca.limite_total)}`, cor: COR.warn },
    { rotulo: 'Utilização', valor: pct(ca.utilizacao_pct), contexto: `${ca.inoperantes} inoperantes` },
    { rotulo: 'Movimento', valor: `+${ca.novos_semana} / ${MENOS}${ca.sairam_semana}`, contexto: 'novos / saíram' },
  ])

  secao(doc, 'Carteiras que não estão performando')
  tabela(doc,
    [
      { chave: 'cliente', titulo: 'Cliente', largura: 40, alinhar: 'left', forte: true },
      { chave: 'gestor', titulo: 'Gestor', largura: 22, alinhar: 'left' },
      { chave: 'ocioso', titulo: 'Ocioso', largura: 20 },
      { chave: 'dias', titulo: 'Dias sem operar', largura: 18 },
    ],
    (r.carteira.listas.nao_performando as Record<string, unknown>[]).map((x) => ({
      cliente: String(x.cliente ?? '—'),
      gestor: String(x.gestor ?? '—'),
      ocioso: brlCurto(Number(x.ocioso)),
      dias: x.dias_sem_operar === null || x.dias_sem_operar === undefined ? '—' : String(x.dias_sem_operar),
    })),
    8,
  )
  doc.moveDown(0.8)

  const ce = r.carteira.certificados
  const inv = ce.invisivel
  secao(doc, 'Certificados digitais', `cobertura de ${pct(ce.cobertura_pct)}`)
  /* A barra de cobertura: três segmentos, sem borda. É a única peça "gráfica" da página 3,
     e existe porque a razão coberto/descoberto é a coisa que se lê num relance. */
  {
    const y0 = doc.y
    const total = Math.max(ce.cnpjs, 1)
    const wc = (ce.cobertos / total) * CONTEUDO
    const wv = (ce.vencendo_30d / total) * CONTEUDO
    doc.save()
      .fillColor(COR.accent).rect(PAG.lado, y0, wc, 7).fill()
      .fillColor(COR.warn).rect(PAG.lado + wc, y0, wv, 7).fill()
      .fillColor(COR.line).rect(PAG.lado + wc + wv, y0, CONTEUDO - wc - wv, 7).fill()
      .restore()
    doc.y = y0 + 11
    doc.font(FONTE.normal).fontSize(7).fillColor(COR.mut).text(
      `${ce.cobertos} válidos · ${ce.vencendo_30d} vencendo em 30 dias · ${ce.sem_certificado} sem certificado   ` +
      `|   matrizes ${ce.matrizes_cobertas}/${ce.matrizes} · SPEs ${ce.spes_cobertas}/${ce.spes}`,
      PAG.lado, doc.y, { width: CONTEUDO },
    )
    doc.moveDown(0.6)
  }

  if (inv.razao !== null) {
    doc.font(FONTE.normal).fontSize(8).fillColor(COR.ink).text(
      `${inv.grupos_cegos} contas sem nenhum certificado. As ${inv.topo ?? 15} maiores escondem ` +
      `${brlCurto(inv.total_mes_do_topo)} de NF por mês.`,
      PAG.lado, doc.y, { width: CONTEUDO },
    )
    doc.font(FONTE.normal).fontSize(6.8).fillColor(COR.mut2).text(
      `Estimativa: ${pct(inv.razao * 100)} do faturamento estimado vira NF visível — ` +
      `razão medida em ${inv.razao_base} clientes que têm certificado.`,
      PAG.lado, doc.y + 1, { width: CONTEUDO },
    )
    doc.moveDown(0.5)
    tabela(doc,
      [
        { chave: 'grupo', titulo: 'Conta', largura: 46, alinhar: 'left', forte: true },
        { chave: 'cnpjs', titulo: 'CNPJs', largura: 14 },
        { chave: 'fat', titulo: 'Faturamento estimado', largura: 22 },
        { chave: 'inv', titulo: 'Invisível por mês', largura: 20 },
      ],
      (inv.itens as Record<string, unknown>[]).map((x) => ({
        grupo: String(x.grupo ?? '—'),
        cnpjs: String(x.cnpjs_no_grupo ?? '—'),
        fat: brlCurto(Number(x.faturamento_estimado)),
        inv: brlCurto(Number(x.invisivel_mes)),
      })),
      8,
    )
  }
  doc.moveDown(0.8)

  secao(doc, 'Time')
  tabela(doc,
    [
      { chave: 'nome', titulo: 'Vendedor', largura: 34, alinhar: 'left', forte: true },
      { chave: 'tipo', titulo: 'Papel', largura: 18, alinhar: 'left' },
      { chave: 'reunioes', titulo: 'Reuniões', largura: 14 },
      { chave: 'conv', titulo: 'Conversões', largura: 14 },
      { chave: 'vop', titulo: 'VOP', largura: 20 },
      { chave: 'com', titulo: 'Comissão', largura: 18 },
    ],
    r.comercial.time.vendedores.map((v) => ({
      nome: v.nome, tipo: v.tipo, reunioes: String(v.reunioes), conv: String(v.conversoes),
      vop: brlCurto(v.vop), com: brlCurto(v.comissao),
    })),
    8,
  )
  const fi = r.comercial.time.filas
  doc.font(FONTE.normal).fontSize(7.5).fillColor(COR.mut).text(
    `Filas acumulando: ${fi.inbound_sem_contato} inbound sem contato · ` +
    `${fi.docs_parados} ${fi.docs_parados === 1 ? 'doc parado' : 'docs parados'} · ` +
    `${fi.conversas_sem_resposta} conversas sem resposta.`,
    PAG.lado, doc.y + 3, { width: CONTEUDO },
  )
  doc.moveDown(1)

  secao(doc, 'Exige atenção')
  {
    const rotulos: Record<string, string> = {
      limites_reduzidos: 'Limites reduzidos pela seguradora',
      protestos_novos: 'Protestos novos em clientes',
      certificados_vencendo_30d: 'Certificados vencendo em 30 dias',
      processos_com_movimento: 'Processos com movimentação relevante',
      lotes_aguardando: 'Lotes de enriquecimento aguardando aprovação',
      sugestoes_perfil_pendentes: 'Sugestões do Perfil pendentes',
      ex_clientes_sem_motivo: 'Ex-clientes sem motivo registrado',
      fornecedores_sem_contato: 'Fornecedores sem contato',
      antecipacoes_travadas: 'Antecipações travadas',
    }
    /* Só o que é MAIOR QUE ZERO. Uma lista de nove linhas com sete zeros treina o leitor a
       pular a seção inteira — e é justamente a seção que existe para ser lida. */
    const itens = Object.entries(rotulos)
      .map(([k, rot]) => ({ rot, n: Number(r.carteira.atencao[k] ?? 0) }))
      .filter((x) => x.n > 0)
      .sort((a2, b2) => b2.n - a2.n)

    if (itens.length === 0) {
      texto(doc, 'Nada exigindo atenção nesta semana.', { cor: COR.mut })
    } else {
      for (const it of itens) {
        const y = doc.y
        doc.save().fillColor(it.n > 20 ? COR.down : COR.warn).circle(PAG.lado + 2, y + 4, 2).fill().restore()
        doc.font(FONTE.forte).fontSize(8).fillColor(COR.ink)
          .text(String(it.n), PAG.lado + 9, y, { width: 22 })
        doc.font(FONTE.normal).fontSize(8).fillColor(COR.ink)
          .text(it.rot, PAG.lado + 33, y, { width: CONTEUDO - 33 })
        doc.y = y + 12
        linha(doc, doc.y - 3)
      }
    }
  }

  rodape(doc, r, 3, 3)
  doc.end()
  return pronto
}
