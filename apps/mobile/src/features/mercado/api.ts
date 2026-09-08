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

/** Uma linha da amostra que `mercado_amostra_camada` devolve dentro de `mercado_mapa`. */
interface LinhaAmostra {
  capital_social: number | null
  data_inicio_atividade: string | null
  erp_atual: string | null
  tem_contato: boolean | null
  obras_ativas: number | null
}

interface IndicadorDefinicao {
  id: IndicadorId
  label: string
  descricao: string
  /** Avaliado sobre a AMOSTRA, em memória — veja a nota de fetchResumoPiramide. */
  combina: (linha: LinhaAmostra) => boolean
}

const MS_POR_ANO = 365.25 * 24 * 60 * 60 * 1000
const IDADE_MADURA_ANOS = 10
const CAPITAL_ALTO = 2_000_000

/**
 * Os cinco sinais comerciais de cada camada.
 *
 * ── Por que deixaram de ser árvores de filtro ───────────────────────────────
 * Até aqui cada indicador era uma ArvoreFiltro compilada para PostgREST, o que
 * os fazia passar pelo mesmo catálogo e pelo mesmo compilador das regras de
 * camada — uma propriedade boa, e é uma pena perdê-la. Mas ela custava uma query
 * por indicador por camada, e essa conta não fecha (veja fetchResumoPiramide).
 *
 * Agora eles são predicados sobre as linhas da amostra. A equivalência com o
 * catálogo tem que ser mantida À MÃO, e é literal:
 *   com_erp        ⇔ erp_conhecido = true      ⇔ erp_atual is not null
 *   com_contato    ⇔ tem_contato = true
 *   com_obra_ativa ⇔ obras_ativas >= 1
 *   madura         ⇔ idade_anos >= 10          ⇔ data_inicio_atividade <= hoje - 10 anos
 *   capital_alto   ⇔ capital_social >= 2000000
 * As duas derivações (idade_anos e erp_conhecido) são as mesmas que
 * packages/core/src/mercado/filters.ts aplica. Se o catálogo mudar, isto muda
 * junto — não há mais compilador para garantir isso.
 */
export const INDICADORES_MAPA: readonly IndicadorDefinicao[] = [
  {
    id: 'com_erp',
    label: 'Com ERP identificado',
    descricao: 'Sabemos qual ERP a empresa usa hoje.',
    combina: (l) => l.erp_atual !== null,
  },
  {
    id: 'com_contato',
    label: 'Com contato conhecido',
    descricao: 'Já temos ao menos um contato na empresa.',
    combina: (l) => l.tem_contato === true,
  },
  {
    id: 'com_obra_ativa',
    label: 'Com obra ativa',
    descricao: 'Ao menos uma obra ativa no CNO.',
    combina: (l) => (l.obras_ativas ?? 0) >= 1,
  },
  {
    id: 'madura',
    label: 'Com 10 anos ou mais',
    descricao: 'Idade desde o início de atividade na Receita.',
    combina: (l) => {
      if (!l.data_inicio_atividade) return false
      const inicio = Date.parse(l.data_inicio_atividade)
      if (Number.isNaN(inicio)) return false
      return (Date.now() - inicio) / MS_POR_ANO >= IDADE_MADURA_ANOS
    },
  },
  {
    id: 'capital_alto',
    label: 'Capital ≥ R$ 2 mi',
    descricao: 'Capital social declarado na Receita.',
    combina: (l) => (l.capital_social ?? 0) >= CAPITAL_ALTO,
  },
]

/**
 * O tamanho da amostra por camada. Igual ao da web (LIMITE_AMOSTRA), de propósito:
 * as duas telas mostram os mesmos percentuais e não podem discordar por causa de
 * uma constante.
 */
export const LIMITE_AMOSTRA = 1000

interface RespostaCamada {
  camada: Camada
  total: number
  linhas: LinhaAmostra[] | null
}

/**
 * O Mapa: quantas empresas há em cada camada, e quantas delas carregam cada sinal.
 *
 * ── Por que uma RPC, e não 24 contagens ─────────────────────────────────────
 * Esta função disparava 4 camadas × (1 total + 5 indicadores) = 24 queries
 * `count: 'exact'` sobre `mercado_explorador`, todas em paralelo. Com as 903 mil
 * linhas que o universo tem hoje isso não tinha como funcionar: a view é um
 * LEFT JOIN de sete tabelas mais um LATERAL sobre `contatos`, e UMA contagem
 * sozinha media 5,3s. Vinte e quatro delas competindo pelo mesmo buffer
 * estouravam o `statement_timeout` de 8s do papel `authenticated`, o Promise.all
 * rejeitava e a tela caía inteira no estado de erro — que é como ela chegou ao
 * primeiro teste em aparelho: sem nunca carregar.
 *
 * `mercado_mapa` é a RPC que a WEB já usava para o mesmo problema; o mobile
 * simplesmente nunca foi migrado para ela. Ela conta em `mercado_universo` (a
 * tabela base, não a view) por index-only scan — 955ms para as quatro camadas —
 * e traz junto uma amostra de cada uma. Um round trip, ~1s.
 *
 * ── O que isso custa em precisão, e por que vale ────────────────────────────
 * Os TOTAIS de cada camada continuam EXATOS: são um group by sobre o universo.
 * Os cinco indicadores passam a ser ESTIMATIVAS, extrapoladas da amostra — e a
 * amostra é `limit N` sem order by, ou seja, é a ordem física da tabela, não uma
 * amostra aleatória. Ela pode ser enviesada. `estimado` viaja no resultado para
 * a tela poder dizer isso em vez de exibir um número exato que não é.
 *
 * É a mesma troca que a web fez, e é uma troca boa: um percentual aproximado que
 * aparece vale mais que um percentual exato que nunca carrega.
 */
export async function fetchResumoPiramide(): Promise<ResumoPiramide> {
  const { data, error } = await supabase.rpc('mercado_mapa', { p_limite: LIMITE_AMOSTRA })
  if (error) throw error

  const porCamada = new Map<Camada, { total: number; linhas: LinhaAmostra[] }>()
  for (const linha of (data ?? []) as unknown as RespostaCamada[]) {
    porCamada.set(linha.camada, { total: linha.total ?? 0, linhas: linha.linhas ?? [] })
  }

  const camadas = CAMADAS.map((camada): Omit<ResumoCamada, 'participacao'> => {
    const { total, linhas } = porCamada.get(camada) ?? { total: 0, linhas: [] }
    const amostra = linhas.length

    const indicadores: IndicadorCamada[] = INDICADORES_MAPA.map((indicador) => {
      // Proporção na amostra, extrapolada para a camada. Sem amostra não há o que
      // extrapolar: zero, e `estimado` conta o resto da história.
      const proporcao = amostra > 0 ? linhas.filter(indicador.combina).length / amostra : 0

      return {
        id: indicador.id,
        label: indicador.label,
        descricao: indicador.descricao,
        total: Math.round(proporcao * total),
        // Participação DA CAMADA: "38% do SAM tem ERP identificado".
        participacao: proporcao * 100,
      }
    })

    return {
      camada,
      label: CAMADA_LABELS[camada],
      descricao: CAMADA_DESCRICOES[camada],
      total,
      amostra,
      // A amostra cobriu a camada inteira? Então os indicadores são exatos.
      estimado: total > amostra,
      indicadores,
    }
  })

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
