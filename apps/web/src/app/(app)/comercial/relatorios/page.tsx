import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { contextoComercial } from '@/lib/comercial'
import { RelatoriosTela } from '@/components/comercial/relatorios/relatorios-tela'

export const metadata: Metadata = { title: 'Relatórios' }

// A tela lê a semana fechada e o histórico; renderizar estático congelaria os dois.
export const dynamic = 'force-dynamic'

/**
 * Guarda na PÁGINA, e não só na navegação — mesmo padrão de /fila, /painel e /admin.
 *
 * A régua é `app_report_gestor()`, a mesma da RLS: tem o módulo Comercial e NÃO é
 * vendedor. `contextoComercial().ehGestor` não serve aqui — ela é `app_gestor_comercial()`,
 * "perfil Admin ou Comercial", e a auxiliar do closer tem perfil Comercial. Este report
 * mostra o desempenho nominal e a comissão de cada pessoa do time.
 */
export default async function Pagina() {
  await contextoComercial()
  const supabase = await createClient()
  const { data } = await supabase.rpc('app_report_gestor')
  if (data !== true) redirect('/comercial')

  return <RelatoriosTela podeGerar />
}
