import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { contextoComercial } from '@/lib/comercial'
import { DocumentosTela } from '@/components/comercial/relatorios/documentos-tela'

export const metadata: Metadata = { title: 'Documentos sem dono' }

// Estoque do momento: renderizar estático congelaria a fila.
export const dynamic = 'force-dynamic'

/** Mesma régua do report semanal: `app_report_gestor()`, que é também a porta do RPC. */
export default async function Pagina() {
  await contextoComercial()
  const supabase = await createClient()
  const { data } = await supabase.rpc('app_report_gestor')
  if (data !== true) redirect('/comercial')

  return <DocumentosTela />
}
