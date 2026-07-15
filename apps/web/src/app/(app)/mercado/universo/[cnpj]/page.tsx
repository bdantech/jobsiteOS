import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { UniversoFicha } from '@/components/mercado/explorador/universo-ficha'

export const metadata: Metadata = {
  title: 'Universo',
}

/**
 * A ficha de um CNPJ que ainda NÃO é uma empresa. O Explorador só manda para cá
 * quem não foi promovido — quem foi vai para o Company 360.
 */
export default async function UniversoPage({ params }: { params: Promise<{ cnpj: string }> }) {
  const { cnpj } = await params

  const { grantedModuleIds } = await requireSessionContext()
  if (!canAccessRoute('/mercado/universo', grantedModuleIds)) redirect('/sem-acesso')

  // CNPJ é sempre 14 dígitos normalizados (zeros à esquerda importam, por isso é
  // text e não numérico). Qualquer outra coisa é 404, não uma query: o banco
  // aceitaria a busca e devolveria vazio, o que é um estado diferente de "essa
  // URL não faz sentido".
  const normalizado = decodeURIComponent(cnpj).replace(/\D/g, '')
  if (normalizado.length !== 14) notFound()

  return <UniversoFicha cnpj={normalizado} />
}
