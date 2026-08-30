import type { Metadata } from 'next'
import { FilaNaoVinculadas } from '@/components/comunicacao/nao-vinculadas'

export const metadata: Metadata = { title: 'Não vinculadas — Comunicação' }

export default function NaoVinculadasPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-medium">Aguardando identificação</h1>
        <p className="text-sm text-muted-foreground">
          Quem falou com a gente e o sistema não soube quem era. Vincular cria o contato oficial na
          empresa e traz as mensagens já recebidas para a thread dele.
        </p>
      </div>
      <FilaNaoVinculadas />
    </div>
  )
}
