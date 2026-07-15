import type { Metadata } from 'next'
import Link from 'next/link'
import { ShieldOff } from 'lucide-react'
import { grantedModules } from '@jobsiteos/core'
import { sair } from '@/actions/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireSessionContext } from '@/lib/auth'

export const metadata: Metadata = { title: 'Sem acesso' }

/**
 * The landing spot for every "you can't be here" redirect in the app:
 *  - "/" when the perfil grants no module at all (a misconfiguration);
 *  - /admin for a non-admin;
 *  - a module route the perfil doesn't grant (middleware sends those to "/",
 *    which falls through to here when there is nowhere else to land).
 *
 * It deliberately lives inside (app), so the user keeps the shell: with modules,
 * the sidebar is itself the way out. This route is not in the registry, so
 * canAccessRoute() returns true for it and the middleware lets it through —
 * without that, "/" → /sem-acesso → "/" would be an infinite redirect.
 */
export default async function SemAcessoPage() {
  const { usuario, grantedModuleIds } = await requireSessionContext()
  const [primeiroModulo] = grantedModules(grantedModuleIds)

  return (
    <div className="flex flex-1 items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div
            className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted"
            aria-hidden
          >
            <ShieldOff className="h-6 w-6 text-muted-foreground" />
          </div>
          <CardTitle>Sem acesso</CardTitle>
          <CardDescription>
            {primeiroModulo
              ? 'Você não tem permissão para acessar esta área. Se acredita que isso é um engano, fale com um administrador.'
              : 'Seu perfil ainda não tem nenhum módulo liberado. Peça a um administrador para liberar seu acesso.'}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-2">
          {primeiroModulo ? (
            <Button asChild className="w-full">
              <Link href={primeiroModulo.route}>Voltar para {primeiroModulo.name}</Link>
            </Button>
          ) : null}

          <Button asChild variant="outline" className="w-full">
            <Link href="/settings">Configurações da conta</Link>
          </Button>

          {/*
            A user with zero modules has an empty sidebar, so logging out is the
            only action left to them. Keep it reachable.
          */}
          <form action={sair}>
            <Button type="submit" variant="ghost" className="w-full text-muted-foreground">
              Sair
            </Button>
          </form>

          <p className="pt-2 text-center text-xs text-muted-foreground">
            Conectado como {usuario.email}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
