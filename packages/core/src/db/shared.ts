import type { PostgrestError } from '@supabase/supabase-js'
import type { z } from 'zod'

/**
 * Shared by every write helper (empresas, mercado, and whatever comes next).
 *
 * Extracted from db/mutations.ts when the Mercado module needed the same error
 * translation: two copies of `translate()` would inevitably drift, and the drift
 * would show up as a Postgres error code leaking to a user as
 * "Não foi possível concluir a operação" in one module and a readable message in
 * another.
 */

/** zod's flatten() yields a partial record — a field with no errors is absent, not []. */
export type FieldErrors = Record<string, string[] | undefined>

export class MutationError extends Error {
  // Campos declarados, e não parameter properties: o `--experimental-strip-types` dos
  // testes não aceita sintaxe que gera código, e sem isto nada que importe este arquivo
  // (a tradução de erros, por exemplo) seria testável.
  readonly code: string
  readonly fieldErrors?: FieldErrors

  constructor(message: string, code: string, fieldErrors?: FieldErrors) {
    super(message)
    this.name = 'MutationError'
    this.code = code
    this.fieldErrors = fieldErrors
  }
}

/**
 * Mensagem escrita por NÓS num `raise exception` (pt-BR, acentuada) — e não pelo Postgres,
 * que fala inglês sem acento. É a mesma régua do 22023 abaixo, estendida aos códigos que as
 * RPCs da Cobrança usam com explicação própria ("Há título já em cobrança ativa (COB-…)",
 * "Somente a gestão de cobrança pode fazer isso."). O genérico apagaria o que fazer.
 */
const ehNossa = (message: string) => /[À-ÿ]/.test(message)

/** Postgres/PostgREST errors are not user-facing. Translate the ones we provoke. */
export function traduzirErro(error: PostgrestError): MutationError {
  // Raised by the RLS policies and by the explicit checks in the write helpers.
  if (error.code === '42501') {
    if (ehNossa(error.message)) return new MutationError(error.message, 'forbidden')
    return new MutationError('Você não tem permissão para esta ação.', 'forbidden')
  }

  // unique_violation. `empresas.cnpj` is by far the common case, but `perfis.nome`
  // and `camada_regras (camada, versao)` share the code — so key off the message
  // rather than asserting it is always the CNPJ.
  if (error.code === '23505') {
    if (ehNossa(error.message)) return new MutationError(error.message, 'duplicate')
    if (error.message.includes('cnpj')) {
      return new MutationError('Já existe uma empresa cadastrada com este CNPJ.', 'duplicate', {
        cnpj: ['CNPJ já cadastrado.'],
      })
    }
    return new MutationError('Já existe um registro com estes dados.', 'duplicate')
  }

  // check_violation — the CHECK constraints (estagio, tipo, cnpj, camada).
  if (error.code === '23514') {
    return new MutationError('Dados inválidos para o banco de dados.', 'invalid')
  }

  /*
   * invalid_parameter_value — o código que as NOSSAS funções usam para recusar um pedido
   * por regra de negócio, sempre com a explicação em pt-BR na mensagem ("este sacado está
   * em cobrança extrajudicial: novas análises ficam suspensas até a regularização"). Trocar
   * por um genérico apagaria a única coisa que diz à pessoa o que fazer. O Postgres também
   * levanta 22023 sozinho (jsonb em escalar, parâmetro inválido de função nativa), sempre em
   * inglês e sem acento — esses continuam genéricos.
   */
  if (error.code === '22023') {
    if (ehNossa(error.message)) return new MutationError(error.message, 'invalid')
    return new MutationError('Não foi possível concluir a operação.', 'unknown')
  }

  if (error.code === 'P0002' || error.message.includes('não encontrad')) {
    if (ehNossa(error.message)) return new MutationError(error.message, 'not_found')
    return new MutationError('Registro não encontrado.', 'not_found')
  }

  return new MutationError('Não foi possível concluir a operação.', 'unknown')
}

export function parseOuFalhar<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new MutationError('Dados inválidos.', 'validation', result.error.flatten().fieldErrors)
  }
  return result.data
}
