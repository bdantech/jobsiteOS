'use server'

import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdmin, requireSessionContext } from '@/lib/auth'
import { resolverAtalho } from '@/components/shell/abas-dos-modulos'

/**
 * Os atalhos fixados no topo da sidebar (0284).
 *
 * `usuarios.atalhos_fixados` não tem grant para `authenticated`, como
 * `prefs_notificacoes`: a escrita passa pelo service role, e a única coisa entre quem
 * chama e a linha de outra pessoa é esta regra — a linha é a do id da sessão
 * revalidada, NUNCA um id vindo do cliente. Nada aqui recebe `usuario_id`.
 *
 * A lista vai INTEIRA a cada gravação (fixar, desafixar e reordenar são todos "esta é
 * a minha lista agora"). Uma action por gesto seria um read-modify-write no servidor,
 * e dois cliques rápidos intercalados perderiam um deles; com a lista inteira, quem
 * grava por último é o estado que a pessoa está vendo.
 */

export type ResultadoAtalhos = { ok: true; atalhos: string[] } | { ok: false; erro: string }

const listaSchema = z.array(z.string().min(1).max(200)).max(20)

export async function salvarAtalhos(entrada: string[]): Promise<ResultadoAtalhos> {
  const context = await requireSessionContext()

  const parsed = listaSchema.safeParse(entrada)
  if (!parsed.success) return { ok: false, erro: 'Lista de atalhos inválida.' }

  const visao = { ehAdmin: isAdmin(context), modulos: context.grantedModuleIds }

  // Só o que o catálogo conhece e esta pessoa alcança. É uma lista de links, não uma
  // permissão — mas guardar um caminho arbitrário viraria um link para qualquer lugar
  // desenhado na sidebar de quem o mandou.
  const atalhos = [...new Set(parsed.data)].filter((href) => resolverAtalho(href, visao) !== null)

  const { error } = await createAdminClient()
    .from('usuarios')
    .update({ atalhos_fixados: atalhos })
    .eq('id', context.user.id)

  if (error) return { ok: false, erro: 'Não foi possível salvar os atalhos.' }
  return { ok: true, atalhos }
}
