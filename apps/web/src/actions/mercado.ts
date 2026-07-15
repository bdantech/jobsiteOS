'use server'

import { revalidatePath } from 'next/cache'
import {
  FiltroError,
  MutationError,
  canAccessRoute,
  compileToPostgrest,
  criarSegmento,
  parseArvore,
  promoverEmpresa,
  type FieldErrors,
  type Tables,
} from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

/**
 * Mutações do módulo Mercado.
 *
 * Todas passam pelos write helpers de @jobsiteos/core, que chamam as funções
 * SECURITY INVOKER da migração 0013 — entidade + evento + audit_log em UMA
 * transação. Nunca escreva `mercado_universo`/`empresas` direto daqui.
 *
 * O client entregue aos helpers é deliberadamente o do USUÁRIO
 * (lib/supabase/server), nunca o admin: as funções rodam como quem chamou, então
 * o RLS decide o que elas podem tocar e audit_log.usuario_id = auth.uid(). Passar
 * o client de serviço aqui burlaria o RLS em silêncio.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

type Falha = { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

const SEM_SESSAO: Falha = {
  ok: false,
  message: 'Sua sessão expirou. Entre novamente para continuar.',
  code: 'forbidden',
}

const SEM_MODULO: Falha = {
  ok: false,
  message: 'Você não tem acesso ao módulo Mercado.',
  code: 'forbidden',
}

type Autorizacao =
  | { erro: Falha; supabase: null }
  | { erro: null; supabase: Awaited<ReturnType<typeof createClient>> }

async function autorizar(): Promise<Autorizacao> {
  const context = await getSessionContext()
  if (!context) return { erro: SEM_SESSAO, supabase: null }
  if (!canAccessRoute('/mercado', context.grantedModuleIds)) {
    return { erro: SEM_MODULO, supabase: null }
  }

  return { erro: null, supabase: await createClient() }
}

function falha(error: unknown): Falha {
  if (error instanceof MutationError) {
    return { ok: false, message: error.message, code: error.code, fieldErrors: error.fieldErrors }
  }
  if (error instanceof FiltroError) {
    return { ok: false, message: error.message, code: 'validation' }
  }

  console.error('[mercado] erro inesperado na mutação', error)
  return { ok: false, message: 'Não foi possível concluir a operação.', code: 'unknown' }
}

// ─── Promoção ───────────────────────────────────────────────────────────────

/**
 * Idempotente por construção (app_promover_empresa devolve a empresa existente
 * em vez de estourar), que é o que permite a promoção em lote: uma linha já
 * promovida por outra pessoa no meio do lote não é um erro.
 */
export async function promoverEmpresaAction(
  input: unknown,
): Promise<ActionResult<Tables<'empresas'>>> {
  const auth = await autorizar()
  if (auth.erro) return auth.erro

  try {
    const empresa = await promoverEmpresa(auth.supabase, input)
    revalidatePath('/mercado/explorador')
    revalidatePath('/empresas')
    return { ok: true, data: empresa }
  } catch (error) {
    return falha(error)
  }
}

// ─── Segmentos ──────────────────────────────────────────────────────────────

export async function criarSegmentoAction(
  input: unknown,
): Promise<ActionResult<Tables<'segmentos'>>> {
  const auth = await autorizar()
  if (auth.erro) return auth.erro

  try {
    const segmento = await criarSegmento(auth.supabase, input)
    revalidatePath('/mercado/segmentos')
    return { ok: true, data: segmento }
  } catch (error) {
    return falha(error)
  }
}

export interface Recontagem {
  contagem: number
  atualizado_em: string
}

/**
 * Recontagem de um segmento: conta de novo e grava o cache.
 *
 * Aqui o `count: 'exact'` é o ponto — um segmento é o que as Cadências vão
 * disparar em cima, e "≈ 12 mil empresas" não é um número que se planeja. É a
 * ÚNICA leitura full-scan que a UI dispara, e sempre por ação explícita.
 *
 * `contagem_cache` é o único campo do módulo que não tem RPC próprio: não é
 * entidade nem evento, é cache derivado da própria definição. A policy
 * `segmentos_update` (migração 0012) autoriza o update para quem tem o módulo, e
 * o client é o do usuário — o RLS continua sendo quem decide.
 */
export async function recontarSegmentoAction(id: string): Promise<ActionResult<Recontagem>> {
  const auth = await autorizar()
  if (auth.erro) return auth.erro

  try {
    const { data: segmento, error: erroLeitura } = await auth.supabase
      .from('segmentos')
      .select('id, definicao')
      .eq('id', id)
      .maybeSingle()

    if (erroLeitura) throw new Error(erroLeitura.message)
    if (!segmento) {
      return { ok: false, message: 'Segmento não encontrado.', code: 'not_found' }
    }

    // A definição vem do banco como jsonb — e ainda assim passa pelo zod + o
    // catálogo antes de virar filtro. Uma definição gravada por uma versão
    // anterior do catálogo não pode virar uma query quebrada.
    const arvore = parseArvore(segmento.definicao)

    const { count, error: erroContagem } = await auth.supabase
      .from('mercado_explorador')
      .select('cnpj', { count: 'exact', head: true })
      .or(compileToPostgrest(arvore))

    if (erroContagem) throw new Error(erroContagem.message)

    const contagem = count ?? 0
    const atualizado_em = new Date().toISOString()

    const { error: erroUpdate } = await auth.supabase
      .from('segmentos')
      .update({ contagem_cache: contagem, contagem_atualizada_em: atualizado_em })
      .eq('id', id)

    if (erroUpdate) throw new Error(erroUpdate.message)

    revalidatePath('/mercado/segmentos')
    revalidatePath(`/mercado/segmentos/${id}`)

    return { ok: true, data: { contagem, atualizado_em } }
  } catch (error) {
    return falha(error)
  }
}
