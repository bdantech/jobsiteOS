import { supabaseAdmin } from '../db.js'
import { lerOrcamento } from './config.js'

/**
 * Teto de orçamento mensal (§2/§6.2). A verdade do gasto é a soma de custo_real
 * em `enriquecimentos` no mês corrente — não um contador à parte que pode divergir.
 */

export interface EstadoOrcamento {
  gasto: number
  teto: number
  saldo: number
  alerta: boolean // projeção cruza alerta_percentual
  estourou: boolean // projeção passa do teto → bloqueia execução
  alertaPercentual: number
}

function inicioDoMesUtc(): string {
  const h = new Date()
  return new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth(), 1)).toISOString()
}

export async function gastoDoMes(): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('enriquecimentos')
    .select('custo_real')
    .gte('executado_em', inicioDoMesUtc())
  if (error) throw new Error(`Falha ao apurar gasto do mês: ${error.message}`)
  return (data ?? []).reduce((s, r) => s + (Number(r.custo_real) || 0), 0)
}

export async function estadoOrcamento(custoAdicional = 0): Promise<EstadoOrcamento> {
  const orc = await lerOrcamento()
  const gasto = await gastoDoMes()
  const projetado = gasto + custoAdicional
  return {
    gasto,
    teto: orc.teto_mensal_total,
    saldo: Math.max(0, orc.teto_mensal_total - gasto),
    alerta: projetado >= orc.teto_mensal_total * orc.alerta_percentual,
    estourou: projetado > orc.teto_mensal_total,
    alertaPercentual: orc.alerta_percentual,
  }
}
