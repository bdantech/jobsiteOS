import { createClient } from '@/lib/supabase/client'

/**
 * Leituras do Grupo econômico.
 *
 * Rodam no BROWSER com a anon key + a sessão do usuário, então tudo passa por
 * RLS (`app_tem_modulo('mercado')`). Os membros vêm de `mercado_explorador`, a
 * superfície única do módulo: um grupo pode ter SPEs que só existem no staging
 * e outras já promovidas para `empresas`, e a view junta as duas sem que a tela
 * precise saber de qual lado cada uma veio.
 */

export interface MembroGrupo {
  cnpj: string
  razao_social: string | null
  nome_fantasia: string | null
  uf: string | null
  municipio: string | null
  situacao_cadastral: string | null
  camada: string | null
  is_spe: boolean
  data_inicio_atividade: string | null
  capital_social: number | null
  obras_ativas: number
  m2_em_execucao: number
  empresa_id: string | null
}

export interface MetricasGrupo {
  empresas_total: number
  spes_total: number
  spes_24m: number
  ufs: string[]
  capital_agregado: number | null
  obras_ativas: number
  m2_em_execucao: number
  /**
   * 'worker'   — números vindos de mercado_metricas (o worker já rodou).
   * 'derivada' — o worker ainda não calculou este grupo; os números foram
   *              somados a partir dos membros visíveis. A UI diz isso em voz
   *              alta, porque um número derivado de 500 membros paginados não
   *              é o mesmo que um número calculado sobre o grupo inteiro.
   */
  fonte: 'worker' | 'derivada'
}

export interface GrupoDetalhado {
  id: string
  nome: string | null
  cnpj_cabeca: string | null
  membros: MembroGrupo[]
  metricas: MetricasGrupo
}

export const gruposKeys = {
  all: ['mercado', 'grupos'] as const,
  detalhe: (id: string) => ['mercado', 'grupos', 'detalhe', id] as const,
  resumo: (id: string) => ['mercado', 'grupos', 'resumo', id] as const,
}

/** Um grupo grande é uma incorporadora com centenas de SPEs — mas a tela não é um relatório. */
export const LIMITE_MEMBROS = 500

const COLUNAS_MEMBRO =
  'cnpj, razao_social, nome_fantasia, uf, municipio, situacao_cadastral, camada, is_spe, data_inicio_atividade, capital_social, obras_ativas, m2_em_execucao, empresa_id' as const

const MESES_24 = 24

function dentroDe24Meses(iso: string | null): boolean {
  if (!iso) return false
  const limite = new Date()
  limite.setMonth(limite.getMonth() - MESES_24)
  return new Date(iso).getTime() >= limite.getTime()
}

/**
 * As métricas de grupo (spes_total, spes_24m, ufs, capital agregado) são
 * calculadas pelo worker e ficam replicadas em TODA linha de mercado_metricas
 * do grupo — são propriedades do grupo, não do CNPJ. Basta ler UMA linha; a
 * cabeça, se ela existir, senão o primeiro membro que tiver métricas.
 */
async function metricasDoWorker(cnpjs: string[]): Promise<{
  grupo_spes_total: number
  grupo_spes_24m: number
  grupo_ufs: string[]
  grupo_capital_agregado: number | null
} | null> {
  if (cnpjs.length === 0) return null

  const supabase = createClient()
  const { data, error } = await supabase
    .from('mercado_metricas')
    .select('grupo_spes_total, grupo_spes_24m, grupo_ufs, grupo_capital_agregado')
    .in('cnpj', cnpjs)
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data
}

export async function buscarGrupo(grupoId: string): Promise<GrupoDetalhado | null> {
  const supabase = createClient()

  const { data: grupo, error: erroGrupo } = await supabase
    .from('grupos_economicos')
    .select('id, nome, cnpj_cabeca')
    .eq('id', grupoId)
    .maybeSingle()

  if (erroGrupo) throw new Error(erroGrupo.message)
  if (!grupo) return null

  const { data, error } = await supabase
    .from('mercado_explorador')
    .select(COLUNAS_MEMBRO)
    .eq('grupo_id', grupoId)
    .order('data_inicio_atividade', { ascending: false, nullsFirst: false })
    .limit(LIMITE_MEMBROS)

  if (error) throw new Error(error.message)

  // A view é `union all` de duas pernas, então toda coluna é nullable para o
  // gerador de tipos. cnpj é PK dos dois lados: uma linha sem ele é impossível,
  // mas descartá-la é mais barato do que carregar `string | null` até a tabela.
  const membros: MembroGrupo[] = (data ?? [])
    .filter((m): m is typeof m & { cnpj: string } => m.cnpj !== null)
    .map((m) => ({
      cnpj: m.cnpj,
      razao_social: m.razao_social,
      nome_fantasia: m.nome_fantasia,
      uf: m.uf,
      municipio: m.municipio,
      situacao_cadastral: m.situacao_cadastral,
      camada: m.camada,
      is_spe: m.is_spe ?? false,
      data_inicio_atividade: m.data_inicio_atividade,
      capital_social: m.capital_social,
      obras_ativas: m.obras_ativas ?? 0,
      m2_em_execucao: m.m2_em_execucao ?? 0,
      empresa_id: m.empresa_id,
    }))

  // A cabeça primeiro: é ela que dá nome ao grupo.
  const cabeca = grupo.cnpj_cabeca
  const cnpjsParaMetricas = cabeca ? [cabeca] : membros.slice(0, 1).map((m) => m.cnpj)
  const doWorker = await metricasDoWorker(cnpjsParaMetricas)

  const spes = membros.filter((m) => m.is_spe)
  const obrasAtivas = membros.reduce((soma, m) => soma + m.obras_ativas, 0)
  const m2 = membros.reduce((soma, m) => soma + m.m2_em_execucao, 0)

  const metricas: MetricasGrupo = doWorker
    ? {
        empresas_total: membros.length,
        spes_total: doWorker.grupo_spes_total,
        spes_24m: doWorker.grupo_spes_24m,
        ufs: doWorker.grupo_ufs ?? [],
        capital_agregado: doWorker.grupo_capital_agregado,
        obras_ativas: obrasAtivas,
        m2_em_execucao: m2,
        fonte: 'worker',
      }
    : {
        empresas_total: membros.length,
        spes_total: spes.length,
        spes_24m: spes.filter((m) => dentroDe24Meses(m.data_inicio_atividade)).length,
        ufs: [...new Set(membros.map((m) => m.uf).filter((uf): uf is string => Boolean(uf)))].sort(),
        capital_agregado: membros.reduce((soma, m) => soma + (m.capital_social ?? 0), 0),
        obras_ativas: obrasAtivas,
        m2_em_execucao: m2,
        fonte: 'derivada',
      }

  return {
    id: grupo.id,
    nome: grupo.nome,
    cnpj_cabeca: grupo.cnpj_cabeca,
    membros,
    metricas,
  }
}

export interface ResumoGrupo {
  id: string
  nome: string | null
  cnpj_cabeca: string | null
  empresas_total: number
  spes_total: number
}

/**
 * O card "Grupo" do Company 360: só o suficiente para dizer que a empresa não
 * está sozinha e levar para o grupo. Duas contagens `head`, sem trazer linha
 * nenhuma — um grupo com 400 SPEs não pode pesar no carregamento da empresa.
 */
export async function buscarResumoGrupo(grupoId: string): Promise<ResumoGrupo | null> {
  const supabase = createClient()

  const { data: grupo, error } = await supabase
    .from('grupos_economicos')
    .select('id, nome, cnpj_cabeca')
    .eq('id', grupoId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!grupo) return null

  const [total, spes] = await Promise.all([
    supabase
      .from('mercado_explorador')
      .select('cnpj', { count: 'exact', head: true })
      .eq('grupo_id', grupoId),
    supabase
      .from('mercado_explorador')
      .select('cnpj', { count: 'exact', head: true })
      .eq('grupo_id', grupoId)
      .eq('is_spe', true),
  ])

  if (total.error) throw new Error(total.error.message)
  if (spes.error) throw new Error(spes.error.message)

  return {
    id: grupo.id,
    nome: grupo.nome,
    cnpj_cabeca: grupo.cnpj_cabeca,
    empresas_total: total.count ?? 0,
    spes_total: spes.count ?? 0,
  }
}
