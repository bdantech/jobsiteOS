/**
 * O bloco de Aquisição do report semanal (04u §2).
 *
 * Os números vêm prontos de `app__rp_aquisicao()` no banco, uma linha por origem. O que
 * mora aqui é o que as três superfícies precisam ler igual — os totais, os percentuais da
 * linha, o carimbo de quando foi lido — e a REGRA de classificação escrita em código
 * testável: `matrizDeLeads()` é o espelho de `app__rp_aq_leads` + `app__rp_aq_linhas`, e os
 * testes dela são a especificação que o SQL tem de cumprir.
 */
import {
  agregarSemanas,
  fechadasPorMes,
  naSemana,
  type AgregadoSemanas,
  type Semana,
} from './semanas.js'

export const ORIGENS_AQUISICAO = ['inbound', 'outbound', 'sem_origem'] as const
export type OrigemAquisicao = (typeof ORIGENS_AQUISICAO)[number]

export const FITS_AQUISICAO = ['com_fit', 'sem_fit', 'nao_avaliado'] as const
export type FitAquisicao = (typeof FITS_AQUISICAO)[number]

export const ORIGEM_AQUISICAO_LABELS: Record<OrigemAquisicao | 'total', string> = {
  inbound: 'Inbound',
  outbound: 'Outbound',
  sem_origem: 'Sem origem',
  total: 'Total',
}

export const FIT_AQUISICAO_LABELS: Record<FitAquisicao | 'total', string> = {
  com_fit: 'Com fit',
  sem_fit: 'Sem fit',
  nao_avaliado: 'Ainda não avaliado',
  total: 'Total',
}

/** Os fatos de reunião que o bloco conta. Cada um tem a sua data — ver `reunioes-janela.ts`. */
export const FATOS_REUNIAO = [
  'agendada', 'realizada', 'cancelada', 'remarcada', 'no_show', 'sem_captura', 'sem_desfecho',
] as const
export type FatoReuniao = (typeof FATOS_REUNIAO)[number]

/** O campo de `LinhaAquisicao` que guarda a contagem de cada fato. */
export const CAMPO_DO_FATO: Record<FatoReuniao, keyof ContagemReunioes> = {
  agendada: 'agendadas',
  realizada: 'realizadas',
  cancelada: 'canceladas',
  remarcada: 'remarcadas',
  no_show: 'no_shows',
  sem_captura: 'sem_captura',
  sem_desfecho: 'sem_desfecho',
}

export interface ContagemFit {
  com_fit: number
  sem_fit: number
  nao_avaliado: number
}

export interface ContagemReunioes {
  agendadas: number
  realizadas: number
  canceladas: number
  remarcadas: number
  no_shows: number
  sem_captura: number
  sem_desfecho: number
}

export interface LinhaAquisicao extends ContagemFit, ContagemReunioes {
  origem: OrigemAquisicao
  /** Dos não avaliados, quantos o sistema encerrou por expiração: não serão avaliados. */
  expirados_sem_avaliar: number
}

export interface BlocoAquisicao extends Semana {
  em_aberto: boolean
  /** Quando os números foram lidos. É o carimbo que explica a tela ≠ e-mail. */
  calculado_em: string
  origens: LinhaAquisicao[]
}

// ─── A regra de classificação ───────────────────────────────────────────────

/**
 * Outbound é tudo que NÃO é inbound — `distribuicao` e `manual` no banco. Origem nula não
 * é distribuída por chute entre as duas: vira "Sem origem", que é problema de cadastro.
 */
export function origemDoLead(origem: string | null | undefined): OrigemAquisicao {
  if (origem === null || origem === undefined || origem === '') return 'sem_origem'
  return origem === 'inbound' ? 'inbound' : 'outbound'
}

/**
 * Nulo é "ainda não avaliado", e NUNCA "sem fit".
 *
 * O lead que entrou na quinta e ninguém trabalhou não foi reprovado por ninguém. Se ele
 * caísse no balde de "sem fit", a semana corrente pareceria sempre pior que as fechadas —
 * e alguém tomaria decisão de canal em cima disso.
 */
export function fitDoLead(fit: boolean | null | undefined): FitAquisicao {
  if (fit === true) return 'com_fit'
  if (fit === false) return 'sem_fit'
  return 'nao_avaliado'
}

export interface LeadAquisicao {
  origem: string | null
  fit: boolean | null
  /** Quando ENTROU. É o que decide a semana; a data da avaliação não decide nada. */
  distribuido_em: string
}

/**
 * A matriz origem × fit da COORTE da janela: quem foi distribuído nela.
 *
 * O lead conta na semana em que ENTROU, com o fit que tem hoje. Um lead da semana 40
 * avaliado na 42 aparece na 40 como "com fit" — a pergunta é "do que entrou naquela
 * semana, o que se mostrou bom", e por isso a linha de uma semana fechada amadurece.
 */
export function matrizDeLeads(
  leads: readonly LeadAquisicao[],
  janela: Semana,
): Record<OrigemAquisicao, ContagemFit> {
  const m: Record<OrigemAquisicao, ContagemFit> = {
    inbound: { com_fit: 0, sem_fit: 0, nao_avaliado: 0 },
    outbound: { com_fit: 0, sem_fit: 0, nao_avaliado: 0 },
    sem_origem: { com_fit: 0, sem_fit: 0, nao_avaliado: 0 },
  }
  for (const l of leads) {
    if (!naSemana(l.distribuido_em, janela)) continue
    m[origemDoLead(l.origem)][fitDoLead(l.fit)] += 1
  }
  return m
}

// ─── O que as três superfícies leem ─────────────────────────────────────────

export interface LinhaMatriz extends ContagemFit {
  origem: OrigemAquisicao | 'total'
  total: number
  /** Percentual DA LINHA. `null` quando a linha é vazia: 0 de 0 não é 0%. */
  pct: Record<FitAquisicao, number | null>
}

const pct1 = (n: number, de: number): number | null =>
  de > 0 ? Math.round((n / de) * 1000) / 10 : null

function linhaDaMatriz(origem: LinhaMatriz['origem'], c: ContagemFit): LinhaMatriz {
  const total = c.com_fit + c.sem_fit + c.nao_avaliado
  return {
    origem, total,
    com_fit: c.com_fit, sem_fit: c.sem_fit, nao_avaliado: c.nao_avaliado,
    pct: {
      com_fit: pct1(c.com_fit, total),
      sem_fit: pct1(c.sem_fit, total),
      nao_avaliado: pct1(c.nao_avaliado, total),
    },
  }
}

const ZERO_REUNIOES: ContagemReunioes = {
  agendadas: 0, realizadas: 0, canceladas: 0, remarcadas: 0, no_shows: 0,
  sem_captura: 0, sem_desfecho: 0,
}

/** A soma das origens: a linha "Total" da matriz e das reuniões. */
export function totalDoBloco(b: Pick<BlocoAquisicao, 'origens'>): Omit<LinhaAquisicao, 'origem'> {
  const t = { com_fit: 0, sem_fit: 0, nao_avaliado: 0, expirados_sem_avaliar: 0, ...ZERO_REUNIOES }
  for (const o of b.origens) {
    for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += Number(o[k] ?? 0)
  }
  return t
}

/** As linhas da grade, na ordem de leitura, com a de Total no fim. */
export function matrizDoBloco(b: Pick<BlocoAquisicao, 'origens'>): LinhaMatriz[] {
  return [
    ...b.origens.map((o) => linhaDaMatriz(o.origem, o)),
    linhaDaMatriz('total', totalDoBloco(b)),
  ]
}

/** Há lead (ou reunião) sem origem? É o sinal de cadastro quebrado que o card mostra. */
export function temSemOrigem(b: Pick<BlocoAquisicao, 'origens'>): boolean {
  return b.origens.some((o) => o.origem === 'sem_origem')
}

/**
 * O carimbo do bloco, que é o que faz as duas vidas do report concordarem.
 *
 * Na tela ele recalcula a cada abertura; no PDF ele é o snapshot do envio. Sem o carimbo,
 * alguém abre o e-mail de segunda na quarta, compara com a tela e conclui que um dos dois
 * está errado. Com ele, a diferença se explica sozinha.
 */
export function carimboDaAquisicao(b: Pick<BlocoAquisicao, 'calculado_em'>, aoVivo: boolean): string {
  const d = new Date(b.calculado_em)
  if (Number.isNaN(d.getTime())) return aoVivo ? 'atualizado agora' : 'dados sem carimbo'
  const hora = d.toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
  })
  if (aoVivo) return `atualizado agora, às ${hora}`
  const dia = d.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
  })
  return `dados de ${dia} às ${hora}`
}

// ─── A série (04u §3) ───────────────────────────────────────────────────────

export const SERIES_AQUISICAO = [
  'inbound_com_fit', 'inbound_sem_fit', 'outbound_com_fit', 'outbound_sem_fit',
] as const
export type SerieAquisicao = (typeof SERIES_AQUISICAO)[number]

export const SERIE_AQUISICAO_LABELS: Record<SerieAquisicao, string> = {
  inbound_com_fit: 'Inbound com fit',
  inbound_sem_fit: 'Inbound sem fit',
  outbound_com_fit: 'Outbound com fit',
  outbound_sem_fit: 'Outbound sem fit',
}

/** De qual célula da matriz sai cada série — é o recorte que o ponto do gráfico abre. */
export const RECORTE_DA_SERIE: Record<SerieAquisicao, { origem: OrigemAquisicao; fit: FitAquisicao }> = {
  inbound_com_fit: { origem: 'inbound', fit: 'com_fit' },
  inbound_sem_fit: { origem: 'inbound', fit: 'sem_fit' },
  outbound_com_fit: { origem: 'outbound', fit: 'com_fit' },
  outbound_sem_fit: { origem: 'outbound', fit: 'sem_fit' },
}

export function valorDaCelula(b: Pick<BlocoAquisicao, 'origens'>, origem: OrigemAquisicao, fit: FitAquisicao): number {
  return b.origens.find((o) => o.origem === origem)?.[fit] ?? 0
}

export type PontoAquisicao = Semana & { em_aberto: boolean } & Record<SerieAquisicao, number>

/** Os pontos do gráfico, do mais antigo para o mais recente. A em aberto vem marcada. */
export function serieDeAquisicao(semanas: readonly BlocoAquisicao[]): PontoAquisicao[] {
  return [...semanas]
    .sort((a, b) => a.inicio.localeCompare(b.inicio))
    .map((s) => ({
      inicio: s.inicio, fim: s.fim, em_aberto: s.em_aberto,
      inbound_com_fit: valorDaCelula(s, 'inbound', 'com_fit'),
      inbound_sem_fit: valorDaCelula(s, 'inbound', 'sem_fit'),
      outbound_com_fit: valorDaCelula(s, 'outbound', 'com_fit'),
      outbound_sem_fit: valorDaCelula(s, 'outbound', 'sem_fit'),
    }))
}

export type CampoAquisicao = FitAquisicao | 'total_leads' | 'agendadas' | 'realizadas'

const campoDoBloco = (b: BlocoAquisicao, campo: CampoAquisicao): number => {
  const t = totalDoBloco(b)
  if (campo === 'total_leads') return t.com_fit + t.sem_fit + t.nao_avaliado
  return t[campo]
}

/**
 * Total e média de um campo sobre as semanas FECHADAS.
 *
 * Passa por `agregarSemanas`, que recusa a semana em aberto. Não há outro caminho de soma
 * neste módulo, e é de propósito.
 */
export function agregadoDeAquisicao(
  semanas: readonly BlocoAquisicao[],
  campo: CampoAquisicao,
): AgregadoSemanas {
  return agregarSemanas(semanas, (s) => campoDoBloco(s, campo))
}

/** O agregado mensal da aba "Últimos três meses": só semanas fechadas, pelo mês em que fecham. */
export function aquisicaoPorMes(
  semanas: readonly BlocoAquisicao[],
): ({ mes: string; semanas: number } & Record<CampoAquisicao, number>)[] {
  return fechadasPorMes(semanas).map(({ mes, semanas: lista }) => ({
    mes,
    semanas: lista.length,
    com_fit: lista.reduce((s, x) => s + campoDoBloco(x, 'com_fit'), 0),
    sem_fit: lista.reduce((s, x) => s + campoDoBloco(x, 'sem_fit'), 0),
    nao_avaliado: lista.reduce((s, x) => s + campoDoBloco(x, 'nao_avaliado'), 0),
    total_leads: lista.reduce((s, x) => s + campoDoBloco(x, 'total_leads'), 0),
    agendadas: lista.reduce((s, x) => s + campoDoBloco(x, 'agendadas'), 0),
    realizadas: lista.reduce((s, x) => s + campoDoBloco(x, 'realizadas'), 0),
  }))
}
