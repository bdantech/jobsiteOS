import type { IdFerramenta } from '../../../../packages/core/src/agentes/ferramentas.js'
import type { PortaOrcamento } from '../../../../packages/core/src/agentes/loop.js'
import { saldoGlobal } from '../../../../packages/core/src/agentes/orcamento.js'
import { pool, supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'

/**
 * A porta do loop para o orçamento REAL: as RPCs atômicas da 0270d. A regra de negócio está
 * no banco (e espelhada em `core/agentes/orcamento.ts` para os testes); aqui só se traduz.
 */
export function portaOrcamento(args: { mandatoId: string; agenteId: string; acaoAtual: () => string | null }): PortaOrcamento {
  return {
    async reservar(ferramenta: IdFerramenta, valorCentavos: number) {
      const { data, error } = await supabaseAdmin.rpc('app__agentes_reservar', {
        p: { mandato_id: args.mandatoId, ferramenta, valor_centavos: valorCentavos },
      })
      if (error) {
        logger.error({ erro: error.message, mandato: args.mandatoId }, 'Falha ao reservar orçamento.')
        return { ok: false as const, motivo: 'erro_reserva', saldoCentavos: 0 }
      }
      const r = data as { ok: boolean; reserva_id?: string; motivo?: string; saldo_centavos?: number }
      return r.ok && r.reserva_id
        ? { ok: true as const, reservaId: r.reserva_id }
        : { ok: false as const, motivo: r.motivo ?? 'orcamento', saldoCentavos: r.saldo_centavos ?? 0 }
    },
    async consumir(reservaId: string, valorRealCentavos: number) {
      const { error } = await supabaseAdmin.rpc('app__agentes_consumir', {
        p: { reserva_id: reservaId, valor_real_centavos: valorRealCentavos, acao_id: args.acaoAtual() },
      })
      if (error) logger.error({ erro: error.message, reservaId }, 'Falha ao consumir a reserva.')
    },
    async estornar(reservaId: string) {
      const { error } = await supabaseAdmin.rpc('app__agentes_estornar', { p: { reserva_id: reservaId } })
      if (error) logger.error({ erro: error.message, reservaId }, 'Falha ao estornar a reserva.')
    },
    async consumirTokens(valorCentavos: number) {
      const { error } = await supabaseAdmin.rpc('app__agentes_consumo_direto', {
        p: { mandato_id: args.mandatoId, agente_id: args.agenteId, valor_centavos: valorCentavos, ferramenta: 'modelo' },
      })
      if (error) logger.error({ erro: error.message }, 'Falha ao registrar o custo dos tokens.')
    },
  }
}

export interface SaldosDoCiclo {
  global: number
  mandato: number
  diaAgente: number | null
  /** O menor dos três: o que o ciclo pode gastar. */
  efetivo: number
}

/** Os três saldos, lidos de uma vez. O dia do agente é nulo quando ele não tem teto próprio. */
export async function saldosDoCiclo(args: {
  mandatoId: string
  agenteId: string
  orcamentoMandato: number
  gastoMandato: number
  tetoDiarioAgente: number
  tetoMensalPadrao: number
}): Promise<SaldosDoCiclo> {
  const { rows } = await pool.query<{
    teto: number | null
    consumido: number | null
    reservado: number | null
    abertas_mandato: number
    gasto_dia: number
  }>(
    `select o.teto_centavos as teto, o.consumido_centavos as consumido, o.reservado_centavos as reservado,
            (select coalesce(sum(valor_centavos), 0)::int from agentes_orcamento_movimentos
              where mandato_id = $1 and tipo = 'reserva' and not liquidada) as abertas_mandato,
            (select coalesce(sum(case when tipo = 'consumo' then valor_centavos
                                      when tipo = 'reserva' and not liquidada then valor_centavos else 0 end), 0)::int
               from agentes_orcamento_movimentos
              where agente_id = $2
                and (criado_em at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date) as gasto_dia
       from (select 1) um
       left join agentes_orcamento o on o.mes = app__agentes_mes_atual()`,
    [args.mandatoId, args.agenteId],
  )
  const r = rows[0]
  const global = saldoGlobal({
    // Mês sem linha ainda: vale o teto padrão da config — a primeira reserva cria a linha.
    teto_centavos: r?.teto ?? args.tetoMensalPadrao,
    consumido_centavos: r?.consumido ?? 0,
    reservado_centavos: r?.reservado ?? 0,
  })
  const mandato = Math.max(0, args.orcamentoMandato - args.gastoMandato - (r?.abertas_mandato ?? 0))
  const diaAgente = args.tetoDiarioAgente > 0 ? Math.max(0, args.tetoDiarioAgente - (r?.gasto_dia ?? 0)) : null
  return { global, mandato, diaAgente, efetivo: Math.min(global, mandato, diaAgente ?? Number.POSITIVE_INFINITY) }
}
