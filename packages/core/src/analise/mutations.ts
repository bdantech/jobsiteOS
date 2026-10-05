import { parseOuFalhar, traduzirErro } from '../db/shared.js'
import type { Supabase } from '../registry/types.js'
import type { Json } from '../types/database.js'
import {
  auditarVinculoSchema,
  contestarSchema,
  decidirContestacaoSchema,
  decidirSugestaoSchema,
  dispensarCapturaSchema,
  eventoReuniaoSchema,
  overrideLimiarSchema,
  resolverPendenciaSchema,
  rotularSchema,
  rubricaIdSchema,
  salvarConfigQualidadeSchema,
  salvarPessoaQualidadeSchema,
  salvarRubricaSchema,
  salvarSegredoQualidadeSchema,
} from './schemas.js'

/**
 * As escritas da Inteligência de Conversas — todas RPC SECURITY DEFINER (0283c), com o
 * client do USUÁRIO: quem decide se a pessoa pode é a função, não a tela.
 */

type NomeRpc =
  | 'app_qualidade_salvar_config'
  | 'app_qualidade_salvar_segredo'
  | 'app_qualidade_salvar_pessoa'
  | 'app_reuniao_dispensar_captura'
  | 'app_reuniao_chamar_bot'
  | 'app_qualidade_contestar'
  | 'app_qualidade_decidir_contestacao'
  | 'app_qualidade_rotular'
  | 'app_qualidade_salvar_rubrica'
  | 'app_qualidade_ativar_rubrica'
  | 'app_qualidade_pedir_recalibracao'
  | 'app_qualidade_override_limiar'
  | 'app_qualidade_resolver_pendencia'
  | 'app_qualidade_auditar_vinculo'
  | 'app_empresa_sugestao_decidir'

async function chamar<T>(supabase: Supabase, rpc: NomeRpc, p: unknown): Promise<T> {
  const { data, error } = await supabase.rpc(rpc, { p: p as Json })
  if (error) throw traduzirErro(error)
  return data as T
}

export const salvarConfigQualidade = (s: Supabase, input: unknown) =>
  chamar(s, 'app_qualidade_salvar_config', parseOuFalhar(salvarConfigQualidadeSchema, input))

export const salvarSegredoQualidade = (s: Supabase, input: unknown) =>
  chamar<{ chave: string; definido: boolean }>(s, 'app_qualidade_salvar_segredo', parseOuFalhar(salvarSegredoQualidadeSchema, input))

export const salvarPessoaQualidade = (s: Supabase, input: unknown) =>
  chamar(s, 'app_qualidade_salvar_pessoa', parseOuFalhar(salvarPessoaQualidadeSchema, input))

export const dispensarCaptura = (s: Supabase, input: unknown) =>
  chamar(s, 'app_reuniao_dispensar_captura', parseOuFalhar(dispensarCapturaSchema, input))

export const chamarBotReuniao = (s: Supabase, input: unknown) =>
  chamar<{ resgate_id: string | null; ja_na_fila: boolean; enviados: string[] }>(
    s,
    'app_reuniao_chamar_bot',
    parseOuFalhar(eventoReuniaoSchema, input),
  )

export const contestarItem = (s: Supabase, input: unknown) =>
  chamar(s, 'app_qualidade_contestar', parseOuFalhar(contestarSchema, input))

export const decidirContestacao = (s: Supabase, input: unknown) =>
  chamar(s, 'app_qualidade_decidir_contestacao', parseOuFalhar(decidirContestacaoSchema, input))

export const rotularAnalise = (s: Supabase, input: unknown) =>
  chamar<number>(s, 'app_qualidade_rotular', parseOuFalhar(rotularSchema, input))

export const salvarRubrica = (s: Supabase, input: unknown) =>
  chamar<{ id: string; versao: number }>(s, 'app_qualidade_salvar_rubrica', parseOuFalhar(salvarRubricaSchema, input))

export const ativarRubrica = (s: Supabase, input: unknown) =>
  chamar(s, 'app_qualidade_ativar_rubrica', parseOuFalhar(rubricaIdSchema, input))

export const pedirRecalibracao = (s: Supabase, input: unknown) =>
  chamar(s, 'app_qualidade_pedir_recalibracao', parseOuFalhar(rubricaIdSchema, input))

export const overrideLimiar = (s: Supabase, input: unknown) =>
  chamar(s, 'app_qualidade_override_limiar', parseOuFalhar(overrideLimiarSchema, input))

export const resolverPendenciaQualidade = (s: Supabase, input: unknown) =>
  chamar(s, 'app_qualidade_resolver_pendencia', parseOuFalhar(resolverPendenciaSchema, input))

export const auditarVinculo = (s: Supabase, input: unknown) =>
  chamar(s, 'app_qualidade_auditar_vinculo', parseOuFalhar(auditarVinculoSchema, input))

export const decidirSugestaoCadastro = (s: Supabase, input: unknown) =>
  chamar(s, 'app_empresa_sugestao_decidir', parseOuFalhar(decidirSugestaoSchema, input))
