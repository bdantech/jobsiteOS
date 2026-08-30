import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Retorno do consentimento OAuth do Gmail.
 *
 * ── O SERVICE ROLE É NECESSÁRIO, E ELE NÃO É ATALHO ────────────────────────
 * Os dois tokens vão para o Vault, e `vault.create_secret` não é alcançável por
 * `authenticated`. A RPC `app_salvar_gmail_conta` é SECURITY DEFINER com EXECUTE
 * só para `service_role` (0144). A AUTORIZAÇÃO desta rota é a verificação da
 * assinatura do `state` — é ela que prova de quem é o consentimento, e ela vem
 * antes de qualquer escrita.
 *
 * ── FALHA VOLTA PARA A TELA, NÃO PARA UM JSON ──────────────────────────────
 * Quem chega aqui veio de um botão e está olhando o navegador. Um objeto de erro
 * cru seria o fim de um fluxo que a pessoa não sabe retomar; o redirect com
 * `?gmail=erro` deixa a tela explicar e oferecer o botão de novo.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function usuarioDoState(state: string | null): string | null {
  if (!state) return null
  const partes = state.split('.')
  if (partes.length !== 3) return null
  const [usuarioId, nonce, assinatura] = partes as [string, string, string]

  const segredo = process.env.CRON_SECRET ?? ''
  const esperada = createHmac('sha256', segredo).update(`${usuarioId}.${nonce}`).digest('hex')
  const a = Buffer.from(assinatura)
  const b = Buffer.from(esperada)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return usuarioId
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url)
  const destino = new URL('/comunicacao/config', url.origin)

  const usuarioId = usuarioDoState(url.searchParams.get('state'))
  const codigo = url.searchParams.get('code')
  if (!usuarioId || !codigo) {
    destino.searchParams.set('gmail', 'erro')
    return NextResponse.redirect(destino)
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    destino.searchParams.set('gmail', 'sem_config')
    return NextResponse.redirect(destino)
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: codigo,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${url.origin}/api/auth/gmail/callback`,
        grant_type: 'authorization_code',
      }),
    })
    const tokens = (await tokenRes.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      scope?: string
    }
    if (!tokenRes.ok || !tokens.access_token) {
      destino.searchParams.set('gmail', 'erro')
      return NextResponse.redirect(destino)
    }

    const perfilRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    })
    const perfil = (await perfilRes.json()) as { emailAddress?: string }
    if (!perfil.emailAddress) {
      destino.searchParams.set('gmail', 'erro')
      return NextResponse.redirect(destino)
    }

    const admin = createAdminClient()
    const { error } = await admin.rpc('app_salvar_gmail_conta', {
      p: {
        usuario_id: usuarioId,
        endereco: perfil.emailAddress,
        refresh_token: tokens.refresh_token ?? null,
        access_token: tokens.access_token,
        access_token_expira_em: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
        escopos: (tokens.scope ?? '').split(' ').filter(Boolean),
      } as never,
    })
    if (error) {
      console.error('[comunicacao] falha ao gravar a conexão do Gmail', { code: error.code })
      destino.searchParams.set('gmail', 'erro')
      return NextResponse.redirect(destino)
    }

    destino.searchParams.set('gmail', 'conectado')
    return NextResponse.redirect(destino)
  } catch (erro) {
    console.error('[comunicacao] erro no callback do Gmail', String(erro))
    destino.searchParams.set('gmail', 'erro')
    return NextResponse.redirect(destino)
  }
}
