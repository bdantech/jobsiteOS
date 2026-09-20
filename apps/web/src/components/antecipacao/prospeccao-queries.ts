import type { Json, Tables, Views } from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'

/**
 * As leituras do funil de Sacados por NF (04r).
 *
 * Toda consulta bate em `sacados_prospeccao_view`, que é `security_invoker`: a RLS de
 * `sacados_prospeccao` decide as linhas, e o client é o do usuário. Uma fetcher por
 * superfície, de propósito — duas respostas para "quanto este sacado recebeu em 30
 * dias" é como o card do kanban e o painel do topo passam a discordar.
 *
 * AS NOTAS SÃO A EXCEÇÃO, e por um motivo de segurança e não de estilo: a policy de
 * `notas_fiscais` recorta por vendedor da nota ou por carteira de empresa, e o
 * originador deste funil não é nenhum dos dois (o sacado NÃO é cliente — é o ponto da
 * feature). Lidas direto, viriam VAZIAS, com cara de resposta certa. Elas vêm pela RPC
 * `prospeccao_notas`, autorizada pelo card.
 */

export type SacadoProspeccao = Views<'sacados_prospeccao_view'>
export type QuebraFornecedor = Tables<'sacados_prospeccao_fornecedores'>

export const prospeccaoKeys = {
  all: ['prospeccao'] as const,
  funil: (filtros: FiltrosProspeccao) => [...prospeccaoKeys.all, 'funil', filtros] as const,
  painel: (originadorId?: string | null) =>
    [...prospeccaoKeys.all, 'painel', originadorId ?? null] as const,
  fornecedores: (id: string) => [...prospeccaoKeys.all, 'fornecedores', id] as const,
  notas: (cnpj: string, fornecedor: string | null) =>
    [...prospeccaoKeys.all, 'notas', cnpj, fornecedor] as const,
  config: () => [...prospeccaoKeys.all, 'config'] as const,
  seguidos: () => [...prospeccaoKeys.all, 'seguidos'] as const,
  custoProtesto: () => [...prospeccaoKeys.all, 'custo-protesto'] as const,
}

/**
 * Por que se ordena este funil, e o que cada opção responde.
 *
 * `valor_esperado` é o DEFAULT e é a decisão central do §4: ele combina fluxo real,
 * chance de a esteira destravar e margem. Ordenar por `volume` premiaria o pico de uma
 * obra que acabou; `operavel` responde "o que dá para operar HOJE", que é a pergunta de
 * quem tem meta este mês; `recorrencia` separa a anuidade do evento único.
 *
 * A COLUNA é escolhida daqui, nunca montada com o texto que veio da tela: o `order()`
 * do PostgREST recebe um identificador, e um identificador vindo de input é injeção com
 * outro nome.
 */
export const ORDENS_PROSPECCAO = {
  valor_esperado: { label: 'Valor esperado mensal', coluna: 'valor_esperado_mensal' },
  volume: { label: 'Volume em 30 dias', coluna: 'volume_30d' },
  operavel: { label: 'Valor operável', coluna: 'valor_operavel' },
  recorrencia: { label: 'Recorrência (6 meses)', coluna: 'meses_com_emissao_6m' },
  media: { label: 'Média mensal (6 meses)', coluna: 'media_mensal_6m' },
} as const

export type OrdemProspeccao = keyof typeof ORDENS_PROSPECCAO

export interface FiltrosProspeccao {
  estagio?: string
  /** CNPJ do cedente seguido — recorta o funil pelo fluxo que veio dele. */
  fornecedorCnpj?: string
  uf?: string
  /** Score mínimo do sacado. `undefined` = sem corte (inclui quem não tem score). */
  scoreMin?: number
  /** Meses com emissão nos últimos 6. É o filtro que separa anuidade de pico. */
  recorrenciaMin?: number
  originadorId?: string
  semDono?: boolean
  termo?: string
  ordem?: OrdemProspeccao
  ordemAsc?: boolean
  limite?: number
}

/**
 * As colunas do card. Em UMA string literal: o supabase-js parseia o select no nível de
 * tipo, e concatenar vários literais estoura o parser — o resultado degrada em silêncio
 * para `GenericStringError`, e o erro aparece nas linhas de USO, não no select.
 */
const COLUNAS_CARD =
  'id, cnpj_sacado, sacado_nome, nome_fantasia, municipio, uf, cnae_principal, porte_rfb, situacao_cadastral, data_inicio_atividade, empresa_id, originador_id, originador_origem, originador_nome, estagio, estagio_alterado_em, motivo_saida, observacao_saida, volume_30d, valor_operavel, qtd_nfs_30d, qtd_fornecedores, meses_com_emissao_6m, media_mensal_6m, prazo_medio_dias, ultima_nf_em, prazo_minimo_operavel_dias, prazo_minimo_origem, score_credito, score_completude, chance_concessao, faturamento_estimado, limite_potencial, valor_esperado_mensal, analise_credito_id, analise_estagio, analise_limite_aprovado, analise_decidida_em, entrou_em, atualizado_em'

export const PAGINA_PROSPECCAO = 40

export async function buscarFunilProspeccao(
  filtros: FiltrosProspeccao,
): Promise<{ linhas: SacadoProspeccao[]; total: number }> {
  const supabase = createClient()
  const ordem = ORDENS_PROSPECCAO[filtros.ordem ?? 'valor_esperado']

  let q = supabase
    .from('sacados_prospeccao_view')
    .select(COLUNAS_CARD, { count: 'exact' })
    .order(ordem.coluna, { ascending: filtros.ordemAsc ?? false, nullsFirst: false })
    .limit(filtros.limite ?? PAGINA_PROSPECCAO)

  if (filtros.estagio) q = q.eq('estagio', filtros.estagio)
  if (filtros.uf) q = q.eq('uf', filtros.uf)
  if (filtros.scoreMin !== undefined) q = q.gte('score_credito', filtros.scoreMin)
  if (filtros.recorrenciaMin !== undefined) {
    q = q.gte('meses_com_emissao_6m', filtros.recorrenciaMin)
  }
  if (filtros.originadorId) q = q.eq('originador_id', filtros.originadorId)
  if (filtros.semDono) q = q.is('originador_id', null)
  if (filtros.termo) {
    const t = filtros.termo.replace(/[%,()]/g, '')
    q = q.or(`sacado_nome.ilike.%${t}%,cnpj_sacado.ilike.%${t}%`)
  }

  /*
   * O filtro por CEDENTE atravessa a quebra, que é outra tabela. Uma consulta só — com
   * `in` sobre os ids que a quebra devolve — em vez de um join embutido: o join
   * duplicaria o card de um sacado com três notas do mesmo cedente, e a contagem exata
   * do topo passaria a contar notas em vez de sacados.
   */
  if (filtros.fornecedorCnpj) {
    const { data: ids } = await supabase
      .from('sacados_prospeccao_fornecedores')
      .select('sacado_prospeccao_id')
      .eq('fornecedor_cnpj', filtros.fornecedorCnpj)
    const lista = (ids ?? []).map((r) => r.sacado_prospeccao_id)
    if (lista.length === 0) return { linhas: [], total: 0 }
    q = q.in('id', lista)
  }

  const { data, error, count } = await q
  if (error) throw new Error(`Falha ao carregar o funil de sacados: ${error.message}`)
  return { linhas: (data ?? []) as SacadoProspeccao[], total: count ?? 0 }
}

export interface PainelProspeccao {
  tem_acesso: boolean
  escopo?: 'todos' | 'originador'
  sacados?: number
  volume_observado?: number
  valor_operavel?: number
  valor_esperado_mensal?: number
  travados_na_esteira?: number
  sem_dono?: number
  por_estagio?: Record<string, number>
}

export async function buscarPainelProspeccao(
  originadorId?: string | null,
): Promise<PainelProspeccao> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('prospeccao_painel', {
    p_originador_id: originadorId ?? null,
  })
  if (error) throw new Error(`Falha ao carregar o painel: ${error.message}`)
  return (data ?? { tem_acesso: false }) as unknown as PainelProspeccao
}

export async function buscarQuebraFornecedores(
  sacadoProspeccaoId: string,
): Promise<QuebraFornecedor[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('sacados_prospeccao_fornecedores')
    .select('*')
    .eq('sacado_prospeccao_id', sacadoProspeccaoId)
    .order('valor_30d', { ascending: false, nullsFirst: false })
  if (error) throw new Error(`Falha ao carregar a quebra por fornecedor: ${error.message}`)
  return data ?? []
}

export interface NotaDoCard {
  access_key: string
  numero: string | null
  serie: string | null
  fornecedor_cnpj: string
  fornecedor_nome: string | null
  valor: number
  emitida_em: string | null
  vencimento: string | null
  dias_para_vencimento: number | null
  operavel: boolean
}

export interface NotasDoCard {
  cnpj_sacado: string
  prazo_minimo_operavel_dias: number
  prazo_minimo_origem: 'medido' | 'configurado' | null
  notas: NotaDoCard[]
}

export async function buscarNotasDoCard(
  cnpjSacado: string,
  fornecedorCnpj: string | null,
): Promise<NotasDoCard> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('prospeccao_notas', {
    p: { cnpj_sacado: cnpjSacado, fornecedor_cnpj: fornecedorCnpj } as unknown as Json,
  })
  if (error) throw new Error(`Falha ao carregar as notas: ${error.message}`)
  return data as unknown as NotasDoCard
}

export interface ConfigProspeccao {
  janelas: { janela_emissao_dias: number; janela_recorrencia_meses: number }
  corte_volume: number
  prazo: { margem_prazo_dias: number; tempo_esteira_dias: number; esteira_base_minima: number }
  max_cards_por_originador: number
  exigir_contratante: boolean
  enriquecimento: { teto_mensal_por_originador: number; alerta_percentual: number }
  notificacao: { limiar_valor_esperado_mensal: number }
  motivos_descarte: { id: string; label: string }[]
  templates: { abordagem_fornecedor: string; pedido_ponte: string }
}

/**
 * Os defaults repetem os do banco, e a repetição é deliberada: a tela precisa renderizar
 * antes de a config chegar, e um card que aparece sem régua ("operável" sem dizer acima
 * de quantos dias) é pior que um card que demora.
 */
export const CONFIG_PROSPECCAO_PADRAO: ConfigProspeccao = {
  janelas: { janela_emissao_dias: 30, janela_recorrencia_meses: 6 },
  corte_volume: 30_000,
  prazo: { margem_prazo_dias: 10, tempo_esteira_dias: 15, esteira_base_minima: 10 },
  max_cards_por_originador: 60,
  exigir_contratante: true,
  enriquecimento: { teto_mensal_por_originador: 150, alerta_percentual: 0.8 },
  notificacao: { limiar_valor_esperado_mensal: 1000 },
  motivos_descarte: [],
  templates: { abordagem_fornecedor: '', pedido_ponte: '' },
}

export async function buscarConfigProspeccao(): Promise<ConfigProspeccao> {
  const supabase = createClient()
  const { data, error } = await supabase.from('prospeccao_config').select('chave, valor')
  if (error) throw new Error(`Falha ao carregar as configurações: ${error.message}`)
  const porChave = new Map((data ?? []).map((c) => [c.chave, c.valor]))
  const ler = <K extends keyof ConfigProspeccao>(chave: K): ConfigProspeccao[K] =>
    (porChave.get(chave) as ConfigProspeccao[K] | undefined) ?? CONFIG_PROSPECCAO_PADRAO[chave]
  return {
    janelas: ler('janelas'),
    corte_volume: ler('corte_volume'),
    prazo: ler('prazo'),
    max_cards_por_originador: ler('max_cards_por_originador'),
    exigir_contratante: ler('exigir_contratante'),
    enriquecimento: ler('enriquecimento'),
    notificacao: ler('notificacao'),
    motivos_descarte: ler('motivos_descarte'),
    templates: ler('templates'),
  }
}

export interface CedenteSeguido {
  fornecedor_cnpj: string
  origem: string
  desde: string
}

export async function buscarCedentesSeguidos(): Promise<CedenteSeguido[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('fornecedores_seguidos')
    .select('fornecedor_cnpj, origem, desde')
    .is('ate', null)
    .order('desde', { ascending: false })
  if (error) throw new Error(`Falha ao carregar os cedentes seguidos: ${error.message}`)
  return data ?? []
}

/**
 * O preço da consulta de protesto, da MESMA fonte que o funil de NFs usa. Desde
 * 01/09/2026 há um preço só (a DirectD desativou o endpoint de SP ao consolidar no
 * IEPTB), e a RPC ainda devolve a chave `sp` por compatibilidade — ignorada aqui.
 */
export async function buscarCustoProtesto(): Promise<number> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('antecipacao_custo_protesto' as never)
  if (error) throw new Error(error.message)
  const c = data as unknown as { nacional?: number } | null
  return Number(c?.nacional ?? 0)
}
