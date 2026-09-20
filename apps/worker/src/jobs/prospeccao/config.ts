import { supabaseAdmin } from '../../db.js'

/**
 * Settings do funil de Sacados por NF, lidas de `prospeccao_config` (0222h).
 *
 * Cada leitura tem um default EMBUTIDO — se a linha sumir, o job roda com o padrão da
 * spec em vez de quebrar. Mesmo desenho de `fornecedores/config.ts` e `radar/config.ts`,
 * e pelo mesmo motivo: um job que morre porque uma linha de configuração foi apagada é
 * um job que ninguém confia o suficiente para agendar.
 */

async function ler<T>(chave: string, padrao: T): Promise<T> {
  const { data } = await supabaseAdmin
    .from('prospeccao_config')
    .select('valor')
    .eq('chave', chave)
    .maybeSingle()
  return (data?.valor as T | undefined) ?? padrao
}

export interface Janelas {
  janela_emissao_dias: number
  janela_recorrencia_meses: number
}

export interface ParametrosPrazo {
  margem_prazo_dias: number
  tempo_esteira_dias: number
  esteira_base_minima: number
}

export interface ParametrosEnriquecimento {
  teto_mensal_por_originador: number
  alerta_percentual: number
}

export const lerJanelas = (): Promise<Janelas> =>
  ler('janelas', { janela_emissao_dias: 30, janela_recorrencia_meses: 6 })

export const lerCorteVolume = (): Promise<number> => ler('corte_volume', 30_000)

export const lerParametrosPrazo = (): Promise<ParametrosPrazo> =>
  ler('prazo', { margem_prazo_dias: 10, tempo_esteira_dias: 15, esteira_base_minima: 10 })

export const lerMaxCardsPorOriginador = (): Promise<number> => ler('max_cards_por_originador', 60)

/** Só sacados que CONTRATAM obra. Ver o comentário do seed — a lição foi paga uma vez. */
export const lerExigirContratante = (): Promise<boolean> => ler('exigir_contratante', true)

export const lerEnriquecimento = (): Promise<ParametrosEnriquecimento> =>
  ler('enriquecimento', { teto_mensal_por_originador: 150, alerta_percentual: 0.8 })

export const lerLimiarNotificacao = async (): Promise<number> =>
  (await ler('notificacao', { limiar_valor_esperado_mensal: 1000 })).limiar_valor_esperado_mensal

/**
 * Os parâmetros de economia do Crédito, que é de onde sai a MARGEM (04o).
 *
 * Lidos de `credito_config`, e não copiados para cá: a taxa padrão é a mesma que
 * precifica o potencial do sacado na tela do Crédito, e duas cópias dela fariam os dois
 * módulos discordarem sobre qual sacado vale mais — a dois cliques um do outro.
 */
export async function lerEconomiaCredito(): Promise<{
  taxa_padrao_am: number
  prazo_medio_dias: number
  tac: number
  valor_medio_nf: number
}> {
  const { data } = await supabaseAdmin
    .from('credito_config')
    .select('valor')
    .eq('chave', 'economia')
    .maybeSingle()
  const v = (data?.valor ?? {}) as Record<string, unknown>
  return {
    taxa_padrao_am: Number(v.taxa_padrao_am) || 2.5,
    prazo_medio_dias: Number(v.prazo_medio_dias) || 45,
    tac: Number(v.tac) || 0,
    valor_medio_nf: Number(v.valor_medio_nf) || 0,
  }
}

/**
 * A chance de concessão default, para quem ainda não tem score (04d).
 *
 * Devolver `null` jogaria para o fim da fila justamente os CNPJs de que menos se sabe —
 * que não é o mesmo que os que menos valem.
 */
export async function lerChanceSemScore(): Promise<number> {
  const { data } = await supabaseAdmin
    .from('credito_config')
    .select('valor')
    .eq('chave', 'scorecard')
    .maybeSingle()
  const v = (data?.valor ?? {}) as Record<string, unknown>
  const c = Number(v.chance_sem_score)
  return Number.isFinite(c) && c > 0 ? c : 0.5
}
