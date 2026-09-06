import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { isAdmin } from '@/lib/auth'
import { contextoComercial } from '@/lib/comercial'
import { CampanhasLista } from '@/components/campanhas/campanhas-lista'

export const metadata: Metadata = { title: 'Campanhas — Comercial' }

// A lista mostra progresso de campanha em execução; estático congelaria o placar.
export const dynamic = 'force-dynamic'

/** Só Admin: disparar em nome da casa é decisão de aquisição, não trabalho de funil. */
export default async function Pagina() {
  const { context } = await contextoComercial()
  if (!isAdmin(context)) redirect('/comercial')
  return <CampanhasLista podeGerir />
}
