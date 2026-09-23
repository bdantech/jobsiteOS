import type { Json } from '@jobsiteos/core'

import { supabase } from '@/lib/supabase'
import type {
  ConfigProspeccao,
  PedidoApresentacao,
  NotasDoCard,
  PainelProspeccao,
  QuebraFornecedor,
  SacadoProspeccao,
} from './types'

/**
 * As leituras do funil de Sacados por NF (04r) no celular.
 *
 * Mesma superfície da web — a view `sacados_prospeccao_view`, `security_invoker` —, e o
 * mesmo motivo: a RLS é quem recorta, e duas respostas para "quanto este sacado recebeu"
 * é como o card do desktop e o do celular passam a discordar na frente do cliente.
 *
 * AS NOTAS SÃO A EXCEÇÃO, e por segurança e não por estilo: a policy de `notas_fiscais`
 * recorta por vendedor da nota ou carteira de empresa, e o originador deste funil não é
 * nenhum dos dois — o sacado NÃO é cliente, que é o ponto da feature. Lidas direto,
 * viriam VAZIAS com cara de resposta certa. Vêm pela RPC, autorizada pelo card.
 */

/** Em UMA string literal: o supabase-js parseia o select no nível de tipo. */
const COLUNAS_CARD =
  'id, cnpj_sacado, sacado_nome, municipio, uf, cnae_principal, porte_rfb, empresa_id, originador_id, originador_nome, estagio, volume_30d, valor_operavel, qtd_nfs_30d, qtd_fornecedores, meses_com_emissao_6m, media_mensal_6m, ultima_nf_em, prazo_minimo_operavel_dias, prazo_minimo_origem, score_credito, score_completude, chance_concessao, limite_potencial, valor_esperado_mensal, analise_estagio, condicao_taxa_am, condicao_tac, condicao_publicada_em, condicao_expira_em'

/**
 * No celular a lista é PLANA e ordenada por valor esperado, não um kanban.
 *
 * O originador em campo não arrasta card entre colunas com uma mão: ele quer saber o
 * que trabalhar agora. O estágio vira um chip dentro do card, e a coluna vira filtro.
 */
export async function fetchSacadosProspeccao(estagio?: string): Promise<SacadoProspeccao[]> {
  let q = supabase
    .from('sacados_prospeccao_view')
    .select(COLUNAS_CARD)
    .order('valor_esperado_mensal', { ascending: false, nullsFirst: false })
    .limit(100)

  if (estagio) q = q.eq('estagio', estagio)
  else {
    q = q.in('estagio', [
      'identificado',
      'fornecedor_consultado',
      'apresentacao_solicitada',
      'analise_solicitada',
      'em_analise',
    ])
  }

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as SacadoProspeccao[]
}

export async function fetchPainelProspeccao(): Promise<PainelProspeccao> {
  const { data, error } = await supabase.rpc('prospeccao_painel', { p_originador_id: null })
  if (error) throw error
  return (data ?? { tem_acesso: false }) as unknown as PainelProspeccao
}

export async function fetchQuebraFornecedores(
  sacadoProspeccaoId: string,
): Promise<QuebraFornecedor[]> {
  const { data, error } = await supabase
    .from('sacados_prospeccao_fornecedores')
    .select('*')
    .eq('sacado_prospeccao_id', sacadoProspeccaoId)
    .order('valor_30d', { ascending: false, nullsFirst: false })
  if (error) throw error
  return data ?? []
}

export async function fetchNotasDoCard(
  cnpjSacado: string,
  fornecedorCnpj: string | null,
): Promise<NotasDoCard> {
  const { data, error } = await supabase.rpc('prospeccao_notas', {
    p: { cnpj_sacado: cnpjSacado, fornecedor_cnpj: fornecedorCnpj } as unknown as Json,
  })
  if (error) throw error
  return data as unknown as NotasDoCard
}

/**
 * Os defaults repetem os do banco de propósito: a lista precisa renderizar antes de a
 * config chegar, e um card que aparece sem régua ("operável" sem dizer acima de quantos
 * dias) é pior que um card que demora.
 */
export const CONFIG_PROSPECCAO_PADRAO: ConfigProspeccao = {
  janelas: { janela_emissao_dias: 30, janela_recorrencia_meses: 6 },
  motivos_descarte: [],
  templates: { abordagem_fornecedor: '', pedido_ponte: '' },
}

export async function fetchConfigProspeccao(): Promise<ConfigProspeccao> {
  const { data, error } = await supabase
    .from('prospeccao_config')
    .select('chave, valor')
    .in('chave', ['janelas', 'motivos_descarte', 'templates'])
  if (error) throw error
  const porChave = new Map((data ?? []).map((c) => [c.chave, c.valor]))
  return {
    janelas:
      (porChave.get('janelas') as ConfigProspeccao['janelas'] | undefined) ??
      CONFIG_PROSPECCAO_PADRAO.janelas,
    motivos_descarte:
      (porChave.get('motivos_descarte') as ConfigProspeccao['motivos_descarte'] | undefined) ??
      CONFIG_PROSPECCAO_PADRAO.motivos_descarte,
    templates:
      (porChave.get('templates') as ConfigProspeccao['templates'] | undefined) ??
      CONFIG_PROSPECCAO_PADRAO.templates,
  }
}

/**
 * OS PEDIDOS DE APRESENTAÇÃO deste sacado, e o que voltou deles.
 *
 * O app já sabia PEDIR (`pedirApresentacaoSacado`), mas não sabia mostrar o
 * pedido nem a resposta — então quem pedia pelo celular não tinha como saber se
 * o analista respondeu, e pedia de novo. `status`, `direcao` e `respondido_em`
 * são o que fecham o ciclo: a 0222d deu direção ao pedido e a 0248 fez a
 * resposta voltar para quem pediu.
 */
export async function fetchPedidosApresentacao(
  cnpjSacado: string,
): Promise<PedidoApresentacao[]> {
  const { data, error } = await supabase
    .from('pedidos_apresentacao')
    .select('id, fornecedor_cnpj, sacado_cnpj, mensagem, status, direcao, criado_em, respondido_em')
    .eq('sacado_cnpj', cnpjSacado)
    .order('criado_em', { ascending: false })
    .limit(20)
  if (error) throw error
  return (data ?? []) as PedidoApresentacao[]
}
