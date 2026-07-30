/**
 * Vencimento escondido em texto livre da nota.
 *
 * Por que isto existe: 70% das notas da base caem no fallback de emissão + 30
 * dias, e nas NFS-e são 99,5% — porque a NFS-e nacional simplesmente não tem
 * bloco de cobrança. O vencimento real está lá, mas escrito em prosa: nas
 * informações complementares da NFe (`infCpl`) e na discriminação do serviço da
 * NFS-e (`xDescServ`). "Emissão + 30" é um palpite que se passa por dado, e é ele
 * que decide se a nota é operável e quanto vale antecipar.
 *
 * Determinístico, e não IA, de propósito: o sync processa milhares de notas por
 * corrida, precisa ser reprocessável e dar o mesmo resultado duas vezes. Uma
 * chamada de modelo por nota custaria dinheiro e latência para resolver um
 * problema que é de formato, não de compreensão. O que não casar aqui continua
 * caindo no fallback — e `vencimento_origem` diz qual foi.
 *
 * SEM DEPENDÊNCIA: o core vai para o browser e para o app.
 */

/** Rótulos que introduzem um vencimento. Sem um deles por perto, a data é ignorada. */
const ROTULOS_VENCIMENTO = [
  'vencimento',
  'vencimentos',
  'vencto',
  'vencto.',
  'vcto',
  'venc',
  'vence em',
  'vence',
  'data de pagamento',
  'data pagamento',
  'pagamento',
  'pagto',
  'pgto',
  'pagar até',
  'para pagamento em',
  'duplicata',
  'duplicatas',
  'fatura',
  'faturas',
  'parcela',
  'parcelas',
  'prazo',
]

/**
 * Rótulos que introduzem uma data que NÃO é vencimento. Se um deles estiver mais
 * perto da data do que o rótulo de vencimento, a data é descartada — senão
 * "Emitida em 01/07/2026" seria lida como vencimento em toda nota que descreve a
 * própria emissão no corpo do texto.
 */
const ROTULOS_NEGATIVOS = [
  'emissao',
  'emissão',
  'emitida',
  'emitido',
  'competencia',
  'competência',
  'apuracao',
  'apuração',
  'referencia',
  'referência',
  'periodo',
  'período',
  'contrato de',
  'medicao',
  'medição',
  'data base',
  'assinatura',
]

/** Janela de busca à frente do rótulo. Cobre "Venc.: 10/08/2026" e "Vencimento da parcela 1: …". */
const JANELA = 60

/** Nada além de 3 anos da emissão é vencimento de nota — é cláusula de contrato. */
const MAX_DIAS_FUTURO = 1095

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * `aaaa-mm-dd`, `dd/mm/aaaa`, `dd-mm-aa`, `dd.mm.aaaa` e — por último — `dd/mm` sem
 * ano, que aparece de verdade ("MÃO DE OBRA: R$ 23.076,10 - VENCIMENTO: 17/08").
 *
 * A ordem das alternativas importa: a com ano tem de casar antes, senão `25.08.2026`
 * seria lido como `25/08` e o ano viraria palpite.
 *
 * O `dd/mm` exige DOIS dígitos em cada lado, e isso é uma decisão contra falso
 * positivo, não estética: "Parcela 1/3" e "Parcela 1/12" são frações, não datas, e
 * viriam a ser lidas como 1º de março e 1º de dezembro.
 */
const RE_DATA =
  /(\d{4})-(\d{2})-(\d{2})|(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})|(\d{2})[/.\-](\d{2})(?![/.\-]?\d)/g

/** Ano de dois dígitos: 26 → 2026. Nota fiscal de 1979 não existe neste sistema. */
function anoCompleto(a: number): number {
  if (a >= 1000) return a
  return a <= 79 ? 2000 + a : 1900 + a
}

/** Valida de verdade: 31/02 não existe, e `Date` normalizaria para 03/03 em silêncio. */
function isoValido(ano: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
  const d = new Date(Date.UTC(ano, mes - 1, dia))
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null
  return d.toISOString().slice(0, 10)
}

interface Achado {
  iso: string
  /** Posição no texto normalizado — usada para decidir qual rótulo está mais perto. */
  pos: number
}

/**
 * `emissao` serve para completar o ano do formato `dd/mm`: usa o ano da emissão e,
 * se a data cair antes dela, o ano seguinte — uma nota emitida em dezembro com
 * "venc. 10/01" vence em janeiro do ano que vem.
 */
function datasNoTexto(texto: string, emissao: string | null): Achado[] {
  const out: Achado[] = []
  RE_DATA.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = RE_DATA.exec(texto)) !== null) {
    let iso: string | null = null
    if (m[1]) {
      iso = isoValido(Number(m[1]), Number(m[2]), Number(m[3]))
    } else if (m[4]) {
      iso = isoValido(anoCompleto(Number(m[6])), Number(m[5]), Number(m[4]))
    } else if (m[7] && emissao) {
      const dia = Number(m[7])
      const mes = Number(m[8])
      const anoEmissao = Number(emissao.slice(0, 4))
      iso = isoValido(anoEmissao, mes, dia)
      if (iso && iso < emissao) iso = isoValido(anoEmissao + 1, mes, dia)
    }
    if (iso) out.push({ iso, pos: m.index })
  }
  return out
}

/** Distância até o rótulo mais próximo ANTES da posição, ou null se nenhum na janela. */
function distanciaAoRotulo(texto: string, pos: number, rotulos: readonly string[]): number | null {
  const inicio = Math.max(0, pos - JANELA)
  const trecho = texto.slice(inicio, pos)
  let melhor: number | null = null
  for (const r of rotulos) {
    const i = trecho.lastIndexOf(r)
    if (i === -1) continue
    const dist = trecho.length - i
    if (melhor === null || dist < melhor) melhor = dist
  }
  return melhor
}

export interface VencimentosDoTexto {
  /** Todas as datas plausíveis, ordenadas. */
  datas: string[]
  /** Como foram achadas: data explícita, prazo em dias, ou pagamento à vista. */
  origem: 'data' | 'prazo' | 'a_vista' | null
}

/**
 * "COND.PAGAMENTO: PAGAMENTO A VISTA" é informação, não ausência dela: o
 * vencimento é a própria emissão. Aparece bastante nas notas de insumo, e tratar
 * como desconhecido jogava a nota para emissão + 30 — 30 dias de prazo inventado
 * numa nota que já estava paga.
 */
const RE_A_VISTA = /\ba\s*vista\b|\bavista\b|\bcontra\s*apresentacao\b/g

/**
 * Prazo em dias: "PAGAMENTO: 28 DIAS", "PRAZO 30/60/90 DIAS", "28 DDL". Só conta
 * com rótulo de pagamento/prazo por perto — "30 dias de garantia" não é vencimento.
 */
const RE_PRAZO = /(\d{1,3})(?:\s*\/\s*(\d{1,3}))*\s*(?:d\s*d\s*l|dias?|dd)\b/g

function prazosNoTexto(texto: string): number[] {
  const out: number[] = []
  RE_PRAZO.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = RE_PRAZO.exec(texto)) !== null) {
    if (distanciaAoRotulo(texto, m.index, ROTULOS_VENCIMENTO) === null) continue
    const neg = distanciaAoRotulo(texto, m.index, ROTULOS_NEGATIVOS)
    const pos = distanciaAoRotulo(texto, m.index, ROTULOS_VENCIMENTO)
    if (neg !== null && pos !== null && neg < pos) continue
    // "30/60/90 dias" casa como um bloco; recupera cada número do trecho.
    for (const n of m[0].match(/\d{1,3}/g) ?? []) {
      const dias = Number(n)
      if (dias > 0 && dias <= MAX_DIAS_FUTURO) out.push(dias)
    }
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

function somarDias(iso: string, dias: number): string | null {
  const base = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(base.getTime())) return null
  return new Date(base.getTime() + dias * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Lê todas as datas de vencimento plausíveis do texto. Primeiro tenta datas
 * explícitas; só se não houver nenhuma, cai para prazo em dias sobre a emissão.
 *
 * `emitidaEm` não é opcional por capricho: é ele que descarta a maior fonte de
 * falso positivo — data anterior à emissão não é vencimento, é referência.
 */
export function vencimentosDeTextoLivre(
  texto: string | null | undefined,
  emitidaEm?: string | null,
): VencimentosDoTexto {
  if (!texto || texto.trim() === '') return { datas: [], origem: null }

  const t = normalizar(texto)
  const emissao = emitidaEm ? (/^(\d{4}-\d{2}-\d{2})/.exec(emitidaEm)?.[1] ?? null) : null
  const limite = emissao ? somarDias(emissao, MAX_DIAS_FUTURO) : null

  const datas = datasNoTexto(t, emissao)
    .filter((d) => {
      const perto = distanciaAoRotulo(t, d.pos, ROTULOS_VENCIMENTO)
      if (perto === null) return false
      // Rótulo negativo mais próximo vence: a data é de emissão/competência.
      const neg = distanciaAoRotulo(t, d.pos, ROTULOS_NEGATIVOS)
      if (neg !== null && neg < perto) return false
      if (emissao && d.iso < emissao) return false
      if (limite && d.iso > limite) return false
      return true
    })
    .map((d) => d.iso)

  const unicas = [...new Set(datas)].sort()
  if (unicas.length > 0) return { datas: unicas, origem: 'data' }

  if (emissao) {
    const porPrazo = prazosNoTexto(t)
      .map((dias) => somarDias(emissao, dias))
      .filter((d): d is string => d !== null)
    if (porPrazo.length > 0) return { datas: [...new Set(porPrazo)].sort(), origem: 'prazo' }

    RE_A_VISTA.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = RE_A_VISTA.exec(t)) !== null) {
      if (distanciaAoRotulo(t, m.index, ROTULOS_VENCIMENTO) !== null) {
        return { datas: [emissao], origem: 'a_vista' }
      }
    }
  }

  return { datas: [], origem: null }
}

/**
 * A data que representa a dívida: a primeira que ainda não venceu; se todas
 * venceram, a última. Mesma regra de `vencimentoDasParcelas`, para que nota com
 * duplicata e nota com texto livre respondam igual.
 */
export function vencimentoDeTextoLivre(
  texto: string | null | undefined,
  emitidaEm?: string | null,
  hoje: Date = new Date(),
): { vencimento: string; origem: NonNullable<VencimentosDoTexto['origem']> } | null {
  const { datas, origem } = vencimentosDeTextoLivre(texto, emitidaEm)
  if (datas.length === 0 || !origem) return null
  const hojeIso = hoje.toISOString().slice(0, 10)
  const vencimento = datas.find((d) => d >= hojeIso) ?? datas[datas.length - 1]
  return vencimento ? { vencimento, origem } : null
}
