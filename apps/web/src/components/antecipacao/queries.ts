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
export type FornecedorProspectar = Views<'antecipacao_fornecedores_a_prospectar'>
export type FornecedorSemInteresse = Views<'antecipacao_fornecedores_sem_interesse'>

export const antecipacaoKeys = {
  all: ['antecipacao'] as const,
  funil: (filtros: FiltrosFunil) => [...antecipacaoKeys.all, 'funil', filtros] as const,
  resumo: () => [...antecipacaoKeys.all, 'resumo'] as const,
  metricas: () => [...antecipacaoKeys.all, 'metricas'] as const,
  fornecedor: (cnpj: string) => [...antecipacaoKeys.all, 'fornecedor', cnpj] as const,
  sacados: () => [...antecipacaoKeys.all, 'sacados'] as const,
  prospectar: () => [...antecipacaoKeys.all, 'prospectar'] as const,
  prospectarPendentes: () => [...antecipacaoKeys.all, 'prospectar', 'pendentes'] as const,
  prospectarFornecedores: () => [...antecipacaoKeys.all, 'prospectar-fornecedores'] as const,
  fornecedoresSemInteresse: () =>
    [...antecipacaoKeys.all, 'prospectar-fornecedores', 'sem-interesse'] as const,
  sacado: (cnpj: string) => [...antecipacaoKeys.all, 'sacado', cnpj] as const,
  regras: (faixa: Faixa) => [...antecipacaoKeys.all, 'regras', faixa] as const,
  disparos: () => [...antecipacaoKeys.all, 'disparos'] as const,
  contas: () => [...antecipacaoKeys.all, 'contas'] as const,
  outbox: (filtros: FiltrosOutbox) => [...antecipacaoKeys.all, 'outbox', filtros] as const,
  config: () => [...antecipacaoKeys.all, 'config'] as const,
  antecipacoes: (filtros: FiltrosAntecipacoes) =>
    [...antecipacaoKeys.all, 'antecipacoes', filtros] as const,
  conversoes: (dias: number) => [...antecipacaoKeys.all, 'conversoes', dias] as const,
  candidatas: (idExterno: number) => [...antecipacaoKeys.all, 'candidatas', idExterno] as const,
  calibracao: () => [...antecipacaoKeys.all, 'calibracao'] as const,
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
  /**
   * Só as notas roteadas para este vendedor. É o que separa "o funil de NFs do
   * originador" da fila inteira, que é a tela do gestor.
   */
  vendedorId?: string
}

/**
 * As colunas do card. Em UMA string literal: supabase-js parseia o select no
 * nível de tipo, e concatenar vários literais estoura o parser — o resultado
 * degrada em silêncio para `GenericStringError`.
 *
 * `fornecedor_uf`, `fornecedor_protesto_valor` e `fornecedor_protesto_em` não são do
 * card: são da ficha do fornecedor, que lê pelo MESMO select. Faltavam aqui, e o
 * efeito era a tela de protesto inteira ficar cega — `consultadoEm` chegava sempre
 * `undefined`, então o card dizia "nunca consultamos este CNPJ" mesmo depois da
 * consulta paga, escondia o valor protestado e cobrava o preço da base nacional
 * porque a UF também não vinha. Três colunas a mais por card é barato perto disso.
 */
const COLUNAS_CARD =
  'access_key, numero, serie, valor, vencimento, vencimento_origem, natureza_operacao, operavel, nao_operavel_motivo, dias_para_vencimento, receita_esperada, faixa, faixa_motivo, estagio_funil, fornecedor_cnpj, fornecedor_nome, fornecedor_empresa_id, fornecedor_tipagem, fornecedor_uf, fornecedor_tem_protesto, fornecedor_protesto_valor, fornecedor_protesto_em, fornecedor_suprimido, fornecedor_sem_interesse, sacado_cnpj, sacado_nome, sacado_empresa_id, sacado_credito_status, sacado_limite_disponivel, sacado_limite_cobre_nota, perda_motivo, conversao_antecipacao_id, conversao_em_disputa, conversao_valor, conversao_taxa'

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

  // Fornecedor que já disse que não vai se cadastrar sai dos DOIS funis — o do gestor
  // e o do vendedor, que são esta mesma função. Sem isto, a decisão tomada uma vez na
  // lista de prospecção teria de ser lembrada nota a nota, todo dia, por quem trabalha
  // o Kanban. Vale também para as encerradas: a nota some da tela, não do banco, e
  // volta inteira quando alguém reverte o descarte.
  query = query.eq('fornecedor_sem_interesse', false)

  if (filtros.estagio === 'encerradas') query = query.in('estagio_funil', [...ESTAGIOS_ENCERRADOS])
  else if (filtros.estagio) query = query.eq('estagio_funil', filtros.estagio)
  else query = query.in('estagio_funil', [...ESTAGIOS_ABERTOS])

  if (filtros.vendedorId) query = query.eq('vendedor_id', filtros.vendedorId)
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

/**
 * Mesma lógica do teto por sacado: a ordenação da tela roda sobre o que veio.
 *
 * Era 200, e a lista já tem 279 construtoras — 79 estavam sendo cortadas em
 * silêncio, e nada na tela dizia isso. 500 dá folga real; se um dia encostar, a
 * tela avisa que a ordem vale sobre o recorte.
 */
export const LIMITE_PROSPECTAR = 500

export async function buscarSacadosAProspectar(): Promise<SacadoProspectar[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('antecipacao_sacados_a_prospectar')
    .select('*')
    .order('valor_agregado', { ascending: false, nullsFirst: false })
    .limit(LIMITE_PROSPECTAR)
  if (error) throw error
  return (data ?? []) as SacadoProspectar[]
}

/**
 * Teto da lista de fornecedores a prospectar. Dimensionado para NÃO morder.
 *
 * Era 500, e cortava lead bom em silêncio. O caso que expôs: DIAGRAMA AR
 * CONDICIONADO emitiu UMA nota de R$ 644 mil para um sacado aprovado — 14º maior
 * valor da lista inteira, e 1.233º em número de notas. Truncar por contagem de
 * notas a deixava fora da tela.
 *
 * O problema é estrutural, não daquele CNPJ: 826 dos 1.808 fornecedores têm
 * exatamente uma nota e somam R$ 9,4 mi. Ordenar por qualquer outra coluna sobre um
 * recorte feito por contagem responde a pergunta errada, e o aviso no rodapé
 * explicava o defeito em vez de corrigi-lo.
 *
 * 1.808 linhas são 741 kB numa leitura só — barato o bastante para trazer tudo e
 * deixar a ordenação do cliente valer sobre a lista inteira. O teto continua aqui
 * como rede: se a janela de 90 dias crescer além dele, a tela volta a avisar.
 */
export const LIMITE_PROSPECTAR_FORNECEDORES = 3000

/**
 * O tamanho da página. NÃO é escolha de gosto: o PostgREST tem um teto próprio de
 * linhas por resposta (1.000 por padrão no Supabase) e **ignora em silêncio** um
 * `.limit()` maior — não erra, não avisa, só devolve menos.
 *
 * Foi assim que subir o teto de 500 para 3.000 trouxe 1.000 linhas em vez das 1.808:
 * mais fornecedores do que antes, o suficiente para parecer resolvido, e ainda sem o
 * lead de R$ 644 mil que estava na 1.233ª posição.
 */
const PAGINA_PROSPECTAR = 1000

export async function buscarFornecedoresAProspectar(): Promise<FornecedorProspectar[]> {
  const supabase = createClient()
  const linhas: FornecedorProspectar[] = []

  let inicio = 0
  while (inicio < LIMITE_PROSPECTAR_FORNECEDORES) {
    const fim = Math.min(inicio + PAGINA_PROSPECTAR, LIMITE_PROSPECTAR_FORNECEDORES) - 1
    const { data, error } = await supabase
      .from('antecipacao_fornecedores_a_prospectar')
      .select('*')
      // A ordem do PEDIDO: quem mais emitiu contra sacado aprovado, primeiro.
      .order('notas', { ascending: false, nullsFirst: false })
      // O DESEMPATE É OBRIGATÓRIO, não cosmético. 826 fornecedores empatam em uma
      // nota; sem uma segunda chave, o banco pode devolvê-los em ordens diferentes
      // a cada página e a paginação passa a repetir linhas e pular outras.
      .order('fornecedor_cnpj', { ascending: true })
      .range(inicio, fim)
    if (error) throw error

    const pagina = (data ?? []) as FornecedorProspectar[]
    if (pagina.length === 0) break
    linhas.push(...pagina)

    // Avança pelo que VEIO, não pelo que foi pedido: se o teto do servidor for menor
    // que a página, tratar a resposta curta como "acabou" pararia no meio da lista.
    inicio += pagina.length
  }

  return linhas
}

/**
 * Os descartados: quem já foi trabalhado e não vai se cadastrar.
 *
 * Sem paginação, e não por descuido — a lista a prospectar precisa dela porque tem
 * 1.951 linhas vindas de uma janela de 90 dias, e esta aqui só cresce por clique
 * humano. Se um dia passar de mil, o teto do PostgREST corta em silêncio (foi o que
 * aconteceu na irmã dela), então o aviso vem no rodapé da tela.
 */
export async function buscarFornecedoresSemInteresse(): Promise<FornecedorSemInteresse[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('antecipacao_fornecedores_sem_interesse')
    .select('*')
    // Os mais recentes primeiro: quem quer conferir um descarte acabou de fazê-lo.
    .order('marcado_em', { ascending: false })
    .limit(1000)
  if (error) throw error
  return (data ?? []) as FornecedorSemInteresse[]
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

// ─── Antecipações & conversão (04e) ─────────────────────────────────────────

export type Antecipacao = Tables<'antecipacoes'>

export interface FiltrosAntecipacoes {
  /** `match_status`. `revisao` e `sem_nf` são a FILA; o resto é a tabela. */
  matchStatus?: string
  status?: string
  termo?: string
  /** Só as que precisam de decisão humana — o modo em que a tela abre. */
  soPendencias?: boolean
}

export const LIMITE_ANTECIPACOES = 300

/**
 * Em UMA string literal: supabase-js parseia o select no nível de tipo e a
 * concatenação degrada para `GenericStringError`. Sem `raw` — o payload cru é
 * dezenas de KB por linha e ninguém o lê numa tabela.
 */
const COLUNAS_ANTECIPACAO =
  'id_externo, status, status_anterior, anticipation_type, document_number, numero_normalizado, sacado_cnpj, sacado_nome, fornecedor_cnpj, fornecedor_nome, request_date, created_at_plataforma, original_due_date, completion_date, anticipation_days, gross_value, net_value, total_spread, monthly_interest_rate, invoice_cancelled_at, access_key_casada, match_status, match_confianca, match_motivo, match_candidatas, match_em, match_observacao, sem_nf_definitivo_em, convertida_em, regrediu_em, sincronizada_em'

export async function buscarAntecipacoes(filtros: FiltrosAntecipacoes): Promise<Antecipacao[]> {
  const supabase = createClient()
  let query = supabase
    .from('antecipacoes')
    .select(COLUNAS_ANTECIPACAO)
    .order('created_at_plataforma', { ascending: false, nullsFirst: false })
    .limit(LIMITE_ANTECIPACOES)

  if (filtros.soPendencias) query = query.in('match_status', ['revisao', 'sem_nf'])
  else if (filtros.matchStatus) query = query.eq('match_status', filtros.matchStatus)
  if (filtros.status) query = query.eq('status', filtros.status)
  if (filtros.termo?.trim()) {
    const t = `*${filtros.termo.trim()}*`
    query = query.or(
      `fornecedor_nome.ilike.${t},sacado_nome.ilike.${t},fornecedor_cnpj.ilike.${t},sacado_cnpj.ilike.${t},document_number.ilike.${t}`,
    )
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Antecipacao[]
}

export interface StatusConversoes {
  tem_acesso: boolean
  dias: number
  total: number
  casadas: number
  convertidas: number
  valor_convertido: number
  taxa_media: number | null
  pendentes_revisao: number
  sem_nf_definitivo: number
  em_disputa: number
  por_status: Record<string, number>
}

export async function buscarStatusConversoes(dias: number): Promise<StatusConversoes> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('antecipacao_status_conversoes', { p: { dias } })
  if (error) throw error
  const r = (data ?? {}) as Partial<StatusConversoes>
  if (!r.tem_acesso) throw new Error('Você não tem acesso ao módulo Antecipação.')
  return {
    tem_acesso: true,
    dias: r.dias ?? dias,
    total: r.total ?? 0,
    casadas: r.casadas ?? 0,
    convertidas: r.convertidas ?? 0,
    valor_convertido: Number(r.valor_convertido ?? 0),
    taxa_media: r.taxa_media ?? null,
    pendentes_revisao: r.pendentes_revisao ?? 0,
    sem_nf_definitivo: r.sem_nf_definitivo ?? 0,
    em_disputa: r.em_disputa ?? 0,
    por_status: r.por_status ?? {},
  }
}

export interface CandidataNota {
  access_key: string
  numero: string | null
  serie: string | null
  valor: number | null
  vencimento: string | null
  emitida_em: string | null
  estagio_funil: string
  faixa: string | null
  ja_casada: boolean
  proximidade: string
}

export interface CandidatasDaAntecipacao {
  encontrada: boolean
  antecipacao: Antecipacao | null
  candidatas: CandidataNota[]
}

/**
 * As NFs do MESMO par fornecedor↔sacado, ordenadas por proximidade.
 *
 * Via RPC e não por consulta montada aqui: o recorte por par é a única guarda que
 * o casamento não negocia, e deixá-la na tela seria deixar a tela poder afrouxá-la.
 */
export async function buscarCandidatas(idExterno: number): Promise<CandidatasDaAntecipacao> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('antecipacao_candidatas', {
    p: { id_externo: idExterno },
  })
  if (error) throw error
  const r = (data ?? {}) as Partial<CandidatasDaAntecipacao>
  return {
    encontrada: r.encontrada ?? false,
    antecipacao: r.antecipacao ?? null,
    candidatas: r.candidatas ?? [],
  }
}

export interface CalibracaoCarteiraSalva {
  janela_dias: number
  amostras: number
  calculado_em: string | null
  calibracao: {
    taxa_am: { valor: number | null; n: number }
    prazo_dias: { valor: number | null; n: number }
    valor_medio_nf: { valor: number | null; n: number }
  }
  configurado: {
    taxa_mensal_padrao: number
    taxa_padrao_am: number
    prazo_medio_dias: number
    valor_medio_nf: number
  }
  desvios: {
    taxa_funil_pct: number | null
    taxa_credito_pct: number | null
    prazo_pct: number | null
    valor_medio_nf_pct: number | null
  }
}

/**
 * O resultado do último job de calibração. Vem de `antecipacao_config` e não de
 * um cálculo ao vivo — a data do cálculo aparece ao lado do número, porque um
 * número sem data é um número que ninguém sabe se pode usar.
 */
export async function buscarCalibracao(): Promise<CalibracaoCarteiraSalva | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('antecipacao_config')
    .select('valor')
    .eq('chave', 'calibracao_carteira')
    .maybeSingle()
  if (error) throw error
  return (data?.valor as CalibracaoCarteiraSalva | undefined) ?? null
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
