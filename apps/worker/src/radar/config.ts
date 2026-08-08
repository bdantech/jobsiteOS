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
  /** 04c §3: headcount muda devagar, e reconsultar cedo só polui a série. */
  funcionarios: number
}

export interface ConfigFaturamento {
  teto_simples: number
  teto_presumido: number
  pct_teto_simples_default: number
  variacao_minima_snapshot: number
  n_minimo_calibracao_por_tipo: number
  /**
   * Se amostras de faturamento PUBLICADO (ranking setorial) entram na calibração,
   * ao lado das declaradas pelo cliente.
   *
   * Está em config, e não no código, porque é uma decisão que se revisa com dado
   * novo. A medição de agosto/2026, com 15 declarantes e 9 empresas do Ranking da
   * Engenharia: incluir a revista levou o erro fora da amostra de 1,34x para 1,47x
   * nos declarantes e de 1,29x para 1,41x nas próprias empresas da revista. O
   * suspeito é uso PARCIAL do ERP — uma construtora de R$ 1,5 bi com 3 usuários
   * paga um MRR que não fala do tamanho dela —, e não dá para separar essas contas
   * pelos campos que temos hoje.
   *
   * Desligar aqui volta ao comportamento anterior sem deploy.
   */
  usar_amostras_publicadas: boolean
}

export interface ConfigFuncionarios {
  ttl_dias: number
  /** `organizations/enrich` não consome crédito de revelação. Config caso o plano mude. */
  custo_unitario: number
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

/**
 * O TTL de funcionários mora na chave `funcionarios` (04c §3), não em `ttl_dias`, e
 * é reconciliado aqui: a spec pediu a chave separada, mas o harness de lote lê tudo
 * de `TtlDias`. Ler nos dois lugares faria a tela de settings editar um valor que o
 * job ignora.
 */
export const lerTtl = async (): Promise<TtlDias> => {
  const [base, func] = await Promise.all([
    ler('ttl_dias', {
      dominio: 180,
      dominio_sem_dados: 360,
      contatos: 180,
      contatos_sem_dados: 360,
      protestos_cliente: 30,
      protestos_prospeccao: 90,
    }),
    lerConfigFuncionarios(),
  ])
  return { ...base, funcionarios: func.ttl_dias }
}

export const lerConfigFaturamento = (): Promise<ConfigFaturamento> =>
  ler('faturamento', {
    teto_simples: 4_800_000,
    teto_presumido: 78_000_000,
    pct_teto_simples_default: 0.5,
    variacao_minima_snapshot: 0.1,
    n_minimo_calibracao_por_tipo: 5,
    usar_amostras_publicadas: true,
  })

export const lerConfigFuncionarios = (): Promise<ConfigFuncionarios> =>
  ler('funcionarios', { ttl_dias: 180, custo_unitario: 0 })

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
