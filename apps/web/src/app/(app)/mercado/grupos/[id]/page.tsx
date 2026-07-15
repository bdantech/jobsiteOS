import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { GrupoDetalhe } from '@/components/mercado/grupos/grupo-detalhe'

export const metadata: Metadata = {
  title: 'Grupo econômico',
}

const uuidSchema = z.string().uuid()

/**
 * Guarda fina: o registry resolve /mercado/... para o módulo `mercado` e checa
 * contra os grants do perfil — a mesma chamada que a sidebar e a lista de tools
 * da IA fazem. RLS já devolveria zero linhas; isto transforma isso numa página
 * honesta em vez de uma tela vazia.
 */
export default async function GrupoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { grantedModuleIds } = await requireSessionContext()
  if (!canAccessRoute('/mercado', grantedModuleIds)) redirect('/sem-acesso')

  // Um id que não é uuid é 404, não consulta: o PostgREST responderia 22P02
  // (invalid input syntax for uuid), que é erro, não vazio — e apareceria como
  // uma caixa vermelha em vez de "grupo não encontrado".
  if (!uuidSchema.safeParse(id).success) notFound()

  return <GrupoDetalhe grupoId={id} />
}
