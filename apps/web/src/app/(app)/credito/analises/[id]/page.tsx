import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { AnaliseDetalhe } from '@/components/credito/analise-detalhe'

const uuidSchema = z.string().uuid()

/**
 * O título da página É o nome da construtora, pelo mesmo motivo da Company 360.
 *
 * A barra de abas do app segue o `<title>` de quem está aberto (components/shell/
 * route-sync.tsx). Com o título fixo, cinco análises abertas viravam cinco abas escritas
 * "Análise de crédito", e escolher entre elas era tentativa e erro.
 *
 * Vai pelo cliente do USUÁRIO, não pelo de serviço: a RLS decide se o nome pode ser lido.
 * Quem não pode ver a análise recebe o título genérico, em vez da razão social de uma
 * ficha que a página em seguida se recusa a mostrar — um título vaza tão bem quanto
 * qualquer outro texto.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return { title: 'Análise de crédito' }

  const supabase = await createClient()
  const { data } = await supabase
    .from('analises_credito')
    .select('empresas(razao_social, nome_fantasia)')
    .eq('id', id)
    .maybeSingle()

  const e = (data as { empresas: { razao_social: string | null; nome_fantasia: string | null } | null } | null)
    ?.empresas
  return { title: e?.razao_social || e?.nome_fantasia || 'Análise de crédito' }
}

export default async function AnalisePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // id não-uuid é 404, não consulta: o PostgREST responderia 22P02, que a tela mostraria
  // como caixa vermelha de erro em vez de "não encontrada".
  if (!uuidSchema.safeParse(id).success) notFound()
  return <AnaliseDetalhe id={id} />
}
