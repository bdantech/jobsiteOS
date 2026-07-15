/**
 * The shape every form in the app reads with useActionState. `fieldErrors`
 * mirrors zod's flatten(), so a schema change surfaces on the right input
 * without any mapping table at the call site.
 *
 * WHY THIS IS NOT IN `actions/auth.ts`: a `'use server'` module may only export
 * async functions — every export becomes a callable RPC endpoint. `ESTADO_INICIAL`
 * is a plain object, so exporting it from there makes Next fail the build with
 * "A 'use server' file can only export async functions, found object" the moment a
 * SERVER component imports that module. Client components were importing it happily
 * (they only ever see the action references), which is why this stayed latent.
 *
 * Types are erased at compile time and are safe to export from a 'use server'
 * file; runtime values like this one are not.
 */
export type FormState = {
  status: 'idle' | 'error' | 'success'
  message?: string
  fieldErrors?: Record<string, string[] | undefined>
}

export const ESTADO_INICIAL: FormState = { status: 'idle' }
