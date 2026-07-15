import { NextResponse } from 'next/server'
import { z } from 'zod'
import { registrarPushWebSchema, type Json } from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Web Push subscription registration for callers that CANNOT use a server action:
 * namely the service worker, on `pushsubscriptionchange`. The UI path uses the
 * server actions in @/actions/notificacoes instead.
 *
 * Authenticated by the session cookie — a fetch() from a service worker is
 * same-origin and carries it. Returns 401 rather than redirecting: a worker
 * cannot follow a redirect to /login in any useful way.
 *
 * SERVICE ROLE: usuarios.web_push_subscriptions is not granted to
 * `authenticated` on any row, so this column is unreachable from the user-scoped
 * client. Every query below is scoped to the caller's own id.
 */

const inscricoesArmazenadasSchema = z.array(registrarPushWebSchema).catch([])

const corpoSchema = z.object({
  inscricao: registrarPushWebSchema,
  /**
   * The endpoint the browser just rotated away from. Without it the dead
   * subscription lingers until a push to it 410s, so we'd keep sending to a
   * black hole in the meantime.
   */
  endpointAnterior: z.string().url().nullish(),
})

export async function POST(request: Request): Promise<NextResponse> {
  const contexto = await getSessionContext()
  if (contexto === null) {
    return NextResponse.json({ erro: 'Não autenticado.' }, { status: 401 })
  }

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Corpo inválido.' }, { status: 400 })
  }

  const parsed = corpoSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ erro: 'Inscrição de push inválida.' }, { status: 400 })
  }

  const { inscricao, endpointAnterior } = parsed.data
  const admin = createAdminClient()

  const { data, error: readError } = await admin
    .from('usuarios')
    .select('web_push_subscriptions')
    .eq('id', contexto.usuario.id)
    .single()

  if (readError || !data) {
    return NextResponse.json({ erro: 'Não foi possível carregar as inscrições.' }, { status: 500 })
  }

  const atuais = inscricoesArmazenadasSchema.parse(data.web_push_subscriptions)

  const descartar = new Set<string>([inscricao.endpoint])
  if (endpointAnterior !== null && endpointAnterior !== undefined) {
    descartar.add(endpointAnterior)
  }

  const novas = [...atuais.filter((s) => !descartar.has(s.endpoint)), inscricao]

  const { error: writeError } = await admin
    .from('usuarios')
    .update({ web_push_subscriptions: novas as unknown as Json })
    .eq('id', contexto.usuario.id)

  if (writeError) {
    return NextResponse.json({ erro: 'Não foi possível salvar a inscrição.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
