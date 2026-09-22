import type { ConfigFunilOportunidades } from './schemas.js'

/**
 * O PLANO das duas passadas (§3) — e a segunda não é opcional.
 *
 * ── POR QUE DUAS ────────────────────────────────────────────────────────────
 * Os dois endpoints filtram por data de ENTRADA (`createdAt` na pré-autorização,
 * `firstSeenAt` no título), nunca por data de ATUALIZAÇÃO. Isso torna a janela
 * curta cega para tudo que MUDA sem entrar de novo:
 *
 *   uma pré-autorização criada há 20 dias que expirou hoje;
 *   um título que saiu de `ready_to_create` para `offer_created`.
 *
 * Nenhum dos dois aparece numa janela de 7 dias sobre a entrada, e os dois são
 * exatamente o que o funil precisa saber. Por isso a varredura diária de 92 dias
 * existe, e por isso ela é obrigatória — sem ela o funil congela no estado do dia
 * em que cada item entrou, e continua mostrando ofertas que já morreram.
 *
 * ── POR QUE AS DATAS SÃO DE BRASÍLIA ────────────────────────────────────────
 * O filtro é por dia civil do lado deles. Calcular o recorte em UTC empurra a
 * borda em três horas: entre 21h e meia-noite de Brasília, "hoje" em UTC já é
 * amanhã, e a passada perderia silenciosamente as horas mais movimentadas do dia
 * — que é justamente quando o ERP da construtora roda os fechamentos.
 */

export const FUSO_BRASILIA = 'America/Sao_Paulo'

export type ModoSyncFunil = 'novidade' | 'estado'

export interface JanelaSyncFunil {
  modo: ModoSyncFunil
  /** `YYYY-MM-DD`, inclusivo. */
  de: string
  ate: string
  descricao: string
}

/** `YYYY-MM-DD` do instante, no fuso pedido. */
export function diaNoFuso(instante: Date, timezone: string = FUSO_BRASILIA): string {
  // `en-CA` formata como `YYYY-MM-DD`, que é exatamente o que o endpoint espera —
  // e evita montar a string à mão a partir das partes.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante)
}

function recuar(dia: string, dias: number): string {
  const d = new Date(`${dia}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - dias)
  return d.toISOString().slice(0, 10)
}

export function montarJanelaFunil(
  modo: ModoSyncFunil,
  agora: Date,
  cfg: Pick<ConfigFunilOportunidades, 'janela_novidade_dias' | 'janela_estado_dias'>,
): JanelaSyncFunil {
  const ate = diaNoFuso(agora)

  if (modo === 'novidade') {
    const dias = cfg.janela_novidade_dias
    return {
      modo,
      de: recuar(ate, dias - 1),
      ate,
      descricao: `novidade: ${dias} dia(s) de entrada, encadeada ao sync de NFs`,
    }
  }

  /*
   * 92 dias é o TETO do endpoint, e estourá-lo é 400 na cara. Não fatiamos em
   * blocos como no sync de NFs porque aqui o teto e a janela que queremos são o
   * mesmo número: uma requisição cobre o horizonte inteiro.
   */
  const dias = Math.min(92, cfg.janela_estado_dias)
  return {
    modo,
    de: recuar(ate, dias - 1),
    ate,
    descricao: `estado: varredura completa de ${dias} dias (o que MUDOU não volta na janela curta)`,
  }
}

/** Os parâmetros da query, com os nomes que os dois endpoints esperam. */
export function querystringFunil(
  janela: Pick<JanelaSyncFunil, 'de' | 'ate'>,
  page: number,
  pageSize: number,
): string {
  return new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
    start_date: janela.de,
    end_date: janela.ate,
  }).toString()
}
