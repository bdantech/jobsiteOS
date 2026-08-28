import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { EmpresaDetalhe } from '@/components/empresas/empresa-detalhe'

const uuidSchema = z.string().uuid()

/**
 * O título da página É o nome da empresa.
 *
 * A barra de abas do app segue o `<title>` de quem está aberto (components/shell/
 * route-sync.tsx). Com um título fixo, cinco empresas abertas viravam cinco abas escritas
 * "Empresa", e escolher entre elas era tentativa e erro. O mecanismo já existia — faltava
 * esta página usá-lo.
 *
 * Vai pelo cliente do USUÁRIO, não pelo de serviço: a RLS decide se o nome pode ser lido.
 * Quem não pode ver a empresa recebe o título genérico, em vez da razão social de uma
 * ficha que a página em seguida se recusa a mostrar — um título vaza tão bem quanto
 * qualquer outro texto.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return { title: 'Empresa' }

  const supabase = await createClient()
  const { data } = await supabase
    .from('empresas')
    .select('razao_social, nome_fantasia')
    .eq('id', id)
    .maybeSingle()

  return { title: data?.nome_fantasia || data?.razao_social || 'Empresa' }
}

export default async function EmpresaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { grantedModuleIds } = await requireSessionContext()
  if (!canAccessRoute(`/empresas/${id}`, grantedModuleIds)) redirect('/sem-acesso')

  // A non-uuid id is a 404, not a query: PostgREST would answer `.eq('id', 'abc')`
  // with 22P02 (invalid input syntax for uuid), which is an error state, not an
  // empty one — and it would surface as a red box instead of "não encontrada".
  if (!uuidSchema.safeParse(id).success) notFound()

  /*
   * A RLS deixa `processos` ser lida por quem tem `empresas` — é assim que o vendedor
   * vê que existe ação contra o sacado (08 §8). O CONTEÚDO do processo, não: o link
   * para /juridico só sai para quem tem o módulo, porque oferecer um link que leva a
   * /sem-acesso é pior que não oferecer link nenhum.
   */
  return <EmpresaDetalhe empresaId={id} podeAbrirJuridico={grantedModuleIds.includes('juridico')} />
}
