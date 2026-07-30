import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { CertificadosGrid, LegendaCertificados } from '@/components/certificados/certificados-grid'

export const metadata: Metadata = {
  title: 'Gestão de certificados',
}

/**
 * Gestão de certificados digitais (04b §4). Rota própria, aberta do painel de
 * Clientes Onepay — o grid não cabe dentro de uma aba junto de outras coisas.
 *
 * Guard pelo registry, como as demais páginas: a RLS já devolveria zero linhas a
 * quem não tem o módulo, e isto transforma isso numa página honesta em vez de um
 * grid vazio. A rota é estática, então não conflita com /empresas/[id].
 */
export default async function CertificadosPage() {
  const { grantedModuleIds } = await requireSessionContext()
  if (!canAccessRoute('/empresas', grantedModuleIds)) redirect('/sem-acesso')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Gestão de certificados</h1>
          <p className="text-sm text-muted-foreground">
            Certificado digital vencido significa que paramos de ingerir NF-e daquela empresa.
          </p>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/empresas?tab=clientes">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" aria-hidden />
            Clientes Onepay
          </Link>
        </Button>
      </div>

      <LegendaCertificados />
      <CertificadosGrid />
    </div>
  )
}
