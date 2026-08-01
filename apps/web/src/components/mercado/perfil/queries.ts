import type {
  AchadoContraste,
  Auditoria,
  Sugestao,
  TracoResumo,
  Trilha,
} from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'

/**
 * As leituras do Perfil. Tudo vem de UM snapshot por comparação — a tela nunca
 * recalcula nada.
 *
 * É deliberado: o cálculo varre coortes inteiras e compila as regras de camada
 * para SQL, o que só o worker pode fazer. Uma tela que recalculasse "só para
 * conferir" acabaria com dois números diferentes para a mesma pergunta, e o da
 * tela é o que a pessoa acreditaria.
 */

export const perfilKeys = {
  all: ['perfil'] as const,
  trilha: (trilha: Trilha) => [...perfilKeys.all, trilha] as const,
  sugestao: (logId: string) => [...perfilKeys.all, 'sugestao', logId] as const,
}

export interface ResultadosSnapshot {
  achados: AchadoContraste[]
  rotulos: Record<string, string>
  resumo: string
  tracos: TracoResumo[]
  rotulo_a: string
  rotulo_b: string
}

export interface SnapshotPerfil {
  id: string
  trilha: Trilha
  comparacao: string
  resultados: ResultadosSnapshot
  auditoria: Auditoria | null
  sugestoes: Sugestao[] | null
  versao_regras: Record<string, number> | null
  coorte_a: number
  coorte_b: number
  calculado_em: string
}

export interface DecisaoSugestao {
  sugestao_id: string
  acao: 'aceita' | 'descartada'
  log_id: string
  regra_versao_criada: number | null
}

export interface PerfilDaTrilha {
  snapshots: SnapshotPerfil[]
  decisoes: DecisaoSugestao[]
}

export async function buscarPerfil(trilha: Trilha): Promise<PerfilDaTrilha> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('perfil_snapshot_atual', { p: { trilha } })
  if (error) throw error
  const r = (data ?? {}) as { tem_acesso?: boolean } & Partial<PerfilDaTrilha>
  if (!r.tem_acesso) throw new Error('Você não tem acesso ao módulo Mercado.')
  return { snapshots: r.snapshots ?? [], decisoes: r.decisoes ?? [] }
}

/**
 * A série de uma comparação, para o gráfico de tendência (§4).
 *
 * Só os campos leves: `resultados` de um snapshot tem dezenas de achados com
 * todas as categorias, e trazer doze deles inteiros para desenhar uma linha
 * baixaria megabytes.
 */
export interface PontoTendencia {
  id: string
  calculado_em: string
  coorte_a: number
  coorte_b: number
  tracos: TracoResumo[]
}

export async function buscarTendencia(
  trilha: Trilha,
  comparacao: string,
  limite = 12,
): Promise<PontoTendencia[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('perfil_snapshots')
    .select('id, calculado_em, coorte_a, coorte_b, resultados')
    .eq('trilha', trilha)
    .eq('comparacao', comparacao)
    .order('calculado_em', { ascending: false })
    .limit(limite)
  if (error) throw error
  return (data ?? [])
    .map((s) => ({
      id: s.id,
      calculado_em: s.calculado_em,
      coorte_a: s.coorte_a,
      coorte_b: s.coorte_b,
      tracos: ((s.resultados as ResultadosSnapshot | null)?.tracos ?? []) as TracoResumo[],
    }))
    .reverse()
}

/** O rascunho que o editor de regra carrega quando abre com `?sugestao=`. */
export interface SugestaoAceita {
  log_id: string
  sugestao: Sugestao
  regra_versao_criada: number | null
}

export async function buscarSugestaoAceita(logId: string): Promise<SugestaoAceita | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('perfil_sugestoes_log')
    .select('id, sugestao, regra_versao_criada')
    .eq('id', logId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    log_id: data.id,
    sugestao: data.sugestao as unknown as Sugestao,
    regra_versao_criada: data.regra_versao_criada,
  }
}
