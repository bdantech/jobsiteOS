/**
 * A semana do report (04u §3) — a MESMA do 04q, escrita uma vez.
 *
 * Semana é segunda a domingo. FECHADA é a que o último dia já passou; num domingo a semana
 * ainda está correndo. É a aritmética de `app_report_semanal` no banco e de `janela.ts` no
 * worker, e as três precisam concordar: relatório com duas definições de semana é relatório
 * em que ninguém confia.
 *
 * Este arquivo não importa nada, de propósito — o worker o testa com
 * `--experimental-strip-types`, e um import transitivo com parameter property o derrubaria.
 */

export interface Semana {
  inicio: string
  fim: string
}

const DIA_MS = 86_400_000

function emUtc(iso: string): Date {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, d ?? 1))
}

const paraIso = (d: Date) => d.toISOString().slice(0, 10)

/** Soma dias a uma data ISO, sem fuso no meio: `2026-10-11` + 1 é `2026-10-12`. */
export function somarDias(iso: string, dias: number): string {
  return paraIso(new Date(emUtc(iso).getTime() + dias * DIA_MS))
}

/** A semana (segunda a domingo) que contém o dia. */
export function semanaDe(dia: string): Semana {
  const d = emUtc(dia)
  // getUTCDay(): 0 = domingo. Segunda é o dia 1; o domingo pertence à semana que termina nele.
  const desdeSegunda = (d.getUTCDay() + 6) % 7
  const inicio = somarDias(paraIso(d), -desdeSegunda)
  return { inicio, fim: somarDias(inicio, 6) }
}

/**
 * A semana fechada mais recente em relação a `hoje`.
 *
 * Num domingo é a ANTERIOR: o domingo de hoje não acabou. Abrir na semana corrente
 * compararia três dias com sete, e toda segunda o report diria que a semana desabou.
 */
export function semanaFechadaEm(hoje: string): Semana {
  const atual = semanaDe(hoje)
  return { inicio: somarDias(atual.inicio, -7), fim: somarDias(atual.fim, -7) }
}

/** Em aberto = o último dia ainda não passou. No próprio domingo, ainda está em aberto. */
export function semanaEmAberto(semana: Semana, hoje: string): boolean {
  return semana.fim >= hoje.slice(0, 10)
}

/**
 * O mês a que a semana pertence: o do seu ÚLTIMO dia.
 *
 * Uma semana que atravessa a virada (29/09 a 05/10) precisa cair inteira em um mês só, ou a
 * soma dos meses deixa de bater com a soma das semanas. Fica no mês em que ela FECHA, que é
 * quando o número dela passa a existir.
 */
export function mesDaSemana(semana: Semana): string {
  return semana.fim.slice(0, 7)
}

/**
 * Só as semanas FECHADAS. É a única porta por onde uma lista de semanas vira média ou total.
 *
 * Semana parcial comparada com semanas inteiras é a forma mais comum de enganar um gestor
 * com dado correto: três dias de leads ao lado de sete parecem uma queda de 60%.
 */
export function soFechadas<T extends { em_aberto: boolean }>(semanas: readonly T[]): T[] {
  return semanas.filter((s) => !s.em_aberto)
}

export interface AgregadoSemanas {
  total: number
  /** Média por semana fechada. `null` sem nenhuma semana fechada — e nunca zero. */
  media: number | null
  /** Quantas semanas entraram. A em aberto NUNCA é uma delas. */
  semanas: number
}

/** Total e média de um valor sobre as semanas fechadas. A em aberto é recusada aqui. */
export function agregarSemanas<T extends { em_aberto: boolean }>(
  semanas: readonly T[],
  valor: (s: T) => number,
): AgregadoSemanas {
  const fechadas = soFechadas(semanas)
  const total = fechadas.reduce((s, x) => s + valor(x), 0)
  return {
    total,
    media: fechadas.length > 0 ? total / fechadas.length : null,
    semanas: fechadas.length,
  }
}

/** As semanas de um mês (`YYYY-MM`), pela regra de `mesDaSemana`. Mantém a em aberto. */
export function semanasDoMes<T extends Semana>(semanas: readonly T[], mes: string): T[] {
  return semanas.filter((s) => mesDaSemana(s) === mes)
}

/** Semanas FECHADAS agrupadas por mês, do mais recente para o mais antigo. */
export function fechadasPorMes<T extends Semana & { em_aberto: boolean }>(
  semanas: readonly T[],
): { mes: string; semanas: T[] }[] {
  const porMes = new Map<string, T[]>()
  for (const s of soFechadas(semanas)) {
    const mes = mesDaSemana(s)
    porMes.set(mes, [...(porMes.get(mes) ?? []), s])
  }
  return [...porMes.entries()]
    .map(([mes, lista]) => ({ mes, semanas: lista }))
    .sort((a, b) => b.mes.localeCompare(a.mes))
}

/** O dia (`YYYY-MM-DD`) de um instante no fuso de São Paulo — o fuso em que o report conta. */
export function diaEmSaoPaulo(instante: string | Date): string {
  const d = typeof instante === 'string' ? new Date(instante) : instante
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

/** O instante cai dentro da semana, contando o dia em São Paulo? */
export function naSemana(instante: string | Date | null | undefined, semana: Semana): boolean {
  if (!instante) return false
  const dia = diaEmSaoPaulo(instante)
  return dia >= semana.inicio && dia <= semana.fim
}
