import type { Metadata } from 'next'
import { TemplatesLista } from '@/components/comunicacao/templates-lista'

export const metadata: Metadata = { title: 'Templates — Comunicação' }

export default function TemplatesPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-medium">Templates</h1>
        <p className="text-sm text-muted-foreground">
          O compositor mostra o texto já renderizado com as variáveis reais antes de enviar — quem
          aperta o botão vê o que a pessoa vai ler.
        </p>
      </div>
      <TemplatesLista />
    </div>
  )
}
