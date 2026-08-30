import { randomBytes, createHmac } from 'node:crypto'
import { NextResponse } from 'next/server'
import { ESCOPOS_GMAIL } from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'

/**
 * Início do consentimento OAuth do Gmail (05A §3.2).
 *
 * ── O `state` É ASSINADO, E NÃO É SÓ UM ID ─────────────────────────────────
 * Ele carrega o id do usuário e um nonce, com HMAC do `CRON_SECRET`. Sem
 * assinatura, qualquer pessoa poderia chamar o callback com o `state` de outra e
 * fazer o consentimento dela ser gravado como conexão de terceiro — que é a
 * versão de CSRF que importa aqui, porque o que se ganha é a caixa de e-mail de
 * alguém.
 *
 * ── `access_type=offline` + `prompt=consent` ───────────────────────────────
 * O Google só devolve o refresh token no PRIMEIRO consentimento. Sem
 * `prompt=consent`, uma reconexão devolve access token e nenhum refresh — e a
 * conexão morre em uma hora sem ninguém entender por quê.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function assinarState(usuarioId: string, nonce: string): string {
  const segredo = process.env.CRON_SECRET ?? ''
  const corpo = `${usuarioId}.${nonce}`
  const assinatura = createHmac('sha256', segredo).update(corpo).digest('hex')
  return `${corpo}.${assinatura}`
}

export async function GET(request: Request): Promise<NextResponse> {
  const contexto = await getSessionContext()
  if (!contexto) return NextResponse.json({ erro: 'Sessão expirada.' }, { status: 401 })
  if (!contexto.grantedModuleIds.includes('comunicacao')) {
    return NextResponse.json({ erro: 'Sem acesso ao módulo Comunicação.' }, { status: 403 })
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId || !process.env.CRON_SECRET) {
    return NextResponse.json(
      { erro: 'A integração com o Gmail não está configurada.' },
      { status: 500 },
    )
  }

  const origem = new URL(request.url).origin
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origem}/api/auth/gmail/callback`,
    response_type: 'code',
    scope: ESCOPOS_GMAIL.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: assinarState(contexto.usuario.id, randomBytes(12).toString('hex')),
  })

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
}
