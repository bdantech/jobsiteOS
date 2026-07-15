import { NextResponse } from 'next/server'
import { prefsNotificacoesSchema, type Json } from '@jobsiteos/core'

import { jsonError, readJsonBody, requireApiSession } from '../../_lib/session'

/**
 * The caller's own notification preferences (`usuarios.prefs_notificacoes`).
 *
 * This has to be a server route even though it is nothing but "read/write my own
 * row": `prefs_notificacoes` is not granted to `authenticated` on ANY row — not
 * even your own (migration 0005) — so supabase-js on the phone simply cannot see
 * the column. Hence the service role, scoped to the caller's id and nothing else.
 *
 * Shape is prefsNotificacoesSchema: { push_web, push_mobile }, both defaulting to
 * true. Absent/garbage JSON in the column parses to "everything on", which is
 * exactly how notify() reads it — the two must not disagree about the default.
 */

export const runtime = 'nodejs'

/** PATCH takes any subset; unspecified channels keep their current value. */
const patchSchema = prefsNotificacoesSchema.partial()

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireApiSession(request)
  if (!auth.ok) return auth.response

  const { usuario, admin } = auth.session

  const { data, error } = await admin
    .from('usuarios')
    .select('prefs_notificacoes')
    .eq('id', usuario.id)
    .maybeSingle()

  if (error) return jsonError('Falha ao carregar suas preferências.', 500)

  // safeParse, not parse: a legacy/hand-edited value must degrade to the
  // defaults rather than 500 the settings screen.
  const prefs = prefsNotificacoesSchema.safeParse(data?.prefs_notificacoes ?? {})

  return NextResponse.json({
    prefs: prefs.success ? prefs.data : prefsNotificacoesSchema.parse({}),
  })
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const auth = await requireApiSession(request)
  if (!auth.ok) return auth.response

  const { usuario, admin } = auth.session

  const parsedBody = await readJsonBody(request)
  if (!parsedBody.ok) return parsedBody.response

  const parsed = patchSchema.safeParse(parsedBody.body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Preferências inválidas.', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 422 },
    )
  }

  const { data: atual, error: leituraError } = await admin
    .from('usuarios')
    .select('prefs_notificacoes')
    .eq('id', usuario.id)
    .maybeSingle()

  if (leituraError) return jsonError('Falha ao carregar suas preferências.', 500)

  const base = prefsNotificacoesSchema.safeParse(atual?.prefs_notificacoes ?? {})
  const prefs = {
    ...(base.success ? base.data : prefsNotificacoesSchema.parse({})),
    ...parsed.data,
  }

  const { error } = await admin
    .from('usuarios')
    .update({ prefs_notificacoes: prefs as unknown as Json })
    .eq('id', usuario.id)

  if (error) return jsonError('Não foi possível salvar suas preferências.', 500)

  return NextResponse.json({ prefs })
}
