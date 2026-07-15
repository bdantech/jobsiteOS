import { formatCnpj } from '../../schemas/cnpj.js'
import { compileToPostgrest, descrever } from '../../mercado/filters.js'
import { criarSegmento, promoverEmpresa } from '../../mercado/mutations.js'
import {
  CAMADAS,
  CAMADA_LABELS,
  criarSegmentoSchema,
  detalharGrupoSchema,
  explorarSchema,
  promoverEmpresaSchema,
  resumoPiramideSchema,
  type Camada,
  type CriarSegmentoInput,
  type DetalharGrupoInput,
  type ExplorarInput,
  type PromoverEmpresaInput,
  type ResumoPiramideInput,
} from '../../mercado/schemas.js'
import type { AppModule, ToolContext } from '../types.js'

/**
 * Mercado: Universo → TAM → SAM → SOM.
 *
 * All reads go through the `mercado_explorador` view (migration 0012), which is
 * security_invoker — so RLS decides the rows, exactly as it does everywhere else,
 * and the AI cannot see a company the user could not open by hand.
 */

// ─── mercado.resumo_piramide ────────────────────────────────────────────────

async function resumoPiramide(input: ResumoPiramideInput, ctx: ToolContext) {
  const camadas = await Promise.all(
    CAMADAS.map(async (camada) => {
      let q = ctx.supabase
        .from('mercado_explorador')
        .select('*', { count: 'exact', head: true })
        .eq('camada', camada)

      if (input.uf) q = q.eq('uf', input.uf.toUpperCase())
      if (input.tipo) q = q.eq('tipo', input.tipo)

      const { count, error } = await q
      if (error) throw new Error(`Falha ao contar a camada ${camada}: ${error.message}`)
      return { camada, label: CAMADA_LABELS[camada as Camada], total: count ?? 0 }
    }),
  )

  const total = camadas.reduce((soma, c) => soma + c.total, 0)

  return {
    total_universo: total,
    camadas: camadas.map((c) => ({
      ...c,
      // Share of the whole universe, so the layers read as a pyramid.
      participacao: total > 0 ? Number(((c.total / total) * 100).toFixed(1)) : 0,
    })),
    route: '/mercado',
  }
}

// ─── mercado.buscar_universo ────────────────────────────────────────────────

async function buscarUniverso(input: ExplorarInput, ctx: ToolContext) {
  // One string literal, NOT a concatenation: supabase-js infers the row type from
  // the literal passed to .select(). Break it across lines with `+` and the type
  // widens to `string`, the inference collapses, and every field access below
  // becomes an error on `GenericStringError`.
  let q = ctx.supabase
    .from('mercado_explorador')
    .select(
      'cnpj, razao_social, nome_fantasia, uf, municipio, camada, estagio, capital_social, is_spe, grupo_id, obras_ativas, erp_atual, erp_mrr, empresa_id',
      { count: 'exact' },
    )
    .order('capital_social', { ascending: false, nullsFirst: false })
    .range(input.pagina * input.limite, input.pagina * input.limite + input.limite - 1)

  if (input.termo) {
    // Commas and parens are PostgREST's own syntax inside .or().
    const termo = input.termo.replace(/[,()]/g, '')
    q = q.or(`razao_social.ilike.%${termo}%,nome_fantasia.ilike.%${termo}%,cnpj.ilike.%${termo}%`)
  }
  if (input.camada) q = q.eq('camada', input.camada)
  if (input.uf) q = q.eq('uf', input.uf.toUpperCase())

  // The composite tree, compiled to PostgREST — never to SQL. Nothing the model
  // produces reaches a query planner as text.
  if (input.filtro) q = q.or(compileToPostgrest(input.filtro))

  const { data, count, error } = await q
  if (error) throw new Error(`Falha ao buscar no universo: ${error.message}`)

  return {
    total: count ?? data.length,
    empresas: data.map((e) => ({
      ...e,
      cnpj: formatCnpj(e.cnpj ?? ''),
      camada_label: e.camada ? CAMADA_LABELS[e.camada as Camada] : null,
      promovida: e.empresa_id !== null,
      // Promoted → the Company 360. Otherwise the universe sheet in the Explorador.
      route: e.empresa_id ? `/empresas/${e.empresa_id}` : `/mercado/universo/${e.cnpj}`,
    })),
  }
}

// ─── mercado.detalhar_grupo ─────────────────────────────────────────────────

async function detalharGrupo(input: DetalharGrupoInput, ctx: ToolContext) {
  let grupoId = input.grupo_id ?? null

  if (!grupoId && input.cnpj) {
    const cnpj = input.cnpj.replace(/\D/g, '')
    const { data } = await ctx.supabase
      .from('mercado_explorador')
      .select('grupo_id')
      .eq('cnpj', cnpj)
      .maybeSingle()
    grupoId = data?.grupo_id ?? null
  }

  if (!grupoId && input.nome) {
    const nome = input.nome.replace(/[,()]/g, '')
    const { data } = await ctx.supabase
      .from('grupos_economicos')
      .select('id')
      .ilike('nome', `%${nome}%`)
      .limit(1)
      .maybeSingle()
    grupoId = data?.id ?? null
  }

  if (!grupoId) {
    return { encontrado: false, mensagem: 'Nenhum grupo econômico encontrado com esses dados.' }
  }

  const { data: grupo, error: erroGrupo } = await ctx.supabase
    .from('grupos_economicos')
    .select('id, nome, cnpj_cabeca')
    .eq('id', grupoId)
    .maybeSingle()
  if (erroGrupo) throw new Error(`Falha ao carregar o grupo: ${erroGrupo.message}`)
  if (!grupo) return { encontrado: false, mensagem: 'Grupo não encontrado.' }

  const { data: membros, error: erroMembros } = await ctx.supabase
    .from('mercado_explorador')
    .select('cnpj, razao_social, uf, camada, is_spe, data_inicio_atividade, obras_ativas, empresa_id')
    .eq('grupo_id', grupoId)
    .order('data_inicio_atividade', { ascending: false, nullsFirst: false })
    .limit(200)
  if (erroMembros) throw new Error(`Falha ao carregar os membros: ${erroMembros.message}`)

  const spes = membros.filter((m) => m.is_spe)
  const ufs = [...new Set(membros.map((m) => m.uf).filter(Boolean))]

  return {
    encontrado: true,
    grupo: {
      id: grupo.id,
      nome: grupo.nome,
      cnpj_cabeca: grupo.cnpj_cabeca ? formatCnpj(grupo.cnpj_cabeca) : null,
      route: `/mercado/grupos/${grupo.id}`,
    },
    metricas: {
      empresas_total: membros.length,
      spes_total: spes.length,
      ufs,
      obras_ativas: membros.reduce((s, m) => s + (m.obras_ativas ?? 0), 0),
    },
    membros: membros.slice(0, 50).map((m) => ({
      cnpj: formatCnpj(m.cnpj ?? ''),
      razao_social: m.razao_social,
      uf: m.uf,
      camada: m.camada,
      is_spe: m.is_spe,
      ano_abertura: m.data_inicio_atividade?.slice(0, 4) ?? null,
      route: m.empresa_id ? `/empresas/${m.empresa_id}` : `/mercado/universo/${m.cnpj}`,
    })),
  }
}

// ─── Módulo ─────────────────────────────────────────────────────────────────

export const mercadoModule: AppModule = {
  id: 'mercado',
  name: 'Mercado',
  icon: 'map',
  route: '/mercado',
  tools: [
    {
      id: 'mercado.resumo_piramide',
      name: 'Resumo da pirâmide',
      description:
        'Retorna a contagem e a participação de cada camada da pirâmide de mercado ' +
        '(universo, TAM, SAM, SOM), com filtro opcional de UF e tipo. Use para responder ' +
        '"quantas empresas temos no TAM?", "qual o tamanho do SOM em SP?" e perguntas de ' +
        'dimensionamento de mercado. Camada é classificação de mercado (o quanto a empresa ' +
        'se encaixa) — não confundir com estágio, que é o histórico de relacionamento.',
      inputSchema: resumoPiramideSchema,
      mutates: false,
      execute: (input, ctx) => resumoPiramide(input as ResumoPiramideInput, ctx),
    },
    {
      id: 'mercado.buscar_universo',
      name: 'Buscar no universo',
      description:
        'Busca empresas em TODO o universo de mercado (staging da Receita + empresas já ' +
        'promovidas), por razão social, nome fantasia ou CNPJ, com filtros de camada e UF, ' +
        'e opcionalmente uma árvore de filtros composta. Diferente de empresas.search, que ' +
        'só enxerga a base de Empresas: use esta para prospecção e dimensionamento. ' +
        'Retorna `route` para navegar até cada empresa e `promovida` indicando se ela já ' +
        'existe na base de Empresas.',
      inputSchema: explorarSchema,
      mutates: false,
      execute: (input, ctx) => buscarUniverso(input as ExplorarInput, ctx),
    },
    {
      id: 'mercado.detalhar_grupo',
      name: 'Detalhar grupo econômico',
      description:
        'Detalha um grupo econômico a partir do id, de um CNPJ de qualquer empresa do grupo, ' +
        'ou do nome. Retorna a cabeça do grupo, métricas (total de empresas, SPEs, UFs, obras ' +
        'ativas) e os membros. Uma incorporadora grande não é uma empresa: é uma holding com ' +
        'dezenas ou centenas de SPEs, e tratá-la como um CNPJ só subdimensiona a conta.',
      inputSchema: detalharGrupoSchema,
      mutates: false,
      execute: (input, ctx) => detalharGrupo(input as DetalharGrupoInput, ctx),
    },
    {
      id: 'mercado.promover_empresa',
      name: 'Promover empresa',
      description:
        'Promove uma empresa do universo (staging) para a base de Empresas, onde ela passa a ' +
        'ter timeline, notas e eventos. Recebe o CNPJ. Como grava dados, exige confirmação ' +
        'explícita do usuário. É idempotente: promover uma empresa já promovida devolve a ' +
        'existente sem erro.',
      inputSchema: promoverEmpresaSchema,
      mutates: true,
      execute: async (input, ctx) => {
        const empresa = await promoverEmpresa(ctx.supabase, input as PromoverEmpresaInput)
        return {
          id: empresa.id,
          cnpj: formatCnpj(empresa.cnpj),
          razao_social: empresa.razao_social,
          camada: empresa.camada,
          route: `/empresas/${empresa.id}`,
        }
      },
    },
    {
      id: 'mercado.criar_segmento',
      name: 'Criar segmento',
      description:
        'Cria um segmento: um filtro nomeado e salvo sobre o universo, que as Cadências vão ' +
        'consumir depois. A definição é uma árvore de filtros: grupos "e"/"ou" aninhados sobre ' +
        'condições { variavel, operador, valor }. Só as variáveis do catálogo do Mercado são ' +
        'aceitas — qualquer outra é rejeitada. Como grava dados, exige confirmação explícita.',
      inputSchema: criarSegmentoSchema,
      mutates: true,
      execute: async (input, ctx) => {
        const segmento = await criarSegmento(ctx.supabase, input as CriarSegmentoInput)
        return {
          id: segmento.id,
          nome: segmento.nome,
          // Read back the tree in prose, so the confirmation card shows the user
          // what the AI actually built rather than a wall of JSON.
          regra: descrever(segmento.definicao as never),
          route: `/mercado/segmentos/${segmento.id}`,
        }
      },
    },
  ],
}
