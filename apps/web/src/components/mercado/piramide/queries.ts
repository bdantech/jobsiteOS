import { type Camada, type CamadaComRegra, type Grupo } from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'
import { arvoreDeJson } from './arvore'

/**
 * Reads for the pyramid. All of them run in the BROWSER against the anon key, so
 * RLS (`app_tem_modulo('mercado')`) decides the rows — the counts a user sees are
 * the counts a user is allowed to see. Nothing here writes; the rules are saved
 * by the server actions in src/actions/mercado-regras.ts.
 *
 * The dry-run (§5.1) is the exception: a count over the whole universe times out
 * at 8s in the browser, so it runs on the worker via POST /api/mercado/previa and
 * the components import its result type from here.
 */

export type { PreviaRegra as Previsao, PreviaDestino as DestinoQueda } from '@jobsiteos/core'

export const piramideKeys = {
  all: ['mercado', 'piramide'] as const,
  contagens: () => ['mercado', 'piramide', 'contagens'] as const,
  regras: (camada: CamadaComRegra) => ['mercado', 'piramide', 'regras', camada] as const,
}

// ─── Contagens da pirâmide ──────────────────────────────────────────────────

export interface ContagensPiramide {
  porCamada: Record<Camada, number>
  total: number
  /** Rows with no layer yet — imported companies awaiting the next reclassification. */
  semCamada: number
}

export async function contarCamadas(): Promise<ContagensPiramide> {
  const supabase = createClient()

  // Uma RPC, não 5 count:'exact' sobre a view. Com 876k linhas cada count varria a view
  // inteira (~11s) e estourava o statement_timeout de 8s do authenticated — a aba não
  // carregava. mercado_piramide conta o universo por camada com index-only scan (~1s),
  // como security definer (sem o overhead de RLS por linha).
  const { data, error } = await supabase.rpc('mercado_piramide')
  if (error) throw new Error(error.message)

  const d = data as { por_camada: Partial<Record<Camada, number>>; total: number; sem_camada: number }

  const porCamada = {
    universo: d.por_camada.universo ?? 0,
    tam: d.por_camada.tam ?? 0,
    sam: d.por_camada.sam ?? 0,
    som: d.por_camada.som ?? 0,
  } satisfies Record<Camada, number>

  return { porCamada, total: d.total, semCamada: Math.max(0, d.sem_camada) }
}

// ─── Versões da regra ───────────────────────────────────────────────────────

export interface RegraVersao {
  id: string
  camada: CamadaComRegra
  versao: number
  /** null when the stored tree no longer parses (e.g. a variable left the catalog). */
  definicao: Grupo | null
  ativa: boolean
  criada_em: string
  autor_nome: string | null
}

export async function buscarRegras(camada: CamadaComRegra): Promise<RegraVersao[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('camada_regras')
    .select('id, camada, versao, definicao, ativa, criada_em, criada_por')
    .eq('camada', camada)
    .order('versao', { ascending: false })
    .limit(50)

  if (error) throw new Error(error.message)
  const regras = data ?? []

  // criada_por → usuarios in one extra round trip (usuarios exposes id/nome to
  // any active user; migration 0005). The seeded v1 rules have no author.
  const autores = [...new Set(regras.map((r) => r.criada_por).filter((id): id is string => id !== null))]
  const nomes = new Map<string, string>()

  if (autores.length > 0) {
    const { data: usuarios, error: erroUsuarios } = await supabase
      .from('usuarios')
      .select('id, nome')
      .in('id', autores)
    if (erroUsuarios) throw new Error(erroUsuarios.message)
    for (const usuario of usuarios ?? []) nomes.set(usuario.id, usuario.nome)
  }

  return regras.map((regra) => ({
    id: regra.id,
    camada: regra.camada as CamadaComRegra,
    versao: regra.versao,
    definicao: arvoreDeJson(regra.definicao),
    ativa: regra.ativa,
    criada_em: regra.criada_em,
    autor_nome: regra.criada_por ? (nomes.get(regra.criada_por) ?? null) : null,
  }))
}
