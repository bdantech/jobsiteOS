import type { Tables, Views } from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'

/**
 * Leituras das campanhas. Tudo passa pelas views: a lista já traz o placar
 * somado e os destinatários já vêm com nome de empresa e de contato — sem isso
 * uma tela de 200 destinatários custaria 400 joins no cliente.
 */

export const campanhasKeys = {
  todas: ['campanhas'] as const,
  lista: () => ['campanhas', 'lista'] as const,
  uma: (id: string) => ['campanhas', 'uma', id] as const,
  metricas: (id: string) => ['campanhas', 'metricas', id] as const,
  destinatarios: (id: string, filtro: string) => ['campanhas', 'dest', id, filtro] as const,
  templates: (canal: string) => ['campanhas', 'templates', canal] as const,
  segmentos: () => ['campanhas', 'segmentos'] as const,
  contas: () => ['campanhas', 'contas'] as const,
  vendedores: () => ['campanhas', 'vendedores'] as const,
}

export type CampanhaNaLista = Views<'campanhas_lista'>
export type DestinatarioNaLista = Views<'campanha_destinatarios_lista'>

export async function buscarCampanhas(): Promise<CampanhaNaLista[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('campanhas_lista')
    .select('*')
    .order('criada_em', { ascending: false })
    .limit(100)
  if (error) throw new Error(error.message)
  return (data ?? []) as CampanhaNaLista[]
}

export async function buscarCampanha(id: string): Promise<Tables<'campanhas'> | null> {
  const supabase = createClient()
  const { data, error } = await supabase.from('campanhas').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function buscarMetricas(id: string): Promise<Record<string, unknown>> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('app_campanha_metricas', {
    p: { campanha_id: id } as never,
  })
  if (error) throw new Error(error.message)
  return (data ?? {}) as Record<string, unknown>
}

export interface FiltroDestinatarios {
  status?: string
  motivo?: string
}

export async function buscarDestinatarios(
  campanhaId: string,
  filtro: FiltroDestinatarios,
): Promise<DestinatarioNaLista[]> {
  const supabase = createClient()
  let q = supabase
    .from('campanha_destinatarios_lista')
    .select('*')
    .eq('campanha_id', campanhaId)
    .order('criado_em', { ascending: true })
    .limit(300)
  if (filtro.status) q = q.eq('status', filtro.status)
  if (filtro.motivo) q = q.eq('motivo_exclusao', filtro.motivo)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as DestinatarioNaLista[]
}

export interface TemplateSimples {
  id: string
  nome: string
  assunto: string | null
  corpo: string
}

export async function buscarTemplates(canal: string): Promise<TemplateSimples[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('templates_mensagem')
    .select('id, nome, assunto, corpo')
    .eq('canal', canal)
    .eq('ativo', true)
    .order('nome')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarSegmentos(): Promise<{ id: string; nome: string; contagem_cache: number | null }[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('segmentos')
    .select('id, nome, contagem_cache')
    .order('nome')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarContasDeCampanha(): Promise<
  { id: string; apelido: string; numero: string; tipo: string }[]
> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('whatsapp_contas')
    .select('id, apelido, numero, tipo')
    .eq('ativo', true)
    .order('apelido')
  if (error) throw new Error(error.message)
  return data ?? []
}

/**
 * O badge "em campanha X" (§8), por empresa. É lido pela ficha da empresa e
 * responde antes do telefonema: esta pessoa recebeu um disparo nosso hoje?
 */
export async function buscarContatosEmCampanha(
  empresaId: string,
): Promise<Views<'contatos_em_campanha'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('contatos_em_campanha')
    .select('*')
    .eq('empresa_id', empresaId)
  if (error) throw new Error(error.message)
  return (data ?? []) as Views<'contatos_em_campanha'>[]
}
