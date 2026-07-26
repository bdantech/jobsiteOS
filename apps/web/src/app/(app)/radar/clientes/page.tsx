import { redirect } from 'next/navigation'

/**
 * Clientes Onepay foi movido para o menu Empresas (aba "Clientes Onepay"). Mantemos
 * esta rota só como redirecionamento, para links/bookmarks antigos não quebrarem.
 * A autorização acontece no destino (/empresas), que tem o próprio guard de módulo.
 */
export default function ClientesPage() {
  redirect('/empresas?tab=clientes')
}
