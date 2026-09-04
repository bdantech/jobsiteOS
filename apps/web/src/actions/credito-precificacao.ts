'use server'

import { revalidatePath } from 'next/cache'
import {
  MutationError,
  ativarMatrizPrecificacao,
  canAccessRoute,
  publicarCondicoes,
  salvarCondicoes,
  salvarMatrizPrecificacao,
  validarCondicoes,
  type CondicoesFormulario,
  type FieldErrors,
  type MatrizPrecificacao,
  type Tables,
} from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { dispararEntregarWebhooks } from '@/lib/mercado/worker'

/**
 * As condições comerciais (04o §6) e a matriz de precificação (§3).
 *
 * ─── A VALIDAÇÃO ACONTECE AQUI, NÃO SÓ NA TELA ──────────────────────────────
 * O formulário já valida a cada tecla com a MESMA função (`validarCondicoes`, do
 * core). Ela roda de novo aqui porque o botão não é a única porta: uma action é
 * chamável por qualquer requisição autenticada, e o que sai desta publicação vira um
 * `POST /api/backoffice/credit-analyses` do outro lado. Uma condição malformada não é
 * um relatório feio — é uma análise de crédito que não nasce lá.
 *
 * ─── FALHA DE VALIDAÇÃO NÃO É SILÊNCIO ──────────────────────────────────────
 * Quando o validador recusa, a publicação NÃO é abortada: ela é registrada como
 * `falha_validacao`, com a mensagem exata, e nenhum webhook é enfileirado. A
 * tentativa recusada é a informação mais útil que existe quando alguém pergunta, três
 * dias depois, por que a produção nunca recebeu aquelas condições.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

type Falha = { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

const SEM_SESSAO: Falha = {
  ok: false,
  message: 'Sua sessão expirou. Entre novamente.',
  code: 'forbidden',
}
const SEM_MODULO: Falha = {
  ok: false,
  message: 'Precificação é do perfil Crédito.',
  code: 'forbidden',
}

async function autorizar() {
  const context = await getSessionContext()
  if (!context) return { erro: SEM_SESSAO as Falha, supabase: null }
  if (!canAccessRoute('/credito', context.grantedModuleIds)) {
    return { erro: SEM_MODULO as Falha, supabase: null }
  }
  return { erro: null, supabase: await createClient() }
}

function falhaDe(e: unknown): Falha {
  if (e instanceof MutationError) {
    return { ok: false, message: e.message, code: e.code, fieldErrors: e.fieldErrors }
  }
  return { ok: false, message: 'Não foi possível concluir a operação.', code: 'unknown' }
}

export interface PublicarInput {
  analise_credito_id: string
  condicoes: CondicoesFormulario
  sugestao: Record<string, unknown>
  ajustes: Record<string, unknown> | null
  matriz_versao: number
  /** A matriz vigente, para o validador conferir as faixas globais. */
  matriz: MatrizPrecificacao
}

export interface PublicacaoResultado {
  condicoes: Tables<'condicoes_comerciais'>
  /** `false` quando a validação recusou — aí `erros` diz o quê. */
  publicada: boolean
  erros: { campo: string; mensagem: string }[]
  /** O worker foi acordado? `false` = a fila entrega no próximo ciclo do cron. */
  worker_acordado: boolean
}

/** Rascunho: guarda o trabalho em curso sem publicar nada para a produção. */
export async function salvarCondicoesAction(
  input: unknown,
): Promise<ActionResult<Tables<'condicoes_comerciais'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const c = await salvarCondicoes(supabase, input)
    revalidatePath(`/credito/analises/${c.analise_credito_id}`)
    return { ok: true, data: c }
  } catch (e) {
    return falhaDe(e)
  }
}

/**
 * Publicar. Valida, grava e — só se passou — enfileira o webhook e cutuca o worker.
 *
 * O disparo do worker é best-effort, como no resto do sistema: a entrega já está na
 * fila e o cron a varre de qualquer forma. Falhar a action porque o worker não
 * atendeu esconderia uma publicação que de fato aconteceu.
 */
export async function publicarCondicoesAction(
  input: PublicarInput,
): Promise<ActionResult<PublicacaoResultado>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro

  const validacao = validarCondicoes(input.condicoes, input.matriz)
  const mensagem = validacao.erros.map((e) => `${e.campo}: ${e.mensagem}`).join(' · ')

  try {
    const c = await publicarCondicoes(supabase, {
      analise_credito_id: input.analise_credito_id,
      condicoes: input.condicoes,
      sugestao: input.sugestao,
      ajustes: input.ajustes,
      matriz_versao: input.matriz_versao,
      erro_validacao: validacao.ok ? null : mensagem,
    })

    const disparo = validacao.ok
      ? await dispararEntregarWebhooks()
      : { ok: false as const, message: '', code: '' }

    revalidatePath(`/credito/analises/${input.analise_credito_id}`)
    revalidatePath('/credito')
    return {
      ok: true,
      data: {
        condicoes: c,
        publicada: validacao.ok,
        erros: validacao.erros,
        worker_acordado: disparo.ok,
      },
    }
  } catch (e) {
    return falhaDe(e)
  }
}

/**
 * Nova versão da matriz. Não reprecifica nada retroativamente, e isso é deliberado:
 * uma condição publicada aponta para a versão que a sugeriu, e reescrevê-la mudaria o
 * preço que alguém já combinou com um cliente.
 */
export async function salvarMatrizAction(
  input: unknown,
): Promise<ActionResult<Tables<'precificacao_matriz'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const m = await salvarMatrizPrecificacao(supabase, input)
    revalidatePath('/credito/precificacao')
    return { ok: true, data: m }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function ativarMatrizAction(
  versao: number,
): Promise<ActionResult<Tables<'precificacao_matriz'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const m = await ativarMatrizPrecificacao(supabase, { versao })
    revalidatePath('/credito/precificacao')
    return { ok: true, data: m }
  } catch (e) {
    return falhaDe(e)
  }
}
