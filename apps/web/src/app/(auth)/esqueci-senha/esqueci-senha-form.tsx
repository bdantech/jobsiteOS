'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, MailCheck } from 'lucide-react'
import { Logo } from '@/components/brand/logo'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function EsqueciSenhaForm() {
  const [email, setEmail] = React.useState('')
  const [enviando, setEnviando] = React.useState(false)
  const [resposta, setResposta] = React.useState<string | null>(null)
  const [erro, setErro] = React.useState<string | null>(null)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    setEnviando(true)
    try {
      const res = await fetch('/api/auth/esqueci-senha', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const corpo = (await res.json().catch(() => ({}))) as { mensagem?: string; erro?: string }
      if (!res.ok) setErro(corpo.erro ?? 'Não foi possível pedir o link. Tente de novo.')
      else setResposta(corpo.mensagem ?? 'Se houver uma conta com este e-mail, enviamos o link.')
    } catch {
      setErro('Sem conexão. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Card>
      <CardHeader className="space-y-2">
        <Logo className="size-10" />
        <CardTitle className="text-2xl">Esqueci minha senha</CardTitle>
        <CardDescription>
          Informe o e-mail da sua conta. Enviamos um link para você criar uma nova senha.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {resposta ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
              <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              <span>{resposta} Confira também a caixa de spam.</span>
            </div>
            <Button asChild variant="outline">
              <Link href="/login">Voltar para o login</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={enviar} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="voce@oneos.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={enviando}
                required
              />
              {erro && <p className="text-sm text-destructive">{erro}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={enviando || !email.trim()}>
              {enviando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Enviar link
            </Button>
            <Link
              href="/login"
              className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" aria-hidden /> Voltar para o login
            </Link>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
