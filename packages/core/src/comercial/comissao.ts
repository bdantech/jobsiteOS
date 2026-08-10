/**
 * Comissão (04g §6) — regra vigente, atribuição temporal e clawback.
 *
 * O desenho inteiro serve a uma frase: **um lançamento é uma afirmação sobre o
 * passado**. Isso tem duas consequências que o código precisa garantir, e nenhuma
 * delas é óbvia até alguém contestar a folha de março:
 *
 *   REGRA VIGENTE NA DATA — subir o valor por reunião hoje não pode reprecificar as
 *   reuniões de março. Por isso a regra tem vigência e a busca é pela data do evento,
 *   nunca pela data de hoje.
 *
 *   DONO NA DATA — trocar a carteira hoje não pode reatribuir o que foi ganho em
 *   março. Por isso a carteira é temporal e a busca é por intervalo, não pelo vigente.
 *
 * A terceira coisa é o clawback: antecipação que regride gera lançamento NEGATIVO
 * espelhado, e ele nasce `apurado` — nunca `pago` — porque estorno automático em cima
 * de dinheiro já pago é o tipo de decisão que precisa de gente.
 */

export type TipoVendedor = 'sdr' | 'vendedor' | 'originador'
export type OrigemLancamento = 'reuniao_agendada' | 'nf_convertida' | 'volume_passivo' | 'estorno'
export type StatusLancamento = 'apurado' | 'aprovado' | 'pago'

export const ORIGEM_LANCAMENTO_LABELS: Record<OrigemLancamento, string> = {
  reuniao_agendada: 'Reunião agendada',
  nf_convertida: 'NF convertida',
  volume_passivo: 'Volume de conta passiva',
  estorno: 'Estorno',
}

export const STATUS_LANCAMENTO_LABELS: Record<StatusLancamento, string> = {
  apurado: 'Apurado',
  aprovado: 'Aprovado',
  pago: 'Pago',
}

export interface RegraComissao {
  id: string
  tipo_vendedor: TipoVendedor
  /** null = regra padrão do tipo. Preenchido = override de uma pessoa, e vence. */
  vendedor_id: string | null
  parametros: Record<string, unknown>
  vigente_de: string
  vigente_ate: string | null
}

/** Só a data (YYYY-MM-DD) importa para vigência: comissão não tem hora. */
function dia(d: Date | string): string {
  return typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)
}

/**
 * A regra que valia para este vendedor NAQUELE dia.
 *
 * Override pessoal vence a regra do tipo. Entre duas do mesmo escopo, a de início mais
 * recente — o que permite corrigir uma regra publicada errada sem apagar a anterior.
 */
export function regraVigente(
  regras: readonly RegraComissao[],
  vendedor: { id: string; tipo: TipoVendedor },
  data: Date | string,
): RegraComissao | null {
  const d = dia(data)
  const candidatas = regras.filter(
    (r) =>
      r.tipo_vendedor === vendedor.tipo &&
      (r.vendedor_id === null || r.vendedor_id === vendedor.id) &&
      dia(r.vigente_de) <= d &&
      (r.vigente_ate === null || dia(r.vigente_ate) >= d),
  )
  if (candidatas.length === 0) return null

  return candidatas.sort((a, b) => {
    // Override pessoal primeiro.
    const pessoalA = a.vendedor_id ? 0 : 1
    const pessoalB = b.vendedor_id ? 0 : 1
    if (pessoalA !== pessoalB) return pessoalA - pessoalB
    return dia(b.vigente_de).localeCompare(dia(a.vigente_de))
  })[0] as RegraComissao
}

export interface JanelaCarteira {
  vendedor_id: string
  empresa_id: string
  papel: 'originacao' | 'gestao_passiva' | 'sdr'
  desde: string
  ate: string | null
}

/**
 * Quem era dono desta empresa, neste papel, NA DATA do evento.
 *
 * Intervalo semiaberto [desde, ate): quem assumiu às 10h de hoje não recebe pelo que
 * aconteceu às 9h. Sem esse cuidado, uma troca de carteira no meio do mês faria as duas
 * pessoas reivindicarem o mesmo evento — e as duas teriam razão.
 */
export function donoNaData(
  janelas: readonly JanelaCarteira[],
  empresaId: string,
  papel: JanelaCarteira['papel'],
  data: Date | string,
): string | null {
  const t = new Date(data).getTime()
  const achada = janelas.find(
    (j) =>
      j.empresa_id === empresaId &&
      j.papel === papel &&
      new Date(j.desde).getTime() <= t &&
      (j.ate === null || new Date(j.ate).getTime() > t),
  )
  return achada?.vendedor_id ?? null
}

export interface Lancamento {
  vendedor_id: string
  competencia: string
  origem_tipo: OrigemLancamento
  origem_id: string
  descricao: string
  valor: number
  regra_id: string | null
}

/** Primeiro dia do mês do evento, em ISO. A competência é do EVENTO, não da apuração. */
export function competenciaDe(data: Date | string): string {
  const d = new Date(data)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

function numero(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Centavos: `valor numeric(12,2)` no banco, e somar 1/3 sem arredondar vira drift. */
function arredondar(v: number): number {
  return Math.round(v * 100) / 100
}

/** SDR: valor fixo por reunião AGENDADA (não por realizada — ver o comentário do estorno). */
export function comissaoReuniao(
  regra: RegraComissao | null,
  evento: { lead_id: string; vendedor_id: string; agendada_em: string; empresa: string },
): Lancamento | null {
  const valor = numero(regra?.parametros?.valor_por_reuniao)
  // Sem regra vigente não se lança nada. Um default aqui inventaria dinheiro, e
  // dinheiro inventado só é descoberto quando alguém confere a folha.
  if (regra === null || valor === null || valor <= 0) return null

  return {
    vendedor_id: evento.vendedor_id,
    competencia: competenciaDe(evento.agendada_em),
    origem_tipo: 'reuniao_agendada',
    origem_id: evento.lead_id,
    descricao: `Reunião agendada — ${evento.empresa}`,
    valor: arredondar(valor),
    regra_id: regra.id,
  }
}

/** Originador: por milhão convertido. `gross_value` é o que a operação de fato moveu. */
export function comissaoNfConvertida(
  regra: RegraComissao | null,
  evento: { antecipacao_id: string; vendedor_id: string; convertida_em: string; gross_value: number; empresa: string },
): Lancamento | null {
  const porMilhao = numero(regra?.parametros?.valor_por_milhao)
  if (regra === null || porMilhao === null || porMilhao <= 0) return null
  if (!(evento.gross_value > 0)) return null

  return {
    vendedor_id: evento.vendedor_id,
    competencia: competenciaDe(evento.convertida_em),
    origem_tipo: 'nf_convertida',
    origem_id: evento.antecipacao_id,
    descricao: `NF convertida — ${evento.empresa} (${arredondar(evento.gross_value)})`,
    valor: arredondar((evento.gross_value / 1_000_000) * porMilhao),
    regra_id: regra.id,
  }
}

/**
 * Vendedor: por milhão antecipado no mês pelas contas passivas que ele gere.
 *
 * O volume é o da HOLDING E DAS SPEs dela — numa construtora é contra a SPE que se
 * fatura, e somar só o CNPJ da holding deixava a maior parte de fora. Por isso a
 * descrição diz quantas operações vieram por SPE: um valor que triplicou de um mês para
 * o outro é o tipo de linha que alguém contesta, e a resposta tem de estar na própria
 * linha, não numa consulta que só quem escreveu o job sabe fazer.
 */
export function comissaoVolumePassivo(
  regra: RegraComissao | null,
  evento: {
    vendedor_id: string
    empresa_id: string
    competencia: string
    volume: number
    empresa: string
    operacoes_via_spe?: number
  },
): Lancamento | null {
  const porMilhao = numero(regra?.parametros?.valor_por_milhao)
  if (regra === null || porMilhao === null || porMilhao <= 0) return null
  if (!(evento.volume > 0)) return null

  const viaSpe = evento.operacoes_via_spe ?? 0
  return {
    vendedor_id: evento.vendedor_id,
    competencia: evento.competencia,
    origem_tipo: 'volume_passivo',
    // Agregado mensal: a chave é (empresa, mês), e é ela que torna o job idempotente.
    origem_id: `volume:${evento.empresa_id}:${evento.competencia.slice(0, 7)}`,
    descricao:
      viaSpe > 0
        ? `Volume de conta passiva — ${evento.empresa} (${viaSpe} operação(ões) via SPE)`
        : `Volume de conta passiva — ${evento.empresa}`,
    valor: arredondar((evento.volume / 1_000_000) * porMilhao),
    regra_id: regra.id,
  }
}

/**
 * O espelho negativo de um lançamento que não deveria ter existido.
 *
 * A competência é a do ESTORNO, não a do original: reabrir uma competência já paga para
 * corrigi-la reescreveria uma folha fechada. O estorno aparece no mês em que se
 * descobriu, que é como qualquer contabilidade honesta trata uma reversão.
 */
export function estornoDe(
  original: { vendedor_id: string; origem_id: string; valor: number; descricao: string },
  descobertoEm: Date | string,
): Lancamento {
  return {
    vendedor_id: original.vendedor_id,
    competencia: competenciaDe(descobertoEm),
    origem_tipo: 'estorno',
    origem_id: `estorno:${original.origem_id}`,
    descricao: `Estorno — ${original.descricao}`,
    valor: arredondar(-Math.abs(original.valor)),
    regra_id: null,
  }
}
