import type {
  Cenario,
  DadosExtraidos,
  Indicador,
  ParametrosAnalise,
  Tables,
  Teto,
} from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'

/**
 * O painel do sacado (04j §8) numa chamada só.
 *
 * `analise_propria_painel` é SECURITY DEFINER e cruza sete origens. Montar isso no
 * cliente seriam sete idas ao banco com sete latências — e sete lugares para esquecer de
 * atualizar quando o painel ganhar a oitava.
 */

export const analisePropriaKeys = {
  all: ['analise-propria'] as const,
  painel: (analiseId: string) => [...analisePropriaKeys.all, 'painel', analiseId] as const,
  parametros: () => [...analisePropriaKeys.all, 'parametros'] as const,
}

export interface PainelSacado {
  encontrado: boolean
  esteira: Tables<'analises_credito'> | null
  empresa: {
    id: string
    cnpj: string | null
    razao_social: string | null
    nome_fantasia: string | null
    tipo: string | null
    estagio: string | null
    uf: string | null
    municipio: string | null
    faturamento_anual: number | null
    faturamento_origem: string | null
    faturamento_confianca: string | null
    funcionarios: number | null
    funcionarios_crescimento_12m: number | null
    limite_potencial: number | null
    valor_esperado_mensal: number | null
    patrimonio_liquido: number | null
  } | null
  metricas: {
    qtd_filiais: number | null
    grupo_spes_total: number | null
    grupo_spes_24m: number | null
    obras_ativas: number | null
    m2_em_execucao: number | null
  } | null
  score: Tables<'empresa_scores'> | null
  propria: AnalisePropria | null
  protestos: {
    tem_protesto: boolean | null
    qtd_protestos: number | null
    valor_total: number | null
    consultado_em: string | null
  } | null
  certificado: { expires_at: string | null; status: string | null } | null
  opera_na_plataforma: boolean
  nfe_observada: { janela_meses: number; total: number; qtd: number; media_mensal: number }
  docs: Tables<'analise_docs'>[]
  parametros_ativos: ParametrosAnalise | null
}

/**
 * A linha de `analises_proprietarias` com os jsonb já tipados. O banco devolve `Json`;
 * o formato de dentro é contrato do core, e é aqui que ele é declarado uma vez só.
 */
export interface AnalisePropria
  extends Omit<
    Tables<'analises_proprietarias'>,
    'indicadores' | 'tetos' | 'cenarios' | 'dados_extraidos' | 'motivos_nao_operar' | 'lacunas_calculo'
  > {
  indicadores: Indicador[] | null
  tetos: Teto[] | null
  cenarios: Cenario[] | null
  dados_extraidos: DadosExtraidos | null
  motivos_nao_operar: string[]
  lacunas_calculo: string[]
}

export async function buscarPainelSacado(analiseId: string): Promise<PainelSacado> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('analise_propria_painel', {
    p_analise_credito_id: analiseId,
  })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as unknown as Partial<PainelSacado>
  return {
    encontrado: r.encontrado ?? false,
    esteira: r.esteira ?? null,
    empresa: r.empresa ?? null,
    metricas: r.metricas ?? null,
    score: r.score ?? null,
    propria: r.propria ?? null,
    protestos: r.protestos ?? null,
    certificado: r.certificado ?? null,
    opera_na_plataforma: r.opera_na_plataforma ?? false,
    nfe_observada: r.nfe_observada ?? { janela_meses: 6, total: 0, qtd: 0, media_mensal: 0 },
    docs: r.docs ?? [],
    parametros_ativos: r.parametros_ativos ?? null,
  }
}

export async function buscarParametros(): Promise<Tables<'analise_parametros'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('analise_parametros')
    .select('*')
    .order('versao', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}
