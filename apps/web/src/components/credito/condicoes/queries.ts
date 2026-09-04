import type {
  ContextoPrecificacao,
  MatrizPrecificacao,
  Tables,
} from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'

/**
 * O painel da precificação (04o §6) numa chamada só.
 *
 * `condicoes_painel` é SECURITY DEFINER e cruza esteira, empresa, score, protestos,
 * NF-e observada, cadastro na plataforma, a matriz vigente, o histórico de condições
 * e as entregas do webhook. Montar isso no cliente seriam nove idas ao banco — e nove
 * lugares para esquecer de atualizar quando entrar a décima.
 *
 * O que ele NÃO faz é sugerir preço: devolve contexto, e quem transforma contexto em
 * condições é `sugerirCondicoes`, do core, com teste.
 */

export const condicoesKeys = {
  all: ['condicoes'] as const,
  painel: (analiseId: string) => [...condicoesKeys.all, 'painel', analiseId] as const,
  matrizes: () => [...condicoesKeys.all, 'matrizes'] as const,
  amostra: (meses: number) => [...condicoesKeys.all, 'amostra', meses] as const,
}

export interface EntregaCondicoes {
  id: string
  status: 'pendente' | 'entregue' | 'falhou'
  tentativas: number
  ultimo_status_http: number | null
  ultimo_erro: string | null
  criado_em: string
  entregue_em: string | null
  proxima_tentativa_em: string | null
}

export interface PainelCondicoes {
  encontrado: boolean
  esteira: {
    id: string
    cnpj: string
    estagio: string
    limite_aprovado: number | null
    limite_operacional: number | null
    expira_em: string | null
    seguradora: string | null
    rating_seguradora: string | null
    external_id: string | null
  } | null
  empresa: {
    id: string
    razao_social: string | null
    nome_fantasia: string | null
    faturamento_anual: number | null
    faturamento_origem: string | null
    faturamento_confianca: string | null
  } | null
  score: { score: number | null; faixa: string | null } | null
  protestos: {
    tem_protesto: boolean | null
    qtd_protestos: number | null
    valor_total: number | null
    consultado_em: string | null
  } | null
  cobertura_vigente: boolean
  nfe: {
    janela_meses: number
    qtd: number
    total: number
    ticket_medio: number | null
    prazo_medio_dias: number | null
  }
  limite_recomendado: number | null
  onepay_company_id: number | null
  matriz: { versao: number; definicao: MatrizPrecificacao } | null
  condicoes: Tables<'condicoes_comerciais'>[]
  entregas: EntregaCondicoes[]
}

const NFE_VAZIA = { janela_meses: 6, qtd: 0, total: 0, ticket_medio: null, prazo_medio_dias: null }

export async function buscarPainelCondicoes(analiseId: string): Promise<PainelCondicoes> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('condicoes_painel', {
    p_analise_credito_id: analiseId,
  })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as unknown as Partial<PainelCondicoes>
  return {
    encontrado: r.encontrado ?? false,
    esteira: r.esteira ?? null,
    empresa: r.empresa ?? null,
    score: r.score ?? null,
    protestos: r.protestos ?? null,
    cobertura_vigente: r.cobertura_vigente ?? false,
    nfe: r.nfe ?? NFE_VAZIA,
    limite_recomendado: r.limite_recomendado ?? null,
    onepay_company_id: r.onepay_company_id ?? null,
    matriz: r.matriz ?? null,
    condicoes: r.condicoes ?? [],
    entregas: r.entregas ?? [],
  }
}

/**
 * O contexto do motor, montado a partir do painel.
 *
 * `numeric` do PostgREST chega como string; o `Number()` aqui é a fronteira onde isso
 * é resolvido, antes de qualquer conta. Um `"30000000"` somado a um ajuste viraria
 * concatenação de texto, e o preço sairia de uma faixa que ninguém escolheu.
 */
export function contextoDoPainel(p: PainelCondicoes): ContextoPrecificacao {
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return {
    faturamento_estimado: num(p.empresa?.faturamento_anual),
    faixa_score: p.score?.faixa ?? null,
    cobertura_vigente: p.cobertura_vigente,
    tem_protesto: p.protestos?.tem_protesto ?? null,
    prazo_medio_nf_dias: num(p.nfe.prazo_medio_dias),
    ticket_medio_nf: num(p.nfe.ticket_medio),
    limite_aprovado: num(p.esteira?.limite_aprovado),
    limite_recomendado: num(p.limite_recomendado),
  }
}

export async function buscarMatrizes(): Promise<Tables<'precificacao_matriz'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('precificacao_matriz')
    .select('*')
    .order('versao', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Uma linha da amostra do preview: contexto, não preço. */
export interface LinhaAmostra extends ContextoPrecificacao {
  analise_credito_id: string
  cnpj: string
  razao_social: string
}

export async function buscarAmostraPrecificacao(meses: number): Promise<LinhaAmostra[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('precificacao_amostra', { p_meses: meses })
  if (error) throw new Error(error.message)
  const linhas = (data ?? []) as unknown as Record<string, unknown>[]
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return linhas.map((l) => ({
    analise_credito_id: String(l.analise_credito_id),
    cnpj: String(l.cnpj),
    razao_social: String(l.razao_social ?? l.cnpj),
    faturamento_estimado: num(l.faturamento_estimado),
    faixa_score: (l.faixa_score as string | null) ?? null,
    cobertura_vigente: Boolean(l.cobertura_vigente),
    tem_protesto: (l.tem_protesto as boolean | null) ?? null,
    prazo_medio_nf_dias: num(l.prazo_medio_nf_dias),
    ticket_medio_nf: num(l.ticket_medio_nf),
    limite_aprovado: num(l.limite_aprovado),
    limite_recomendado: num(l.limite_recomendado),
  }))
}
