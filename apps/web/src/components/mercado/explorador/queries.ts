import {
  resolverParaJson,
  type Grupo,
  type Json,
  type Tables,
  type Views,
} from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'
import { mercadoKeys as chavesDoModulo } from '../queries'
import { COLUNAS_POR_ID } from './colunas'
import type { EstadoExplorador } from './filtro-url'

/**
 * Leituras do Mercado. Rodam no NAVEGADOR, com a anon key e a sessão do usuário
 * — então cada uma delas passa por RLS (`app_tem_modulo('mercado')`). Nenhuma
 * mutação mora aqui: escrita é server action (src/actions/mercado.ts).
 *
 * Toda leitura da tabela grande é PAGINADA no servidor. `mercado_explorador` é
 * uma view sobre ~2M linhas: não existe query sem `.range()` neste arquivo, e
 * `count: 'exact'` (que é full scan) só aparece onde o número precisa estar
 * certo — a contagem de um segmento, que é o que o time comercial vai planejar
 * em cima.
 */

export type LinhaExplorador = Views<'mercado_explorador'>

export interface PaginaExplorador {
  linhas: LinhaExplorador[]
  /**
   * Estimativa do planner (count=estimated). O número exato custa um full scan
   * da view inteira — a UI diz "≈" e oferece um botão para contar de verdade.
   */
  totalEstimado: number | null
  /** Há mais uma página? Sabido sem contar nada: pedimos uma linha a mais. */
  temProxima: boolean
}

/**
 * A fábrica de chaves do MÓDULO (components/mercado/queries.ts) mais as chaves
 * que só o Explorador tem. Todas penduradas no mesmo prefixo `['mercado']`, que
 * é o que faz `invalidateQueries({ queryKey: mercadoKeys.all })` — depois de uma
 * promoção ou da ativação de uma regra — atualizar Mapa, Explorador, ficha do
 * universo e segmentos de uma vez.
 */
export const mercadoKeys = {
  ...chavesDoModulo,
  contagem: (arvore: Grupo | null, termo: string) =>
    ['mercado', 'contagem', arvore, termo] as const,
  socios: (cnpj: string) => ['mercado', 'socios', cnpj] as const,
  obras: (cnpj: string) => ['mercado', 'obras', cnpj] as const,
  segmento: (id: string) => ['mercado', 'segmento', id] as const,
}

/**
 * `%`/`_`/`\` são curingas do ilike; um `%` numa razão social buscada viraria
 * "qualquer coisa". Fora, antes de o termo virar `%termo%` na RPC — busca literal.
 * (Injeção não é o risco: o termo vai como parâmetro ligado, e a RPC usa format %L.)
 */
function sanitizarTermo(termo: string): string {
  return termo.replace(/[%_\\]/g, ' ').trim()
}

/**
 * A página do Explorador — via RPC (mercado_explorar), NÃO direto na view.
 *
 * A busca por nome/CNPJ é ILIKE, e sob a RLS da view (`app_tem_modulo`) o ILIKE não
 * pode usar o índice de trigrama: o operador não é leakproof, então o planner é
 * proibido de aplicá-lo antes da checagem de RLS e varre as 876k linhas inteiras —
 * 8s, timeout. A RPC roda SECURITY DEFINER (sem RLS, com o mesmo portão feito UMA
 * vez), e aí o trigrama volta a valer. Mesmo padrão do mercado_mapa/mercado_piramide.
 *
 * A RPC já pede uma linha a mais que a página (p_limite) para responder "tem próxima"
 * sem contar nada, e devolve a estimativa do planner como total.
 */
export async function buscarPagina(estado: EstadoExplorador): Promise<PaginaExplorador> {
  const supabase = createClient()
  const coluna = COLUNAS_POR_ID.get(estado.ordem)
  const ordenarPor = coluna?.ordenarPor ?? 'cnpj'

  // `ordemInvertida`: a coluna "Idade" ordena por data_inicio_atividade, e mais
  // velho = data menor. Ordenar "crescente" por idade é ordenar decrescente pela
  // data — a mesma inversão que o engine faz em `idade_anos`.
  const ascendente = coluna?.ordemInvertida ? estado.direcao === 'desc' : estado.direcao === 'asc'
  const termo = sanitizarTermo(estado.termo)

  const { data, error } = await supabase.rpc('mercado_explorar', {
    p_termo: termo || null,
    p_arvore: estado.arvore ? (resolverParaJson(estado.arvore) as unknown as Json) : null,
    p_ordem: ordenarPor,
    p_asc: ascendente,
    p_offset: estado.pagina * estado.tamanho,
    p_limite: estado.tamanho,
  })
  if (error) throw new Error(error.message)

  const resultado = data as { linhas: LinhaExplorador[]; total: number | null }
  const linhas = resultado.linhas ?? []
  const temProxima = linhas.length > estado.tamanho

  return {
    linhas: temProxima ? linhas.slice(0, estado.tamanho) : linhas,
    totalEstimado: resultado.total,
    temProxima,
  }
}

/** Contagem EXATA (a pedido do usuário). Mesmo motivo da RPC: sob RLS o ILIKE não indexa. */
export async function contarExato(termo: string, arvore: Grupo | null): Promise<number> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('mercado_contar_exato', {
    p_termo: sanitizarTermo(termo) || null,
    p_arvore: arvore ? (resolverParaJson(arvore) as unknown as Json) : null,
  })
  if (error) throw new Error(error.message)
  return (data as number | null) ?? 0
}

// ─── Ficha do universo ──────────────────────────────────────────────────────

export interface FichaUniverso {
  universo: Tables<'mercado_universo'>
  grupo: Tables<'grupos_economicos'> | null
  metricas: Tables<'mercado_metricas'> | null
  /** Preenchido só quando a empresa já foi promovida. */
  empresa: Pick<Tables<'empresas'>, 'id' | 'razao_social' | 'estagio' | 'erp_atual'> | null
}

export async function buscarFichaUniverso(cnpj: string): Promise<FichaUniverso | null> {
  const supabase = createClient()

  const { data: universo, error } = await supabase
    .from('mercado_universo')
    .select('*')
    .eq('cnpj', cnpj)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!universo) return null

  const [grupo, metricas, empresa] = await Promise.all([
    universo.grupo_id
      ? supabase
          .from('grupos_economicos')
          .select('*')
          .eq('id', universo.grupo_id)
          .maybeSingle()
          .then(({ data }) => data)
      : Promise.resolve(null),
    supabase
      .from('mercado_metricas')
      .select('*')
      .eq('cnpj', cnpj)
      .maybeSingle()
      .then(({ data }) => data),
    universo.empresa_id
      ? supabase
          .from('empresas')
          .select('id, razao_social, estagio, erp_atual')
          .eq('id', universo.empresa_id)
          .maybeSingle()
          .then(({ data }) => data)
      : Promise.resolve(null),
  ])

  return { universo, grupo, metricas, empresa }
}

export type SocioLinha = Tables<'mercado_socios'>

export async function buscarSocios(cnpj: string): Promise<SocioLinha[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('mercado_socios')
    .select('*')
    .eq('cnpj', cnpj)
    .order('data_entrada', { ascending: false, nullsFirst: false })
    .limit(100)

  if (error) throw new Error(error.message)
  return data ?? []
}

export type ObraLinha = Pick<
  Tables<'mercado_obras'>,
  | 'cno'
  | 'situacao'
  | 'data_inicio_obra'
  | 'uf'
  | 'municipio'
  | 'destinacao'
  | 'categoria'
  | 'metragem_m2'
  | 'tipo_responsabilidade'
>

export async function buscarObras(cnpj: string): Promise<ObraLinha[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('mercado_obras')
    .select(
      'cno, situacao, data_inicio_obra, uf, municipio, destinacao, categoria, metragem_m2, tipo_responsabilidade',
    )
    .eq('ni_responsavel', cnpj)
    .order('data_inicio_obra', { ascending: false, nullsFirst: false })
    .limit(100)

  if (error) throw new Error(error.message)
  return data ?? []
}

export interface MembroGrupo {
  cnpj: string | null
  razao_social: string | null
  uf: string | null
  camada: string | null
  is_spe: boolean | null
  data_inicio_atividade: string | null
  obras_ativas: number | null
  empresa_id: string | null
}

export interface FichaGrupo {
  grupo: Tables<'grupos_economicos'>
  membros: MembroGrupo[]
  /** A lista de membros é truncada — este é o total real. */
  total: number
}

export async function buscarFichaGrupo(grupoId: string): Promise<FichaGrupo | null> {
  const supabase = createClient()

  const { data: grupo, error } = await supabase
    .from('grupos_economicos')
    .select('*')
    .eq('id', grupoId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!grupo) return null

  const { data, count, error: erroMembros } = await supabase
    .from('mercado_explorador')
    .select(
      'cnpj, razao_social, uf, camada, is_spe, data_inicio_atividade, obras_ativas, empresa_id',
      { count: 'exact' },
    )
    .eq('grupo_id', grupoId)
    .order('data_inicio_atividade', { ascending: false, nullsFirst: false })
    // Um grupo pode ter centenas de SPEs, não milhões: aqui `exact` é barato
    // (o índice em grupo_id resolve) e o número precisa estar certo.
    .range(0, 199)

  if (erroMembros) throw new Error(erroMembros.message)

  return { grupo, membros: data ?? [], total: count ?? (data?.length ?? 0) }
}

// ─── Segmentos ──────────────────────────────────────────────────────────────

export type SegmentoLinha = Tables<'segmentos'> & { criador_nome: string | null }

export async function buscarSegmentos(): Promise<SegmentoLinha[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('segmentos')
    .select('*')
    .order('criado_em', { ascending: false })
    .limit(200)

  if (error) throw new Error(error.message)
  const segmentos = data ?? []

  const ids = [...new Set(segmentos.map((s) => s.criado_por).filter((id): id is string => !!id))]
  if (ids.length === 0) return segmentos.map((s) => ({ ...s, criador_nome: null }))

  // segmentos.criado_por → usuarios.id existe como FK, mas o embed do PostgREST
  // exigiria grant de select em usuarios via a relação; `usuarios` já é legível
  // (migração 0005), então uma segunda ida é mais simples e igualmente barata.
  const { data: usuarios } = await supabase.from('usuarios').select('id, nome').in('id', ids)
  const nomes = new Map((usuarios ?? []).map((u) => [u.id, u.nome]))

  return segmentos.map((s) => ({
    ...s,
    criador_nome: s.criado_por ? (nomes.get(s.criado_por) ?? null) : null,
  }))
}

export async function buscarSegmento(id: string): Promise<Tables<'segmentos'> | null> {
  const supabase = createClient()

  const { data, error } = await supabase.from('segmentos').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}
