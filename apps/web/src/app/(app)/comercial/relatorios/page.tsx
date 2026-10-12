import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { contextoComercial } from '@/lib/comercial'
import { ListaRelatorios } from '@/components/comercial/relatorios/lista-relatorios'

export const metadata: Metadata = { title: 'Relatórios' }

export const dynamic = 'force-dynamic'

/**
 * A aba Relatórios é uma LISTA: cada card abre um relatório.
 *
 * A guarda é a mesma de cada relatório (`app_report_gestor()`, ver semanal/page.tsx) —
 * a lista não mostra número nenhum, mas um card que leva a uma tela que redireciona de
 * volta ensina que a aba está quebrada.
 */
export default async function Pagina() {
  await contextoComercial()
  const supabase = await createClient()
  const { data } = await supabase.rpc('app_report_gestor')
  if (data !== true) redirect('/comercial')

  return <ListaRelatorios />
}
