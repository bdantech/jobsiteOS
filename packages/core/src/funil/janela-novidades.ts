import { z } from 'zod'
import { instanteNoFuso } from '../agentes/agenda.js'
import { FUSO_BRASILIA, diaNoFuso } from './sync-plano.js'

/**
 * A JANELA DE NOVIDADES do funil (04t) — "o que entrou desde a última vez que eu
 * trabalhei".
 *
 * ── A REGRA É UMA SÓ ────────────────────────────────────────────────────────
 * O pedido era "as últimas 6 horas, e na segunda-feira desde sexta". A exceção é a
 * regra: o originador quer o que chegou desde o FIM DO ÚLTIMO EXPEDIENTE ÚTIL. Um
 * `agora - 6h` com um `if` para segunda acerta a segunda e erra todo feriado
 * emendado, ponto facultativo e véspera de Natal.
 *
 *   início = o maior instante T tal que T = (dia D às `expediente_fim`),
 *            com D dia útil e T < agora.
 *
 * Segunda 09:00 dá sexta 18:00; sexta 20:00 dá a própria sexta 18:00; segunda depois
 * de feriado emendado dá quinta 18:00 — sem caso especial nenhum.
 *
 * ── O FUSO ──────────────────────────────────────────────────────────────────
 * Tudo é calculado em `America/Sao_Paulo` e convertido para UTC só na borda. O
 * contrário (somar horas a um instante UTC) pula ou duplica uma hora na virada do
 * horário de verão. O Brasil não tem um desde 2019, mas a conta não depende disso.
 *
 * ── A LIMITAÇÃO, DITA EM VOZ ALTA ───────────────────────────────────────────
 * A janela segue o calendário da EMPRESA, não a presença de cada pessoa. Quem volta
 * de férias ou de folga não tem a janela esticada — para isso existe o intervalo
 * personalizado. Não se infere ausência individual aqui.
 */

// ─── Config ─────────────────────────────────────────────────────────────────

const horaSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.')

export const configNovidadesSchema = z
  .object({
    expediente_inicio: horaSchema.default('09:00'),
    expediente_fim: horaSchema.default('18:00'),
    /** Quanto tempo longe do funil faz a próxima abertura contar como visita nova. */
    minutos_para_avancar_marcador: z.number().int().min(1).max(720).default(30),
  })
  .refine((c) => c.expediente_inicio < c.expediente_fim, {
    message: 'O expediente precisa terminar depois de começar.',
    path: ['expediente_fim'],
  })

export type ConfigNovidades = z.infer<typeof configNovidadesSchema>

export const CONFIG_NOVIDADES_PADRAO: ConfigNovidades = configNovidadesSchema.parse({})

/** Config vinda do banco: o que estiver torto volta ao padrão em vez de quebrar a tela. */
export function lerConfigNovidades(valor: unknown): ConfigNovidades {
  const r = configNovidadesSchema.safeParse(valor ?? {})
  return r.success ? r.data : CONFIG_NOVIDADES_PADRAO
}

// ─── Calendário ─────────────────────────────────────────────────────────────

export const ESCOPOS_DIA_NAO_UTIL = ['nacional', 'estadual', 'municipal', 'empresa'] as const
export type EscopoDiaNaoUtil = (typeof ESCOPOS_DIA_NAO_UTIL)[number]

export const ESCOPO_DIA_NAO_UTIL_LABELS: Record<EscopoDiaNaoUtil, string> = {
  nacional: 'Nacional',
  estadual: 'Estadual',
  municipal: 'Municipal',
  empresa: 'Ponto facultativo da empresa',
}

export const diaNaoUtilSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data.'),
  nome: z.string().trim().min(2, 'Dê um nome ao dia.').max(120),
  escopo: z.enum(ESCOPOS_DIA_NAO_UTIL).default('empresa'),
  uf: z.string().trim().length(2).optional().or(z.literal('')),
  municipio: z.string().trim().max(120).optional().or(z.literal('')),
})
export type DiaNaoUtilInput = z.infer<typeof diaNaoUtilSchema>

export interface CalendarioNovidades {
  /** `YYYY-MM-DD` de tudo que não tem expediente além do fim de semana. */
  diasNaoUteis: ReadonlySet<string>
  /**
   * Os anos para os quais os feriados nacionais foram importados. Um dia caminhado
   * fora deles significa "posso ter pulado um feriado que não conheço".
   */
  anosCobertos: ReadonlySet<number>
}

/** Calendário vazio: só o fim de semana conta. É o chão quando a BrasilAPI nunca respondeu. */
export const CALENDARIO_SO_FIM_DE_SEMANA: CalendarioNovidades = {
  diasNaoUteis: new Set(),
  anosCobertos: new Set(),
}

export function montarCalendario(
  linhas: readonly { data: string; origem?: string | null }[] | null | undefined,
): CalendarioNovidades {
  const dias = new Set<string>()
  const anos = new Set<number>()
  for (const l of linhas ?? []) {
    const dia = String(l.data).slice(0, 10)
    dias.add(dia)
    if (l.origem === 'brasilapi') anos.add(Number(dia.slice(0, 4)))
  }
  return { diasNaoUteis: dias, anosCobertos: anos }
}

// ─── Datas no fuso ──────────────────────────────────────────────────────────

/**
 * O instante em que o relógio de parede do fuso marca `dia` às `hora`.
 *
 * A conversão é a mesma da agenda dos agentes (`agentes/agenda.ts`), que já acerta as
 * viradas de horário de verão — aqui só muda a forma de pedir.
 */
export function instanteDoExpediente(dia: string, hora: string, timezone: string = FUSO_BRASILIA): Date {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number]
  const [h, min] = hora.split(':').map(Number) as [number, number]
  return instanteNoFuso(a, m, d, h, min, timezone)
}

function diaAnterior(dia: string): string {
  const d = new Date(`${dia}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** 0 = domingo … 6 = sábado, do DIA CIVIL — sem passar por fuso nenhum. */
function diaDaSemana(dia: string): number {
  return new Date(`${dia}T00:00:00Z`).getUTCDay()
}

export function temExpediente(dia: string, cal: CalendarioNovidades): boolean {
  const semana = diaDaSemana(dia)
  return semana !== 0 && semana !== 6 && !cal.diasNaoUteis.has(dia)
}

// ─── O cálculo ──────────────────────────────────────────────────────────────

/** Até onde se anda para trás atrás de um dia útil. Dois meses sem expediente não existem. */
const MAX_DIAS_PARA_TRAS = 60

export interface InicioDaJanela {
  inicio: Date
  /**
   * `false` quando algum dia caminhado caiu num ano sem feriados importados: a janela
   * saiu só com fim de semana e cadastro manual, e a tela precisa AVISAR.
   */
  feriadosConsiderados: boolean
}

export function calcularInicioDaJanela(
  agora: Date,
  cal: CalendarioNovidades,
  cfg: Pick<ConfigNovidades, 'expediente_fim'>,
  timezone: string = FUSO_BRASILIA,
): InicioDaJanela {
  let dia = diaNoFuso(agora, timezone)
  let feriadosConsiderados = true

  for (let i = 0; i < MAX_DIAS_PARA_TRAS; i++) {
    if (!cal.anosCobertos.has(Number(dia.slice(0, 4)))) feriadosConsiderados = false
    if (temExpediente(dia, cal)) {
      const fim = instanteDoExpediente(dia, cfg.expediente_fim, timezone)
      // Estritamente antes: às 18:00 em ponto o expediente de hoje ainda não "acabou
      // antes de agora", e a janela seria de zero segundos.
      if (fim.getTime() < agora.getTime()) return { inicio: fim, feriadosConsiderados }
    }
    dia = diaAnterior(dia)
  }

  // Nunca uma janela vazia: um calendário absurdo devolve os dois meses caminhados.
  return {
    inicio: new Date(agora.getTime() - MAX_DIAS_PARA_TRAS * 86_400_000),
    feriadosConsiderados: false,
  }
}

/** O início da janela default. Ver o cabeçalho do arquivo para a regra. */
export function inicioJanelaNovidades(
  agora: Date,
  cal: CalendarioNovidades,
  cfg: Pick<ConfigNovidades, 'expediente_fim'>,
  timezone: string = FUSO_BRASILIA,
): Date {
  return calcularInicioDaJanela(agora, cal, cfg, timezone).inicio
}

// ─── As opções do seletor ───────────────────────────────────────────────────

export const OPCOES_NOVIDADES = ['expediente', 'seis_horas', 'hoje', 'sete_dias', 'personalizado'] as const
export type OpcaoNovidades = (typeof OPCOES_NOVIDADES)[number]

export const OPCAO_NOVIDADES_LABELS: Record<OpcaoNovidades, string> = {
  expediente: 'Desde meu último expediente',
  seis_horas: 'Últimas 6 horas',
  hoje: 'Hoje',
  sete_dias: 'Últimos 7 dias',
  personalizado: 'Personalizado',
}

export interface JanelaNovidades {
  opcao: OpcaoNovidades
  de: Date
  /** `null` = até agora. Só o personalizado fecha a ponta. */
  ate: Date | null
  /** Só a opção do expediente lê o calendário; nas outras é sempre `true`. */
  feriadosConsiderados: boolean
}

export interface IntervaloPersonalizado {
  de?: Date | null
  ate?: Date | null
}

/**
 * A janela de cada opção. Devolve `null` só no personalizado ainda sem data inicial —
 * um intervalo pela metade não é um filtro.
 */
export function resolverJanelaNovidades(
  opcao: OpcaoNovidades,
  agora: Date,
  cal: CalendarioNovidades,
  cfg: ConfigNovidades,
  personalizado?: IntervaloPersonalizado,
  timezone: string = FUSO_BRASILIA,
): JanelaNovidades | null {
  switch (opcao) {
    case 'expediente': {
      const r = calcularInicioDaJanela(agora, cal, cfg, timezone)
      return { opcao, de: r.inicio, ate: null, feriadosConsiderados: r.feriadosConsiderados }
    }
    case 'seis_horas':
      return { opcao, de: new Date(agora.getTime() - 6 * 3_600_000), ate: null, feriadosConsiderados: true }
    case 'hoje': {
      const hoje = diaNoFuso(agora, timezone)
      const abertura = instanteDoExpediente(hoje, cfg.expediente_inicio, timezone)
      // Antes de o expediente abrir, "hoje" começa à meia-noite: às 07:30 a janela
      // não pode começar às 09:00 de um dia que ainda não chegou lá.
      const de = abertura.getTime() <= agora.getTime() ? abertura : instanteDoExpediente(hoje, '00:00', timezone)
      return { opcao, de, ate: null, feriadosConsiderados: true }
    }
    case 'sete_dias':
      return { opcao, de: new Date(agora.getTime() - 7 * 86_400_000), ate: null, feriadosConsiderados: true }
    case 'personalizado': {
      const de = personalizado?.de
      if (!de || Number.isNaN(de.getTime())) return null
      const ate = personalizado?.ate && !Number.isNaN(personalizado.ate.getTime()) ? personalizado.ate : null
      if (ate && ate.getTime() <= de.getTime()) return null
      return { opcao, de, ate, feriadosConsiderados: true }
    }
  }
}

/**
 * `10/10/2026 18:00` (ou só `10/10/2026`, que vale 00:00) → o instante, em Brasília.
 *
 * É o intervalo personalizado do CELULAR, que não tem seletor de data e hora: o campo
 * é texto, e texto pela metade devolve `null` em vez de uma data inventada.
 */
export function lerDataHoraDigitada(texto: string, timezone: string = FUSO_BRASILIA): Date | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?\s*$/.exec(texto)
  if (!m) return null
  const [dia, mes, ano, hora, minuto] = [m[1], m[2], m[3], m[4] ?? '0', m[5] ?? '0'].map(Number) as [
    number, number, number, number, number,
  ]
  if (mes < 1 || mes > 12 || dia < 1 || hora > 23 || minuto > 59) return null
  // 31/02 não existe: o Date rolaria para março em silêncio.
  if (dia > new Date(Date.UTC(ano, mes, 0)).getUTCDate()) return null
  return instanteNoFuso(ano, mes, dia, hora, minuto, timezone)
}

// ─── O texto ────────────────────────────────────────────────────────────────

const DIAS_DA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const

function partesNoFuso(instante: Date, timezone: string) {
  const dia = diaNoFuso(instante, timezone)
  const hora = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).format(instante)
  return { dia, hora, ddmm: `${dia.slice(8, 10)}/${dia.slice(5, 7)}`, semana: DIAS_DA_SEMANA[diaDaSemana(dia)]! }
}

/** "sexta, 10/10, às 18:00" — ou "hoje às 09:00" / "ontem, 11/10, às 18:00". */
export function descreverInstante(instante: Date, agora: Date, timezone: string = FUSO_BRASILIA): string {
  const p = partesNoFuso(instante, timezone)
  const hoje = diaNoFuso(agora, timezone)
  if (p.dia === hoje) return `hoje às ${p.hora}`
  if (p.dia === diaAnterior(hoje)) return `ontem, ${p.ddmm}, às ${p.hora}`
  return `${p.semana}, ${p.ddmm}, às ${p.hora}`
}

/**
 * A janela por extenso: "Mostrando o que entrou desde sexta, 10/10, às 18:00 — 23 itens".
 *
 * Janela calculada em silêncio é janela em que ninguém confia; escrita assim, o
 * originador confere sozinho se a conta bate.
 */
export function descreverJanela(
  janela: Pick<JanelaNovidades, 'de' | 'ate'>,
  agora: Date,
  total?: number | null,
  timezone: string = FUSO_BRASILIA,
): string {
  const periodo = janela.ate
    ? `entre ${descreverInstante(janela.de, agora, timezone)} e ${descreverInstante(janela.ate, agora, timezone)}`
    : `desde ${descreverInstante(janela.de, agora, timezone)}`
  const quantos =
    typeof total === 'number' ? ` — ${total.toLocaleString('pt-BR')} ${total === 1 ? 'item' : 'itens'}` : ''
  return `Mostrando o que entrou ${periodo}${quantos}`
}

/** "entrou há 2h" / "entrou ontem 19:40" / "entrou sexta 19:40" / "entrou em 03/10". */
export function textoDeEntrada(
  novidadeEm: string | Date | null | undefined,
  agora: Date,
  timezone: string = FUSO_BRASILIA,
): string | null {
  if (!novidadeEm) return null
  const quando = novidadeEm instanceof Date ? novidadeEm : new Date(novidadeEm)
  if (Number.isNaN(quando.getTime())) return null

  const minutos = Math.floor((agora.getTime() - quando.getTime()) / 60_000)
  if (minutos < 1) return 'entrou agora'
  if (minutos < 60) return `entrou há ${minutos} min`
  if (minutos < 12 * 60) return `entrou há ${Math.floor(minutos / 60)}h`

  const p = partesNoFuso(quando, timezone)
  const hoje = diaNoFuso(agora, timezone)
  if (p.dia === hoje) return `entrou hoje ${p.hora}`
  if (p.dia === diaAnterior(hoje)) return `entrou ontem ${p.hora}`
  if (minutos < 7 * 24 * 60) return `entrou ${p.semana} ${p.hora}`
  return `entrou em ${p.ddmm}`
}

// ─── A reentrada ────────────────────────────────────────────────────────────

export const MOTIVOS_REENTRADA = ['carteira', 'sacado_aprovado', 'operavel'] as const
export type MotivoReentrada = (typeof MOTIVOS_REENTRADA)[number]

export const MOTIVO_REENTRADA_LABELS: Record<MotivoReentrada, string> = {
  carteira: 'entrou na sua carteira',
  sacado_aprovado: 'sacado aprovado',
  operavel: 'passou a ser operável',
}

/**
 * "voltou ao funil: sacado aprovado". Um item com emissão antiga aparecendo como novo
 * sem explicação parece bug — o motivo é o que faz ele parecer o que é.
 */
export function textoDeReentrada(
  reentrouEm: string | null | undefined,
  motivo: string | null | undefined,
): string | null {
  if (!reentrouEm) return null
  const label = MOTIVO_REENTRADA_LABELS[motivo as MotivoReentrada]
  return label ? `voltou ao funil: ${label}` : 'voltou ao funil'
}

// ─── O selo "novo" ──────────────────────────────────────────────────────────

/**
 * Novo = entrou DEPOIS da visita anterior. Compara com o marcador anterior, e não com
 * o da visita atual, para o selo ficar estável durante a sessão.
 */
export function ehNovoDesdeAVisita(
  novidadeEm: string | null | undefined,
  vistoAnterior: string | null | undefined,
): boolean {
  if (!novidadeEm || !vistoAnterior) return false
  return new Date(novidadeEm).getTime() > new Date(vistoAnterior).getTime()
}

// ─── A tool (§8) ────────────────────────────────────────────────────────────

export const novidadesFunilSchema = z.object({
  janela: z
    .enum(['expediente', 'seis_horas', 'hoje', 'sete_dias'])
    .default('expediente')
    .describe(
      'expediente = desde o fim do último expediente útil (segunda de manhã traz desde sexta 18h); ' +
        'seis_horas, hoje e sete_dias são janelas fixas.',
    ),
  desde: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe('Início explícito da janela (ISO com fuso). Quando vem, vence `janela`.'),
})
export type NovidadesFunilInput = z.infer<typeof novidadesFunilSchema>

/** O que `funil_novidades_resumo` devolve. */
export interface ResumoNovidades {
  total: number
  valor: number
  por_tipo: { tipo: string; qtd: number; valor: number }[]
  por_vendedor: { vendedor_id: string | null; nome: string | null; qtd: number; valor: number }[]
}

export const RESUMO_NOVIDADES_VAZIO: ResumoNovidades = { total: 0, valor: 0, por_tipo: [], por_vendedor: [] }

export function lerResumoNovidades(bruto: unknown): ResumoNovidades {
  const r = (bruto ?? {}) as Partial<ResumoNovidades>
  return {
    total: Number(r.total ?? 0),
    valor: Number(r.valor ?? 0),
    por_tipo: (r.por_tipo ?? []).map((t) => ({ tipo: String(t.tipo), qtd: Number(t.qtd), valor: Number(t.valor) })),
    por_vendedor: (r.por_vendedor ?? []).map((v) => ({
      vendedor_id: v.vendedor_id ?? null,
      nome: v.nome ?? null,
      qtd: Number(v.qtd),
      valor: Number(v.valor),
    })),
  }
}
