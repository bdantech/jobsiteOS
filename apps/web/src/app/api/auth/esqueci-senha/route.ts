import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { z } from 'zod'
import { BRAND_ACCENT } from '@jobsiteos/core'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * "Esqueci minha senha" (0262) — para a web e para o app.
 *
 * ── A RESPOSTA É SEMPRE A MESMA ─────────────────────────────────────────────
 * Existindo ou não a conta, ativa ou não, a rota responde 200 com a mesma frase.
 * Responder diferente transformaria esta porta num verificador de quais e-mails
 * têm conta na ONE OS.
 *
 * ── O LINK NÃO É O DO SUPABASE ──────────────────────────────────────────────
 * `generateLink` devolve o `hashed_token`, e o link que sai no e-mail aponta para
 * `/api/auth/redefinir`, NOSSA rota: ela valida o token, abre a sessão por cookie
 * e marca `must_change_password` — o resto é a tela de troca obrigatória que já
 * existe, com a mesma régua de senha. Sem depender do SMTP nem dos modelos de
 * e-mail do Supabase, e saindo pelo mesmo remetente da senha temporária.
 *
 * Sem service role no navegador: a busca da conta e a geração do link rodam aqui.
 */

export const runtime = 'nodejs'

const corpoSchema = z.object({ email: z.string().trim().toLowerCase().email() })

// Um pedido por e-mail por minuto, por instância. Não é a defesa (o link expira e
// só chega à caixa do dono); é o que impede alguém de encher a caixa de outra pessoa.
const ultimoPedido = new Map<string, number>()

const RESPOSTA = {
  ok: true,
  mensagem: 'Se houver uma conta ativa com este e-mail, enviamos um link para criar uma nova senha.',
}

export async function POST(request: Request): Promise<NextResponse> {
  let corpo: unknown
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Informe um e-mail.' }, { status: 400 })
  }
  const parsed = corpoSchema.safeParse(corpo)
  if (!parsed.success) return NextResponse.json({ erro: 'Informe um e-mail válido.' }, { status: 400 })
  const { email } = parsed.data

  const agora = Date.now()
  if (agora - (ultimoPedido.get(email) ?? 0) < 60_000) return NextResponse.json(RESPOSTA)
  ultimoPedido.set(email, agora)

  try {
    const admin = createAdminClient()
    const { data: usuario } = await admin
      .from('usuarios')
      .select('nome, ativo')
      .eq('email', email)
      .maybeSingle()
    if (!usuario?.ativo) return NextResponse.json(RESPOSTA)

    const { data: link, error } = await admin.auth.admin.generateLink({ type: 'recovery', email })
    const token = link?.properties?.hashed_token
    if (error || !token) return NextResponse.json(RESPOSTA)

    const origem = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin).replace(/\/$/, '')
    await enviar(email, usuario.nome, `${origem}/api/auth/redefinir?token_hash=${encodeURIComponent(token)}`)
  } catch {
    // A mesma resposta de sempre — ver o cabeçalho.
  }
  return NextResponse.json(RESPOSTA)
}

async function enviar(email: string, nome: string, url: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_REMETENTE_INTERNO ?? process.env.RESEND_FROM_EMAIL
  if (!apiKey || !from) return

  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b;">
    <table role="presentation" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <tr><td>
        <h1 style="margin:0 0 24px;font-size:20px;color:${BRAND_ACCENT};">JobsiteOS</h1>
        <p style="margin:0 0 16px;font-size:16px;">Olá, ${esc(nome)}!</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
          Recebemos um pedido para criar uma nova senha para a sua conta. O link abaixo vale
          por uma hora e funciona uma vez só.
        </p>
        <p style="margin:32px 0;">
          <a href="${esc(url)}"
             style="background:${BRAND_ACCENT};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;display:inline-block;font-weight:600;">
            Criar nova senha
          </a>
        </p>
        <p style="margin:24px 0 0;font-size:13px;color:#71717a;line-height:1.6;">
          Se não foi você, ignore este e-mail: sua senha atual continua valendo.
        </p>
      </td></tr>
    </table>
  </body>
</html>`

  const text = [
    `Olá, ${nome}!`,
    '',
    'Recebemos um pedido para criar uma nova senha para a sua conta no JobsiteOS.',
    'O link vale por uma hora e funciona uma vez só:',
    '',
    url,
    '',
    'Se não foi você, ignore este e-mail: sua senha atual continua valendo.',
  ].join('\n')

  await new Resend(apiKey).emails.send({ from, to: email, subject: 'Criar nova senha no JobsiteOS', html, text })
}
