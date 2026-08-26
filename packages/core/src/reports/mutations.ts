import type { Json } from '../types/database.js'
import type { Supabase } from '../registry/types.js'
import {
  atualizarReportSchema,
  comentarReportSchema,
  criarReportSchema,
  definirBetaSchema,
} from './schemas.js'

/**
 * As escritas de reports. Todas por RPC, como no resto do sistema — e aqui com
 * um motivo a mais: `authenticated` não tem grant de INSERT nem de UPDATE nessas
 * tabelas (migração 0141). Não existe caminho alternativo a contornar.
 */

export interface ReportCriado {
  id: string
  numero: number
  tipo: string
  status: string
}

export async function criarReport(supabase: Supabase, input: unknown): Promise<ReportCriado> {
  const dados = criarReportSchema.parse(input)
  const { data, error } = await supabase.rpc('app_report_criar', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  const r = data as unknown as ReportCriado | null
  if (!r?.id) throw new Error('O report não foi criado.')
  return r
}

export interface ReportAtualizado {
  report_id: string
  numero: number
  tipo: string
  autor_id: string
  status_anterior: string
  status: string
  prioridade: string | null
  /** Falso quando o admin salvou sem mexer no status. Decide se o autor é notificado. */
  mudou_status: boolean
}

export async function atualizarReport(
  supabase: Supabase,
  input: unknown,
): Promise<ReportAtualizado> {
  const dados = atualizarReportSchema.parse(input)
  const { data, error } = await supabase.rpc('app_report_atualizar', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data as unknown as ReportAtualizado
}

export interface ComentarioCriado {
  comentario_id: string
  report_id: string
  numero: number
  autor_do_report: string
  /** Comentário interno NUNCA notifica o autor (§4). Quem decide isso é o servidor. */
  interno: boolean
  ator_e_admin: boolean
}

export async function comentarReport(
  supabase: Supabase,
  input: unknown,
): Promise<ComentarioCriado> {
  const dados = comentarReportSchema.parse(input)
  const { data, error } = await supabase.rpc('app_report_comentar', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data as unknown as ComentarioCriado
}

export async function definirBeta(supabase: Supabase, input: unknown) {
  const dados = definirBetaSchema.parse(input)
  const { data, error } = await supabase.rpc('app_definir_beta', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}
