'use client'

import type {
  CommissionParam,
  FaseConta,
  PapelComissao,
  StatusCompetencia,
  StatusLancamentoV2,
} from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'

/**
 * Leituras do motor de comissões v2.
 *
 * O EXTRATO vem da tabela, não de uma RPC, por um motivo só: é ele que precisa de
 * Realtime, e o Realtime assina tabela. Todo o resto — que exige agregação — vem de
 * `comissao_painel_v2` numa chamada, porque a tela abre no celular e seis viagens é onde
 * uma tela "quase carrega".
 *
 * A RLS decide o que volta em ambos os caminhos. Nenhum filtro por vendedor é repetido
 * aqui: uma segunda régua para "quem pode ver o dinheiro de quem" é uma régua a mais
 * para divergir da primeira.
 */

export const comissaoKeys = {
  painel: (vendedorId?: string | null) => ['comercial', 'comissao-v2', 'painel', vendedorId ?? 'todos'] as const,
  extrato: (competencia: string, vendedorId?: string | null) =>
    ['comercial', 'comissao-v2', 'extrato', competencia, vendedorId ?? 'todos'] as const,
  parametros: () => ['comercial', 'comissao-v2', 'parametros'] as const,
  competencias: () => ['comercial', 'comissao-v2', 'competencias'] as const,
  aceites: () => ['comercial', 'comissao-v2', 'aceites'] as const,
  reclassificacao: (janela: number) => ['comercial', 'comissao-v2', 'reclassificacao', janela] as const,
  semConta: () => ['comercial', 'comissao-v2', 'sacados-sem-conta'] as const,
  contasCliente: () => ['comercial', 'comissao-v2', 'contas-cliente'] as const,
  contasFase: () => ['comercial', 'comissao-v2', 'contas-fase'] as const,
}

// ─── Painel ─────────────────────────────────────────────────────────────────

export interface PainelComissao {
  tem_acesso: boolean
  competencia: string
  vendedor_id: string | null
  consolidado: boolean
  mes_corrente: {
    total: number
    lancamentos: number
    cessoes: number
    volume_cedido: number
    por_papel: Partial<Record<PapelComissao, number>>
  }
  mes_anterior: { competencia: string; total: number; cessoes: number }
  historico: {
    competencia: string
    total: number
    lancamentos: number
    status: StatusCompetencia
    por_papel: Partial<Record<PapelComissao, number>>
  }[]
}

const numeros = (o: Record<string, unknown> | null | undefined): Partial<Record<PapelComissao, number>> =>
  Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, Number(v) || 0])) as Partial<
    Record<PapelComissao, number>
  >

export async function buscarPainelComissao(vendedorId?: string | null): Promise<PainelComissao> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('comissao_painel_v2', {
    p_vendedor_id: vendedorId ?? undefined,
    p_meses: 12,
  })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as Record<string, unknown>
  const mc = (r.mes_corrente ?? {}) as Record<string, unknown>
  const ma = (r.mes_anterior ?? {}) as Record<string, unknown>

  return {
    tem_acesso: Boolean(r.tem_acesso),
    competencia: String(r.competencia ?? ''),
    vendedor_id: (r.vendedor_id as string | null) ?? null,
    consolidado: Boolean(r.consolidado),
    mes_corrente: {
      total: Number(mc.total ?? 0),
      lancamentos: Number(mc.lancamentos ?? 0),
      cessoes: Number(mc.cessoes ?? 0),
      volume_cedido: Number(mc.volume_cedido ?? 0),
      por_papel: numeros(mc.por_papel as Record<string, unknown>),
    },
    mes_anterior: {
      competencia: String(ma.competencia ?? ''),
      total: Number(ma.total ?? 0),
      cessoes: Number(ma.cessoes ?? 0),
    },
    historico: ((r.historico ?? []) as Record<string, unknown>[]).map((h) => ({
      competencia: String(h.competencia),
      total: Number(h.total ?? 0),
      lancamentos: Number(h.lancamentos ?? 0),
      status: (h.status as StatusCompetencia) ?? 'aberta',
      por_papel: numeros(h.por_papel as Record<string, unknown>),
    })),
  }
}

// ─── Extrato ────────────────────────────────────────────────────────────────

export interface LinhaExtrato {
  id: string
  vendedor_id: string
  papel: PapelComissao
  competencia: string
  origem_tipo: string
  origem_id: string
  evento_em: string
  empresa_id: string | null
  cedente_cnpj: string | null
  cedente_nome: string | null
  nf_numero: string | null
  descricao: string | null
  gestao_operacao: string | null
  fase: FaseConta | null
  valor_cedido: number | null
  anticipation_days: number | null
  vop: number | null
  taxa_brl_por_mm: number | null
  share_pct: number
  valor: number
  params_snapshot: Record<string, unknown>
  status: StatusLancamentoV2
  vendedores: { id: string; nome: string; tipo: string } | null
  empresas: { id: string; razao_social: string | null } | null
}

export async function buscarExtrato(
  competencia: string,
  vendedorId?: string | null,
): Promise<LinhaExtrato[]> {
  const supabase = createClient()
  let q = supabase
    .from('comissao_lancamentos_v2')
    .select('*, vendedores(id, nome, tipo), empresas(id, razao_social)')
    .eq('competencia', competencia)
    // Ordem cronológica invertida: o extrato do mês corrente é lido de cima, e o que
    // acabou de entrar é justamente o que a pessoa abriu a tela para ver.
    .order('evento_em', { ascending: false })
    .limit(2000)
  if (vendedorId) q = q.eq('vendedor_id', vendedorId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []).map((l) => ({
    ...(l as unknown as LinhaExtrato),
    valor_cedido: l.valor_cedido === null ? null : Number(l.valor_cedido),
    vop: l.vop === null ? null : Number(l.vop),
    taxa_brl_por_mm: l.taxa_brl_por_mm === null ? null : Number(l.taxa_brl_por_mm),
    share_pct: Number(l.share_pct ?? 100),
    valor: Number(l.valor),
    params_snapshot: (l.params_snapshot ?? {}) as Record<string, unknown>,
  }))
}

// ─── Parâmetros ─────────────────────────────────────────────────────────────

export interface ParametroComVendedor extends CommissionParam {
  vendedores: { id: string; nome: string } | null
}

export async function buscarParametros(): Promise<ParametroComVendedor[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('commission_params')
    .select('id, chave, vendedor_id, valor, unidade, vigente_de, vigente_ate, criado_em, vendedores(id, nome)')
    .order('chave')
    .order('vigente_de', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((p) => ({
    ...(p as unknown as ParametroComVendedor),
    valor: Number(p.valor),
  }))
}

/** Só os VIGENTES hoje — é o conjunto que o simulador usa. */
export function vigentesHoje(
  params: readonly ParametroComVendedor[],
  hoje = new Date().toISOString().slice(0, 10),
): ParametroComVendedor[] {
  return params.filter((p) => p.vigente_de <= hoje && (p.vigente_ate === null || p.vigente_ate > hoje))
}

// ─── Competências ───────────────────────────────────────────────────────────

export interface Competencia {
  competencia: string
  status: Exclude<StatusCompetencia, 'aberta'>
  lancamentos: number
  total: number
  fechada_em: string
  aprovada_em: string | null
  paga_em: string | null
}

export async function buscarCompetencias(): Promise<Competencia[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('comissao_competencias')
    .select('*')
    .order('competencia', { ascending: false })
    .limit(24)
  if (error) throw new Error(error.message)
  return (data ?? []).map((c) => ({ ...(c as unknown as Competencia), total: Number(c.total) }))
}

// ─── Fila de aceite ─────────────────────────────────────────────────────────

export interface AceitePendente {
  id: string
  sdr_lead_id: string
  sdr_id: string
  vendedor_destino_id: string
  empresa_id: string
  reuniao_em: string | null
  criado_em: string
  prazo_em: string
  status: 'pendente' | 'aceita' | 'recusada'
  aceite_automatico: boolean
  motivo_recusa: string | null
  empresas: { id: string; razao_social: string | null } | null
}

export async function buscarAceites(): Promise<AceitePendente[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('sdr_aceites')
    .select('*, empresas(id, razao_social)')
    // Pendentes primeiro e por prazo: a fila é uma fila de decisão, e a que vence
    // primeiro é a que não pode esperar.
    .order('status')
    .order('prazo_em')
    .limit(200)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as AceitePendente[]
}

// ─── Painel de reclassificação ──────────────────────────────────────────────

export interface ContaParaRevisar {
  empresa_id: string
  cnpj: string
  razao_social: string | null
  gestao_operacao: string | null
  marco_ativacao: string | null
  gestao_definida_em: string | null
  titular: string | null
  volume_janela: number
  media_mensal_anterior: number
  mudancas: number
}

export async function buscarReclassificacao(
  janelaDias: number,
): Promise<{ janela_dias: number; contas: ContaParaRevisar[] }> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('comissao_reclassificacao', { p_janela_dias: janelaDias })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as Record<string, unknown>
  return {
    janela_dias: Number(r.janela_dias ?? janelaDias),
    contas: ((r.contas ?? []) as Record<string, unknown>[]).map((c) => ({
      ...(c as unknown as ContaParaRevisar),
      volume_janela: Number(c.volume_janela ?? 0),
      media_mensal_anterior: Number(c.media_mensal_anterior ?? 0),
    })),
  }
}

// ─── Histórico de classificação de uma conta ────────────────────────────────

export interface MudancaClassificacao {
  id: string
  valor_anterior: string | null
  valor_novo: string
  motivo: string
  alterado_em: string
  usuarios: { id: string; nome: string | null } | null
}

export async function buscarHistoricoGestao(empresaId: string): Promise<MudancaClassificacao[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('gestao_operacao_historico')
    .select('id, valor_anterior, valor_novo, motivo, alterado_em, usuarios:alterado_por(id, nome)')
    .eq('empresa_id', empresaId)
    .order('alterado_em', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as MudancaClassificacao[]
}

// ─── Sacados que operam sem conta ───────────────────────────────────────────

export interface SacadoSemConta {
  cnpj: string
  nome: string | null
  cessoes: number
  volume: number
  primeira: string
  ultima: string
  cedentes: number
  /** Quando o CNPJ existe em `empresas` mas fora de cliente/ex-cliente — o caso mais comum. */
  cadastro_nome: string | null
  cadastro_estagio: string | null
}

/**
 * O volume que não paga comissão a ninguém.
 *
 * Vem de RPC e não da tabela porque a pergunta é "quem NÃO resolve para conta" — uma
 * negativa sobre o resultado de `app_holding_do_sacado`, que só o banco sabe calcular.
 */
export async function buscarSacadosSemConta(): Promise<SacadoSemConta[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('comercial_sacados_sem_conta')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((s) => ({
    ...(s as unknown as SacadoSemConta),
    volume: Number(s.volume ?? 0),
    cessoes: Number(s.cessoes ?? 0),
    cedentes: Number(s.cedentes ?? 0),
  }))
}

export interface ContaCliente {
  id: string
  razao_social: string | null
  cnpj: string
  estagio: string
}

/** As contas que podem receber um vínculo — a mesma régua do RPC, para não oferecer erro. */
export async function buscarContasCliente(): Promise<ContaCliente[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('empresas')
    .select('id, razao_social, cnpj, estagio')
    .in('estagio', ['cliente', 'ex_cliente'])
    .order('razao_social')
  if (error) throw new Error(error.message)
  return (data ?? []) as ContaCliente[]
}

// ─── O relógio de cada conta ────────────────────────────────────────────────

export interface ContaFase {
  empresa_id: string
  razao_social: string | null
  cnpj: string
  estagio: string
  gestao_operacao: string | null
  /** A data da primeira cessão convertida. É o zero do relógio que decide a taxa. */
  marco_ativacao: string | null
  /** Fase fixada por um gestor. Nula = a fase sai do relógio. */
  fase_manual: 'CRESCIMENTO' | 'MANUTENCAO' | null
  titular: string | null
  volume_mes: number
  comissao_mes: number
  ajustes: number
}

export async function buscarContasFase(): Promise<ContaFase[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('comercial_contas_fase')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((c) => ({
    ...(c as unknown as ContaFase),
    volume_mes: Number(c.volume_mes ?? 0),
    comissao_mes: Number(c.comissao_mes ?? 0),
    ajustes: Number(c.ajustes ?? 0),
  }))
}

export interface AjusteFase {
  id: string
  marco_anterior: string | null
  marco_novo: string | null
  fase_anterior: string | null
  fase_nova: string | null
  motivo: string
  alterado_em: string
  usuarios: { id: string; nome: string | null } | null
}

export async function buscarHistoricoFase(empresaId: string): Promise<AjusteFase[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('conta_fase_historico')
    .select('id, marco_anterior, marco_novo, fase_anterior, fase_nova, motivo, alterado_em, usuarios:alterado_por(id, nome)')
    .eq('empresa_id', empresaId)
    .order('alterado_em', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as AjusteFase[]
}
