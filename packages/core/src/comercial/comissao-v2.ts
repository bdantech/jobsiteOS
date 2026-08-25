/**
 * Motor de comissões v2 (04k) — VOP, parâmetros versionados e lançamento determinístico.
 *
 * Três ideias sustentam o arquivo inteiro, e nenhuma delas é óbvia até alguém contestar
 * a folha:
 *
 *   O FATO GERADOR É A CESSÃO, NÃO A LIQUIDAÇÃO. Vendedor e originador não correm risco
 *   de crédito: a comissão nasce quando a NF converte. Recompra e inadimplência não
 *   geram estorno; só geram os dois casos em que a cessão deixa de existir.
 *
 *   A UNIDADE É O VOP, NÃO O VALOR CEDIDO. `valor × dias / 30`. Uma antecipação de 45
 *   dias imobiliza uma vez e meia o que uma de 30 imobiliza — pagar as duas igual
 *   premiaria, na mesma medida, a operação barata e a cara para nós.
 *
 *   TUDO É UMA AFIRMAÇÃO SOBRE UMA DATA. O parâmetro que valia naquele dia, a
 *   classificação que valia naquele dia, o titular que era titular naquele dia. Um
 *   sistema que responde "hoje" às três paga a pessoa errada, com o valor errado, e
 *   parece certo até o dia em que alguém confere.
 *
 * Por isso este módulo é PURO: nada aqui lê banco. Ele recebe o que aconteceu e devolve
 * o que deve ser lançado — e é isso que torna cada caso de borda do §8 um teste de três
 * linhas em vez de um ambiente de integração.
 */

import type { GestaoOperacao } from './schemas.js'

// ─── Vocabulário ────────────────────────────────────────────────────────────

export const PAPEIS_COMISSAO = ['VENDEDOR', 'ORIGINADOR', 'SDR'] as const
export type PapelComissao = (typeof PAPEIS_COMISSAO)[number]

export const PAPEL_COMISSAO_LABELS: Record<PapelComissao, string> = {
  VENDEDOR: 'Vendedor',
  ORIGINADOR: 'Originador',
  SDR: 'SDR',
}

export const FASES_CONTA = ['CRESCIMENTO', 'MANUTENCAO', 'RESIDUAL'] as const
export type FaseConta = (typeof FASES_CONTA)[number]

export const FASE_CONTA_LABELS: Record<FaseConta, string> = {
  CRESCIMENTO: 'Crescimento',
  MANUTENCAO: 'Manutenção',
  RESIDUAL: 'Residual',
}

export const FASE_CONTA_DESCRICOES: Record<FaseConta, string> = {
  CRESCIMENTO: 'A conta ainda está sendo construída — é a fase que paga mais.',
  MANUTENCAO: 'A conta já opera sozinha; o trabalho é mantê-la.',
  RESIDUAL: 'Passou do sunset do vendedor: ele não recebe mais. O originador segue.',
}

export const ORIGENS_LANCAMENTO_V2 = [
  'nf_convertida',
  'sdr_reuniao',
  'sdr_conta_fechada',
  'estorno',
  'ajuste_manual',
] as const
export type OrigemLancamentoV2 = (typeof ORIGENS_LANCAMENTO_V2)[number]

export const ORIGEM_LANCAMENTO_V2_LABELS: Record<OrigemLancamentoV2, string> = {
  nf_convertida: 'NF convertida',
  sdr_reuniao: 'Reunião aceita',
  sdr_conta_fechada: 'Conta fechada',
  estorno: 'Estorno',
  ajuste_manual: 'Ajuste manual',
}

export const STATUS_LANCAMENTO_V2 = [
  'provisionado',
  'fechado',
  'aprovado',
  'pago',
  'estornado',
] as const
export type StatusLancamentoV2 = (typeof STATUS_LANCAMENTO_V2)[number]

export const STATUS_LANCAMENTO_V2_LABELS: Record<StatusLancamentoV2, string> = {
  provisionado: 'Provisionado',
  fechado: 'Fechado',
  aprovado: 'Aprovado',
  pago: 'Pago',
  estornado: 'Estornado',
}

export const STATUS_COMPETENCIA = ['aberta', 'fechada', 'aprovada', 'paga'] as const
export type StatusCompetencia = (typeof STATUS_COMPETENCIA)[number]

export const STATUS_COMPETENCIA_LABELS: Record<StatusCompetencia, string> = {
  aberta: 'Aberta',
  fechada: 'Fechada',
  aprovada: 'Aprovada',
  paga: 'Paga',
}

export const UNIDADES_PARAMETRO = [
  'BRL_PER_MM',
  'BRL',
  'MONTHS',
  'DAYS',
  'HOURS',
  'PERCENT',
  'BOOL',
  'MULTIPLIER',
] as const
export type UnidadeParametro = (typeof UNIDADES_PARAMETRO)[number]

export const UNIDADE_PARAMETRO_SUFIXO: Record<UnidadeParametro, string> = {
  BRL_PER_MM: 'R$/MM',
  BRL: 'R$',
  MONTHS: 'meses',
  DAYS: 'dias',
  HOURS: 'horas',
  PERCENT: '%',
  BOOL: '',
  MULTIPLIER: '×',
}

// ─── O catálogo de parâmetros ───────────────────────────────────────────────
//
// Existe para a tela poder listar TODOS os parâmetros — inclusive os que ninguém
// publicou ainda e os que estão desligados. Uma tela que só mostra o que já foi
// publicado esconde justamente o parâmetro esquecido, que é o que causa a folha errada.

export interface ParametroCatalogado {
  chave: string
  rotulo: string
  unidade: UnidadeParametro
  grupo: 'calculo' | 'taxas' | 'fases' | 'sdr' | 'titularidade' | 'sinalizadores' | 'desligados'
  /** Taxas aceitam override por vendedor. PRAZO é sempre geral (§2). */
  aceitaOverride: boolean
  descricao: string
  /** Ligado a uma flag desativada (§11). A tela mostra, mas não deixa publicar. */
  desativado?: boolean
}

export const PARAMETROS_COMISSAO: readonly ParametroCatalogado[] = [
  {
    chave: 'dias_referencia_vop',
    rotulo: 'Dias de referência do VOP',
    unidade: 'DAYS',
    grupo: 'calculo',
    aceitaOverride: false,
    descricao:
      'O denominador de `valor × dias / N`. Mudar isto reprecifica TODA cessão futura de '
      + 'todos os papéis — é o parâmetro mais sensível do sistema.',
  },
  {
    chave: 'orig_prospeccao_ativa',
    rotulo: 'Originador — conta em prospecção ativa',
    unidade: 'BRL_PER_MM',
    grupo: 'taxas',
    aceitaOverride: true,
    descricao: 'Por milhão de VOP das cessões do cedente que ele titulariza.',
  },
  {
    chave: 'orig_passivo',
    rotulo: 'Originador — conta passiva',
    unidade: 'BRL_PER_MM',
    grupo: 'taxas',
    aceitaOverride: true,
    descricao:
      'Igual à ativa por padrão: o trabalho do originador é o mesmo dos dois lados. Quem '
      + 'muda de valor conforme a conta é o vendedor.',
  },
  {
    chave: 'vend_prospeccao_ativa_crescimento',
    rotulo: 'Vendedor — ativa, crescimento',
    unidade: 'BRL_PER_MM',
    grupo: 'taxas',
    aceitaOverride: true,
    descricao: 'Conta que só opera com trabalho do originador, nos primeiros meses.',
  },
  {
    chave: 'vend_prospeccao_ativa_manutencao',
    rotulo: 'Vendedor — ativa, manutenção',
    unidade: 'BRL_PER_MM',
    grupo: 'taxas',
    aceitaOverride: true,
    descricao: 'A mesma conta depois da fase de crescimento e antes do sunset.',
  },
  {
    chave: 'vend_passivo_crescimento',
    rotulo: 'Vendedor — passivo, crescimento',
    unidade: 'BRL_PER_MM',
    grupo: 'taxas',
    aceitaOverride: true,
    descricao: 'Conta cujo sacado traz operação sozinho, nos primeiros meses.',
  },
  {
    chave: 'vend_passivo_manutencao',
    rotulo: 'Vendedor — passivo, manutenção',
    unidade: 'BRL_PER_MM',
    grupo: 'taxas',
    aceitaOverride: true,
    descricao: 'A menor taxa do sistema: conta madura que opera sem esforço comercial.',
  },
  {
    chave: 'fase_crescimento_prospeccao_ativa_meses',
    rotulo: 'Fase de crescimento — ativa',
    unidade: 'MONTHS',
    grupo: 'fases',
    aceitaOverride: false,
    descricao: 'Meses desde o marco de ativação em que a conta ainda paga taxa de crescimento.',
  },
  {
    chave: 'fase_crescimento_passivo_meses',
    rotulo: 'Fase de crescimento — passivo',
    unidade: 'MONTHS',
    grupo: 'fases',
    aceitaOverride: false,
    descricao: 'O mesmo, para conta passiva.',
  },
  {
    chave: 'sunset_vendedor_prospeccao_ativa_meses',
    rotulo: 'Sunset do vendedor — ativa',
    unidade: 'MONTHS',
    grupo: 'fases',
    aceitaOverride: false,
    descricao: 'Depois disto a conta entra em RESIDUAL: o vendedor não recebe mais.',
  },
  {
    chave: 'sunset_vendedor_passivo_meses',
    rotulo: 'Sunset do vendedor — passivo',
    unidade: 'MONTHS',
    grupo: 'fases',
    aceitaOverride: false,
    descricao: 'Mais curto que o da ativa: manter conta passiva exige menos ao longo do tempo.',
  },
  {
    chave: 'sunset_originador_meses',
    rotulo: 'Sunset do originador',
    unidade: 'MONTHS',
    grupo: 'fases',
    aceitaOverride: false,
    descricao:
      'AUSENTE por padrão, e ausência aqui significa SEM SUNSET — quem originou a relação '
      + 'continua recebendo por ela. Publicar um valor liga o corte.',
  },
  {
    chave: 'sdr_valor_reuniao',
    rotulo: 'SDR — reunião aceita',
    unidade: 'BRL',
    grupo: 'sdr',
    aceitaOverride: true,
    descricao: 'Valor fixo, na reunião ACEITA pelo vendedor (ou aceita por decurso de prazo).',
  },
  {
    chave: 'sdr_valor_conta_fechada',
    rotulo: 'SDR — conta fechada',
    unidade: 'BRL',
    grupo: 'sdr',
    aceitaOverride: true,
    descricao: 'Na primeira NF convertida do sacado, se a reunião aceita cabe na janela.',
  },
  {
    chave: 'sdr_sla_recusa_horas',
    rotulo: 'SLA de recusa da reunião',
    unidade: 'HOURS',
    grupo: 'sdr',
    aceitaOverride: false,
    descricao: 'Sem ação nesse prazo, a reunião conta como aceita.',
  },
  {
    chave: 'janela_atribuicao_sdr_dias',
    rotulo: 'Janela de atribuição do SDR',
    unidade: 'DAYS',
    grupo: 'sdr',
    aceitaOverride: false,
    descricao: 'Quanto tempo depois da reunião aceita o fechamento ainda é creditado a ela.',
  },
  {
    chave: 'dormencia_cedente_dias',
    rotulo: 'Dormência do cedente',
    unidade: 'DAYS',
    grupo: 'titularidade',
    aceitaOverride: false,
    descricao: 'Cedente sem conversão nesse prazo volta ao pool e perde o titular.',
  },
  {
    chave: 'alerta_revisao_dias',
    rotulo: 'Janela do alerta de revisão',
    unidade: 'DAYS',
    grupo: 'sinalizadores',
    aceitaOverride: false,
    descricao: 'Período recente comparado com a média dos três meses anteriores.',
  },
  {
    chave: 'alerta_revisao_percentual',
    rotulo: 'Piso do alerta de revisão',
    unidade: 'PERCENT',
    grupo: 'sinalizadores',
    aceitaOverride: false,
    descricao:
      'Abaixo disso a conta passiva é SINALIZADA para revisão. Sinalizador, nunca '
      + 'automação: reclassificar sozinho é mudar a comissão de alguém sem avisar.',
  },
  {
    chave: 'premio_transicao_multiplo',
    rotulo: 'Prêmio de transição',
    unidade: 'MULTIPLIER',
    grupo: 'desligados',
    aceitaOverride: false,
    desativado: true,
    descricao: 'Fora de escopo (§11). Existe aqui para ser revisado, não para ser usado.',
  },
  {
    chave: 'carencia_migracao_dias',
    rotulo: 'Carência de migração',
    unidade: 'DAYS',
    grupo: 'desligados',
    aceitaOverride: false,
    desativado: true,
    descricao: 'Fora de escopo (§11).',
  },
  {
    chave: 'reativacao_dormente_dias',
    rotulo: 'Reativação de dormente',
    unidade: 'DAYS',
    grupo: 'desligados',
    aceitaOverride: false,
    desativado: true,
    descricao: 'Fora de escopo (§11).',
  },
]

export const GRUPO_PARAMETRO_LABELS: Record<ParametroCatalogado['grupo'], string> = {
  calculo: 'Unidade de cálculo',
  taxas: 'Taxas por papel',
  fases: 'Fases e sunset',
  sdr: 'SDR',
  titularidade: 'Titularidade',
  sinalizadores: 'Sinalizadores',
  desligados: 'Desativados (fora de escopo)',
}

// ─── Resolução de parâmetro ─────────────────────────────────────────────────

export interface CommissionParam {
  id: string
  chave: string
  /** null = parâmetro geral da empresa. */
  vendedor_id: string | null
  valor: number
  unidade: string
  vigente_de: string
  /** EXCLUSIVO: o primeiro dia que já NÃO vale. null = sem fim. */
  vigente_ate: string | null
}

/** Só a data importa para vigência: comissão não tem hora. */
export function dia(d: Date | string): string {
  return typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)
}

/**
 * O parâmetro que valia para este vendedor NAQUELE dia.
 *
 * Override pessoal vence o geral. Não há desempate entre dois do mesmo escopo porque a
 * exclusion constraint do banco torna isso impossível — e um desempate aqui seria um
 * lugar a mais para a resposta divergir da do SQL.
 */
export function resolverParametro(
  params: readonly CommissionParam[],
  chave: string,
  vendedorId: string | null,
  data: Date | string,
): CommissionParam | null {
  const d = dia(data)
  const vigentes = params.filter(
    (p) =>
      p.chave === chave &&
      dia(p.vigente_de) <= d &&
      (p.vigente_ate === null || dia(p.vigente_ate) > d),
  )
  if (vigentes.length === 0) return null
  const pessoal = vendedorId ? vigentes.find((p) => p.vendedor_id === vendedorId) : undefined
  return pessoal ?? vigentes.find((p) => p.vendedor_id === null) ?? null
}

/** O número, ou `null` quando o parâmetro não existe naquela data. Ausência é um valor. */
export function valorParametro(
  params: readonly CommissionParam[],
  chave: string,
  vendedorId: string | null,
  data: Date | string,
): number | null {
  const p = resolverParametro(params, chave, vendedorId, data)
  if (!p) return null
  const n = Number(p.valor)
  return Number.isFinite(n) ? n : null
}

// ─── Classificação e fase ───────────────────────────────────────────────────

export interface MudancaGestao {
  valor_anterior: string | null
  valor_novo: string
  alterado_em: string
}

/**
 * A classificação que valia numa data — com a regra do §8: mudança feita no dia D só
 * vale a partir de D+1.
 *
 * Sem essa véspera, uma conta reclassificada de manhã precificaria pela taxa nova as
 * cessões que converteram à tarde do MESMO dia, e a pessoa que trabalhou o mês inteiro
 * sob a régua antiga descobriria a mudança na folha.
 */
export function gestaoNaData(
  atual: GestaoOperacao | null,
  historico: readonly MudancaGestao[],
  data: Date | string,
): GestaoOperacao | null {
  const d = dia(data)
  const normalizar = (v: string | null): GestaoOperacao | null =>
    v === 'prospeccao_ativa' || v === 'passivo' ? v : null

  const jaVigentes = historico
    .filter((h) => dia(h.alterado_em) < d)
    .sort((a, b) => dia(b.alterado_em).localeCompare(dia(a.alterado_em)))
  if (jaVigentes.length > 0) return normalizar(jaVigentes[0]!.valor_novo)

  // Nenhuma mudança vige ainda: o valor é o que existia ANTES da primeira registrada.
  const futuras = historico
    .filter((h) => dia(h.alterado_em) >= d)
    .sort((a, b) => dia(a.alterado_em).localeCompare(dia(b.alterado_em)))
  if (futuras.length > 0) return normalizar(futuras[0]!.valor_anterior)

  return atual
}

/** Meses COMPLETOS entre duas datas. 15/01 → 14/07 é 5; 15/07 é 6. */
export function idadeEmMeses(de: Date | string, ate: Date | string): number {
  const a = new Date(`${dia(de)}T00:00:00Z`)
  const b = new Date(`${dia(ate)}T00:00:00Z`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth())
  if (b.getUTCDate() < a.getUTCDate()) m -= 1
  return Math.max(0, m)
}

export const CHAVE_FASE_CRESCIMENTO: Record<GestaoOperacao, string> = {
  prospeccao_ativa: 'fase_crescimento_prospeccao_ativa_meses',
  passivo: 'fase_crescimento_passivo_meses',
}

export const CHAVE_SUNSET_VENDEDOR: Record<GestaoOperacao, string> = {
  prospeccao_ativa: 'sunset_vendedor_prospeccao_ativa_meses',
  passivo: 'sunset_vendedor_passivo_meses',
}

export const CHAVE_TAXA_VENDEDOR: Record<GestaoOperacao, Record<'CRESCIMENTO' | 'MANUTENCAO', string>> = {
  prospeccao_ativa: {
    CRESCIMENTO: 'vend_prospeccao_ativa_crescimento',
    MANUTENCAO: 'vend_prospeccao_ativa_manutencao',
  },
  passivo: {
    CRESCIMENTO: 'vend_passivo_crescimento',
    MANUTENCAO: 'vend_passivo_manutencao',
  },
}

export const CHAVE_TAXA_ORIGINADOR: Record<GestaoOperacao, string> = {
  prospeccao_ativa: 'orig_prospeccao_ativa',
  passivo: 'orig_passivo',
}

/**
 * A fase da CONTA, medida pelo relógio do vendedor.
 *
 * O §3 define RESIDUAL pelo sunset DO VENDEDOR ("vendedor 0; originador segue"), então é
 * ele que dá o nome da fase. O originador tem um sunset próprio, opcional e desligado por
 * padrão, que é aplicado à parte — misturar os dois faria a fase significar coisas
 * diferentes conforme quem olhasse.
 */
export function determinarFase(input: {
  marcoAtivacao: string | null
  gestaoOperacao: GestaoOperacao
  data: Date | string
  mesesCrescimento: number | null
  mesesSunset: number | null
}): FaseConta {
  // Sem marco, a conta está ativando AGORA — esta cessão é o próprio marco.
  if (!input.marcoAtivacao) return 'CRESCIMENTO'
  const idade = idadeEmMeses(input.marcoAtivacao, input.data)
  const crescimento = input.mesesCrescimento
  const sunset = input.mesesSunset

  if (crescimento !== null && idade <= crescimento) return 'CRESCIMENTO'
  if (sunset === null || idade <= sunset) return 'MANUTENCAO'
  return 'RESIDUAL'
}

// ─── VOP e arredondamento ───────────────────────────────────────────────────

/** Centavos. `valor numeric(12,2)` no banco, e somar 1/3 sem arredondar vira drift. */
export function arredondar(v: number, casas = 2): number {
  const f = 10 ** casas
  return Math.round(v * f) / f
}

/**
 * Volume-operação-ponderado: o valor cedido corrigido pelo prazo em que ele fica parado.
 *
 * `anticipationDays` vem do payload da plataforma e NÃO é recalculado por datas (§1). A
 * diferença não é acadêmica: vencimento prorrogado, feriado e antecipação parcial fazem
 * a conta por datas divergir da que a plataforma usou para precificar a operação — e a
 * comissão tem de falar do mesmo número que a receita.
 */
export function calcularVOP(
  valorCedido: number,
  anticipationDays: number,
  diasReferenciaVop: number,
): number {
  if (!(valorCedido > 0) || !(diasReferenciaVop > 0) || !(anticipationDays > 0)) return 0
  return arredondar(valorCedido * (anticipationDays / diasReferenciaVop))
}

/** O que o VOP paga a uma taxa em R$ por milhão, já com o share do titular. */
export function comissaoDoVop(vop: number, taxaBrlPorMm: number, sharePct = 100): number {
  if (!(vop > 0) || !(taxaBrlPorMm > 0)) return 0
  return arredondar((vop / 1_000_000) * taxaBrlPorMm * (sharePct / 100))
}

/**
 * O dia em SÃO PAULO de um instante.
 *
 * O Brasil não tem horário de verão desde 2019, então `America/Sao_Paulo` é UTC-3 fixo e
 * um deslocamento aritmético é exato — sem `Intl`, que no Hermes do app nem sempre traz
 * a base de fusos. Isto importa uma vez por mês e importa muito: uma cessão convertida às
 * 23h30 de 31/08 chega ao banco como 01/09T02:30Z, e cair na competência errada faz o
 * dinheiro aparecer no mês seguinte ao do trabalho.
 */
export function diaSp(instante: Date | string): string {
  // Uma data sem hora ('2026-03-01') já é o dia que se quer: deslocar a levaria para trás.
  if (typeof instante === 'string' && instante.length <= 10) return instante.slice(0, 10)
  const d = typeof instante === 'string' ? new Date(instante) : instante
  if (Number.isNaN(d.getTime())) return dia(instante)
  return new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10)
}

/** Primeiro dia do mês (em SP) do evento. A competência é do EVENTO, não da apuração. */
export function competenciaSp(data: Date | string): string {
  return `${diaSp(data).slice(0, 7)}-01`
}

// ─── Lançamento ─────────────────────────────────────────────────────────────

export interface LancamentoV2 {
  vendedor_id: string
  papel: PapelComissao
  competencia: string
  origem_tipo: OrigemLancamentoV2
  origem_id: string
  evento_em: string
  empresa_id: string | null
  cedente_cnpj: string | null
  cedente_nome: string | null
  nf_numero: string | null
  descricao: string
  gestao_operacao: GestaoOperacao | null
  fase: FaseConta | null
  valor_cedido: number | null
  anticipation_days: number | null
  vop: number | null
  taxa_brl_por_mm: number | null
  share_pct: number
  valor: number
  params_snapshot: Record<string, unknown>
}

/** Quem titulariza uma entidade num papel, na data do evento. */
export interface Titular {
  vendedorId: string
  sharePct: number
  /** Vendedor de IA NUNCA gera lançamento — nem para a casa (§4). */
  isIa: boolean
}

export interface CessaoConvertida {
  /** `access_key` da NF: é o identificador da CESSÃO, e é ele que torna o motor idempotente. */
  origemId: string
  antecipacaoId: number | string
  convertidaEm: string
  valorCedido: number
  anticipationDays: number
  /** O sacado como CONTA (holding do grupo, quando a nota é contra uma SPE). */
  empresaId: string | null
  sacadoNome: string | null
  cedenteCnpj: string | null
  cedenteNome: string | null
  nfNumero: string | null
  /** A classificação VIGENTE NA DATA da conversão — já resolvida por `gestaoNaData`. */
  gestaoOperacao: GestaoOperacao | null
  marcoAtivacao: string | null
}

export interface TitularesDaCessao {
  vendedor: readonly Titular[]
  originador: readonly Titular[]
}

/**
 * O motor: uma cessão convertida vira zero, um ou dois lançamentos.
 *
 * ZERO é um resultado normal e frequente, e cada motivo é diferente: sacado sem titular,
 * cedente sem titular, conta em residual, vendedor de IA, cessão sem classificação. Todos
 * eles significam a mesma coisa em dinheiro — **a parcela não é paga nem redistribuída**
 * (§4). Redistribuir seria pagar alguém pelo trabalho de ninguém.
 */
export function lancamentosDaCessao(
  cessao: CessaoConvertida,
  titulares: TitularesDaCessao,
  params: readonly CommissionParam[],
): LancamentoV2[] {
  const out: LancamentoV2[] = []
  const gestao = cessao.gestaoOperacao
  // Sem classificação não há taxa possível: é uma conta que ninguém decidiu como trabalhar,
  // e inventar a taxa mais barata seria decidir por quem não decidiu.
  if (!gestao) return out

  const quando = cessao.convertidaEm
  const competencia = competenciaSp(quando)

  const diasRef = valorParametro(params, 'dias_referencia_vop', null, quando)
  if (diasRef === null || diasRef <= 0) return out

  const mesesCrescimento = valorParametro(params, CHAVE_FASE_CRESCIMENTO[gestao], null, quando)
  const mesesSunset = valorParametro(params, CHAVE_SUNSET_VENDEDOR[gestao], null, quando)
  const fase = determinarFase({
    marcoAtivacao: cessao.marcoAtivacao,
    gestaoOperacao: gestao,
    data: quando,
    mesesCrescimento,
    mesesSunset,
  })
  const idade = cessao.marcoAtivacao ? idadeEmMeses(cessao.marcoAtivacao, quando) : 0
  const vop = calcularVOP(cessao.valorCedido, cessao.anticipationDays, diasRef)
  if (vop <= 0) return out

  const base = {
    competencia,
    origem_tipo: 'nf_convertida' as const,
    origem_id: cessao.origemId,
    evento_em: quando,
    empresa_id: cessao.empresaId,
    cedente_cnpj: cessao.cedenteCnpj,
    cedente_nome: cessao.cedenteNome,
    nf_numero: cessao.nfNumero,
    gestao_operacao: gestao,
    fase,
    valor_cedido: arredondar(cessao.valorCedido),
    anticipation_days: cessao.anticipationDays,
    vop,
  }

  const snapshotComum = {
    dias_referencia_vop: diasRef,
    marco_ativacao: cessao.marcoAtivacao,
    idade_meses: idade,
    fase,
    gestao_operacao: gestao,
    antecipacao_id: cessao.antecipacaoId,
    fase_crescimento_meses: mesesCrescimento,
    sunset_vendedor_meses: mesesSunset,
  }

  // ── Vendedor: titular do SACADO. Em RESIDUAL a taxa é zero e não há linha. ──
  if (fase !== 'RESIDUAL') {
    const chaveTaxa = CHAVE_TAXA_VENDEDOR[gestao][fase]
    for (const t of titulares.vendedor) {
      if (t.isIa) continue
      const taxa = valorParametro(params, chaveTaxa, t.vendedorId, quando)
      if (taxa === null || taxa <= 0) continue
      const valor = comissaoDoVop(vop, taxa, t.sharePct)
      if (valor <= 0) continue
      out.push({
        ...base,
        vendedor_id: t.vendedorId,
        papel: 'VENDEDOR',
        share_pct: t.sharePct,
        taxa_brl_por_mm: taxa,
        valor,
        descricao: `NF ${cessao.nfNumero ?? cessao.origemId} — ${cessao.sacadoNome ?? 'sacado'}`,
        params_snapshot: { ...snapshotComum, taxa_chave: chaveTaxa, taxa_valor: taxa, papel: 'VENDEDOR' },
      })
    }
  }

  // ── Originador: titular do CEDENTE, com sunset próprio (ausente = sem sunset). ──
  const sunsetOriginador = valorParametro(params, 'sunset_originador_meses', null, quando)
  const originadorEmSunset =
    sunsetOriginador !== null && cessao.marcoAtivacao !== null && idade > sunsetOriginador
  if (!originadorEmSunset) {
    const chaveTaxa = CHAVE_TAXA_ORIGINADOR[gestao]
    for (const t of titulares.originador) {
      if (t.isIa) continue
      const taxa = valorParametro(params, chaveTaxa, t.vendedorId, quando)
      if (taxa === null || taxa <= 0) continue
      const valor = comissaoDoVop(vop, taxa, t.sharePct)
      if (valor <= 0) continue
      out.push({
        ...base,
        vendedor_id: t.vendedorId,
        papel: 'ORIGINADOR',
        share_pct: t.sharePct,
        taxa_brl_por_mm: taxa,
        valor,
        descricao: `NF ${cessao.nfNumero ?? cessao.origemId} — ${cessao.cedenteNome ?? cessao.cedenteCnpj ?? 'cedente'}`,
        params_snapshot: {
          ...snapshotComum,
          taxa_chave: chaveTaxa,
          taxa_valor: taxa,
          papel: 'ORIGINADOR',
          sunset_originador_meses: sunsetOriginador,
        },
      })
    }
  }

  return out
}

// ─── SDR ────────────────────────────────────────────────────────────────────

export interface ReuniaoAceita {
  aceiteId: string
  sdrId: string
  sdrIsIa: boolean
  empresaId: string
  empresaNome: string | null
  /** Quando o aceite se consumou — decisão explícita ou decurso de prazo. */
  aceitaEm: string
  automatico: boolean
}

export function lancamentoSdrReuniao(
  aceite: ReuniaoAceita,
  params: readonly CommissionParam[],
): LancamentoV2 | null {
  if (aceite.sdrIsIa) return null
  const valor = valorParametro(params, 'sdr_valor_reuniao', aceite.sdrId, aceite.aceitaEm)
  if (valor === null || valor <= 0) return null

  return {
    vendedor_id: aceite.sdrId,
    papel: 'SDR',
    competencia: competenciaSp(aceite.aceitaEm),
    origem_tipo: 'sdr_reuniao',
    origem_id: aceite.aceiteId,
    evento_em: aceite.aceitaEm,
    empresa_id: aceite.empresaId,
    cedente_cnpj: null,
    cedente_nome: null,
    nf_numero: null,
    descricao:
      `Reunião ${aceite.automatico ? 'aceita por decurso de prazo' : 'aceita'} — ` +
      `${aceite.empresaNome ?? 'empresa'}`,
    gestao_operacao: null,
    fase: null,
    valor_cedido: null,
    anticipation_days: null,
    vop: null,
    taxa_brl_por_mm: null,
    share_pct: 100,
    valor: arredondar(valor),
    params_snapshot: {
      sdr_valor_reuniao: valor,
      aceite_automatico: aceite.automatico,
      papel: 'SDR',
    },
  }
}

export interface ContaFechadaPeloSdr {
  aceiteId: string
  sdrId: string
  sdrIsIa: boolean
  empresaId: string
  empresaNome: string | null
  /** Quando a reunião foi aceita — é ela que precisa caber na janela. */
  reuniaoAceitaEm: string
  /** Primeira NF convertida do sacado: o fato gerador desta linha. */
  fechadaEm: string
  origemIdCessao: string
}

/**
 * O bônus de conta fechada, creditado à reunião que a originou.
 *
 * A janela existe porque atribuição sem prazo transforma qualquer reunião antiga em
 * bilhete premiado: uma conversa de dois anos atrás não é a causa do fechamento de hoje.
 */
export function lancamentoSdrContaFechada(
  fechamento: ContaFechadaPeloSdr,
  params: readonly CommissionParam[],
): LancamentoV2 | null {
  if (fechamento.sdrIsIa) return null
  const janela = valorParametro(params, 'janela_atribuicao_sdr_dias', null, fechamento.fechadaEm)
  if (janela === null || janela <= 0) return null

  const dias =
    (new Date(fechamento.fechadaEm).getTime() - new Date(fechamento.reuniaoAceitaEm).getTime()) /
    86_400_000
  if (!(dias >= 0) || dias > janela) return null

  const valor = valorParametro(params, 'sdr_valor_conta_fechada', fechamento.sdrId, fechamento.fechadaEm)
  if (valor === null || valor <= 0) return null

  return {
    vendedor_id: fechamento.sdrId,
    papel: 'SDR',
    competencia: competenciaSp(fechamento.fechadaEm),
    origem_tipo: 'sdr_conta_fechada',
    origem_id: fechamento.aceiteId,
    evento_em: fechamento.fechadaEm,
    empresa_id: fechamento.empresaId,
    cedente_cnpj: null,
    cedente_nome: null,
    nf_numero: null,
    descricao: `Conta fechada — ${fechamento.empresaNome ?? 'empresa'} (primeira NF convertida)`,
    gestao_operacao: null,
    fase: null,
    valor_cedido: null,
    anticipation_days: null,
    vop: null,
    taxa_brl_por_mm: null,
    share_pct: 100,
    valor: arredondar(valor),
    params_snapshot: {
      sdr_valor_conta_fechada: valor,
      janela_atribuicao_sdr_dias: janela,
      dias_ate_o_fechamento: Math.round(dias),
      cessao: fechamento.origemIdCessao,
      papel: 'SDR',
    },
  }
}

// ─── Estorno ────────────────────────────────────────────────────────────────

export interface LancamentoOriginal {
  vendedor_id: string
  papel: PapelComissao
  origem_id: string
  origem_tipo: OrigemLancamentoV2
  valor: number
  empresa_id: string | null
  cedente_cnpj: string | null
  cedente_nome: string | null
  nf_numero: string | null
  descricao: string | null
  competencia: string
}

/**
 * O espelho negativo dos lançamentos de uma cessão que deixou de existir.
 *
 * Duas decisões que parecem detalhe e não são:
 *
 *   A COMPETÊNCIA É A DO ESTORNO, não a do original. Reabrir uma competência fechada para
 *   corrigi-la reescreveria uma folha já aprovada; o estorno aparece no mês em que se
 *   descobriu, que é como qualquer contabilidade honesta trata uma reversão.
 *
 *   `proporcao` cobre a conversão/estorno PARCIAL do §8: quando só parte do valor foi de
 *   fato revertida, a devolução é proporcional. Estornar 100% de uma reversão parcial
 *   cobraria da pessoa dinheiro que ela ganhou.
 */
export function estornosDaCessao(
  originais: readonly LancamentoOriginal[],
  descobertoEm: Date | string,
  motivo: string,
  proporcao = 1,
): LancamentoV2[] {
  const p = Math.min(Math.max(proporcao, 0), 1)
  if (p <= 0) return []
  const quando = typeof descobertoEm === 'string' ? descobertoEm : descobertoEm.toISOString()

  return originais
    .map((o) => ({
      vendedor_id: o.vendedor_id,
      papel: o.papel,
      competencia: competenciaSp(quando),
      origem_tipo: 'estorno' as const,
      origem_id: o.origem_id,
      evento_em: quando,
      empresa_id: o.empresa_id,
      cedente_cnpj: o.cedente_cnpj,
      cedente_nome: o.cedente_nome,
      nf_numero: o.nf_numero,
      descricao: `Estorno — ${o.descricao ?? o.origem_id}`,
      gestao_operacao: null,
      fase: null,
      valor_cedido: null,
      anticipation_days: null,
      vop: null,
      taxa_brl_por_mm: null,
      share_pct: 100,
      valor: arredondar(-Math.abs(o.valor) * p),
      params_snapshot: {
        estorno_de: o.origem_id,
        competencia_original: o.competencia,
        proporcao: p,
        motivo,
      },
    }))
    .filter((l) => l.valor !== 0)
}

// ─── Explicação por extenso ─────────────────────────────────────────────────

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const num = (n: number, casas = 0) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })

/**
 * A conta que gerou a linha, escrita como alguém escreveria num papel.
 *
 * É o que transforma "R$ 450" em algo contestável: sem isto, discordar da folha exige
 * pedir a alguém que reconstitua o cálculo — e quem tem de pedir acaba não pedindo.
 */
export function explicarCalculo(l: {
  valor_cedido: number | null
  anticipation_days: number | null
  vop: number | null
  taxa_brl_por_mm: number | null
  share_pct: number | null
  valor: number
  params_snapshot?: Record<string, unknown> | null
  origem_tipo?: string
}): string {
  const snap = (l.params_snapshot ?? {}) as Record<string, unknown>

  if (l.origem_tipo === 'estorno') {
    const prop = Number(snap.proporcao ?? 1)
    return prop >= 1
      ? `Estorno integral de ${brl(Math.abs(l.valor))} (${String(snap.motivo ?? 'cessão revertida')}).`
      : `Estorno de ${num(prop * 100, 1)}% do lançamento original = ${brl(l.valor)}.`
  }
  if (l.origem_tipo === 'sdr_reuniao' || l.origem_tipo === 'sdr_conta_fechada') {
    return `Valor fixo de ${brl(l.valor)} — não depende de VOP.`
  }
  if (l.origem_tipo === 'ajuste_manual') {
    return `Ajuste manual de ${brl(l.valor)}, lançado por um gestor.`
  }

  const cedido = l.valor_cedido ?? 0
  const dias = l.anticipation_days ?? 0
  const ref = Number(snap.dias_referencia_vop ?? 30)
  const vop = l.vop ?? 0
  const taxa = l.taxa_brl_por_mm ?? 0
  const share = l.share_pct ?? 100
  const mm = vop / 1_000_000

  const conta =
    `${brl(cedido)} × ${dias}/${ref} = ${num(vop)} VOP → ` +
    `${num(mm, 2)} × ${brl(taxa)} = ${brl(arredondar(mm * taxa))}`
  return share >= 100 ? `${conta}.` : `${conta}, × ${num(share, 1)}% de share = ${brl(l.valor)}.`
}

// ─── Simulador (§7.4) ───────────────────────────────────────────────────────

export interface EntradaSimulacao {
  volume: number
  dias: number
  gestaoOperacao: GestaoOperacao
  idadeMeses: number
}

export interface LinhaSimulacao {
  papel: PapelComissao
  chave: string | null
  taxa: number | null
  valor: number
}

export interface ResultadoSimulacao {
  vop: number
  fase: FaseConta
  linhas: LinhaSimulacao[]
  total: number
  /** O custo comercial total da operação, em R$ por milhão de VOP. */
  custoPorMm: number
}

/**
 * O que uma cessão pagaria, com um conjunto de parâmetros.
 *
 * Recebe os parâmetros como argumento em vez de lê-los: é isso que permite a tela
 * comparar VIGENTES × PROPOSTOS chamando a mesma função duas vezes — e garante que a
 * simulação use exatamente o motor que vai lançar, não uma segunda implementação.
 */
export function simularComissao(
  entrada: EntradaSimulacao,
  params: readonly CommissionParam[],
  data: Date | string = new Date(),
): ResultadoSimulacao {
  const quando = dia(data)
  const gestao = entrada.gestaoOperacao
  const diasRef = valorParametro(params, 'dias_referencia_vop', null, quando) ?? 30
  const vop = calcularVOP(entrada.volume, entrada.dias, diasRef)

  // A idade entra como número, não como data: no simulador a pergunta é "e se a conta
  // tivesse 8 meses?", e obrigar quem simula a inventar um marco seria pedir a resposta
  // pela pergunta.
  const marco = new Date(`${quando}T00:00:00Z`)
  marco.setUTCMonth(marco.getUTCMonth() - Math.max(0, Math.trunc(entrada.idadeMeses)))
  const fase = determinarFase({
    marcoAtivacao: dia(marco),
    gestaoOperacao: gestao,
    data: quando,
    mesesCrescimento: valorParametro(params, CHAVE_FASE_CRESCIMENTO[gestao], null, quando),
    mesesSunset: valorParametro(params, CHAVE_SUNSET_VENDEDOR[gestao], null, quando),
  })

  const linhas: LinhaSimulacao[] = []

  const chaveVendedor = fase === 'RESIDUAL' ? null : CHAVE_TAXA_VENDEDOR[gestao][fase]
  const taxaVendedor = chaveVendedor ? valorParametro(params, chaveVendedor, null, quando) : null
  linhas.push({
    papel: 'VENDEDOR',
    chave: chaveVendedor,
    taxa: taxaVendedor,
    valor: taxaVendedor ? comissaoDoVop(vop, taxaVendedor) : 0,
  })

  const sunsetOrig = valorParametro(params, 'sunset_originador_meses', null, quando)
  const origCortado = sunsetOrig !== null && entrada.idadeMeses > sunsetOrig
  const chaveOrig = origCortado ? null : CHAVE_TAXA_ORIGINADOR[gestao]
  const taxaOrig = chaveOrig ? valorParametro(params, chaveOrig, null, quando) : null
  linhas.push({
    papel: 'ORIGINADOR',
    chave: chaveOrig,
    taxa: taxaOrig,
    valor: taxaOrig ? comissaoDoVop(vop, taxaOrig) : 0,
  })

  const total = arredondar(linhas.reduce((s, l) => s + l.valor, 0))
  return {
    vop,
    fase,
    linhas,
    total,
    custoPorMm: vop > 0 ? arredondar((total / vop) * 1_000_000) : 0,
  }
}

// ─── Alerta de revisão (§3) ─────────────────────────────────────────────────

/**
 * Uma conta passiva cujo volume recente desabou merece ser OLHADA — não reclassificada.
 *
 * A distinção é o ponto: reclassificar sozinho mudaria a comissão de alguém a partir de
 * um número, e o número não sabe se a obra parou, se o sacado trocou de banco ou se
 * ninguém registrou nada. O sistema sinaliza; a decisão continua sendo de uma pessoa,
 * com motivo obrigatório.
 */
export function sugereRevisao(input: {
  gestaoOperacao: GestaoOperacao | null
  volumeJanela: number
  mediaMensalAnterior: number
  percentualPiso: number
}): boolean {
  if (input.gestaoOperacao !== 'passivo') return false
  if (!(input.mediaMensalAnterior > 0)) return false
  return input.volumeJanela < input.mediaMensalAnterior * (input.percentualPiso / 100)
}
