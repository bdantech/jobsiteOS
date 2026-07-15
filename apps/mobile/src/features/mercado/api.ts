import {
  CAMADAS,
  CAMADA_DESCRICOES,
  CAMADA_LABELS,
  compileToPostgrest,
  type Camada,
} from '@jobsiteos/core'

import { supabase } from '@/lib/supabase'
import { anoDe, participacao } from './format'
import type {
  ArvoreFiltro,
  GrupoDetalhe,
  IndicadorCamada,
  IndicadorId,
  MembroGrupo,
  ResumoCamada,
  ResumoPiramide,
  SpesPorAno,
} from './types'

/**
 * The Mapa and the grupo econômico. The Explorador and the ficha do universo read
 * through components/explorador/api.ts — one fetcher per surface, deliberately:
 * a second `fetchGrupo` here would be a second answer to "how many SPEs does this
 * group have", and the 360 card and the grupo screen would drift apart.
 *
 * Every read hits ONE surface: the `mercado_explorador` view. It is
 * security_invoker, so RLS (app_tem_modulo('mercado')) decides the rows, and the
 * user-scoped singleton client is the only client mobile has — there is no
 * service role on a phone.
 *
 * Composite filters are compiled with `compileToPostgrest`, never to SQL: no SQL
 * leaves the device, and a variable outside the catalog fails zod before any
 * compiler sees it.
 */

/** A group can hold hundreds of SPEs; a phone can paint neither all of them nor sum them honestly. */
export const MEMBROS_LIMIT = 300

const MEMBRO_COLUNAS =
  'cnpj, razao_social, nome_fantasia, uf, camada, situacao_cadastral, is_spe, capital_social, data_inicio_atividade, obras_ativas, empresa_id'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ─── Mapa do Mercado ────────────────────────────────────────────────────────

interface IndicadorDefinicao {
  id: IndicadorId
  label: string
  descricao: string
  arvore: ArvoreFiltro
}

/**
 * The layer indicators, expressed as filter TREES rather than hand-written
 * PostgREST — so they run through the same catalog, the same zod validation and
 * the same compiler as the rules and the Explorador, and cannot drift from them.
 * `idade_anos` and `erp_conhecido` are derived variables: the engine rewrites
 * them onto `data_inicio_atividade` and `erp_atual is not null`.
 *
 * All five are COUNTS, and that is a deliberate limit, not an oversight — see
 * `contar()` below.
 */
export const INDICADORES_MAPA: readonly IndicadorDefinicao[] = [
  {
    id: 'com_erp',
    label: 'Com ERP identificado',
    descricao: 'Sabemos qual ERP a empresa usa hoje.',
    arvore: {
      operador: 'e',
      condicoes: [{ variavel: 'erp_conhecido', operador: 'igual', valor: true }],
    },
  },
  {
    id: 'com_contato',
    label: 'Com contato conhecido',
    descricao: 'Já temos ao menos um contato na empresa.',
    arvore: {
      operador: 'e',
      condicoes: [{ variavel: 'tem_contato', operador: 'igual', valor: true }],
    },
  },
  {
    id: 'com_obra_ativa',
    label: 'Com obra ativa',
    descricao: 'Ao menos uma obra ativa no CNO.',
    arvore: {
      operador: 'e',
      condicoes: [{ variavel: 'obras_ativas', operador: 'maior_ou_igual', valor: 1 }],
    },
  },
  {
    id: 'madura',
    label: 'Com 10 anos ou mais',
    descricao: 'Idade desde o início de atividade na Receita.',
    arvore: {
      operador: 'e',
      condicoes: [{ variavel: 'idade_anos', operador: 'maior_ou_igual', valor: 10 }],
    },
  },
  {
    id: 'capital_alto',
    label: 'Capital ≥ R$ 2 mi',
    descricao: 'Capital social declarado na Receita.',
    arvore: {
      operador: 'e',
      condicoes: [{ variavel: 'capital_social', operador: 'maior_ou_igual', valor: 2_000_000 }],
    },
  },
]

/**
 * Counts, and ONLY counts.
 *
 * The Mapa in §5.2 also asks for averages (idade média, capital médio) and sums
 * (obras ativas, m² em execução). Those are not reachable from a client:
 * PostgREST aggregate functions are DISABLED on this project (a select with
 * `capital_social.avg()` answers `PGRST123 — Use of aggregate functions is not
 * allowed`), and migrations 0011–0014 ship no summary RPC. Fetching ~2M rows to
 * average them on a phone is not an option, and averaging a page of them would
 * be a number that looks true and isn't.
 *
 * So the Mapa reports what it can compute EXACTLY: how many companies are in
 * each layer, and how many of them carry each signal. See the report — this
 * wants an `app_resumo_piramide()` RPC in the foundation.
 */
async function contar(camada: Camada, arvore?: ArvoreFiltro): Promise<number> {
  let query = supabase
    .from('mercado_explorador')
    .select('cnpj', { count: 'exact', head: true })
    .eq('camada', camada)

  // `.eq()` and `.or()` are separate query params, and PostgREST ANDs them.
  if (arvore) query = query.or(compileToPostgrest(arvore))

  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

export async function fetchResumoPiramide(): Promise<ResumoPiramide> {
  const camadas = await Promise.all(
    CAMADAS.map(async (camada): Promise<Omit<ResumoCamada, 'participacao'>> => {
      const [total, ...contagens] = await Promise.all([
        contar(camada),
        ...INDICADORES_MAPA.map((indicador) => contar(camada, indicador.arvore)),
      ])

      const indicadores: IndicadorCamada[] = INDICADORES_MAPA.map((indicador, i) => ({
        id: indicador.id,
        label: indicador.label,
        descricao: indicador.descricao,
        total: contagens[i] ?? 0,
        // Share of the LAYER: "38% do SAM tem ERP identificado".
        participacao: participacao(contagens[i] ?? 0, total),
      }))

      return {
        camada,
        label: CAMADA_LABELS[camada],
        descricao: CAMADA_DESCRICOES[camada],
        total,
        indicadores,
      }
    }),
  )

  const total = camadas.reduce((soma, c) => soma + c.total, 0)

  return {
    total,
    camadas: camadas.map((c) => ({ ...c, participacao: participacao(c.total, total) })),
  }
}

// ─── Grupo econômico ────────────────────────────────────────────────────────

/** SPEs opened per year, from the members actually fetched. Oldest first. */
function spesPorAno(membros: MembroGrupo[]): SpesPorAno[] {
  const porAno = new Map<number, number>()

  for (const membro of membros) {
    if (!membro.is_spe) continue
    const ano = anoDe(membro.data_inicio_atividade)
    if (ano === null) continue
    porAno.set(ano, (porAno.get(ano) ?? 0) + 1)
  }

  return [...porAno.entries()]
    .map(([ano, total]) => ({ ano, total }))
    .sort((a, b) => a.ano - b.ano)
}

export async function fetchGrupo(id: string): Promise<GrupoDetalhe | null> {
  if (!UUID_RE.test(id)) return null

  const [grupoResult, membrosResult, totalResult, comObraResult] = await Promise.all([
    supabase.from('grupos_economicos').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('mercado_explorador')
      .select(MEMBRO_COLUNAS)
      .eq('grupo_id', id)
      .order('data_inicio_atividade', { ascending: false, nullsFirst: false })
      .limit(MEMBROS_LIMIT),
    supabase
      .from('mercado_explorador')
      .select('cnpj', { count: 'exact', head: true })
      .eq('grupo_id', id),
    supabase
      .from('mercado_explorador')
      .select('cnpj', { count: 'exact', head: true })
      .eq('grupo_id', id)
      .gt('obras_ativas', 0),
  ])

  if (grupoResult.error) throw grupoResult.error
  if (!grupoResult.data) return null
  if (membrosResult.error) throw membrosResult.error
  if (totalResult.error) throw totalResult.error
  if (comObraResult.error) throw comObraResult.error

  const membros = membrosResult.data ?? []
  const empresasTotal = totalResult.count ?? membros.length

  // grupo_spes_total / _24m / _ufs are GROUP-level metrics the worker computes
  // over the whole group and stores on every member row (mercado_metricas). Read
  // them off a member instead of recomputing from a capped list — a list of 300
  // out of 900 SPEs would quietly under-report the group by two thirds.
  const metricas = await carregarMetricasDoGrupo(grupoResult.data.cnpj_cabeca)

  const ufs = [
    ...new Set(membros.map((membro) => membro.uf).filter((uf): uf is string => Boolean(uf))),
  ].sort()

  return {
    grupo: grupoResult.data,
    membros,
    membros_truncados: empresasTotal > membros.length,
    metricas: {
      empresas_total: empresasTotal,
      empresas_com_obra: comObraResult.count ?? 0,
      spes_total: metricas?.grupo_spes_total ?? membros.filter((m) => m.is_spe).length,
      spes_24m: metricas?.grupo_spes_24m ?? 0,
      ufs: metricas?.grupo_ufs?.length ? metricas.grupo_ufs : ufs,
      capital_agregado: metricas?.grupo_capital_agregado ?? null,
      spes_por_ano: spesPorAno(membros),
    },
  }
}

/**
 * `grupo_capital_agregado` is the one group metric the Explorador view does not
 * expose, so it has to come from `mercado_metricas` directly (SELECT-only for
 * authenticated, gated by the module, like everything else here).
 */
async function carregarMetricasDoGrupo(cnpjCabeca: string | null) {
  if (!cnpjCabeca) return null

  const { data, error } = await supabase
    .from('mercado_metricas')
    .select('grupo_spes_total, grupo_spes_24m, grupo_ufs, grupo_capital_agregado')
    .eq('cnpj', cnpjCabeca)
    .maybeSingle()

  if (error) throw error
  return data
}
