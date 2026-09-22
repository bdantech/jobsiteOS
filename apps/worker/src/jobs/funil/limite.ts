import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'

/**
 * O limite disponível do sacado, pela MESMA função que o funil de NFs usa.
 *
 * `app__limite_da_analise` é a escada que já resolve a hierarquia sacado → holding
 * (uma SPE não é analisada; quem é analisada é a construtora dona dela). Chamar a
 * mesma função aqui é o que faz uma pré-autorização e uma NF contra o mesmo sacado
 * responderem a mesma coisa quando a pergunta é "o limite cobre?".
 *
 * Cache por CNPJ: um sync varre milhares de itens e um punhado de construtoras se
 * repete em quase todos.
 */
const cache = new Map<string, { disponivel: number | null; origem: string | null }>()

export async function limiteDoSacado(
  cnpj: string,
): Promise<{ disponivel: number | null; origem: string | null }> {
  const guardado = cache.get(cnpj)
  if (guardado) return guardado

  /*
   * `.bind` e não `supabaseAdmin.rpc` solto.
   *
   * `rpc()` do supabase-js faz `return this.rest.rpc(...)`; arrancado do objeto,
   * `this` é undefined (módulo ES é strict) e a chamada estoura com "Cannot read
   * properties of undefined (reading 'rest')" no PRIMEIRO item do sync. Custou uma
   * corrida inteira em 21/09/2026, e o `as unknown as` é justamente o que esconde
   * isso do typecheck — ele promete uma função livre, que é o que ela deixou de
   * ser ao ser destacada.
   */
  const rpc = supabaseAdmin.rpc.bind(supabaseAdmin) as unknown as (
    nome: string,
    args: Record<string, unknown>,
  ) => Promise<{
    data: { disponivel: number | null; origem: string | null }[] | null
    error: { message: string } | null
  }>

  const { data, error } = await rpc('app__limite_da_analise', { p_sacado_cnpj: cnpj })
  if (error) {
    logger.warn({ cnpj, erro: error.message }, 'Falha ao resolver o limite do sacado.')
    return { disponivel: null, origem: null }
  }

  const linha = Array.isArray(data) ? data[0] : null
  const bruto = Number(linha?.disponivel ?? Number.NaN)
  const resolvido = {
    disponivel: Number.isFinite(bruto) ? bruto : null,
    origem: (linha?.origem as string | null) ?? null,
  }
  cache.set(cnpj, resolvido)
  return resolvido
}
