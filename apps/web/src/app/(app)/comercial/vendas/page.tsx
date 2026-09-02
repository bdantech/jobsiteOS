import type { Metadata } from 'next'
import { contextoComercial } from '@/lib/comercial'
import { FunilVendas } from '@/components/comercial/funil-vendas'

export const metadata: Metadata = { title: 'Funil de Vendas' }

// A tela lê o funil do usuário logado; renderizar estático congelaria a contagem.
export const dynamic = 'force-dynamic'

export default async function Pagina() {
  const { ehGestor, context } = await contextoComercial()
  /*
   * O link para a análise só existe para quem PODE abri-la. O layout de /credito
   * manda para /sem-acesso quem não tem o módulo, e os perfis Comercial, Closer e
   * SDR não têm — oferecer o botão para eles seria oferecer uma porta trancada.
   * A leitura da análise dentro do card continua valendo para todos: ela vem da
   * RLS estreita da 0129, ligada à venda, e não do módulo.
   */
  const temCredito = context.grantedModuleIds.includes('credito')
  return <FunilVendas ehGestor={ehGestor} temCredito={temCredito} />
}
