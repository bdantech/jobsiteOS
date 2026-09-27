import { pool } from '../../db.js'
import { logger } from '../../logger.js'

/**
 * A RECONCILIAÇÃO DE CUSTO (Prompt 09 §13) — diária.
 *
 * O orçamento é mantido por reserva → consumo → estorno em tempo real, e três coisas podem
 * deixá-lo torto sem ninguém perceber:
 *
 *   1. RESERVA ÓRFÃ: o worker morreu entre reservar e consumir. O saldo fica preso numa
 *      reserva que nunca vai liquidar — e o mês "acaba" antes da hora. Toda reserva aberta
 *      há mais de uma hora é estornada.
 *   2. CUSTO REAL DA LIGAÇÃO: a ferramenta `ligar` consome o ESTIMADO (a ligação só custa
 *      de fato quando acontece, depois). Quando a Ana devolve o custo, a diferença é
 *      lançada — para cima ou para baixo.
 *   3. DERIVA dos totais: `consumido`/`reservado` do mês e `gasto` de cada mandato são
 *      recalculados dos movimentos, que são a fonte da verdade.
 */
export async function reconciliarCusto(): Promise<{ reservas_estornadas: number; ligacoes_ajustadas: number; mandatos_corrigidos: number }> {
  // 1. Reservas órfãs.
  const { rows: orfas } = await pool.query<{ id: string }>(
    `select id from agentes_orcamento_movimentos
      where tipo = 'reserva' and not liquidada and criado_em < now() - interval '1 hour'`,
  )
  for (const r of orfas) {
    await pool.query('select public.app__agentes_estornar($1::jsonb)', [JSON.stringify({ reserva_id: r.id })])
  }

  // 2. Custo real das ligações, contra o que a ação consumiu.
  const { rows: ligacoes } = await pool.query<{ acao_id: string; mandato_id: string; agente_id: string; real: number; consumido: number }>(
    `select a.id as acao_id, a.mandato_id, a.agente_id, v.custo_centavos as real, a.custo_centavos as consumido
       from mandato_acoes a
       join voz_ligacoes v on v.id = a.voz_ligacao_id
      where a.ferramenta = 'ligar' and v.custo_centavos is not null
        and v.custo_centavos <> a.custo_centavos
        and v.encerrada_em > now() - interval '35 days'`,
  )
  for (const l of ligacoes) {
    const diferenca = l.real - l.consumido
    if (diferenca > 0) {
      await pool.query('select public.app__agentes_consumo_direto($1::jsonb)', [
        JSON.stringify({ mandato_id: l.mandato_id, agente_id: l.agente_id, valor_centavos: diferenca, ferramenta: 'ligar_ajuste', acao_id: l.acao_id }),
      ])
    } else {
      // Custou menos que o estimado: devolve como estorno contábil ao mês e ao mandato.
      await pool.query(
        `with m as (select app__agentes_mes_atual() as mes)
         insert into agentes_orcamento_movimentos (mes, mandato_id, acao_id, agente_id, ferramenta, tipo, valor_centavos, liquidada)
         select m.mes, $1, $2, $3, 'ligar_ajuste', 'estorno', $4, true from m`,
        [l.mandato_id, l.acao_id, l.agente_id, -diferenca],
      )
      await pool.query('update agentes_orcamento set consumido_centavos = greatest(0, consumido_centavos - $1) where mes = app__agentes_mes_atual()', [-diferenca])
      await pool.query('update mandatos set gasto_centavos = greatest(0, gasto_centavos - $2) where id = $1', [l.mandato_id, -diferenca])
    }
    await pool.query('update mandato_acoes set custo_centavos = $2 where id = $1', [l.acao_id, l.real])
  }

  // 3. Totais recalculados dos movimentos (o estorno de ajuste entra como negativo).
  await pool.query(
    `update agentes_orcamento o set
        consumido_centavos = x.consumido,
        reservado_centavos = x.reservado,
        atualizado_em = now()
       from (
         select mes,
                coalesce(sum(case when tipo = 'consumo' then valor_centavos
                                  when tipo = 'estorno' and ferramenta = 'ligar_ajuste' then -valor_centavos else 0 end), 0)::int as consumido,
                coalesce(sum(case when tipo = 'reserva' and not liquidada then valor_centavos else 0 end), 0)::int as reservado
           from agentes_orcamento_movimentos group by mes
       ) x
      where x.mes = o.mes and (o.consumido_centavos <> greatest(0, x.consumido) or o.reservado_centavos <> x.reservado)`,
  )
  const { rowCount } = await pool.query(
    `update mandatos m set gasto_centavos = greatest(0, x.gasto)
       from (
         select mandato_id,
                coalesce(sum(case when tipo = 'consumo' then valor_centavos
                                  when tipo = 'estorno' and ferramenta = 'ligar_ajuste' then -valor_centavos else 0 end), 0)::int as gasto
           from agentes_orcamento_movimentos where mandato_id is not null group by mandato_id
       ) x
      where x.mandato_id = m.id and m.gasto_centavos <> greatest(0, x.gasto)`,
  )

  const r = { reservas_estornadas: orfas.length, ligacoes_ajustadas: ligacoes.length, mandatos_corrigidos: rowCount ?? 0 }
  logger.info(r, 'Custo dos agentes reconciliado.')
  return r
}
