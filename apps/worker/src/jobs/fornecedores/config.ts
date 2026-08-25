import type { CustosDescoberta } from '../../../../../packages/core/src/fornecedores/cascata.js'
import { CUSTOS_PADRAO } from '../../../../../packages/core/src/fornecedores/cascata.js'
import { TEMPLATE_PADRAO } from '../../../../../packages/core/src/fornecedores/mensagem.js'
import { supabaseAdmin } from '../../db.js'

/**
 * Settings do funil de fornecedores, lidas de `fornecedores_config` (0138a/h).
 *
 * Cada leitura tem um default embutido — se a linha sumir, o job roda com o padrão
 * da spec em vez de quebrar. Mesmo desenho de `radar/config.ts`, e pelo mesmo motivo:
 * um job que morre porque uma linha de configuração foi apagada é um job que
 * ninguém confia o suficiente para agendar.
 */

async function ler<T>(chave: string, padrao: T): Promise<T> {
  const { data } = await supabaseAdmin
    .from('fornecedores_config')
    .select('valor')
    .eq('chave', chave)
    .maybeSingle()
  return (data?.valor as T | undefined) ?? padrao
}

export const lerCorteVolume = (): Promise<number> => ler('corte_volume', 50_000)
export const lerCustos = (): Promise<CustosDescoberta> => ler('custos', CUSTOS_PADRAO)
export const lerTetoPorOriginador = (): Promise<number> => ler('teto_mensal_por_originador', 150)
export const lerOrcamentoAutomatico = (): Promise<number> => ler('orcamento_automatico_mensal', 400)
export const lerAlertaPercentual = (): Promise<number> => ler('alerta_percentual', 0.8)
export const lerPararAoEncontrarAlta = (): Promise<boolean> => ler('parar_ao_encontrar_alta', true)
export const lerApolloMinimoFuncionarios = (): Promise<number> => ler('apollo_minimo_funcionarios', 10)
export const lerApolloMinimoFaturamento = (): Promise<number> => ler('apollo_minimo_faturamento', 20_000_000)
export const lerTtlSobDemanda = (): Promise<number> => ler('ttl_dias_sob_demanda', 90)
export const lerTtlAutomatica = (): Promise<number> => ler('ttl_dias_automatica', 30)
export const lerMaxNotasPorExtracao = (): Promise<number> => ler('max_notas_por_extracao', 60)
export const lerTemplateApresentacao = (): Promise<string> => ler('template_apresentacao', TEMPLATE_PADRAO)
