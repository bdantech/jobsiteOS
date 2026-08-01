import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { AchadoContraste, Auditoria, Trilha } from '@jobsiteos/core'

import { supabase } from '@/lib/supabase'
import { mercadoKeys } from './queries'

/**
 * Perfil de Quem Opera no mobile (04f §7): LEITURA das duas abas — resumo, top
 * achados e auditoria.
 *
 * Sugestões e recálculo são webOnly, e não por preguiça: aceitar uma sugestão
 * abre um editor de árvore de regra, que é a tela que menos cabe num telefone —
 * e recalcular varre coortes inteiras. Ler o perfil no caminho para uma reunião
 * é útil; editar a régua do mercado num ônibus não é.
 */

export interface AchadoMobile extends AchadoContraste {
  label: string
}

export interface SnapshotPerfilMobile {
  id: string
  trilha: Trilha
  comparacao: string
  resumo: string
  rotulo_a: string
  rotulo_b: string
  achados: AchadoContraste[]
  rotulos: Record<string, string>
  auditoria: Auditoria | null
  sugestoes_pendentes: number
  coorte_a: number
  coorte_b: number
  calculado_em: string
}

interface SnapshotBruto {
  id: string
  trilha: Trilha
  comparacao: string
  resultados: {
    achados?: AchadoContraste[]
    rotulos?: Record<string, string>
    resumo?: string
    rotulo_a?: string
    rotulo_b?: string
  } | null
  auditoria: Auditoria | null
  sugestoes: unknown[] | null
  coorte_a: number
  coorte_b: number
  calculado_em: string
}

export async function fetchPerfil(trilha: Trilha): Promise<SnapshotPerfilMobile[]> {
  const { data, error } = await supabase.rpc('perfil_snapshot_atual', { p: { trilha } })
  if (error) throw error

  const r = data as { tem_acesso?: boolean; snapshots?: SnapshotBruto[] } | null
  if (!r?.tem_acesso) throw new Error('Você não tem acesso ao módulo Mercado.')

  return (r.snapshots ?? []).map((s) => ({
    id: s.id,
    trilha: s.trilha,
    comparacao: s.comparacao,
    resumo: s.resultados?.resumo ?? '',
    rotulo_a: s.resultados?.rotulo_a ?? 'quem opera',
    rotulo_b: s.resultados?.rotulo_b ?? 'o grupo de comparação',
    // Só os que a tela mostraria: o payload completo tem dezenas de achados com
    // todas as categorias, e um telefone não pinta isso nem precisa.
    achados: (s.resultados?.achados ?? []).filter((a) => !a.suprimido).slice(0, 6),
    rotulos: s.resultados?.rotulos ?? {},
    auditoria: s.auditoria,
    sugestoes_pendentes: (s.sugestoes ?? []).length,
    coorte_a: s.coorte_a,
    coorte_b: s.coorte_b,
    calculado_em: s.calculado_em,
  }))
}

export function usePerfilQuery(trilha: Trilha): UseQueryResult<SnapshotPerfilMobile[], Error> {
  return useQuery({
    queryKey: [...mercadoKeys.all, 'perfil', trilha] as const,
    queryFn: () => fetchPerfil(trilha),
    // O perfil só muda quando o worker recalcula — uma vez por mês.
    staleTime: 10 * 60 * 1000,
  })
}
