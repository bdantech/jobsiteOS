import {
  CAMADAS,
  CAMADAS_COM_REGRA,
  compileToPostgrest,
  type Camada,
  type CamadaComRegra,
  type Condicao,
  type Grupo,
  type No,
} from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'
import { alturaDaCamada } from './constants'
import { arvoreDeJson } from './arvore'

/**
 * Reads for the pyramid. All of them run in the BROWSER against the anon key, so
 * RLS (`app_tem_modulo('mercado')`) decides the rows — the counts a user sees are
 * the counts a user is allowed to see. Nothing here writes; the rules are saved
 * by the server actions in src/actions/mercado-regras.ts.
 */

const VISAO = 'mercado_explorador'

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

  const [contagens, totalGeral] = await Promise.all([
    Promise.all(
      CAMADAS.map(async (camada) => {
        const { count, error } = await supabase
          .from(VISAO)
          .select('*', { count: 'exact', head: true })
          .eq('camada', camada)
        if (error) throw new Error(error.message)
        return [camada, count ?? 0] as const
      }),
    ),
    (async () => {
      const { count, error } = await supabase
        .from(VISAO)
        .select('*', { count: 'exact', head: true })
      if (error) throw new Error(error.message)
      return count ?? 0
    })(),
  ])

  const porCamada = Object.fromEntries(contagens) as Record<Camada, number>
  const somaDasCamadas = contagens.reduce((soma, [, total]) => soma + total, 0)

  return {
    porCamada,
    total: totalGeral,
    // Never negative, even if a row is reclassified between the two queries.
    semCamada: Math.max(0, totalGeral - somaDasCamadas),
  }
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

/** The active rule of every layer that has one. The dry-run needs all of them. */
export type RegrasAtivas = Partial<Record<CamadaComRegra, Grupo>>

export async function buscarRegrasAtivas(): Promise<RegrasAtivas> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('camada_regras')
    .select('camada, definicao')
    .eq('ativa', true)

  if (error) throw new Error(error.message)

  const ativas: RegrasAtivas = {}
  for (const regra of data ?? []) {
    const arvore = arvoreDeJson(regra.definicao)
    if (arvore) ativas[regra.camada as CamadaComRegra] = arvore
  }
  return ativas
}

// ─── Dry-run: o que esta regra move ─────────────────────────────────────────

const E = (...condicoes: No[]): Grupo => ({ operador: 'e', condicoes })
const OU = (...condicoes: No[]): Grupo => ({ operador: 'ou', condicoes })

const naCamada = (camada: Camada): Condicao => ({
  variavel: 'camada',
  operador: 'igual',
  valor: camada,
})

/**
 * "Not in layer X" is NOT `camada <> X`: a company imported from a list has a
 * NULL camada until the worker classifies it, and SQL's `<>` drops nulls. Those
 * rows are precisely the ones a new rule is most likely to pull in, so they must
 * be counted.
 */
const foraDaCamada = (camada: Camada): Grupo =>
  OU({ variavel: 'camada', operador: 'diferente', valor: camada }, {
    variavel: 'camada',
    operador: 'nao_definido',
  })

async function contar(arvore: Grupo): Promise<number> {
  const supabase = createClient()

  // head: true → PostgREST runs the count and returns no rows. This is a count
  // over ~2M rows; fetching them would be absurd.
  const { count, error } = await supabase
    .from(VISAO)
    .select('*', { count: 'exact', head: true })
    .or(compileToPostgrest(arvore))

  if (error) throw new Error(error.message)
  return count ?? 0
}

export interface DestinoQueda {
  camada: Camada
  total: number
}

export interface Previsao {
  camada: CamadaComRegra
  /** Rows the new rule pulls INTO this layer. */
  subindo: number
  /** Rows currently in this layer that the new rule no longer matches. */
  descendo: number
  /** Where those rows land: the highest lower layer whose ACTIVE rule still matches. */
  destinos: DestinoQueda[]
  /** Rows already in this layer that the new rule keeps. */
  permanecem: number
  totalMovidas: number
}

/**
 * The dry-run behind "Esta regra move 12.400 empresas…". Every number is DERIVED
 * from head-counts against the same view the worker will reclassify, compiled by
 * the same engine — a rule previewed here and applied there cannot disagree.
 *
 * Two things this deliberately does NOT do naïvely:
 *
 *   1. "Subindo" is not `matches(R) AND camada <> X`. The rules are cumulative
 *      (every SOM company also matches SAM's rule), and the worker assigns the
 *      HIGHEST matching layer — so counting every SOM row as "climbing to SAM"
 *      would report the whole top of the pyramid as moving down into the middle
 *      of it. Rows that also match an ACTIVE rule above X stay above X, and are
 *      subtracted.
 *
 *   2. "Descendo para TAM" is not assumed to be "the layer below". A row leaving
 *      SAM lands in TAM only if TAM's active rule still matches it; otherwise it
 *      falls all the way to Universo. Both are counted, not guessed.
 *
 * There is no NOT() in the compiled tree — negation is done by SUBTRACTION
 * (|A| − |A ∧ R|), which keeps every query a plain AND of catalog conditions.
 */
export async function preverRegra(
  camada: CamadaComRegra,
  regra: Grupo,
  ativas: RegrasAtivas,
): Promise<Previsao> {
  const altura = alturaDaCamada(camada)

  const acima = CAMADAS_COM_REGRA.filter((c) => alturaDaCamada(c) > altura)
    .map((c) => ativas[c])
    .filter((r): r is Grupo => r !== undefined)

  // Highest first: a row leaving SOM prefers SAM over TAM.
  const abaixo = CAMADAS_COM_REGRA.filter((c) => alturaDaCamada(c) < altura)
    .sort((a, b) => alturaDaCamada(b) - alturaDaCamada(a))
    .map((c) => ({ camada: c, regra: ativas[c] }))
    .filter((c): c is { camada: CamadaComRegra; regra: Grupo } => c.regra !== undefined)

  const [naCamadaHoje, permanecem, entramBruto, entramMasFicamAcima] = await Promise.all([
    contar(E(naCamada(camada))),
    contar(E(regra, naCamada(camada))),
    contar(E(regra, foraDaCamada(camada))),
    acima.length > 0 ? contar(E(regra, OU(...acima), foraDaCamada(camada))) : Promise.resolve(0),
  ])

  const subindo = Math.max(0, entramBruto - entramMasFicamAcima)
  const descendo = Math.max(0, naCamadaHoje - permanecem)

  const destinos: DestinoQueda[] = []

  for (const [i, alvo] of abaixo.entries()) {
    // Layers between the target and X: a row that also matches one of THOSE
    // lands there instead, so it must not be counted twice.
    const maiores = abaixo.slice(0, i).map((c) => c.regra)

    const [comAlvo, comAlvoEregra, comMaiores, comMaioresEregra] = await Promise.all([
      contar(E(naCamada(camada), alvo.regra)),
      contar(E(naCamada(camada), alvo.regra, regra)),
      maiores.length > 0
        ? contar(E(naCamada(camada), alvo.regra, OU(...maiores)))
        : Promise.resolve(0),
      maiores.length > 0
        ? contar(E(naCamada(camada), alvo.regra, OU(...maiores), regra))
        : Promise.resolve(0),
    ])

    // |leaving ∧ alvo| − |leaving ∧ alvo ∧ (algum destino mais alto)|
    const total = Math.max(0, comAlvo - comAlvoEregra - (comMaiores - comMaioresEregra))
    if (total > 0) destinos.push({ camada: alvo.camada, total })
  }

  const alocados = destinos.reduce((soma, d) => soma + d.total, 0)
  const paraUniverso = Math.max(0, descendo - alocados)
  if (paraUniverso > 0) destinos.push({ camada: 'universo', total: paraUniverso })

  return {
    camada,
    subindo,
    descendo,
    destinos,
    permanecem,
    totalMovidas: subindo + descendo,
  }
}
