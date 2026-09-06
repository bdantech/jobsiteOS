import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { contextoComercial } from '@/lib/comercial'
import { carregarMeuDia } from '@/components/comercial/meu-dia/queries'
import { MeuDiaTela } from '@/components/comercial/meu-dia/meu-dia-tela'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Meu Dia' }

// A lista é o estado do trabalho AGORA; estático serviria o dia de ontem.
export const dynamic = 'force-dynamic'

/**
 * A home do vendedor.
 *
 * O `?vendedor=` só é honrado para quem é gestor — e mesmo assim o agregador confere de
 * novo (`app_pode_ver_vendedor`), porque um parâmetro de URL nunca é autorização. Para o
 * auxiliar do closer o parâmetro é ignorado: o dia dele é o do superior, e o agregador
 * resolve isso sozinho.
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<{ vendedor?: string }>
}) {
  const { ehGestor, vendedor } = await contextoComercial()
  const { vendedor: escolhido } = await searchParams

  if (!ehGestor && !vendedor) redirect('/comercial/comissoes')

  const dia = await carregarMeuDia(ehGestor ? (escolhido ?? vendedor?.id ?? null) : null)

  const supabase = await createClient()
  const { data: visiveis } = ehGestor
    ? await supabase.rpc('comercial_vendedores_visiveis')
    : { data: [] }

  return (
    <MeuDiaTela
      dia={dia}
      ehGestor={ehGestor}
      visiveis={((visiveis ?? []) as { id: string; nome: string; tipo: string }[]).filter(
        (v) => v.tipo !== 'auxiliar',
      )}
    />
  )
}
