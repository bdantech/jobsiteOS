'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Check, Loader2, X } from 'lucide-react'
import { alterarSenhaConta } from '@/actions/auth'
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

export function SenhaCard() {
  const [state, formAction, isPending] = useActionState(alterarSenhaConta, ESTADO_INICIAL)
  const [senha, setSenha] = useState('')
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message ?? 'Senha alterada com sucesso.')
      formRef.current?.reset()
      setSenha('')
    } else if (state.status === 'error' && state.message && !state.fieldErrors) {
      toast.error(state.message)
    }
  }, [state])

  const erroSenha = state.fieldErrors?.senha?.[0]
  const erroConfirmacao = state.fieldErrors?.confirmacao?.[0]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Senha</CardTitle>
        <CardDescription>
          Escolha uma senha forte. Você continuará conectado neste navegador.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form ref={formRef} action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="nova-senha">Nova senha</Label>
            <Input
              id="nova-senha"
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

          {senha.length > 0 ? (
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
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="nova-senha-confirmacao">Confirme a nova senha</Label>
            <Input
              id="nova-senha-confirmacao"
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

          <Button type="submit" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Salvando...
              </>
            ) : (
              'Alterar senha'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
