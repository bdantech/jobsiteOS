import {
  ESTAGIOS_ABERTOS,
  ESTAGIOS_ENCERRADOS,
  renderizarTemplate,
  formatarMoeda as moedaCore,
  type Faixa,
} from '@jobsiteos/core'

import { supabase } from '@/lib/supabase'
import type {
  DetalheFornecedor,
  FiltrosFunil,
  FornecedorFunil,
  NotaFunil,
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
  'access_key, numero, serie, valor, vencimento, vencimento_origem, dias_para_vencimento, receita_esperada, faixa, faixa_motivo, estagio_funil, fornecedor_cnpj, fornecedor_nome, fornecedor_empresa_id, fornecedor_tipagem, fornecedor_tem_protesto, fornecedor_suprimido, sacado_cnpj, sacado_nome, sacado_empresa_id, sacado_credito_status, sacado_limite_disponivel, sacado_limite_cobre_nota, perda_motivo'

export const PAGINA_FUNIL = 30

export async function fetchFunil(filtros: FiltrosFunil, pagina = 0): Promise<PaginaFunil> {
  let query = supabase
    .from('notas_funil')
    .select(COLUNAS_CARD, { count: 'exact' })
    // Receita esperada decrescente: o vendedor na rua trabalha de cima para baixo,
    // e o topo tem que ser onde há mais ROI.
    .order('receita_esperada', { ascending: false, nullsFirst: false })
    .range(pagina * PAGINA_FUNIL, pagina * PAGINA_FUNIL + PAGINA_FUNIL - 1)

  if (filtros.estagio === 'encerradas') query = query.in('estagio_funil', [...ESTAGIOS_ENCERRADOS])
  else if (filtros.estagio) query = query.eq('estagio_funil', filtros.estagio)
  else query = query.in('estagio_funil', [...ESTAGIOS_ABERTOS])

  if (filtros.faixa) query = query.eq('faixa', filtros.faixa)
  if (filtros.tipagem) query = query.eq('fornecedor_tipagem', filtros.tipagem)

  const termo = (filtros.termo ?? '').replace(/[,()%*\\]/g, ' ').trim()
  if (termo) {
    const t = `*${termo}*`
    query = query.or(
      `fornecedor_nome.ilike.${t},sacado_nome.ilike.${t},fornecedor_cnpj.ilike.${t},sacado_cnpj.ilike.${t},numero.ilike.${t}`,
    )
  }

  const { data, error, count } = await query
  if (error) throw error

  const notas = (data ?? []) as NotaFunil[]
  const fornecedores = await fetchFornecedores(
    notas.map((n) => n.fornecedor_cnpj).filter((c): c is string => Boolean(c)),
  )

  return { notas, fornecedores, total: count ?? 0 }
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
    supabase
      .from('notas_funil')
      .select(COLUNAS_CARD)
      .eq('fornecedor_cnpj', cnpj)
      .order('receita_esperada', { ascending: false, nullsFirst: false })
      .limit(100),
  ])
  if (agregado.error) throw agregado.error
  if (notasRes.error) throw notasRes.error

  const fornecedor = (agregado.data as FornecedorFunil | null) ?? null
  const notas = (notasRes.data ?? []) as NotaFunil[]
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
  notas: readonly NotaFunil[],
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

function cnpjLegivel(notas: readonly NotaFunil[]): string {
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

export async function fetchSacadosAProspectar(): Promise<SacadoProspectar[]> {
  const { data, error } = await supabase
    .from('antecipacao_sacados_a_prospectar')
    .select('*')
    .order('valor_agregado', { ascending: false, nullsFirst: false })
    .limit(100)
  if (error) throw error
  return (data ?? []) as SacadoProspectar[]
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
