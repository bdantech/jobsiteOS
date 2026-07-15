import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { ImportacoesLista } from '@/components/mercado/importador/importacoes-lista'

export const metadata: Metadata = {
  title: 'Importações — Mercado',
}

/**
 * Importador de listas (spec §5.5, webOnly).
 *
 * Mesma guarda de toda página do módulo: o registry resolve /mercado/importacoes
 * para o módulo `mercado` e confere contra os grants do perfil. O RLS
 * (`app_tem_modulo('mercado')`, migração 0012) já devolveria zero linhas a quem
 * não tem o módulo — isto transforma isso em um redirect honesto em vez de uma
 * tabela vazia.
 *
 * APLICAR uma importação exige ainda o módulo `empresas`, porque é lá que as
 * empresas e os contatos são gravados. Essa segunda checagem vive na server action
 * (mercado-importacao.ts), que é onde ela pode ser garantida.
 */
export default async function ImportacoesPage() {
  const { grantedModuleIds } = await requireSessionContext()
  if (!canAccessRoute('/mercado', grantedModuleIds)) redirect('/sem-acesso')

  return <ImportacoesLista />
}
