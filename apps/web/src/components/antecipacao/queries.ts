import type { EstagioFunil, Faixa, Tables, Tipagem, Views } from '@jobsiteos/core'
import { ESTAGIOS_ABERTOS, ESTAGIOS_ENCERRADOS } from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'

/**
 * As leituras do módulo. Toda consulta bate em UMA superfície — a view
 * `notas_funil` (ou seus agregados) — que é security_invoker: a RLS
 * (`app_tem_modulo('antecipacao')`) decide as linhas, e o client é o do usuário.
 *
 * Uma fetcher por superfície, de propósito. Duas respostas para "quantas notas
 * vivas este fornecedor tem" é como o card do Kanban e a tela de detalhe passam a
 * discordar.
 */

export type NotaFunil = Views<'notas_funil'>
export type FornecedorFunil = Views<'antecipacao_fornecedores'>
export type SacadoFunil = Views<'antecipacao_sacados'>
export type SacadoProspectar = Views<'antecipacao_sacados_a_prospectar'>

export const antecipacaoKeys = {
  all: ['antecipacao'] as const,
  funil: (filtros: FiltrosFunil) => [...antecipacaoKeys.all, 'funil', filtros] as const,
  resumo: () => [...antecipacaoKeys.all, 'resumo'] as const,
  metricas: () => [...antecipacaoKeys.all, 'metricas'] as const,
  fornecedor: (cnpj: string) => [...antecipacaoKeys.all, 'fornecedor', cnpj] as const,
  sacados: () => [...antecipacaoKeys.all, 'sacados'] as const,
  prospectar: () => [...antecipacaoKeys.all, 'prospectar'] as const,
  prospectarPendentes: () => [...antecipacaoKeys.all, 'prospectar', 'pendentes'] as const,
  sacado: (cnpj: string) => [...antecipacaoKeys.all, 'sacado', cnpj] as const,
  regras: (faixa: Faixa) => [...antecipacaoKeys.all, 'regras', faixa] as const,
  disparos: () => [...antecipacaoKeys.all, 'disparos'] as const,
  contas: () => [...antecipacaoKeys.all, 'contas'] as const,
  outbox: (filtros: FiltrosOutbox) => [...antecipacaoKeys.all, 'outbox', filtros] as const,
  config: () => [...antecipacaoKeys.all, 'config'] as const,
  xml: (accessKey: string) => [...antecipacaoKeys.all, 'xml', accessKey] as const,
  filaLookup: () => [...antecipacaoKeys.all, 'fila-lookup'] as const,
}

export interface FiltrosFunil {
  faixa?: Faixa
  tipagem?: Tipagem
  termo?: string
  valorMin?: number
  /** Uma coluna do Kanban por vez: cada coluna faz sua própria leitura paginada. */
  estagio?: EstagioFunil | 'encerradas'
  /** Traz de volta o que a regra de natureza ocultou. Para auditoria, não para o dia a dia. */
  incluirNaoOperaveis?: boolean
}

/**
 * As colunas do card. Em UMA string literal: supabase-js parseia o select no
 * nível de tipo, e concatenar vários literais estoura o parser — o resultado
 * degrada em silêncio para `GenericStringError`.
 */
const COLUNAS_CARD =
  'access_key, numero, serie, valor, vencimento, vencimento_origem, natureza_operacao, operavel, nao_operavel_motivo, dias_para_vencimento, receita_esperada, faixa, faixa_motivo, estagio_funil, fornecedor_cnpj, fornecedor_nome, fornecedor_empresa_id, fornecedor_tipagem, fornecedor_tem_protesto, fornecedor_suprimido, sacado_cnpj, sacado_nome, sacado_empresa_id, sacado_credito_status, sacado_limite_disponivel, sacado_limite_cobre_nota, perda_motivo'

export const PAGINA_FUNIL = 40

export interface PaginaFunil {
  notas: NotaFunil[]
  total: number
}

export async function buscarFunil(
  filtros: FiltrosFunil,
  pagina = 0,
  limite = PAGINA_FUNIL,
): Promise<PaginaFunil> {
  const supabase = createClient()
  let query = supabase
    .from('notas_funil')
    .select(COLUNAS_CARD, { count: 'exact' })
    // Ordenação default: receita esperada decrescente. Trabalhar onde há ROI é a
    // única ordenação que o Prompt fixa (§5) — e não é por acaso.
    .order('receita_esperada', { ascending: false, nullsFirst: false })
    .range(pagina * limite, pagina * limite + limite - 1)

  // Notas não operáveis (remessa, devolução, retorno, transferência, comodato) ficam
  // FORA do funil por padrão: não são crédito a receber, e no topo da fila por
  // receita esperada eram as maiores — uma remessa de demonstração de R$ 1,6 milhão
  // ganha de qualquer venda real. `incluirNaoOperaveis` existe para auditar o que a
  // regra escondeu, já que ela lê natureza em texto livre e erra às vezes.
  if (!filtros.incluirNaoOperaveis) query = query.eq('operavel', true)

  if (filtros.estagio === 'encerradas') query = query.in('estagio_funil', [...ESTAGIOS_ENCERRADOS])
  else if (filtros.estagio) query = query.eq('estagio_funil', filtros.estagio)
  else query = query.in('estagio_funil', [...ESTAGIOS_ABERTOS])

  if (filtros.faixa) query = query.eq('faixa', filtros.faixa)
  if (filtros.tipagem) query = query.eq('fornecedor_tipagem', filtros.tipagem)
  if (typeof filtros.valorMin === 'number') query = query.gte('valor', filtros.valorMin)
  if (filtros.termo?.trim()) {
    const t = `*${filtros.termo.trim()}*`
    query = query.or(
      `fornecedor_nome.ilike.${t},sacado_nome.ilike.${t},fornecedor_cnpj.ilike.${t},sacado_cnpj.ilike.${t},numero.ilike.${t}`,
    )
  }

  const { data, error, count } = await query
  if (error) throw error
  return { notas: (data ?? []) as NotaFunil[], total: count ?? 0 }
}

/**
 * O XML de UMA nota, sob demanda.
 *
 * Deliberadamente fora de `COLUNAS_CARD`: um XML de NFe tem dezenas a centenas de
 * KB, e trazê-lo junto dos 40 cards de uma coluna do Kanban seria baixar megabytes
 * para pintar cabeçalhos que nem o mostram. Só quando o modal abre.
 */
export async function buscarXmlDaNota(
  accessKey: string,
): Promise<{ raw_xml: string | null; xml_parse_erro: string | null }> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('notas_fiscais')
    .select('raw_xml, xml_parse_erro')
    .eq('access_key', accessKey)
    .maybeSingle()
  if (error) throw error
  return { raw_xml: data?.raw_xml ?? null, xml_parse_erro: data?.xml_parse_erro ?? null }
}

export interface CelulaResumo {
  estagio_funil: string
  faixa: string | null
  notas: number
  valor: number
  receita_esperada: number
}

export async function buscarResumoFunil(): Promise<CelulaResumo[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('antecipacao_resumo_funil')
  if (error) throw error
  const r = data as { tem_acesso?: boolean; celulas?: CelulaResumo[] } | null
  if (!r?.tem_acesso) throw new Error('Você não tem acesso ao módulo Antecipação.')
  return r.celulas ?? []
}

export interface MetricaFaixa {
  faixa: string
  regra_versao: number | null
  notas: number
  valor: number
  receita_esperada: number
  contatadas: number
  responderam: number
  convertidas: number
  valor_convertido: number
  perdidas: number
  expiradas: number
}

export async function buscarMetricasFaixa(): Promise<MetricaFaixa[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('antecipacao_metricas_faixa')
  if (error) throw error
  const r = data as { tem_acesso?: boolean; faixas?: MetricaFaixa[] } | null
  if (!r?.tem_acesso) throw new Error('Você não tem acesso ao módulo Antecipação.')
  return r.faixas ?? []
}

/** O contexto de fornecedor do card ("+3 notas · R$ 180k"), em uma leitura. */
export async function buscarFornecedores(cnpjs: readonly string[]): Promise<FornecedorFunil[]> {
  if (cnpjs.length === 0) return []
  const supabase = createClient()
  const { data, error } = await supabase
    .from('antecipacao_fornecedores')
    .select('*')
    .in('fornecedor_cnpj', [...new Set(cnpjs)])
  if (error) throw error
  return (data ?? []) as FornecedorFunil[]
}

export interface DetalheFornecedor {
  fornecedor: FornecedorFunil | null
  notas: NotaFunil[]
  toques: Tables<'empresa_eventos'>[]
}

export async function buscarDetalheFornecedor(cnpj: string): Promise<DetalheFornecedor> {
  const supabase = createClient()
  const [agregado, notas] = await Promise.all([
    supabase.from('antecipacao_fornecedores').select('*').eq('fornecedor_cnpj', cnpj).maybeSingle(),
    supabase
      .from('notas_funil')
      .select(COLUNAS_CARD)
      .eq('fornecedor_cnpj', cnpj)
      .order('receita_esperada', { ascending: false, nullsFirst: false })
      .limit(200),
  ])
  if (agregado.error) throw agregado.error
  if (notas.error) throw notas.error

  // O histórico de toques: outbox (sombra) + toque manual do vendedor. Vem de
  // empresa_eventos, então só existe quando o fornecedor está em `empresas`.
  const empresaId = (agregado.data as FornecedorFunil | null)?.fornecedor_empresa_id ?? null
  let toques: Tables<'empresa_eventos'>[] = []
  if (empresaId) {
    const { data } = await supabase
      .from('empresa_eventos')
      .select('*')
      .eq('empresa_id', empresaId)
      .in('tipo', ['toque.manual', 'outbox.mensagem_gerada'])
      .order('criado_em', { ascending: false })
      .limit(30)
    toques = data ?? []
  }

  return { fornecedor: (agregado.data as FornecedorFunil | null) ?? null, notas: (notas.data ?? []) as NotaFunil[], toques }
}

/**
 * Teto da leitura por sacado. A ordenação da tela é feita no cliente sobre o que
 * veio: são 154 linhas hoje, e refazer a consulta a cada clique de cabeçalho
 * trocaria um `sort` instantâneo por um round-trip. Se um dia a lista bater neste
 * número, a tela avisa que a ordem vale sobre o recorte — ordenar 300 de 400 sem
 * dizer nada é um resultado errado com cara de certo.
 */
export const LIMITE_SACADOS = 300

export async function buscarSacados(): Promise<SacadoFunil[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('antecipacao_sacados')
    .select('*')
    .order('demanda_pipeline', { ascending: false, nullsFirst: false })
    .limit(LIMITE_SACADOS)
  if (error) throw error
  return (data ?? []) as SacadoFunil[]
}

export async function buscarSacadosAProspectar(): Promise<SacadoProspectar[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('antecipacao_sacados_a_prospectar')
    .select('*')
    .order('valor_agregado', { ascending: false, nullsFirst: false })
    .limit(200)
  if (error) throw error
  return (data ?? []) as SacadoProspectar[]
}

/**
 * Quantos sacados ainda não têm CNAE, e por isso NÃO aparecem na lista.
 *
 * O recorte por CNAE tira muito ruído, mas cria uma janela: entre a nota chegar e
 * o lookup cadastral responder, a construtora fica invisível. Mostrar o número é o
 * que impede que essa ausência pareça "não há oportunidade".
 */
export async function contarSacadosSemCnae(): Promise<number> {
  const supabase = createClient()
  const { count } = await supabase
    .from('cnpj_lookup_fila')
    .select('cnpj', { count: 'exact', head: true })
    .eq('motivo', 'sacado_nf')
    .in('status', ['pendente', 'erro'])
  return count ?? 0
}

export interface DetalheSacado {
  sacado: SacadoFunil | null
  prospect: SacadoProspectar | null
  notas: NotaFunil[]
}

/**
 * O sacado e as NFs que ELE RECEBEU.
 *
 * Traz as duas visões agregadas porque a mesma tela serve os dois caminhos: quem
 * chega pela capacidade quer limite vs. demanda; quem chega por "a prospectar"
 * quer volume e desde quando. Uma consulta a menos do que buscar sob demanda.
 */
export async function buscarDetalheSacado(cnpj: string): Promise<DetalheSacado> {
  const supabase = createClient()
  const [capacidade, prospect, notas] = await Promise.all([
    supabase.from('antecipacao_sacados').select('*').eq('sacado_cnpj', cnpj).maybeSingle(),
    supabase
      .from('antecipacao_sacados_a_prospectar')
      .select('*')
      .eq('sacado_cnpj', cnpj)
      .maybeSingle(),
    supabase
      .from('notas_funil')
      .select(COLUNAS_CARD)
      .eq('sacado_cnpj', cnpj)
      .order('emitida_em', { ascending: false, nullsFirst: false })
      .limit(200),
  ])
  if (notas.error) throw notas.error

  return {
    sacado: (capacidade.data as SacadoFunil | null) ?? null,
    prospect: (prospect.data as SacadoProspectar | null) ?? null,
    notas: (notas.data ?? []) as NotaFunil[],
  }
}

export interface RegraFaixa extends Tables<'faixa_regras'> {
  autor_nome: string | null
}

export async function buscarRegrasFaixa(faixa: Faixa): Promise<RegraFaixa[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('faixa_regras')
    .select('*, usuarios!faixa_regras_criada_por_fkey(nome)')
    .eq('faixa', faixa)
    .order('versao', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r) => {
    const { usuarios, ...resto } = r as typeof r & { usuarios: { nome: string } | null }
    return { ...(resto as Tables<'faixa_regras'>), autor_nome: usuarios?.nome ?? null }
  })
}

export async function buscarDisparos(): Promise<Tables<'faixa_disparos'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase.from('faixa_disparos').select('*')
  if (error) throw error
  return data ?? []
}

/** Sem `token_secret_id`: o grant de select nessa coluna foi revogado (0046). */
const COLUNAS_CONTA = 'id, apelido, numero, provedor, token_definido_em, usuario_responsavel, ativo, criada_em'

export type WhatsappConta = Pick<
  Tables<'whatsapp_contas'>,
  'id' | 'apelido' | 'numero' | 'provedor' | 'token_definido_em' | 'usuario_responsavel' | 'ativo' | 'criada_em'
>

export async function buscarContasWhatsapp(): Promise<WhatsappConta[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('whatsapp_contas')
    .select(COLUNAS_CONTA)
    .order('criada_em', { ascending: false })
  if (error) throw error
  return (data ?? []) as WhatsappConta[]
}

export interface FiltrosOutbox {
  canal?: 'email' | 'whatsapp'
  faixa?: Faixa
  status?: string
}

export async function buscarOutbox(filtros: FiltrosOutbox): Promise<Tables<'mensagens_outbox'>[]> {
  const supabase = createClient()
  let query = supabase
    .from('mensagens_outbox')
    .select('*')
    .order('criada_em', { ascending: false })
    .limit(200)
  if (filtros.canal) query = query.eq('canal', filtros.canal)
  if (filtros.faixa) query = query.eq('faixa', filtros.faixa)
  if (filtros.status) query = query.eq('status', filtros.status)
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function buscarConfig(): Promise<Record<string, unknown>> {
  const supabase = createClient()
  const { data, error } = await supabase.from('antecipacao_config').select('chave, valor')
  if (error) throw error
  return Object.fromEntries((data ?? []).map((r) => [r.chave, r.valor]))
}

export interface ResumoFilaLookup {
  pendente: number
  resolvido_api: number
  nao_encontrado: number
  erro: number
}

export async function buscarFilaLookup(): Promise<ResumoFilaLookup> {
  const supabase = createClient()
  const contar = async (status: string) => {
    const { count } = await supabase
      .from('cnpj_lookup_fila')
      .select('cnpj', { count: 'exact', head: true })
      .eq('status', status)
    return count ?? 0
  }
  const [pendente, resolvido, naoEncontrado, erro] = await Promise.all([
    contar('pendente'),
    contar('resolvido_api'),
    contar('nao_encontrado'),
    contar('erro'),
  ])
  return { pendente, resolvido_api: resolvido, nao_encontrado: naoEncontrado, erro }
}
