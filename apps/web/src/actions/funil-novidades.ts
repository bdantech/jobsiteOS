'use server'

import { revalidatePath } from 'next/cache'
import {
  anosParaImportar,
  importarFeriadosNacionais,
  removerDiaNaoUtil,
  salvarConfigNovidades,
  salvarDiaNaoUtil,
  type ResultadoImportacaoFeriados,
} from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { ActionResult } from './empresas'

/**
 * As escritas da janela de novidades do funil (04t §8): expediente, marcador de visita
 * e o calendário de dias não úteis.
 *
 * As três primeiras passam pelo client do USUÁRIO e por RPC — quem decide se a pessoa é
 * gestora é o banco (`app_gestor_comercial`), com audit_log na mesma transação. A
 * importação da BrasilAPI é a exceção e está explicada nela.
 */

async function autorizar() {
  const context = await getSessionContext()
  if (!context) {
    return { erro: { ok: false as const, message: 'Sessão expirada.', code: 'auth' }, supabase: null }
  }
  if (!context.grantedModuleIds.includes('comercial')) {
    return { erro: { ok: false as const, message: 'Sem acesso ao módulo Comercial.', code: 'forbidden' }, supabase: null }
  }
  return { erro: null, supabase: await createClient() }
}

function falha(error: unknown): ActionResult<never> {
  const message = error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
  return { ok: false, message, code: 'unknown' }
}

export async function salvarConfigNovidadesAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await salvarConfigNovidades(supabase, input)
    revalidatePath('/comercial/admin')
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

export async function salvarDiaNaoUtilAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await salvarDiaNaoUtil(supabase, input)
    revalidatePath('/comercial/admin')
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

export async function removerDiaNaoUtilAction(data: string): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await removerDiaNaoUtil(supabase, data)
    revalidatePath('/comercial/admin')
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

/**
 * "Importar feriados agora" — a execução sob demanda do job anual.
 *
 * Roda AQUI, e não no worker, de propósito: é uma chamada de um segundo a uma API
 * pública, e o botão existe justamente para o dia em que o calendário está faltando.
 * Depender do worker para isso seria um botão que não funciona quando o worker está
 * fora — que é um dos motivos de o calendário faltar. A função é a mesma do job
 * (`importarFeriadosNacionais`, no core), então os dois gravam igual.
 *
 * Usa o client de SERVIÇO porque `dias_nao_uteis` não tem política de escrita. Por isso
 * a autorização é feita antes, à mão, pela mesma régua dos RPCs do calendário.
 */
export async function importarFeriadosAction(): Promise<ActionResult<ResultadoImportacaoFeriados>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const { data: gestor } = await supabase.rpc('app_gestor_comercial')
    if (!gestor) {
      return { ok: false, message: 'Só gestores importam o calendário de feriados.', code: 'forbidden' }
    }

    const resultado = await importarFeriadosNacionais(createAdminClient(), anosParaImportar())
    if (resultado.anos.every((a) => a.erro)) {
      return {
        ok: false,
        message: `A BrasilAPI não respondeu (${resultado.anos[0]?.erro ?? 'erro desconhecido'}). A janela de novidades segue considerando só fins de semana e os dias cadastrados à mão.`,
        code: 'unknown',
      }
    }
    revalidatePath('/comercial/admin')
    return { ok: true, data: resultado }
  } catch (error) {
    return falha(error)
  }
}
