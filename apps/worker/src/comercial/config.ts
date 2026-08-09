import { supabaseAdmin } from '../db.js'

/**
 * Config do Comercial, com os mesmos defaults da migração 0091.
 *
 * Os defaults são repetidos aqui de propósito: o job tem de rodar numa base onde
 * alguém apagou uma linha de config, e cair em `undefined` no meio de uma distribuição
 * semanal significa 25 empresas não distribuídas sem ninguém saber por quê.
 */

export interface ConfigDistribuicao {
  fonte: 'som' | 'som_sam' | 'som_sam_tam'
  empresas_por_semana: number
  sla_lead_dias: number
  sem_fit_carencia_dias: number
}

export interface ConfigPainel {
  leaderboard: boolean
  sem_atividade_dias_uteis: number
}

export interface ConfigPassivos {
  min_antecipacoes: number
  janela_meses: number
}

export interface ConfigComissao {
  estorno_no_show: boolean
}

async function ler<T>(chave: string, padrao: T): Promise<T> {
  const { data } = await supabaseAdmin.from('comercial_config').select('valor').eq('chave', chave).maybeSingle()
  return { ...padrao, ...((data?.valor as object) ?? {}) } as T
}

export const lerDistribuicao = (): Promise<ConfigDistribuicao> =>
  ler<ConfigDistribuicao>('distribuicao', {
    fonte: 'som',
    empresas_por_semana: 25,
    sla_lead_dias: 7,
    sem_fit_carencia_dias: 90,
  })

export const lerPainel = (): Promise<ConfigPainel> =>
  ler<ConfigPainel>('painel', { leaderboard: false, sem_atividade_dias_uteis: 5 })

export const lerPassivos = (): Promise<ConfigPassivos> =>
  ler<ConfigPassivos>('passivos', { min_antecipacoes: 4, janela_meses: 2 })

export const lerComissao = (): Promise<ConfigComissao> =>
  ler<ConfigComissao>('comissao', { estorno_no_show: false })
