import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { isAdmin, requireSessionContext } from '@/lib/auth'
import { PerfilPagina } from '@/components/mercado/perfil/perfil-pagina'

export const metadata: Metadata = { title: 'Perfil dos Clientes — Mercado' }

/**
 * LEITURA para todo o módulo Mercado, RECÁLCULO só para admin.
 *
 * A separação é a mesma das Camadas: ler o perfil é entender o mercado, e isso é
 * de todo o time. Disparar o recálculo varre coortes inteiras e compila as regras
 * contra ~880 mil linhas — é uma corrida cara que não deve poder ser iniciada por
 * engano, várias vezes seguidas, por quem estava só curioso.
 *
 * As sugestões continuam visíveis para todos: aceitar uma delas leva ao editor de
 * regra, que tem o próprio guarda de admin. Esconder a sugestão de quem opera o
 * funil seria esconder justamente de quem sabe se ela faz sentido.
 */
export default async function PerfilPage() {
  const context = await requireSessionContext()
  if (!canAccessRoute('/mercado', context.grantedModuleIds)) redirect('/sem-acesso')

  return <PerfilPagina podeRecalcular={isAdmin(context)} />
}
