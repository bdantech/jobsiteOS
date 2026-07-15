'use client'

import { useActionState } from 'react'
import { Logo } from '@/components/brand/logo'
import { AlertCircle, Loader2 } from 'lucide-react'
import { entrar } from '@/actions/auth'
import { ESTADO_INICIAL } from '@/lib/form-state'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function LoginForm({ erroInicial }: { erroInicial?: string }) {
  const [state, formAction, isPending] = useActionState(entrar, ESTADO_INICIAL)

  // The action's own error always wins over the one carried in the URL: if the
  // user has since tried to log in again, that attempt is the current truth.
  const erro = state.status === 'error' ? state.message : erroInicial
  const erroEmail = state.fieldErrors?.email?.[0]
  const erroSenha = state.fieldErrors?.senha?.[0]

  return (
    <Card>
      <CardHeader className="space-y-2">
        {/* A marca de verdade, no lugar do quadrado "OS" que era um placeholder.
            Aqui ela leva o title: não há texto ao lado no mesmo elemento, então é o
            leitor de tela que precisa saber de quem é este login. */}
        <Logo className="size-10" />
        <CardTitle className="text-2xl">JobsiteOS</CardTitle>
        <CardDescription>Entre com sua conta ONE OS para continuar.</CardDescription>
      </CardHeader>

      <CardContent>
        <form action={formAction} className="space-y-4" noValidate>
          {erro ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{erro}</span>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="voce@oneos.com.br"
              required
              disabled={isPending}
              aria-invalid={Boolean(erroEmail)}
              aria-describedby={erroEmail ? 'email-erro' : undefined}
            />
            {erroEmail ? (
              <p id="email-erro" className="text-sm text-destructive">
                {erroEmail}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="senha">Senha</Label>
            <Input
              id="senha"
              name="senha"
              type="password"
              autoComplete="current-password"
              required
              disabled={isPending}
              aria-invalid={Boolean(erroSenha)}
              aria-describedby={erroSenha ? 'senha-erro' : undefined}
            />
            {erroSenha ? (
              <p id="senha-erro" className="text-sm text-destructive">
                {erroSenha}
              </p>
            ) : null}
          </div>

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Entrando...
              </>
            ) : (
              'Entrar'
            )}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Acesso restrito a colaboradores. Esqueceu a senha? Fale com um administrador.
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
