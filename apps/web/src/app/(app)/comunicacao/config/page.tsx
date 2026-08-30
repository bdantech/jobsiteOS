import type { Metadata } from 'next'
import { Suspense } from 'react'
import { requireSessionContext } from '@/lib/auth'
import { ConfigComunicacaoTela } from '@/components/comunicacao/config-comunicacao'

export const metadata: Metadata = { title: 'Configurações — Comunicação' }

export default async function ConfigComunicacaoPage() {
  const context = await requireSessionContext()
  const ehAdmin = context.grantedModuleIds.includes('admin')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-medium">Configurações da Comunicação</h1>
        <p className="text-sm text-muted-foreground">
          O portão, os canais e o kill switch do agente.
        </p>
      </div>
      {/* A tela lê `?gmail=` do retorno do OAuth, então precisa de Suspense. */}
      <Suspense fallback={null}>
        <ConfigComunicacaoTela ehAdmin={ehAdmin} />
      </Suspense>
    </div>
  )
}
