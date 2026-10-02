import type { Metadata } from 'next'
import { FilaNaoVinculadas } from '@/components/comunicacao/nao-vinculadas'
import { isAdmin, requireSessionContext } from '@/lib/auth'

export const metadata: Metadata = { title: 'Não vinculadas — Comunicação' }

export default async function NaoVinculadasPage() {
  const context = await requireSessionContext()

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-medium">Aguardando identificação</h1>
        <p className="text-sm text-muted-foreground">
          Quem falou com a gente e o sistema não soube quem era. Vincular cria o contato oficial na
          empresa e traz as mensagens já recebidas para a thread dele.
        </p>
      </div>
      {/* O Admin vê a fila de todos — inclusive as linhas sem dono, que nenhuma fila
          individual mostra. A leitura já era livre para o módulo (a RLS não recorta por
          pessoa); o que muda é a tela oferecer o recorte. */}
      <FilaNaoVinculadas ehAdmin={isAdmin(context)} />
    </div>
  )
}
