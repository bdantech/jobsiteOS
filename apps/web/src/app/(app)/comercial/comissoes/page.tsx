import type { Metadata } from 'next'
import { isAdmin } from '@/lib/auth'
import { contextoComercial } from '@/lib/comercial'
import { Comissoes } from '@/components/comercial/comissoes'

export const metadata: Metadata = { title: 'Comissões' }

// A tela lê o funil do usuário logado; renderizar estático congelaria a contagem.
export const dynamic = 'force-dynamic'

export default async function Pagina() {
  const { context, ehGestor, ehAuxiliar, vendedor } = await contextoComercial()

  /*
   * Duas réguas diferentes, de propósito.
   *
   * `ehGestor` (Admin OU Comercial) é quem aprova competência e simula taxa — decisões
   * sobre a FOLHA. Reclassificar é decisão sobre a POLÍTICA: muda a taxa de todas as
   * cessões futuras de uma conta, e por isso fica só com quem tem o módulo Admin.
   *
   * ── O AUXILIAR NÃO É GESTOR DA FOLHA, MESMO COM PERFIL DE UM (0215) ──────
   * O perfil `Comercial` é o que dá o módulo à auxiliar, e de carona a tornava gestora
   * aqui: a tela abria em "Consolidado (todos)", somando a folha da casa inteira, e
   * oferecia Simulador e os botões de aprovar competência.
   *
   * O banco já recusa os dados (`app_auxiliar_de_closer`), mas parar nele deixaria a
   * tela oferecendo o que a RLS devolve vazio — e oferecer para depois não entregar
   * ensina a pessoa que o sistema erra. As duas réguas são a mesma, escrita nos dois
   * lados.
   */
  return (
    <Comissoes
      ehGestor={ehGestor && !ehAuxiliar}
      ehAdmin={isAdmin(context)}
      vendedorId={vendedor?.id ?? null}
    />
  )
}
