/**
 * Datas civis (AAAA-MM-DD) sem fuso: a apólice conta dias corridos sobre o calendário,
 * e um `new Date('2026-09-26')` local no container em UTC viraria 25/09 às 21h em
 * São Paulo. Tudo aqui opera em UTC puro sobre a data, e só a data sai.
 */

const DIA_MS = 86_400_000

function paraUtc(data: string): number {
  const t = Date.parse(`${data.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(t)) throw new Error(`Data inválida: ${data}`)
  return t
}

function deUtc(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

export function somarDiasCorridos(data: string, dias: number): string {
  return deUtc(paraUtc(data) + dias * DIA_MS)
}

/** `b - a` em dias. */
export function diasEntreDatas(a: string, b: string): number {
  return Math.round((paraUtc(b) - paraUtc(a)) / DIA_MS)
}

/**
 * Soma meses de calendário com o dia travado no fim do mês: 31/08 + 6 meses é 28/02 (ou
 * 29/02), nunca 03/03. "6 meses contados da Data da Perda" que escorregasse para o mês
 * seguinte daria dias a mais — e um prazo de apólice calculado a mais é um prazo perdido.
 */
export function somarMeses(data: string, meses: number): string {
  const d = new Date(paraUtc(data))
  const ano = d.getUTCFullYear()
  const mes = d.getUTCMonth() + meses
  const dia = d.getUTCDate()
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate()
  return deUtc(Date.UTC(ano, mes, Math.min(dia, ultimo)))
}

export function menorData(a: string, b: string): string {
  return a <= b ? a : b
}

/** Hoje em São Paulo — o dia em que a pessoa está, não o do container. */
export function hojeSaoPaulo(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora)
}

// ─── Dias úteis (prazo de pagamento da notificação, §5) ─────────────────────

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
function pascoa(ano: number): string {
  const a = ano % 19
  const b = Math.floor(ano / 100)
  const c = ano % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31)
  const dia = ((h + l - 7 * m + 114) % 31) + 1
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/**
 * Feriados em que não há compensação bancária — o prazo de pagamento é um prazo para
 * pagar boleto/TED. Carnaval e Corpus Christi não são feriados nacionais de lei, mas o
 * banco fecha, e um prazo que vence num dia em que ninguém consegue pagar não é prazo.
 * Feriados estaduais e municipais ficam de fora (o devedor pode estar em qualquer UF).
 */
export function feriadosBancarios(ano: number): Set<string> {
  const p = pascoa(ano)
  const fixos = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25']
  return new Set([
    ...fixos.map((md) => `${ano}-${md}`),
    somarDiasCorridos(p, -48), // segunda de carnaval
    somarDiasCorridos(p, -47), // terça de carnaval
    somarDiasCorridos(p, -2), // sexta-feira santa
    somarDiasCorridos(p, 60), // Corpus Christi
  ])
}

export function ehDiaUtil(data: string): boolean {
  const dow = new Date(paraUtc(data)).getUTCDay()
  if (dow === 0 || dow === 6) return false
  return !feriadosBancarios(Number(data.slice(0, 4))).has(data.slice(0, 10))
}

/** N dias úteis depois de `data` (o dia da notificação não conta). */
export function somarDiasUteis(data: string, dias: number): string {
  let atual = data.slice(0, 10)
  let restantes = dias
  while (restantes > 0) {
    atual = somarDiasCorridos(atual, 1)
    if (ehDiaUtil(atual)) restantes--
  }
  return atual
}

/** O próprio dia, se for útil; senão o primeiro dia útil depois dele. */
export function proximoDiaUtil(data: string): string {
  let atual = data.slice(0, 10)
  while (!ehDiaUtil(atual)) atual = somarDiasCorridos(atual, 1)
  return atual
}

// ─── Quando um título passa a estar EM ATRASO ───────────────────────────────

/**
 * O dia em que um boleto pago em dia aparece como liquidado: o sacado paga no vencimento
 * — ou no primeiro dia útil depois dele, se o vencimento cai em fim de semana ou
 * feriado bancário — e o banco compensa no dia útil seguinte.
 *
 *   vence segunda  → paga segunda → liquida terça
 *   vence sábado   → paga segunda → liquida terça
 *   vence sexta    → paga sexta   → liquida segunda
 *
 * O espelho em SQL é `app__cobranca_liquidacao_esperada` (0274): as telas leem da view,
 * o worker e as tools leem daqui, e os dois precisam dar o mesmo dia.
 */
export function liquidacaoEsperada(vencimento: string): string {
  return somarDiasUteis(proximoDiaUtil(vencimento), 1)
}

/**
 * Em atraso só DEPOIS do dia da liquidação esperada. Antes disso o título pode estar
 * pago e só não ter compensado — e uma lista de "vencidos" que mostra o boleto de sábado
 * na segunda é uma lista que ensina a desconfiar dela.
 *
 * Isto decide o que as LISTAS chamam de vencido. Não mexe em prazo nenhum: o relógio da
 * apólice e os juros continuam contando do vencimento original (cl. 16900.20).
 */
export function emAtraso(vencimento: string, hoje: string): boolean {
  return hoje > liquidacaoEsperada(vencimento)
}

/** Dias de atraso contados do vencimento — mas só quando o título já está em atraso. */
export function diasEmAtraso(vencimento: string, hoje: string): number {
  return emAtraso(vencimento, hoje) ? diasEntreDatas(vencimento, hoje) : 0
}
