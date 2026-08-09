import { requireSessionContext, type SessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

/**
 * Quem está pedindo a tela do Comercial: o vendedor dele, e se ele é gestor.
 *
 * "Gestor" vem do BANCO (`app_gestor_comercial()`), não de uma conta local.
 *
 * Cada página do módulo tinha a sua própria versão da regra — `isAdmin(context) ||
 * !vendedor` — e ela era verdadeira enquanto só Admin e Comercial tinham o módulo: quem
 * não fosse vendedor cadastrado só podia ser gestor. Com os perfis SDR, Originador e
 * Closer (0096) isso deixa de valer: um closer que ainda não foi cadastrado como vendedor
 * cairia em "gestor" e a tela lhe ofereceria Configurações, Fila sem Dono e o painel de
 * todo mundo. O banco recusaria a escrita, mas oferecer e depois recusar é pior que não
 * oferecer — a pessoa aprende que o sistema erra.
 *
 * Uma fonte só, e é a mesma que a RLS consulta. Duas réguas para a mesma pergunta é uma
 * régua a mais para divergir.
 */
export interface ContextoComercial {
  context: SessionContext
  /** O cadastro de vendedor do usuário logado, quando existe. */
  vendedor: { id: string; tipo: string } | null
  ehGestor: boolean
}

export async function contextoComercial(): Promise<ContextoComercial> {
  const context = await requireSessionContext()
  const supabase = await createClient()

  const [vendedorRes, gestorRes] = await Promise.all([
    supabase
      .from('vendedores')
      .select('id, tipo')
      .eq('usuario_id', context.usuario.id)
      .eq('ativo', true)
      .maybeSingle(),
    supabase.rpc('app_gestor_comercial'),
  ])

  return {
    context,
    vendedor: vendedorRes.data ?? null,
    ehGestor: gestorRes.data === true,
  }
}
