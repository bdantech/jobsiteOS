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
  constructor(
    message: string,
    readonly code: string,
    readonly fieldErrors?: FieldErrors,
  ) {
    super(message)
    this.name = 'MutationError'
  }
}

/** Postgres/PostgREST errors are not user-facing. Translate the ones we provoke. */
export function traduzirErro(error: PostgrestError): MutationError {
  // Raised by the RLS policies and by the explicit checks in the write helpers.
  if (error.code === '42501') {
    return new MutationError('Você não tem permissão para esta ação.', 'forbidden')
  }

  // unique_violation. `empresas.cnpj` is by far the common case, but `perfis.nome`
  // and `camada_regras (camada, versao)` share the code — so key off the message
  // rather than asserting it is always the CNPJ.
  if (error.code === '23505') {
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

  if (error.code === 'P0002' || error.message.includes('não encontrad')) {
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
