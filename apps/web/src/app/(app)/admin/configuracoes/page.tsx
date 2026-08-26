import type { Metadata } from 'next'
import { lerEstadoBeta } from '@jobsiteos/core'
import { BetaCard } from '@/components/admin/beta-card'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Configurações' }

// O estado do beta muda por ação de admin e reflete por Realtime. Renderizar
// estaticamente congelaria o valor no build e a tela abriria mentindo.
export const dynamic = 'force-dynamic'

/**
 * Admin → Configurações (04m §5).
 *
 * Lê com o client do USUÁRIO: `app_config_select` libera a leitura a qualquer
 * usuário ativo, e o guard de escrita é a RPC. Um service role aqui só serviria
 * para esconder que a autorização real está no banco.
 */
export default async function AdminConfiguracoesPage() {
  const supabase = await createClient()
  const { data } = await supabase.from('app_config').select('valor').eq('chave', 'beta').maybeSingle()
  const beta = lerEstadoBeta(data?.valor)

  return (
    <div className="max-w-2xl space-y-4">
      <BetaCard inicial={beta} />
    </div>
  )
}
