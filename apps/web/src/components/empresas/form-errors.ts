import type { FieldValues, Path, UseFormReturn } from 'react-hook-form'
import type { FieldErrors as MutationFieldErrors } from '@jobsiteos/core'

/**
 * Bridges MutationError.fieldErrors (server) back onto the form fields (client).
 *
 * This is the whole point of the write helper throwing a typed error instead of
 * a string: a duplicate CNPJ comes back as `{ cnpj: ['CNPJ já cadastrado.'] }`
 * and lands under the CNPJ input, not in a toast the user has to interpret.
 *
 * `campos` is passed explicitly so a key the server invents can never be
 * setError()'d onto a field that doesn't exist (react-hook-form would happily
 * create a phantom error that nothing renders and nothing clears).
 * Returns false when nothing could be attached — the caller then shows a toast.
 */
export function aplicarFieldErrors<T extends FieldValues>(
  form: UseFormReturn<T>,
  fieldErrors: MutationFieldErrors | undefined,
  campos: readonly Path<T>[],
): boolean {
  if (!fieldErrors) return false

  let aplicou = false
  for (const campo of campos) {
    const mensagens = fieldErrors[campo]
    if (mensagens && mensagens.length > 0) {
      form.setError(campo, { type: 'server', message: mensagens[0] })
      aplicou = true
    }
  }
  return aplicou
}
