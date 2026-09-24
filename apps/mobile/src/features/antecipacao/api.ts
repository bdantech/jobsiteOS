import {
  ESTAGIOS_ABERTOS,
  ESTAGIOS_ENCERRADOS,
  TIPOS_OPORTUNIDADE,
  VIEW_DA_FONTE,
  juntarPaginas,
  renderizarTemplate,
  formatarMoeda as moedaCore,
  type Faixa,
  type TipoOportunidade,
} from '@jobsiteos/core'

import { supabase } from '@/lib/supabase'
import type {
  DetalheFornecedor,
  DetalheSacado,
  FiltrosFunil,
  FornecedorFunil,
  NotaFunil,
  Oportunidade,
  PaginaFunil,
  SacadoFunil,
  SacadoProspectar,
} from './types'

/**
 * As leituras do módulo no mobile.
 *
 * Toda consulta bate na view `notas_funil` (ou nos agregados dela), que é
 * security_invoker: a RLS decide as linhas, e o client singleton com a sessão do
 * usuário é o único que o celular tem — não existe service role num telefone.
 *
 * O contexto de fornecedor vem em UMA leitura extra por página, não em uma por
 * card: escrever "+3 notas" em 30 cards não pode custar 30 requisições numa rede
 * 4G de obra.
 */

/** Em UMA string literal: supabase-js parseia o select no nível de tipo. */
const COLUNAS_CARD =
  'access_key, numero, serie, valor, vencimento, vencimento_origem, dias_para_vencimento, receita_esperada, tac_estimada, seguro_estimado, faixa, faixa_motivo, estagio_funil, fornecedor_cnpj, fornecedor_nome, fornecedor_empresa_id, fornecedor_tipagem, fornecedor_tem_protesto, fornecedor_suprimido, sacado_cnpj, sacado_nome, sacado_empresa_id, sacado_credito_status, sacado_limite_disponivel, sacado_limite_cobre_nota, perda_motivo'

/**
 * As colunas do card do funil, agora nas TRÊS fontes.
 *
 * `linha_contexto` vem pronta do banco e é a única linha que varia por tipo — a
 * frase depende de dados que só a fonte tem (quantas parcelas o título tem, qual
 * o guardReason, quantos dias faltam para a oferta expirar). Montá-la aqui
 * exigiria trazer todos esses campos para pintar um texto.
 *
 * `conversao_*` e `pre_autorizacao_*` são o que faltava no celular: sem elas o
 * app mostrava como trabalho a fazer 259 notas que já foram antecipadas.
 */
const COLUNAS_OPORTUNIDADE =
  'tipo, id, access_key, valor, vencimento, dias_para_vencimento, data_base, numero_exibicao, linha_contexto, estado_origem, relogio, receita_esperada, taxa_usada, tac_estimada, seguro_estimado, faixa, faixa_motivo, estagio_funil, perda_motivo, operavel, credor_pessoa_fisica, fornecedor_cnpj, fornecedor_nome, fornecedor_empresa_id, fornecedor_tipagem, fornecedor_tem_protesto, fornecedor_suprimido, sacado_cnpj, sacado_nome, sacado_matriz_cnpj, sacado_empresa_id, sacado_credito_status, sacado_limite_disponivel, sacado_limite_cobre_valor, pre_autorizacao_id, pre_autorizacao_status, pre_autorizacao_em, conversao_antecipacao_id, conversao_em_disputa, conversao_valor, conversao_taxa'

export const PAGINA_FUNIL = 30

export async function fetchFunil(filtros: FiltrosFunil, pagina = 0): Promise<PaginaFunil> {
  /*
   * UMA CONSULTA POR FONTE, e a junção no cliente.
   *
   * Ler `funil_oportunidades` (a união) com `order` + `range` seria mais curto e
   * está errado: o `union all` é BARREIRA DE OTIMIZAÇÃO — o `Append` impede que
   * o ordenar-e-cortar chegue ao índice de cada fonte. Na web isso levou a
   * primeira página de 1,85 ms para 8.382 ms e tirou o funil do ar.
   *
   * Pedir `(pagina+1) * limite` de cada fonte é o que torna a junção correta: o
   * top-N global é sempre subconjunto da união dos top-N de cada fonte.
   */
  const ate = (pagina + 1) * PAGINA_FUNIL

  const consulta = (tipo: TipoOportunidade) => {
    let q = supabase
      .from(VIEW_DA_FONTE[tipo])
      .select(COLUNAS_OPORTUNIDADE, { count: 'exact' })
      // Receita esperada decrescente: o vendedor na rua trabalha de cima para
      // baixo, e o topo tem que ser onde há mais ROI.
      .order('receita_esperada', { ascending: false, nullsFirst: false })
      /*
       * O DESEMPATE por `id`. `range` é OFFSET: sem uma última chave única, duas
       * linhas de mesma receita trocam de lugar entre páginas e um card aparece
       * duas vezes enquanto outro nunca aparece.
       */
      .order('id', { ascending: true })
      .range(0, ate - 1)
      // Fornecedor sem interesse sai do funil, aqui como na web. Um filtro que só
      // o desktop respeita faria o vendedor na rua ligar para quem o escritório
      // já descartou.
      .eq('fornecedor_sem_interesse', false)

    if (filtros.estagio === 'encerradas') q = q.in('estagio_funil', [...ESTAGIOS_ENCERRADOS])
    else if (filtros.estagio) q = q.eq('estagio_funil', filtros.estagio)
    else q = q.in('estagio_funil', [...ESTAGIOS_ABERTOS])

    // As três fontes têm `vendedor_id`: a nota, a pré-autorização e o título são
    // roteados para uma carteira pela mesma regra.
    if (filtros.vendedorId) q = q.eq('vendedor_id', filtros.vendedorId)
    if (filtros.faixa) q = q.eq('faixa', filtros.faixa)
    if (filtros.tipagem) q = q.eq('fornecedor_tipagem', filtros.tipagem)

    const termo = (filtros.termo ?? '').replace(/[,()%*\\]/g, ' ').trim()
    if (termo) {
      const t = `*${termo}*`
      // `numero_exibicao` no lugar de `numero`: é a coluna que as três fontes
      // têm. `numero` só existe na nota, e buscar por ele calaria as outras duas.
      q = q.or(
        `fornecedor_nome.ilike.${t},sacado_nome.ilike.${t},fornecedor_cnpj.ilike.${t},sacado_cnpj.ilike.${t},numero_exibicao.ilike.${t}`,
      )
    }
    return q
  }

  const respostas = await Promise.all(TIPOS_OPORTUNIDADE.map((t) => consulta(t)))

  const erro = respostas.find((r) => r.error)?.error
  if (erro) throw erro

  const oportunidades = juntarPaginas(
    respostas.map((r) => (r.data ?? []) as unknown as Oportunidade[]),
    { coluna: 'receita_esperada', ascendente: false, pagina, limite: PAGINA_FUNIL },
  )

  const fornecedores = await fetchFornecedores(
    oportunidades.map((o) => o.fornecedor_cnpj).filter((c): c is string => Boolean(c)),
  )

  return {
    oportunidades,
    fornecedores,
    total: respostas.reduce((s, r) => s + (r.count ?? 0), 0),
  }
}

async function fetchFornecedores(cnpjs: readonly string[]): Promise<Map<string, FornecedorFunil>> {
  const unicos = [...new Set(cnpjs)]
  if (unicos.length === 0) return new Map()

  const { data, error } = await supabase
    .from('antecipacao_fornecedores')
    .select('*')
    .in('fornecedor_cnpj', unicos)
  if (error) throw error

  const mapa = new Map<string, FornecedorFunil>()
  for (const f of (data ?? []) as FornecedorFunil[]) {
    if (f.fornecedor_cnpj) mapa.set(f.fornecedor_cnpj, f)
  }
  return mapa
}

/**
 * O detalhe do fornecedor: notas vivas, contatos (ponto focal primeiro), toques e a
 * mensagem sugerida.
 *
 * A mensagem sai do MESMO template da faixa que a outbox usaria, renderizado com o
 * MESMO `renderizarTemplate` do core. Se o app do vendedor escrevesse o próprio
 * texto, a mensagem enviada à mão e a mensagem automática divergiriam — e a régua
 * que a Outbox valida deixaria de descrever o que o fornecedor de fato recebe.
 */
export async function fetchDetalheFornecedor(cnpj: string): Promise<DetalheFornecedor> {
  const [agregado, notasRes] = await Promise.all([
    supabase.from('antecipacao_fornecedores').select('*').eq('fornecedor_cnpj', cnpj).maybeSingle(),
    /*
     * Aqui a UNIÃO pode ser lida direto, ao contrário do funil.
     *
     * A barreira do `union all` só machuca quando se ordena e corta um conjunto
     * grande: o `Append` impede que o top-N chegue ao índice de cada fonte.
     * Filtrando por UM fornecedor, o filtro desce para dentro de cada ramo e o
     * que volta são poucas linhas — a ordenação acontece sobre elas.
     */
    supabase
      .from('funil_oportunidades')
      .select(COLUNAS_OPORTUNIDADE)
      .eq('fornecedor_cnpj', cnpj)
      .order('receita_esperada', { ascending: false, nullsFirst: false })
      .limit(100),
  ])
  if (agregado.error) throw agregado.error
  if (notasRes.error) throw notasRes.error

  const fornecedor = (agregado.data as FornecedorFunil | null) ?? null
  const notas = (notasRes.data ?? []) as unknown as Oportunidade[]
  const empresaId = fornecedor?.fornecedor_empresa_id ?? notas[0]?.fornecedor_empresa_id ?? null

  const [contatosRes, toquesRes, mensagem] = await Promise.all([
    empresaId
      ? supabase
          .from('contatos')
          .select('*')
          .eq('empresa_id', empresaId)
          .order('ponto_focal', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    empresaId
      ? supabase
          .from('empresa_eventos')
          .select('*')
          .eq('empresa_id', empresaId)
          .in('tipo', ['toque.manual', 'outbox.mensagem_gerada'])
          .order('criado_em', { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
    montarMensagem(fornecedor, notas),
  ])

  return {
    fornecedor,
    notas,
    contatos: contatosRes.data ?? [],
    toques: toquesRes.data ?? [],
    mensagemSugerida: mensagem,
  }
}

async function montarMensagem(
  fornecedor: FornecedorFunil | null,
  notas: readonly Oportunidade[],
): Promise<string | null> {
  const faixa = (fornecedor?.melhor_faixa ?? notas.find((n) => n.faixa)?.faixa) as Faixa | undefined
  if (!faixa) return null

  const { data } = await supabase
    .from('faixa_disparos')
    .select('template_whatsapp')
    .eq('faixa', faixa)
    .maybeSingle()
  const template = data?.template_whatsapp
  if (!template) return null

  const vivas = notas.filter((n) => n.faixa !== null)
  const valorTotal = vivas.reduce((s, n) => s + Number(n.valor ?? 0), 0)
  const receita = vivas.reduce((s, n) => s + Number(n.receita_esperada ?? 0), 0)

  // O sacado com maior valor agregado é de quem a mensagem fala.
  const porSacado = new Map<string, number>()
  for (const n of vivas) {
    const chave = n.sacado_nome ?? n.sacado_cnpj ?? '—'
    porSacado.set(chave, (porSacado.get(chave) ?? 0) + Number(n.valor ?? 0))
  }
  const principal = [...porSacado.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'

  return renderizarTemplate(template, {
    fornecedor_nome: fornecedor?.fornecedor_nome ?? cnpjLegivel(notas),
    qtd_notas: String(vivas.length),
    valor_total: moedaCore(valorTotal),
    sacado_principal: principal,
    receita_estimada_fornecedor: moedaCore(receita),
  })
}

function cnpjLegivel(notas: readonly Oportunidade[]): string {
  return notas[0]?.fornecedor_cnpj ?? 'fornecedor'
}

export async function fetchSacados(): Promise<SacadoFunil[]> {
  const { data, error } = await supabase
    .from('antecipacao_sacados')
    .select('*')
    .order('demanda_pipeline', { ascending: false, nullsFirst: false })
    .limit(100)
  if (error) throw error
  return (data ?? []) as SacadoFunil[]
}

/**
 * O sacado e as NFs que ELE RECEBEU. Serve os dois caminhos (capacidade e
 * prospecção), por isso traz as duas leituras agregadas.
 */
export async function fetchDetalheSacado(cnpj: string): Promise<DetalheSacado> {
  const [capacidade, prospect, notas] = await Promise.all([
    supabase.from('antecipacao_sacados').select('*').eq('sacado_cnpj', cnpj).maybeSingle(),
    supabase
      .from('antecipacao_sacados_a_prospectar')
      .select('*')
      .eq('sacado_cnpj', cnpj)
      .maybeSingle(),
    supabase
      .from('funil_oportunidades')
      .select(COLUNAS_OPORTUNIDADE)
      .eq('sacado_cnpj', cnpj)
      // `data_base` e não `emitida_em`: a nota é emitida, a oferta é criada e a
      // parcela é vista pela primeira vez. É a coluna que as três fontes têm.
      .order('data_base', { ascending: false, nullsFirst: false })
      .limit(100),
  ])
  if (notas.error) throw notas.error
  return {
    sacado: (capacidade.data as SacadoFunil | null) ?? null,
    prospect: (prospect.data as SacadoProspectar | null) ?? null,
    notas: (notas.data ?? []) as unknown as Oportunidade[],
  }
}

/**
 * Quantos sacados ainda não têm CNAE e por isso NÃO aparecem em "a prospectar".
 * Mostrar o número é o que impede a ausência de parecer "não há oportunidade".
 */
export async function fetchSacadosSemCnae(): Promise<number> {
  const { count } = await supabase
    .from('cnpj_lookup_fila')
    .select('cnpj', { count: 'exact', head: true })
    .eq('motivo', 'sacado_nf')
    .in('status', ['pendente', 'erro'])
  return count ?? 0
}

/**
 * O XML de UMA nota, sob demanda.
 *
 * Fora de `COLUNAS_CARD` de propósito: são dezenas a centenas de KB por nota, e o
 * funil pinta 30 cards de uma vez — numa rede de obra isso é a diferença entre a
 * lista abrir e a lista travar.
 */
export async function fetchXmlDaNota(
  accessKey: string,
): Promise<{ raw_xml: string | null; xml_parse_erro: string | null; link_antecipacao: string | null }> {
  const { data, error } = await supabase
    .from('notas_fiscais')
    /*
     * O LINK vem de carona nesta leitura, que a folha do documento já faz.
     *
     * Ele leva quem EMITIU a nota ao pedido de antecipação já preenchido — é
     * exatamente o que o vendedor na rua precisa mandar ao fornecedor, e antes
     * só existia na web. Uma consulta própria seria uma requisição a mais numa
     * rede 4G de obra para buscar um texto.
     */
    .select('raw_xml, xml_parse_erro, link_antecipacao')
    .eq('access_key', accessKey)
    .maybeSingle<{ raw_xml: string | null; xml_parse_erro: string | null; link_antecipacao: string | null }>()
  if (error) throw error
  return {
    raw_xml: data?.raw_xml ?? null,
    xml_parse_erro: data?.xml_parse_erro ?? null,
    link_antecipacao: data?.link_antecipacao ?? null,
  }
}

/** O mínimo operável, que define os cortes de urgência do card. */
export async function fetchMinimoOperavel(): Promise<number> {
  const { data } = await supabase
    .from('antecipacao_config')
    .select('valor')
    .eq('chave', 'funil')
    .maybeSingle()
  const v = data?.valor as { minimo_operavel_dias?: number } | null
  return v?.minimo_operavel_dias ?? 7
}
