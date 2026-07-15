'use client'

import { useActionState, useState } from 'react'
import { AlertCircle, Check, KeyRound, Loader2, X } from 'lucide-react'
import { alterarSenhaObrigatoria } from '@/actions/auth'
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
import { cn } from '@/lib/utils'

/** Mirrors alterarSenhaSchema in @jobsiteos/core — the server is what enforces it. */
const REQUISITOS: { label: string; ok: (senha: string) => boolean }[] = [
  { label: 'No mínimo 12 caracteres', ok: (s) => s.length >= 12 },
  { label: 'Uma letra minúscula', ok: (s) => /[a-z]/.test(s) },
  { label: 'Uma letra maiúscula', ok: (s) => /[A-Z]/.test(s) },
  { label: 'Um número', ok: (s) => /[0-9]/.test(s) },
]

export function AlterarSenhaForm({ nome }: { nome: string }) {
  const [state, formAction, isPending] = useActionState(alterarSenhaObrigatoria, ESTADO_INICIAL)
  const [senha, setSenha] = useState('')

  const erroSenha = state.fieldErrors?.senha?.[0]
  const erroConfirmacao = state.fieldErrors?.confirmacao?.[0]

  return (
    <Card className="w-full">
      <CardHeader className="space-y-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-brand-foreground">
          <KeyRound className="h-5 w-5" aria-hidden />
        </div>
        <CardTitle>Defina uma nova senha</CardTitle>
        <CardDescription>
          Olá, {nome}. Sua senha atual é temporária. Para continuar, escolha uma senha
          definitiva.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form action={formAction} className="space-y-4" noValidate>
          {state.status === 'error' && state.message ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{state.message}</span>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="senha">Nova senha</Label>
            <Input
              id="senha"
              name="senha"
              type="password"
              autoComplete="new-password"
              required
              disabled={isPending}
              value={senha}
              onChange={(event) => setSenha(event.target.value)}
              aria-invalid={Boolean(erroSenha)}
            />
            {erroSenha ? <p className="text-sm text-destructive">{erroSenha}</p> : null}
          </div>

          <ul className="space-y-1" aria-label="Requisitos da senha">
            {REQUISITOS.map((requisito) => {
              const atendido = requisito.ok(senha)
              return (
                <li
                  key={requisito.label}
                  className={cn(
                    'flex items-center gap-2 text-xs',
                    atendido ? 'text-brand' : 'text-muted-foreground',
                  )}
                >
                  {atendido ? (
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <X className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {requisito.label}
                </li>
              )
            })}
          </ul>

          <div className="space-y-2">
            <Label htmlFor="confirmacao">Confirme a nova senha</Label>
            <Input
              id="confirmacao"
              name="confirmacao"
              type="password"
              autoComplete="new-password"
              required
              disabled={isPending}
              aria-invalid={Boolean(erroConfirmacao)}
            />
            {erroConfirmacao ? (
              <p className="text-sm text-destructive">{erroConfirmacao}</p>
            ) : null}
          </div>

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Salvando...
              </>
            ) : (
              'Salvar e continuar'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
