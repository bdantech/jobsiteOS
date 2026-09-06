'use client'

import { useActionState, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import type { PrefsNotificacoes } from '@jobsiteos/core'
import { ESTADO_INICIAL } from '@/lib/form-state'
import { PushToggle } from '@/components/notifications/push-toggle'
import { salvarPrefsNotificacoes } from './actions'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

/**
 * Two different questions, deliberately kept apart:
 *
 *  - <PushToggle/> (owned by the notifications module) answers "is THIS browser
 *    subscribed?" — a per-device fact, stored in web_push_subscriptions.
 *  - The switches below answer "which channels should we push to at all?" — a
 *    per-user preference, stored in prefs_notificacoes and read by notify().
 *
 * Both must be on for a push to land, which is why the copy says so: a user who
 * turns push on for the browser but leaves "push web" off would otherwise get
 * silence and no explanation.
 */
export function NotificacoesCard({ prefsIniciais }: { prefsIniciais: PrefsNotificacoes }) {
  const [prefs, setPrefs] = useState<PrefsNotificacoes>(prefsIniciais)
  const [state, formAction, isPending] = useActionState(salvarPrefsNotificacoes, ESTADO_INICIAL)

  useEffect(() => {
    if (state.status === 'success') toast.success(state.message ?? 'Preferências salvas.')
    if (state.status === 'error' && state.message) toast.error(state.message)
  }, [state])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notificações</CardTitle>
        <CardDescription>
          Escolha como você quer ser avisado sobre eventos das suas empresas.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <PushToggle />

        <Separator />

        <form action={formAction} className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="push_web" className="text-sm font-medium">
                Push no navegador (web)
              </Label>
              <p className="text-sm text-muted-foreground">
                Se desativado, nenhum navegador recebe push — nem os já ativados acima.
              </p>
            </div>
            <Switch
              id="push_web"
              name="push_web"
              checked={prefs.push_web}
              disabled={isPending}
              onCheckedChange={(marcado) =>
                setPrefs((atual) => ({ ...atual, push_web: marcado }))
              }
            />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="push_mobile" className="text-sm font-medium">
                Push no celular (app)
              </Label>
              <p className="text-sm text-muted-foreground">
                Enviar notificações para o aplicativo JobsiteOS nos seus dispositivos.
              </p>
            </div>
            <Switch
              id="push_mobile"
              name="push_mobile"
              checked={prefs.push_mobile}
              disabled={isPending}
              onCheckedChange={(marcado) =>
                setPrefs((atual) => ({ ...atual, push_mobile: marcado }))
              }
            />
          </div>

          <Separator />

          {/*
            Uma pergunta diferente das duas de cima: elas dizem POR ONDE avisar, esta diz
            SE a lista de trabalho deve procurar a pessoa de manhã. Sem o desligamento
            próprio, quem acha o resumo intrusivo desliga o push inteiro — e perde junto
            os avisos que importam.
          */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="resumo_meu_dia" className="text-sm font-medium">
                Resumo do Meu Dia, às 8h
              </Label>
              <p className="text-sm text-muted-foreground">
                Em dia útil, quantos itens esperam por você e quanto está em jogo. Dia sem
                item não gera aviso.
              </p>
            </div>
            <Switch
              id="resumo_meu_dia"
              name="resumo_meu_dia"
              checked={prefs.resumo_meu_dia}
              disabled={isPending}
              onCheckedChange={(marcado) =>
                setPrefs((atual) => ({ ...atual, resumo_meu_dia: marcado }))
              }
            />
          </div>

          <Button type="submit" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Salvando…
              </>
            ) : (
              'Salvar preferências'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
