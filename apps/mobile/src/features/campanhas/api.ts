import type { Json, Tables, Views } from '@jobsiteos/core'
import { supabase } from '@/lib/supabase'

/**
 * Campanhas no celular: acompanhar, aprovar e pausar (05B §8).
 *
 * O CONSTRUTOR é webOnly, e não por preguiça: montar público, escrever variantes
 * e ler um dry-run de mil linhas é trabalho de duas mãos e uma tela grande. O que
 * cabe no celular é o que se faz em pé — olhar como está e apertar pausar quando
 * alguma coisa parece errada, que é justamente a hora em que a pessoa não está
 * na frente do computador.
 */

export const campanhasKeys = {
  all: ['campanhas'] as const,
  lista: () => [...campanhasKeys.all, 'lista'] as const,
  uma: (id: string) => [...campanhasKeys.all, 'uma', id] as const,
  metricas: (id: string) => [...campanhasKeys.all, 'metricas', id] as const,
}

export type CampanhaNaLista = Views<'campanhas_lista'>

export async function buscarCampanhas(): Promise<CampanhaNaLista[]> {
  const { data, error } = await supabase
    .from('campanhas_lista')
    .select('*')
    .order('criada_em', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  return (data ?? []) as CampanhaNaLista[]
}

export async function buscarCampanha(id: string): Promise<Tables<'campanhas'> | null> {
  const { data, error } = await supabase.from('campanhas').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function buscarMetricasCampanha(id: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('app_campanha_metricas', {
    p: { campanha_id: id } as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return (data ?? {}) as Record<string, unknown>
}

/**
 * As três escritas passam pelas MESMAS RPCs da web — que é onde
 * `app_gestor_comercial()` mora. O app nunca vê service role, e um celular não é
 * uma autorização.
 */
export async function aprovarCampanha(id: string): Promise<void> {
  const { error } = await supabase.rpc('app_aprovar_campanha', { p: { id } as unknown as Json })
  if (error) throw new Error(error.message)
}

export async function pausarCampanha(id: string, motivo?: string): Promise<void> {
  const { error } = await supabase.rpc('app_pausar_campanha', {
    p: { id, motivo } as unknown as Json,
  })
  if (error) throw new Error(error.message)
}

export async function retomarCampanha(id: string): Promise<void> {
  const { error } = await supabase.rpc('app_retomar_campanha', { p: { id } as unknown as Json })
  if (error) throw new Error(error.message)
}
