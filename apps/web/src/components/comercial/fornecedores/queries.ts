import { createClient } from '@/lib/supabase/client'
import type { Tables, Views } from '@jobsiteos/core'

/**
 * Leituras do funil de fornecedores. Todas passam pela RLS — o recorte por originador
 * é do banco, não daqui: um filtro no cliente esconderia o card sem impedir a leitura.
 */

/*
 * O gerador de tipos marca TODA coluna de view como anulável, mesmo as que vêm de uma
 * coluna `not null` — o Postgres não propaga a restrição pela view, e a informação se
 * perde no catálogo. `fornecedor_cnpj` é a chave da tabela e nunca é nulo; estreitá-lo
 * uma vez aqui evita um `?? ''` em cada uso, e cada um desses seria a chance de a tela
 * abrir a ficha de um CNPJ vazio.
 */
export type FornecedorCard = Omit<Views<'fornecedores_funil_view'>, 'fornecedor_cnpj'> & {
  fornecedor_cnpj: string
}
export type ContatoDescoberto = Tables<'contatos_descobertos'>
export type PedidoApresentacao = Tables<'pedidos_apresentacao'>

export const fornecedoresKeys = {
  todos: ['fornecedores'] as const,
  funil: (filtro: string) => ['fornecedores', 'funil', filtro] as const,
  contatos: (cnpj: string) => ['fornecedores', 'contatos', cnpj] as const,
  pedidos: (cnpj: string) => ['fornecedores', 'pedidos', cnpj] as const,
  painel: (id: string | null) => ['fornecedores', 'painel', id] as const,
  eficacia: () => ['fornecedores', 'eficacia'] as const,
  config: () => ['fornecedores', 'config'] as const,
  sacados: (cnpj: string) => ['fornecedores', 'sacados', cnpj] as const,
}

export interface FiltroFunil {
  originadorId: string | null
  /** true mostra o filtro "concluídos" (cadastrado + sem interesse). */
  concluidos: boolean
  termo: string
}

export async function buscarFunil(filtro: FiltroFunil): Promise<FornecedorCard[]> {
  const supabase = createClient()
  let q = supabase
    .from('fornecedores_funil_view')
    .select('*')
    /*
     * QUEM MAIS EMITIU, EM VALOR, PRIMEIRO.
     *
     * A ordem sai de `volume_90d`, não do `potencial_mensal` derivado dele. As duas
     * dão exatamente a mesma sequência — potencial é volume ÷ 3, e as 530 linhas da
     * base concordam linha a linha —, mas ordenar pelo número que a pessoa NÃO vê no
     * card é pedir que ela confie na ordem sem poder conferi-la. O card mostra o
     * volume; a consulta ordena pelo volume.
     *
     * O limite do sacado não entra aqui: ele é o teto da operação, não do lead. Um
     * fornecedor de R$ 900 mil/mês contra um sacado que já usou o limite continua
     * sendo o melhor telefone da lista.
     */
    .order('volume_90d', { ascending: false, nullsFirst: false })
    .limit(500)

  q = filtro.concluidos
    ? q.in('estagio', ['cadastrado', 'sem_interesse'])
    : q.not('estagio', 'in', '("cadastrado","sem_interesse")')

  if (filtro.originadorId === 'sem_dono') q = q.is('originador_id', null)
  else if (filtro.originadorId) q = q.eq('originador_id', filtro.originadorId)

  if (filtro.termo.trim()) {
    const t = filtro.termo.trim().replace(/[%,()]/g, '')
    const digitos = t.replace(/\D/g, '')
    q = digitos.length >= 4
      ? q.ilike('fornecedor_cnpj', `%${digitos}%`)
      : q.ilike('fornecedor_nome', `%${t}%`)
  }

  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []).filter(
    (r): r is FornecedorCard => typeof r.fornecedor_cnpj === 'string',
  )
}

export async function buscarContatosDescobertos(cnpj: string): Promise<ContatoDescoberto[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('contatos_descobertos')
    .select('*')
    .eq('fornecedor_cnpj', cnpj)
    // Confiança primeiro, frequência depois: um telefone visto em 40 notas é outra
    // coisa que um visto numa — mas nenhum dos dois desbanca o campo estruturado.
    .order('confianca', { ascending: true })
    .order('frequencia', { ascending: false })
  if (error) throw new Error(error.message)
  // `order('confianca')` é alfabético em texto: alta < baixa < media. A ordem que
  // importa é semântica, e ela é feita aqui.
  const peso: Record<string, number> = { alta: 3, media: 2, baixa: 1 }
  return (data ?? []).sort(
    (a, b) => (peso[b.confianca] ?? 0) - (peso[a.confianca] ?? 0) || b.frequencia - a.frequencia,
  )
}

export async function buscarPedidos(cnpj: string): Promise<PedidoApresentacao[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('pedidos_apresentacao')
    .select('*')
    .eq('fornecedor_cnpj', cnpj)
    .order('criado_em', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export interface PainelFornecedores {
  tem_acesso: boolean
  eh_gestor?: boolean
  originador_id?: string | null
  por_estagio?: Record<string, number>
  potencial_total?: number
  sem_dono?: number | null
  gasto_mes?: number
  teto_mensal?: number
  ranking?: {
    fornecedor_cnpj: string
    nome: string
    potencial_mensal: number | null
    estagio: string
    contatos_encontrados: number
    melhor_confianca: string | null
  }[]
}

export async function buscarPainelFornecedores(originadorId: string | null): Promise<PainelFornecedores> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fornecedores_painel', {
    p_originador_id: originadorId ?? undefined,
  })
  if (error) throw new Error(error.message)
  return (data ?? { tem_acesso: false }) as unknown as PainelFornecedores
}

export interface LinhaEficacia {
  fonte: string
  contatos_encontrados: number
  contatos_validos: number
  contatos_testados: number
  contatos_promovidos: number
  execucoes: number
  acertos: number
  custo_total: number
  cadastros: number
  custo_por_cadastro: number | null
}

export async function buscarEficacia(): Promise<LinhaEficacia[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fornecedores_eficacia_fontes')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as LinhaEficacia[]
}

export async function buscarConfigFornecedores(): Promise<Record<string, unknown>> {
  const supabase = createClient()
  const { data, error } = await supabase.from('fornecedores_config').select('chave, valor')
  if (error) throw new Error(error.message)
  return Object.fromEntries((data ?? []).map((c) => [c.chave, c.valor]))
}

export interface SacadoDoFornecedor {
  cnpj: string
  nome: string | null
  valor: number
  notas: number
  tem_ponto_focal: boolean
  contato_id: string | null
  contato_nome: string | null
}

/**
 * Os sacados do card, enriquecidos com o ponto focal de cada um.
 *
 * O ponto focal é o que decide a ordem do seletor de "pedir apresentação": o pedido é
 * um favor pessoal, e ele funciona com quem atende, não com quem compra mais.
 */
export async function buscarSacadosDoFornecedor(
  cnpj: string,
  sacados: readonly { cnpj: string; nome: string | null; valor: number; notas: number }[],
): Promise<SacadoDoFornecedor[]> {
  if (sacados.length === 0) return []
  const supabase = createClient()

  const { data: empresas } = await supabase
    .from('empresas')
    .select('id, cnpj')
    .in('cnpj', sacados.map((s) => s.cnpj))

  const ids = (empresas ?? []).map((e) => e.id)
  const { data: focais } = ids.length
    ? await supabase
        .from('contatos')
        .select('id, nome, empresa_id')
        .in('empresa_id', ids)
        .eq('ponto_focal', true)
    : { data: [] }

  const porEmpresa = new Map((focais ?? []).map((c) => [c.empresa_id, c]))
  const empresaPorCnpj = new Map((empresas ?? []).map((e) => [e.cnpj, e.id]))

  return sacados.map((s) => {
    const empresaId = empresaPorCnpj.get(s.cnpj)
    const focal = empresaId ? porEmpresa.get(empresaId) : undefined
    return {
      ...s,
      tem_ponto_focal: Boolean(focal),
      contato_id: focal?.id ?? null,
      contato_nome: focal?.nome ?? null,
    }
  })
}
