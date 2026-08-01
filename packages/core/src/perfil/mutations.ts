import type { Supabase } from '../registry/types.js'
import { parseOuFalhar, traduzirErro } from '../db/shared.js'
import type { Json, Tables } from '../types/database.js'
import {
  registrarSugestaoSchema,
  salvarPerfilConfigSchema,
  vincularVersaoSugestaoSchema,
  type RegistrarSugestaoInput,
  type SalvarPerfilConfigInput,
  type VincularVersaoSugestaoInput,
} from './schemas.js'

/**
 * Escritas do Perfil. Mesmo contrato do resto do core: zod valida, o RPC grava
 * com evento + audit na mesma transação, e o client é o do USUÁRIO.
 *
 * Nenhuma delas ativa regra. O um-clique registra a decisão e devolve o id do
 * log; quem cria a versão é o editor de regras, pelo caminho de sempre.
 */

export async function registrarSugestao(
  supabase: Supabase,
  input: RegistrarSugestaoInput | unknown,
): Promise<Tables<'perfil_sugestoes_log'>> {
  const dados = parseOuFalhar(registrarSugestaoSchema, input)
  const { data, error } = await supabase.rpc('app_registrar_sugestao_perfil', {
    p: dados as unknown as Json,
  })
  if (error) throw traduzirErro(error)
  return data
}

export async function vincularVersaoSugestao(
  supabase: Supabase,
  input: VincularVersaoSugestaoInput | unknown,
): Promise<Tables<'perfil_sugestoes_log'>> {
  const dados = parseOuFalhar(vincularVersaoSugestaoSchema, input)
  const { data, error } = await supabase.rpc('app_vincular_versao_sugestao', {
    p: dados as unknown as Json,
  })
  if (error) throw traduzirErro(error)
  return data
}

export async function salvarPerfilConfig(
  supabase: Supabase,
  input: SalvarPerfilConfigInput | unknown,
): Promise<Tables<'perfil_config'>> {
  const dados = parseOuFalhar(salvarPerfilConfigSchema, input)
  const { data, error } = await supabase.rpc('app_salvar_perfil_config', {
    p: dados as unknown as Json,
  })
  if (error) throw traduzirErro(error)
  return data
}
