import { parseOuFalhar, traduzirErro } from '../db/shared.js'
import type { Supabase } from '../registry/types.js'
import type { Json, Tables } from '../types/database.js'
import {
  acaoMandatoSchema,
  criarMandatoSchema,
  decidirPropostaSchema,
  ligarRegraSchema,
  mandatoRegraSchema,
  materialSchema,
  pausarAgenteSchema,
  reabrirDisjuntorSchema,
  salvarCaixaSchema,
  salvarConfigAgentesSchema,
  salvarDisjuntorSchema,
  salvarPersonaSchema,
} from './schemas.js'

/**
 * Escritas dos Agentes (09), todas por RPC SECURITY DEFINER (0270d). Cada uma começa pela
 * guarda do módulo (e, quando é o caso, a de gestor) — a tela é a camada de mensagem, não
 * a de segurança. O cliente é SEMPRE o do usuário: passar o de service role aqui anularia
 * a única autorização que existe.
 *
 * Nenhuma delas faz o agente agir: criar um mandato só o põe na fila do ciclo, que roda
 * sob as trancas, o orçamento e o disjuntor como qualquer outro.
 */

const p = (dados: unknown) => ({ p: dados as Json })

export async function criarMandato(supabase: Supabase, input: unknown): Promise<Tables<'mandatos'>> {
  const dados = parseOuFalhar(criarMandatoSchema, input)
  const { data, error } = await supabase.rpc('app_agentes_criar_mandato', p(dados))
  if (error) throw traduzirErro(error)
  return data
}

export async function acaoNoMandato(supabase: Supabase, input: unknown): Promise<Tables<'mandatos'>> {
  const dados = parseOuFalhar(acaoMandatoSchema, input)
  const { data, error } = await supabase.rpc('app_agentes_mandato_acao', p(dados))
  if (error) throw traduzirErro(error)
  return data
}

export async function decidirProposta(supabase: Supabase, input: unknown): Promise<Tables<'mandato_propostas'>> {
  const dados = parseOuFalhar(decidirPropostaSchema, input)
  const { data, error } = await supabase.rpc('app_agentes_decidir_proposta', p(dados))
  if (error) throw traduzirErro(error)
  return data
}

export async function salvarRegraMandato(supabase: Supabase, input: unknown): Promise<Tables<'mandato_regras'>> {
  const dados = parseOuFalhar(mandatoRegraSchema, input)
  const { data, error } = await supabase.rpc('app_agentes_salvar_regra', p(dados))
  if (error) throw traduzirErro(error)
  return data
}

export async function ligarRegraMandato(supabase: Supabase, input: unknown): Promise<Tables<'mandato_regras'>> {
  const dados = parseOuFalhar(ligarRegraSchema, input)
  const { data, error } = await supabase.rpc('app_agentes_ligar_regra', p(dados))
  if (error) throw traduzirErro(error)
  return data
}

export async function registrarPreviaRegra(supabase: Supabase, id: string, previa: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc('app_agentes_registrar_previa', p({ id, previa }))
  if (error) throw traduzirErro(error)
}

export async function salvarPersona(supabase: Supabase, input: unknown): Promise<Tables<'vendedores'>> {
  const dados = parseOuFalhar(salvarPersonaSchema, input)
  const { data, error } = await supabase.rpc('app_agentes_salvar_persona', p(dados))
  if (error) throw traduzirErro(error)
  return data
}

export async function pausarAgente(supabase: Supabase, input: unknown): Promise<Tables<'vendedores'>> {
  const dados = parseOuFalhar(pausarAgenteSchema, input)
  const { data, error } = await supabase.rpc('app_agentes_pausar_agente', p(dados))
  if (error) throw traduzirErro(error)
  return data
}

export async function reabrirDisjuntor(supabase: Supabase, input: unknown): Promise<Tables<'agentes_disjuntor'>> {
  const dados = parseOuFalhar(reabrirDisjuntorSchema, input)
  const { data, error } = await supabase.rpc('app_agentes_reabrir_disjuntor', p(dados))
  if (error) throw traduzirErro(error)
  return data
}

export async function salvarDisjuntor(supabase: Supabase, input: unknown): Promise<Tables<'agentes_disjuntor'>> {
  const dados = parseOuFalhar(salvarDisjuntorSchema, input)
  const { data, error } = await supabase.rpc('app_agentes_salvar_disjuntor', p(dados))
  if (error) throw traduzirErro(error)
  return data
}

export async function salvarMaterial(supabase: Supabase, input: unknown): Promise<Tables<'materiais'>> {
  const dados = parseOuFalhar(materialSchema, input)
  const { data, error } = await supabase.rpc('app_agentes_salvar_material', p(dados))
  if (error) throw traduzirErro(error)
  return data
}

export async function salvarConfigAgentes(supabase: Supabase, input: unknown): Promise<Tables<'agentes_config'>> {
  const dados = parseOuFalhar(salvarConfigAgentesSchema, input)
  const { data, error } = await supabase.rpc('app_agentes_salvar_config', p(dados))
  if (error) throw traduzirErro(error)
  return data
}

export async function salvarCaixaEmail(supabase: Supabase, input: unknown): Promise<Tables<'email_caixas'>> {
  const dados = parseOuFalhar(salvarCaixaSchema, input)
  const { data, error } = await supabase.rpc('app_agentes_salvar_caixa', p(dados))
  if (error) throw traduzirErro(error)
  return data
}
