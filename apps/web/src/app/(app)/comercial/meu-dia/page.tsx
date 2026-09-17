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
 * O `?vendedor=` é honrado para QUEM PODE ABRIR aquele dia — e quem decide isso é o
 * banco, não esta página: `meu_dia` e `app_meu_dia_cargo` chamam `app_pode_ver_vendedor`
 * e devolvem `tem_acesso: false` para o resto. Um parâmetro de URL nunca é autorização;
 * por isso ele pode ser passado adiante sem medo, e por isso não precisa (nem deve) ser
 * filtrado aqui por cargo.
 *
 * ANTES ERA SÓ PARA GESTOR, e isso deixava um acesso cruzado sem porta: o closer que
 * recebeu `vendedor_acessos` de um SDR via o funil dele em toda aba do módulo, menos
 * nesta — a única que responde "o que essa pessoa tem para fazer hoje". A lista de
 * quem se pode abrir vem do mesmo RPC das outras telas, então ela já é o recorte certo.
 *
 * Para o auxiliar do closer o parâmetro continua sendo resolvido pelo agregador: o dia
 * dele é o do superior.
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<{ vendedor?: string }>
}) {
  const { ehGestor, vendedor } = await contextoComercial()
  const { vendedor: escolhido } = await searchParams

  if (!ehGestor && !vendedor) redirect('/comercial/comissoes')

  const dia = await carregarMeuDia(escolhido ?? vendedor?.id ?? null)

  const supabase = await createClient()
  const { data: visiveis } = await supabase.rpc('comercial_vendedores_visiveis')

  return (
    <MeuDiaTela
      dia={dia}
      // O auxiliar fica fora da lista: o dia dele é o do closer, e oferecer os dois
      // seria oferecer a mesma tela com dois nomes.
      visiveis={(
        (visiveis ?? []) as { id: string; nome: string; tipo: string; sou_eu: boolean }[]
      ).filter((v) => v.tipo !== 'auxiliar')}
    />
  )
}
