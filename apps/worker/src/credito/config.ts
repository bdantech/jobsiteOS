import { supabaseAdmin } from '../db.js'

/**
 * Settings do módulo Crédito, lidas de `credito_config` (migração 0073).
 *
 * Cada campo tem um default embutido: se a linha sumir, o job roda com o padrão da spec
 * em vez de quebrar. O que NÃO tem default é a calibração — essa, faltando, para o job,
 * porque um coeficiente inventado é pior que nenhum.
 */

export interface ConfigCredito {
  // economia
  taxa_padrao_am: number
  tac: number
  valor_medio_nf: number
  prazo_medio_dias: number
  giro_mensal: number | null
  // limite
  ratio_limite_manual: number | null
  cap_absoluto: number
  cap_pct_faturamento: number
  // scorecard
  corte_concessao: number
  completude_minima: number
  recencia_protesto_dias: number
  knockout_negada_meses: number
  chance_por_faixa: Record<string, number>
  chance_sem_score: number
  // gerais
  n_minimo_calibracao_por_tipo: number
  variacao_minima_snapshot: number
  poll_intervalo_horas: number
  validade_padrao_meses: number
}

export interface TipoDoc {
  id: string
  label: string
  obrigatorio: boolean
}

async function ler<T>(chave: string, padrao: T): Promise<T> {
  const { data } = await supabaseAdmin.from('credito_config').select('valor').eq('chave', chave).maybeSingle()
  return { ...padrao, ...((data?.valor as Partial<T> | undefined) ?? {}) }
}

export async function lerConfigCredito(): Promise<ConfigCredito> {
  const [economia, limite, scorecard, atradius] = await Promise.all([
    ler('economia', {
      taxa_padrao_am: 1.9,
      tac: 150,
      valor_medio_nf: 25_000,
      prazo_medio_dias: 45,
      giro_mensal: null as number | null,
    }),
    ler('limite', {
      ratio_limite_manual: null as number | null,
      cap_absoluto: 5_000_000,
      cap_pct_faturamento: 0.15,
    }),
    ler('scorecard', {
      corte_concessao: 40,
      completude_minima: 0.5,
      recencia_protesto_dias: 90,
      knockout_negada_meses: 6,
      chance_por_faixa: { alta: 0.8, media: 0.5, improvavel: 0.1 } as Record<string, number>,
      chance_sem_score: 0.5,
    }),
    ler('atradius', { poll_intervalo_horas: 6, validade_padrao_meses: 12 }),
  ])

  return {
    ...economia,
    ...limite,
    ...scorecard,
    ...atradius,
    // Reaproveitados do 04c de propósito: a régua de "quantas amostras bastam" e a de
    // "quanto precisa variar para virar snapshot" não podem divergir entre os dois
    // estimadores. Duas cópias divergiriam no dia em que alguém ajustasse uma.
    n_minimo_calibracao_por_tipo: 5,
    variacao_minima_snapshot: 0.1,
  }
}

export async function lerTiposDoc(): Promise<TipoDoc[]> {
  const { data } = await supabaseAdmin.from('credito_config').select('valor').eq('chave', 'docs').maybeSingle()
  const valor = data?.valor as { tipos?: TipoDoc[] } | undefined
  return (
    valor?.tipos ?? [
      { id: 'balanco', label: 'Balanço patrimonial', obrigatorio: true },
      { id: 'dre', label: 'DRE', obrigatorio: true },
      { id: 'contrato_social', label: 'Contrato social', obrigatorio: true },
      { id: 'outros', label: 'Outros', obrigatorio: false },
    ]
  )
}
