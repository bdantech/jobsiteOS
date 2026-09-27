import { randomBytes, createHmac } from 'node:crypto'
import { NextResponse } from 'next/server'
import { ESCOPOS_GMAIL, ESCOPOS_GOOGLE } from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

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
 * ── O CONSENTIMENTO PASSOU A INCLUIR A AGENDA (0201) ───────────────────────
 * `ESCOPOS_GOOGLE` = os três do Gmail + `calendar.events`. É o mesmo botão e o
 * mesmo consentimento: separar em dois fluxos daria duas telas do Google para a
 * mesma pessoa no mesmo dia, e a segunda é a que ninguém completa.
 *
 * Quem conectou ANTES disto continua com os três antigos, e é por isso que a
 * 0201 §7 conserta a gravação de `escopos` — é ela que permite à tela dizer
 * "reconecte" em vez de deixar a reunião falhar com um 403 silencioso.
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

/*
 * ── A CAIXA DE UMA PERSONA (Prompt 09 §4.2) ────────────────────────────────
 * `?caixa=<email_caixas.id>`: o mesmo consentimento, para a caixa real de um agente de IA
 * (`ana@oneos.com.br`). Quem clica é um GESTOR logado na conta Google da caixa. O
 * `state` carrega `caixa:<id>` no lugar do id do usuário — assinado do mesmo jeito, e o
 * callback confere que a conta autorizada É a caixa, e não a do gestor.
 *
 * Só os escopos do Gmail: a persona não tem agenda própria (a reunião vai para a agenda
 * do closer), e pedir o que não se usa é o que faz o Workspace barrar o app.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request): Promise<NextResponse> {
  const contexto = await getSessionContext()
  if (!contexto) return NextResponse.json({ erro: 'Sessão expirada.' }, { status: 401 })

  const caixa = new URL(request.url).searchParams.get('caixa')
  if (caixa !== null) {
    if (!UUID.test(caixa)) return NextResponse.json({ erro: 'Caixa inválida.' }, { status: 400 })
    if (!contexto.grantedModuleIds.includes('agentes')) {
      return NextResponse.json({ erro: 'Sem acesso ao módulo Agentes.' }, { status: 403 })
    }
    const supabase = await createClient()
    const { data: gestor } = await supabase.rpc('app_agentes_gestor')
    if (!gestor) return NextResponse.json({ erro: 'Somente a gestão comercial conecta a caixa de um agente.' }, { status: 403 })
  } else if (!contexto.grantedModuleIds.includes('comunicacao')) {
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
    scope: (caixa ? ESCOPOS_GMAIL : ESCOPOS_GOOGLE).join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: assinarState(caixa ? `caixa:${caixa}` : contexto.usuario.id, randomBytes(12).toString('hex')),
  })

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
}
