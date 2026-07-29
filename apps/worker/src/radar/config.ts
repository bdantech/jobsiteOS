import type { CargosAlvo } from '../../../../packages/core/src/radar/cargos.js'
import { supabaseAdmin } from '../db.js'

/**
 * Settings do Radar, lidas de radar_config (migration 0030). Cada get tem um
 * default embutido — se a linha sumir, o job não quebra, roda com o padrão da spec.
 */

export interface CustosRadar {
  dominio_claude: number
  contato_apollo: number
  protesto_sp: number
  protesto_nacional: number
}

export interface TtlDias {
  dominio: number
  dominio_sem_dados: number
  contatos: number
  contatos_sem_dados: number
  protestos_cliente: number
  protestos_prospeccao: number
}

export interface OrcamentoRadar {
  teto_mensal_total: number
  alerta_percentual: number
  max_itens_por_lote: number
}

export interface ApolloCfg {
  revelar_telefone_em_lote: boolean
  bulk_size: number
}

async function ler<T>(chave: string, padrao: T): Promise<T> {
  const { data } = await supabaseAdmin.from('radar_config').select('valor').eq('chave', chave).maybeSingle()
  return (data?.valor as T | undefined) ?? padrao
}

export const lerCustos = (): Promise<CustosRadar> =>
  ler('custos', { dominio_claude: 0.1, contato_apollo: 1.2, protesto_sp: 0.36, protesto_nacional: 3.5 })

export const lerTtl = (): Promise<TtlDias> =>
  ler('ttl_dias', {
    dominio: 180,
    dominio_sem_dados: 360,
    contatos: 180,
    contatos_sem_dados: 360,
    protestos_cliente: 30,
    protestos_prospeccao: 90,
  })

export const lerOrcamento = (): Promise<OrcamentoRadar> =>
  ler('orcamento', { teto_mensal_total: 5000, alerta_percentual: 0.8, max_itens_por_lote: 2000 })

/**
 * Default vazio de propósito: sem a linha em radar_config, `selecionarAlvos` não
 * qualifica ninguém e o lote registra 'sem_dados' em vez de revelar (e cobrar) a
 * empresa inteira. Falhar sem gastar é melhor que gastar sem critério.
 */
export const lerCargosAlvo = (): Promise<CargosAlvo> =>
  ler('cargos_alvo', {
    titulos: [],
    departamentos: [],
    senioridades: [],
    senioridades_qualificam: [],
    prioritarios: {},
    max_contatos_por_empresa: 8,
    max_paginas_busca: 3,
  })

export const lerApolloCfg = (): Promise<ApolloCfg> =>
  ler('apollo', { revelar_telefone_em_lote: true, bulk_size: 10 })

/** Limiar de dias sem antecipar que marca um cliente como dormente (§7). */
export const lerLimiarDormente = (): Promise<number> =>
  ler<{ dias_dormente: number }>('onepay', { dias_dormente: 15 }).then((c) => c.dias_dormente ?? 15)
