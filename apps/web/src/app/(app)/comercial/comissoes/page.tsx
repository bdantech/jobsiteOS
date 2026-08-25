import type { Metadata } from 'next'
import { isAdmin } from '@/lib/auth'
import { contextoComercial } from '@/lib/comercial'
import { Comissoes } from '@/components/comercial/comissoes'

export const metadata: Metadata = { title: 'Comissões' }

// A tela lê o funil do usuário logado; renderizar estático congelaria a contagem.
export const dynamic = 'force-dynamic'

export default async function Pagina() {
  const { context, ehGestor, vendedor } = await contextoComercial()

  /*
   * Duas réguas diferentes, de propósito.
   *
   * `ehGestor` (Admin OU Comercial) é quem aprova competência e simula taxa — decisões
   * sobre a FOLHA. Reclassificar é decisão sobre a POLÍTICA: muda a taxa de todas as
   * cessões futuras de uma conta, e por isso fica só com quem tem o módulo Admin.
   */
  return (
    <Comissoes
      ehGestor={ehGestor}
      ehAdmin={isAdmin(context)}
      vendedorId={vendedor?.id ?? null}
    />
  )
}
