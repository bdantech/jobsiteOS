import type { Metadata } from 'next'
import { requireSessionContext } from '@/lib/auth'
import { PlaybooksLista } from '@/components/comunicacao/playbooks-lista'

export const metadata: Metadata = { title: 'Playbooks — Comunicação' }

export default async function PlaybooksPage() {
  const context = await requireSessionContext()
  // A checagem que vale é a do RPC (`app_is_admin()`); esta é só para a tela não
  // oferecer um botão que o banco vai recusar.
  const ehAdmin = context.grantedModuleIds.includes('admin')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-medium">Playbooks do agente</h1>
        <p className="text-sm text-muted-foreground">
          O agente é um decisor, não um chatbot: ele escolhe uma ação de uma lista fechada. O
          playbook define quais ações existem naquela conversa, com que tom e por quanto tempo
          insistir.
        </p>
      </div>
      <PlaybooksLista ehAdmin={ehAdmin} />
    </div>
  )
}
