/**
 * Leitor de expressão cron — o suficiente para o que a Vercel aceita, e nada além.
 *
 * Existe porque a agenda da plataforma está escrita em `apps/web/vercel.json`, que
 * é a fonte da verdade (é o que a Vercel executa), e ninguém consegue ler
 * `30 9,13,17,21,1,5 * * *` e responder "então isso roda quando?". A tela de
 * Administração → Crons traduz; este módulo é a tradução.
 *
 * TUDO aqui é UTC, porque é assim que a Vercel dispara. A conversão para Brasília
 * é −3h fixas: o Brasil não tem horário de verão desde 2019, e uma tabela de fuso
 * completa para resolver uma subtração seria peso morto.
 */

export class CronError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CronError'
  }
}

export interface CamposCron {
  minutos: number[]
  horas: number[]
  /** `null` = `*`. A distinção importa: dia-do-mês e dia-da-semana se combinam por OU. */
  diasDoMes: number[] | null
  meses: number[]
  diasDaSemana: number[] | null
}

function parseCampo(texto: string, min: number, max: number, rotulo: string): number[] {
  const valores = new Set<number>()

  for (const parte of texto.split(',')) {
    const [alcance = '', passoTexto] = parte.split('/')
    const passo = passoTexto === undefined ? 1 : Number(passoTexto)
    if (!Number.isInteger(passo) || passo < 1) {
      throw new CronError(`Passo inválido em ${rotulo}: "${parte}".`)
    }

    let inicio: number
    let fim: number

    if (alcance === '*') {
      inicio = min
      fim = max
    } else if (alcance.includes('-')) {
      const [de = '', ate = ''] = alcance.split('-')
      // Number('') é 0 e Number('x') é NaN: a validação logo abaixo pega os dois.
      inicio = Number(de)
      fim = Number(ate)
    } else {
      inicio = Number(alcance)
      fim = passoTexto === undefined ? inicio : max
    }

    if (!Number.isInteger(inicio) || !Number.isInteger(fim) || inicio < min || fim > max || inicio > fim) {
      throw new CronError(`Valor fora da faixa em ${rotulo}: "${parte}" (esperado ${min}–${max}).`)
    }

    for (let v = inicio; v <= fim; v += passo) valores.add(v)
  }

  return [...valores].sort((a, b) => a - b)
}

export function parseCron(expressao: string): CamposCron {
  const campos = expressao.trim().split(/\s+/)
  if (campos.length !== 5) {
    throw new CronError(`Expressão cron precisa de 5 campos, veio com ${campos.length}: "${expressao}".`)
  }

  const [min = '', hora = '', dom = '', mes = '', dow = ''] = campos

  return {
    minutos: parseCampo(min, 0, 59, 'minutos'),
    horas: parseCampo(hora, 0, 23, 'horas'),
    diasDoMes: dom === '*' ? null : parseCampo(dom, 1, 31, 'dia do mês'),
    meses: parseCampo(mes, 1, 12, 'mês'),
    // 7 = domingo em alguns dialetos; normalizado para 0, como getUTCDay().
    diasDaSemana: dow === '*' ? null : parseCampo(dow, 0, 7, 'dia da semana').map((d) => d % 7),
  }
}

function diaCorresponde(campos: CamposCron, data: Date): boolean {
  if (!campos.meses.includes(data.getUTCMonth() + 1)) return false

  const porMes = campos.diasDoMes?.includes(data.getUTCDate()) ?? null
  const porSemana = campos.diasDaSemana?.includes(data.getUTCDay()) ?? null

  // Regra do cron: com os DOIS restritos, vale OU (não E). Nenhuma expressão nossa
  // faz isso hoje, mas a alternativa é acertar por acidente.
  if (porMes === null && porSemana === null) return true
  if (porMes === null) return porSemana as boolean
  if (porSemana === null) return porMes
  return porMes || porSemana
}

/**
 * A próxima vez que a expressão dispara, em UTC, estritamente depois de `agora`.
 * `null` para expressões que nunca ocorrem (31 de fevereiro), em vez de laço eterno.
 */
export function proximaExecucao(expressao: string, agora: Date): Date | null {
  const campos = parseCron(expressao)

  // Minuto cheio seguinte: um cron nunca dispara no meio do minuto.
  const d = new Date(
    Date.UTC(
      agora.getUTCFullYear(),
      agora.getUTCMonth(),
      agora.getUTCDate(),
      agora.getUTCHours(),
      agora.getUTCMinutes() + 1,
    ),
  )

  // 5 anos cobre até 29 de fevereiro; o que não couber aqui não existe.
  const limite = new Date(d.getTime() + 5 * 366 * 24 * 60 * 60 * 1000)

  while (d < limite) {
    if (!diaCorresponde(campos, d)) {
      // Pula o dia inteiro em vez de 1440 minutos um a um.
      d.setUTCDate(d.getUTCDate() + 1)
      d.setUTCHours(0, 0, 0, 0)
      continue
    }
    if (campos.horas.includes(d.getUTCHours()) && campos.minutos.includes(d.getUTCMinutes())) {
      return d
    }
    d.setUTCMinutes(d.getUTCMinutes() + 1)
  }

  return null
}

export type Cadencia = 'diaria' | 'semanal' | 'mensal' | 'outra'

export interface DescricaoCron {
  cadencia: Cadencia
  /** "Todo dia", "Todo dia 10", "Toda segunda-feira". */
  periodicidade: string
  /** Horários UTC, "HH:MM", em ordem. */
  horariosUtc: string[]
  /** Os mesmos horários em Brasília (UTC−3). */
  horariosBrasilia: string[]
  /** Algum horário cai no dia anterior em Brasília (ex.: 01:30 UTC = 22:30 BRT). */
  viraDia: boolean
}

const DIAS_SEMANA = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
]

function hhmm(hora: number, minuto: number): string {
  return `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`
}

function listar(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? ''
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`
}

/** Tradução para pt-BR. Não substitui a expressão na tela — acompanha. */
export function descreverCron(expressao: string): DescricaoCron {
  const campos = parseCron(expressao)

  const horarios = campos.horas.flatMap((h) => campos.minutos.map((m) => ({ h, m })))
  horarios.sort((a, b) => a.h - b.h || a.m - b.m)

  const brasilia = horarios.map(({ h, m }) => ({ h: (h + 24 - 3) % 24, m, virou: h < 3 }))

  const mensal = campos.diasDoMes !== null
  const semanal = !mensal && campos.diasDaSemana !== null

  const periodicidade = mensal
    ? `Todo dia ${listar(campos.diasDoMes!.map(String))}`
    : semanal
      ? `Toda ${listar(campos.diasDaSemana!.map((d) => DIAS_SEMANA[d] ?? String(d)))}`
      : 'Todo dia'

  return {
    cadencia: mensal ? 'mensal' : semanal ? 'semanal' : campos.meses.length === 12 ? 'diaria' : 'outra',
    periodicidade,
    horariosUtc: horarios.map(({ h, m }) => hhmm(h, m)),
    horariosBrasilia: brasilia.map(({ h, m }) => hhmm(h, m)),
    viraDia: brasilia.some((x) => x.virou),
  }
}

/**
 * É hoje o último dia do mês?
 *
 * Existe porque a expressão de cron não sabe dizer "último dia": os campos são
 * números, e `30` simplesmente nunca acontece em fevereiro. Um job que precisa do
 * último dia se agenda em `28-31` e pergunta isto — as outras passagens saem sem
 * fazer nada.
 *
 * O uso concreto é o aviso de custo dos protestos, e ele depende de uma coincidência
 * de calendário que vale sempre: o último dia de qualquer mês é exatamente cinco dias
 * antes do dia 5 do mês seguinte (31/08 → 05/09, 30/09 → 05/10, 28/02 → 05/03).
 */
export function ehUltimoDiaDoMes(d: Date): boolean {
  const amanha = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1))
  return amanha.getUTCDate() === 1
}
