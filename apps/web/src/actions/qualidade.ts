'use server'

import { revalidatePath } from 'next/cache'
import {
  ELEVENLABS_USER_URL,
  FIREFLIES_GRAPHQL,
  MutationError,
  QUERY_DONO_DA_CHAVE,
  ativarRubrica,
  auditarVinculo,
  canAccessRoute,
  chamarBotReuniao,
  contestarItem,
  decidirContestacao,
  decidirSugestaoCadastro,
  dispensarCaptura,
  lerConferenciaChave,
  lerConferenciaChaveElevenLabs,
  overrideLimiar,
  pedirRecalibracao,
  resolverPendenciaQualidade,
  rotularAnalise,
  salvarConfigQualidade,
  salvarPessoaQualidade,
  salvarRubrica,
  salvarSegredoQualidade,
  type ConferenciaChaveElevenLabs,
  type ConferenciaChaveFireflies,
  type FieldErrors,
} from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import {
  dispararQualidadeProcessar,
  dispararQualidadeRecalibrar,
  dispararQualidadeVigiar,
  dispararQualidadeVinculacao,
} from '@/lib/mercado/worker'
import { createClient } from '@/lib/supabase/server'

/**
 * Mutações da Inteligência de Conversas (05C). Tudo por RPC SECURITY DEFINER (0283c) com
 * o client do USUÁRIO — quem decide se a pessoa pode contestar, rotular ou mexer na
 * rubrica é a função, e ela recusa com uma frase em pt-BR que chega intacta ao toast.
 *
 * Algumas escritas cutucam o worker logo em seguida (resgate do bot, recalibração): é o
 * que faz o botão ter efeito em segundos, em vez de esperar o próximo cron. A cutucada é
 * best-effort — se falhar, o cron pega na rodada seguinte.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

type Falha = { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

const SEM_SESSAO: Falha = { ok: false, message: 'Sua sessão expirou. Entre novamente.', code: 'forbidden' }
const SEM_MODULO: Falha = { ok: false, message: 'Você não tem acesso ao módulo Comercial.', code: 'forbidden' }

async function autorizar() {
  const context = await getSessionContext()
  if (!context) return { erro: SEM_SESSAO, supabase: null }
  if (!canAccessRoute('/comercial', context.grantedModuleIds)) return { erro: SEM_MODULO, supabase: null }
  return { erro: null, supabase: await createClient() }
}

function falhaDe(e: unknown): Falha {
  if (e instanceof MutationError) {
    const campos = Object.entries(e.fieldErrors ?? {}).filter(([, v]) => Array.isArray(v) && v.length > 0)
    const primeiro = campos[0]
    const message =
      e.code === 'validation' && primeiro ? `${(primeiro[1] as string[])[0]}` : e.message
    return { ok: false, message, code: e.code, fieldErrors: e.fieldErrors }
  }
  console.error('[qualidade] erro inesperado na mutação', e)
  return { ok: false, message: 'Não foi possível concluir a operação.', code: 'unknown' }
}

async function executar<T>(
  fn: (s: NonNullable<Awaited<ReturnType<typeof autorizar>>['supabase']>) => Promise<T>,
  rotas: string[] = [],
  depois?: () => Promise<unknown>,
): Promise<ActionResult<T>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro ?? SEM_SESSAO
  try {
    const data = await fn(supabase)
    for (const r of rotas) revalidatePath(r)
    if (depois) await depois().catch(() => undefined)
    return { ok: true, data }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── Settings ───────────────────────────────────────────────────────────────

export async function salvarConfigQualidadeAction(input: unknown) {
  return executar((s) => salvarConfigQualidade(s, input), ['/comercial/qualidade'])
}

/**
 * A chave do Fireflies é conferida com o Fireflies ANTES de ir para o Vault: gravada errada,
 * ela não falha na tela, falha um dia depois no worker, transcrição por transcrição. Só a
 * recusa explícita deles impede de salvar; sem resposta, salva e avisa.
 */
async function conferirChaveFireflies(chave: string): Promise<ConferenciaChaveFireflies> {
  try {
    const r = await fetch(FIREFLIES_GRAPHQL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${chave}` },
      body: JSON.stringify({ query: QUERY_DONO_DA_CHAVE }),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    })
    return lerConferenciaChave(r.status, await r.json().catch(() => null))
  } catch {
    return { valida: null, motivo: 'O Fireflies não respondeu.' }
  }
}

async function conferirChaveElevenLabs(chave: string): Promise<ConferenciaChaveElevenLabs> {
  try {
    const r = await fetch(ELEVENLABS_USER_URL, {
      headers: { 'xi-api-key': chave },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    })
    return lerConferenciaChaveElevenLabs(r.status, await r.json().catch(() => null))
  } catch {
    return { valida: null, motivo: 'A ElevenLabs não respondeu.' }
  }
}

export async function salvarSegredoQualidadeAction(
  input: unknown,
): Promise<ActionResult<{ chave: string; definido: boolean; conta?: string | null; aviso?: string; conferida?: boolean }>> {
  const { chave, valor } = (input ?? {}) as { chave?: unknown; valor?: unknown }
  const novo = typeof valor === 'string' ? valor.trim() : ''
  let conferencia: ConferenciaChaveFireflies | ConferenciaChaveElevenLabs | null = null
  let conta: string | null = null
  if (novo && (chave === 'fireflies_api_key' || chave === 'elevenlabs_api_key')) {
    // Só quem pode gravar faz a chamada sair daqui.
    const { erro } = await autorizar()
    if (erro) return erro
    if (chave === 'fireflies_api_key') {
      const c = await conferirChaveFireflies(novo)
      if (c.valida) conta = c.email
      conferencia = c
    } else {
      conferencia = await conferirChaveElevenLabs(novo)
    }
    if (conferencia.valida === false) return { ok: false, message: conferencia.motivo, code: 'validation' }
  }
  const r = await executar((s) => salvarSegredoQualidade(s, input), ['/comercial/qualidade'])
  if (!r.ok || !conferencia) return r
  if (conferencia.valida === null) {
    return { ok: true, data: { ...r.data, aviso: `${conferencia.motivo} A chave foi salva sem conferência.` } }
  }
  return { ok: true, data: { ...r.data, conferida: true, conta } }
}

export async function salvarPessoaQualidadeAction(input: unknown) {
  return executar((s) => salvarPessoaQualidade(s, input), ['/comercial/qualidade'])
}

// ─── Captura (aba Reunião) ──────────────────────────────────────────────────

export async function dispensarCapturaAction(input: unknown) {
  return executar((s) => dispensarCaptura(s, input))
}

/** Entra na fila e cutuca o vigia: com vaga, o bot é chamado em segundos. */
export async function chamarBotAction(input: unknown) {
  return executar((s) => chamarBotReuniao(s, input), [], () => dispararQualidadeVigiar())
}

// ─── Contestação e pendências ───────────────────────────────────────────────

export async function contestarItemAction(input: unknown) {
  return executar((s) => contestarItem(s, input), ['/comercial/feedback'])
}

export async function decidirContestacaoAction(input: unknown) {
  return executar((s) => decidirContestacao(s, input), ['/comercial/qualidade'])
}

export async function resolverPendenciaAction(input: unknown) {
  return executar((s) => resolverPendenciaQualidade(s, input), ['/comercial/feedback', '/comercial/meu-dia'])
}

// ─── Calibração e rubricas ──────────────────────────────────────────────────

export async function rotularAnaliseAction(input: unknown) {
  return executar((s) => rotularAnalise(s, input), ['/comercial/qualidade'])
}

export async function salvarRubricaAction(input: unknown) {
  return executar((s) => salvarRubrica(s, input), ['/comercial/qualidade'])
}

export async function ativarRubricaAction(input: unknown) {
  return executar((s) => ativarRubrica(s, input), ['/comercial/qualidade'], () => dispararQualidadeRecalibrar())
}

export async function pedirRecalibracaoAction(input: unknown) {
  return executar((s) => pedirRecalibracao(s, input), ['/comercial/qualidade'], () => dispararQualidadeRecalibrar())
}

export async function overrideLimiarAction(input: unknown) {
  return executar((s) => overrideLimiar(s, input), ['/comercial/qualidade'])
}

// ─── Vinculação e cadastro ──────────────────────────────────────────────────

export async function auditarVinculoAction(input: unknown) {
  return executar((s) => auditarVinculo(s, input), ['/comercial/qualidade'])
}

/** Disparar o worker à mão é coisa de gestor: a RPC não está no caminho para perguntar. */
async function exigirGestor(s: NonNullable<Awaited<ReturnType<typeof autorizar>>['supabase']>) {
  const { data } = await s.rpc('app_gestor_comercial')
  if (!data) throw new MutationError('Só a gestão comercial faz isto.', 'forbidden')
}

export async function rodarVinculacaoAction() {
  return executar(async (s) => {
    await exigirGestor(s)
    const r = await dispararQualidadeVinculacao()
    if (!r.ok) throw new MutationError(r.message, 'unknown')
    return { disparado: true }
  })
}

export async function processarFilaAction() {
  return executar(async (s) => {
    await exigirGestor(s)
    const r = await dispararQualidadeProcessar()
    if (!r.ok) throw new MutationError(r.message, 'unknown')
    return { disparado: true }
  })
}

export async function decidirSugestaoCadastroAction(input: unknown) {
  return executar((s) => decidirSugestaoCadastro(s, input))
}
