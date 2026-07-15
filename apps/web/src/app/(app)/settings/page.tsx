import type { Metadata } from 'next'
import { prefsNotificacoesSchema, type PrefsNotificacoes } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AparenciaCard } from './aparencia-card'
import { NotificacoesCard } from './notificacoes-card'
import { SenhaCard } from './senha-card'

export const metadata: Metadata = {
  title: 'Configurações',
}

/**
 * `prefs_notificacoes` is not granted to `authenticated` on any row (migration
 * 0005), so even reading your OWN preferences needs the service role. The read is
 * pinned to the id from the revalidated session — see settings/actions.ts.
 */
async function carregarPrefs(userId: string): Promise<PrefsNotificacoes> {
  const admin = createAdminClient()

  const { data } = await admin
    .from('usuarios')
    .select('prefs_notificacoes')
    .eq('id', userId)
    .maybeSingle()

  const parsed = prefsNotificacoesSchema.safeParse(data?.prefs_notificacoes)

  // A user who has never saved prefs has `{}`. Defaulting to "send me everything"
  // matches notify(), which treats unparseable prefs the same way.
  return parsed.success ? parsed.data : prefsNotificacoesSchema.parse({})
}

export default async function SettingsPage() {
  const context = await requireSessionContext()
  const prefs = await carregarPrefs(context.user.id)

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie sua conta, aparência e notificações.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Conta</CardTitle>
          <CardDescription>Seus dados no JobsiteOS.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Nome</span>
            <span className="font-medium">{context.usuario.nome}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">E-mail</span>
            <span className="font-medium">{context.usuario.email}</span>
          </div>
        </CardContent>
      </Card>

      <SenhaCard />
      <AparenciaCard />
      {/* PushToggle (inside) reads NEXT_PUBLIC_VAPID_PUBLIC_KEY itself. */}
      <NotificacoesCard prefsIniciais={prefs} />
    </div>
  )
}
