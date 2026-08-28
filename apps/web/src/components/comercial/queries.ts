'use client'

import { createClient } from '@/lib/supabase/client'
import type { Tables } from '@jobsiteos/core'

/**
 * Leituras do Comercial. Todas passam pela RLS do módulo; a de comissão é a única
 * restrita por pessoa, e essa restrição vive no banco — repeti-la aqui criaria uma
 * segunda regra para divergir da primeira.
 */

export const comercialKeys = {
  resumo: (vendedorId?: string | null) => ['comercial', 'resumo', vendedorId ?? 'eu'] as const,
  vendedores: () => ['comercial', 'vendedores'] as const,
  leads: (sdrId?: string | null) => ['comercial', 'leads', sdrId ?? 'todos'] as const,
  vendas: (vendedorId?: string | null) => ['comercial', 'vendas', vendedorId ?? 'todos'] as const,
  fila: () => ['comercial', 'fila'] as const,
  comissoes: (competencia: string) => ['comercial', 'comissoes', competencia] as const,
  agenda: (vendedorId?: string | null) => ['comercial', 'agenda', vendedorId ?? 'eu'] as const,
  motivos: (contexto: string) => ['comercial', 'motivos', contexto] as const,
  territorios: () => ['comercial', 'territorios'] as const,
  config: () => ['comercial', 'config'] as const,
  carteira: (vendedorId?: string | null) => ['comercial', 'carteira', vendedorId ?? 'eu'] as const,
  visiveis: () => ['comercial', 'visiveis'] as const,
}

export interface ResumoComercial {
  tem_acesso: boolean
  sem_vendedor?: boolean
  vendedor?: { id: string; nome: string; tipo: string; is_ia: boolean }
  leads_por_estagio: Record<string, number>
  vendas_por_estagio: Record<string, number>
  nfs_vivas: number
  passivas_geridas: number
  proximas_reunioes: { id: string; titulo: string; inicio_em: string; empresa_id: string | null }[]
  comissao_mes: { competencia: string; total: number; por_status: Record<string, number> }
}

export async function buscarResumo(vendedorId?: string | null): Promise<ResumoComercial> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('comercial_resumo_vendedor', {
    p_vendedor_id: vendedorId ?? undefined,
  })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as Partial<ResumoComercial>
  return {
    tem_acesso: r.tem_acesso ?? false,
    sem_vendedor: r.sem_vendedor,
    vendedor: r.vendedor,
    leads_por_estagio: r.leads_por_estagio ?? {},
    vendas_por_estagio: r.vendas_por_estagio ?? {},
    nfs_vivas: r.nfs_vivas ?? 0,
    passivas_geridas: r.passivas_geridas ?? 0,
    proximas_reunioes: r.proximas_reunioes ?? [],
    comissao_mes: r.comissao_mes ?? { competencia: '', total: 0, por_status: {} },
  }
}

/** Um vendedor cujo painel o usuário logado pode abrir de fato — a mesma régua da RLS. */
export interface VendedorVisivel {
  id: string
  nome: string
  tipo: string
  is_ia: boolean
}

/**
 * O seletor "ver painel de…" se monta com ISTO, não com a lista de vendedores.
 *
 * A lista completa é legível para quem tem o módulo — um cadastro de pessoas não é
 * segredo. Já ABRIR o painel do outro depende de `vendedor_acessos`, e oferecer no
 * seletor um nome cujo funil volta vazio ensina que a tela está quebrada.
 */
export async function buscarVendedoresVisiveis(): Promise<VendedorVisivel[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('comercial_vendedores_visiveis')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as VendedorVisivel[]
}

export async function buscarVendedores(): Promise<Tables<'vendedores'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('vendedores')
    .select('*')
    .order('ativo', { ascending: false })
    .order('nome')
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Um lead com o nome da empresa — a lista é inútil sem ele. */
export interface LeadComEmpresa extends Tables<'sdr_leads'> {
  empresas: {
    id: string
    razao_social: string | null
    uf: string | null
    valor_esperado_mensal: number | null
    faturamento_anual: number | null
  } | null
}

export async function buscarLeads(sdrId?: string | null): Promise<LeadComEmpresa[]> {
  const supabase = createClient()
  let q = supabase
    .from('sdr_leads')
    .select('*, empresas(id, razao_social, uf, valor_esperado_mensal, faturamento_anual)')
    // Melhor empresa primeiro dentro do funil: a ordem da lista é a ordem de trabalho.
    .order('distribuido_em', { ascending: false })
    .limit(500)
  if (sdrId) q = q.eq('sdr_id', sdrId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as LeadComEmpresa[]
}

export interface VendaComEmpresa extends Tables<'vendas'> {
  empresas: { id: string; razao_social: string | null; uf: string | null } | null
  /** `null` quando não há análise ligada — ou quando a RLS não deixa esta pessoa ver. */
  analises_credito: {
    id: string
    estagio: string
    limite_solicitado: number | null
    limite_aprovado: number | null
    moeda: string | null
    motivo: string | null
    decidida_em: string | null
  } | null
}

export async function buscarVendas(vendedorId?: string | null): Promise<VendaComEmpresa[]> {
  const supabase = createClient()
  let q = supabase
    .from('vendas')
    /*
     * A análise vem junto, e não numa consulta por card: o funil mostra dezenas de
     * negócios e a etapa do crédito é informação de card, não de detalhe. Buscar por
     * card faria N requisições ao abrir a tela.
     *
     * A RLS decide o que volta: quem não é dono do negócio recebe `null` aqui, sem erro.
     */
    .select(
      '*, empresas(id, razao_social, uf), analises_credito(id, estagio, limite_solicitado, limite_aprovado, moeda, motivo, decidida_em)',
    )
    .order('atualizada_em', { ascending: false })
    .limit(500)
  if (vendedorId) q = q.eq('vendedor_id', vendedorId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as VendaComEmpresa[]
}

/**
 * O limite Onepay da empresa, do temperature report (sync diário).
 *
 * Tudo `null` quando a empresa não é cliente Onepay — a carteira também tem prospect
 * e ex-cliente, e para eles não existe limite algum. `null` aqui é "não há", não
 * "zero": a tela precisa distinguir uma conta sem cadastro de uma no talo.
 *
 * O limite é do CNPJ da empresa, e não do grupo econômico, ao contrário de
 * `volume_mes` e `nfs_vivas`. O cadastro de crédito da Onepay é da holding.
 */
export interface LimiteOnepay {
  credit_limit: number | null
  /** Quanto ainda dá para antecipar. É o número que decide a ligação. */
  available_limit: number | null
  /** Fração de 0 a 1, não porcentagem — 0.9396 é 94%. */
  consumed_pct: number | null
  /** Veredito da Onepay, cru: `operating_normally`, `inoperative`… */
  operation_status: string | null
  /** Quando o sync trouxe estes números. O limite é de ontem até o cron rodar. */
  limite_em: string | null
}

export interface PassivaNaCarteira extends LimiteOnepay {
  id: string
  cnpj: string
  razao_social: string | null
  uf: string | null
  faturamento_anual: number | null
  desde: string
  gestao_operacao: string | null
  /** SPEs no grupo econômico da holding — o tamanho do que ela arrasta. */
  spes: number
  /** Volume antecipado no mês corrente, da holding E das SPEs. Vira comissão. */
  volume_mes: number
  /** Quantas dessas operações vieram por uma SPE, não pelo CNPJ da holding. */
  operacoes_via_spe: number
}

export interface EmpresaDeOriginacao extends LimiteOnepay {
  id: string
  cnpj: string
  razao_social: string | null
  uf: string | null
  estagio: string
  gestao_operacao: string | null
  spes: number
  nfs_vivas: number
}

export interface CarteiraVendedorDados {
  tem_acesso: boolean
  sem_vendedor?: boolean
  vendedor_id?: string
  tipo?: string
  competencia?: string
  passivas: PassivaNaCarteira[]
  originacao: EmpresaDeOriginacao[]
}

export async function buscarCarteira(vendedorId?: string | null): Promise<CarteiraVendedorDados> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('comercial_carteira_vendedor', {
    p_vendedor_id: vendedorId ?? undefined,
  })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as Partial<CarteiraVendedorDados>
  return {
    tem_acesso: r.tem_acesso ?? false,
    sem_vendedor: r.sem_vendedor,
    vendedor_id: r.vendedor_id,
    tipo: r.tipo,
    competencia: r.competencia,
    passivas: r.passivas ?? [],
    originacao: r.originacao ?? [],
  }
}

/**
 * Quantas NFs vivas a carteira de um originador alcança AGORA.
 *
 * Responde "meu link pegou?" na hora, sem esperar o roteamento. É diferente de "quantas
 * mudaram de dono", que só se sabe depois do job — e é a pergunta que a pessoa
 * realmente faz ao salvar.
 */
export async function buscarAlcanceCarteira(
  vendedorId: string,
): Promise<{ nfs_vivas: number; via_spe: number }> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('comercial_alcance_da_carteira', {
    p_vendedor_id: vendedorId,
  })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as { nfs_vivas?: number; via_spe?: number }
  return { nfs_vivas: r.nfs_vivas ?? 0, via_spe: r.via_spe ?? 0 }
}

export async function buscarMotivos(contexto: string): Promise<Tables<'motivos_perda'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('motivos_perda')
    .select('*')
    .eq('contexto', contexto)
    .eq('ativo', true)
    .order('ordem')
  if (error) throw new Error(error.message)
  return data ?? []
}

export interface TerritorioCloser {
  ufs: readonly string[]
  faturamento_min: number | null
  faturamento_max: number | null
}

/**
 * Territórios por vendedor, indexados por id. Um mapa, e não uma lista, porque o único
 * uso é "qual o território deste closer" — e um `find` por card de reunião seria uma
 * varredura por linha da tela.
 */
export async function buscarTerritoriosCloser(): Promise<Record<string, TerritorioCloser>> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('vendedor_territorios')
    .select('vendedor_id, ufs, faturamento_min, faturamento_max')
  if (error) throw new Error(error.message)
  return Object.fromEntries(
    (data ?? []).map((t) => [
      t.vendedor_id,
      {
        ufs: (t.ufs ?? []) as string[],
        faturamento_min: t.faturamento_min === null ? null : Number(t.faturamento_min),
        faturamento_max: t.faturamento_max === null ? null : Number(t.faturamento_max),
      },
    ]),
  )
}

export interface NfSemDono {
  access_key: string
  numero: string | null
  valor: number
  sacado_nome: string | null
  fornecedor_nome: string | null
  estagio_funil: string
  receita_esperada: number | null
  dias_para_vencimento: number | null
}

export async function buscarFilaSemDono(): Promise<NfSemDono[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('notas_fiscais')
    .select('access_key, numero, valor, sacado_nome, fornecedor_nome, estagio_funil, receita_esperada, dias_para_vencimento')
    .is('vendedor_id', null)
    .not('estagio_funil', 'in', '("convertida","perdida")')
    // Maior receita esperada primeiro: a fila do gestor é uma fila de decisão, e a
    // decisão que mais paga é a que não pode esperar.
    .order('receita_esperada', { ascending: false, nullsFirst: false })
    .limit(200)
  if (error) throw new Error(error.message)
  return (data ?? []) as NfSemDono[]
}

export interface LancamentoComVendedor extends Tables<'comissao_lancamentos'> {
  vendedores: { id: string; nome: string; tipo: string } | null
}

export async function buscarComissoes(competencia: string): Promise<LancamentoComVendedor[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('comissao_lancamentos')
    .select('*, vendedores(id, nome, tipo)')
    .eq('competencia', competencia)
    .order('valor', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as LancamentoComVendedor[]
}

export interface EventoAgenda extends Tables<'vendedor_eventos'> {
  empresas: { id: string; razao_social: string | null } | null
}

export async function buscarAgenda(vendedorId?: string | null): Promise<EventoAgenda[]> {
  const supabase = createClient()
  let q = supabase
    .from('vendedor_eventos')
    .select('*, empresas(id, razao_social)')
    .is('cancelado_em', null)
    .gte('inicio_em', new Date(Date.now() - 7 * 86_400_000).toISOString())
    .order('inicio_em')
    .limit(300)
  if (vendedorId) q = q.eq('vendedor_id', vendedorId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as EventoAgenda[]
}
