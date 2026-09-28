'use server'

import { revalidatePath } from 'next/cache'
import {
  MutationError,
  canAccessRoute,
  ligarRegraMandato,
  pausarAgente,
  reabrirDisjuntor,
  registrarPreviaRegra,
  salvarCaixaEmail,
  salvarConfigAgentes,
  salvarDisjuntor,
  salvarMaterial,
  salvarPersona,
  salvarPlaybook,
  salvarPlaybookSchema,
  salvarRegraMandato,
  type FieldErrors,
} from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

/**
 * Mutações da GESTÃO dos Agentes (Prompt 09 §11.3–§11.5, §12): personas, disjuntor,
 * materiais, caixas de e-mail, configurações e regras de mandato.
 *
 * Tudo por RPC SECURITY DEFINER (0270d) com o client do USUÁRIO — a RPC começa por
 * `app_agentes_exige_gestor()` e é ela quem decide. Passar o client de service role aqui
 * anularia a única autorização que existe. A action só barra quem nem tem o módulo, para
 * a mensagem sair em pt-BR antes de uma ida ao banco.
 *
 * As mensagens das RPCs são a interface: "Um agente autônomo precisa de uma linha de
 * WhatsApp própria…" diz ao gestor o que fazer, e é por isso que `falhaDe` as repassa
 * intactas em vez de trocar por um genérico. As escritas de mandato (criar, pausar,
 * assumir) moram em `agentes-mandatos.ts`, de outra frente.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

type Falha = { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

const SEM_SESSAO: Falha = { ok: false, message: 'Sua sessão expirou. Entre novamente.', code: 'forbidden' }
const SEM_MODULO: Falha = { ok: false, message: 'Você não tem acesso ao módulo Agentes.', code: 'forbidden' }

async function autorizar() {
  const context = await getSessionContext()
  if (!context) return { erro: SEM_SESSAO, supabase: null }
  if (!canAccessRoute('/agentes', context.grantedModuleIds)) return { erro: SEM_MODULO, supabase: null }
  return { erro: null, supabase: await createClient() }
}

/**
 * O zod do core devolve "Dados inválidos." com os erros por campo. A tela não tem um
 * formulário com um input por chave do schema (a persona e o escopo são objetos
 * aninhados), então o primeiro campo com problema vai JUNTO na mensagem — um toast que
 * diz só "dados inválidos" deixa o gestor caçando o erro no formulário inteiro.
 */
function falhaDe(e: unknown): Falha {
  if (e instanceof MutationError) {
    const campos = Object.entries(e.fieldErrors ?? {}).filter(([, v]) => Array.isArray(v) && v.length > 0)
    const primeiro = campos[0]
    const message =
      e.code === 'validation' && primeiro
        ? `${e.message} Campo "${primeiro[0]}": ${(primeiro[1] as string[])[0]}`
        : e.message
    return { ok: false, message, code: e.code, fieldErrors: e.fieldErrors }
  }
  console.error('[agentes-gestao] erro inesperado na mutação', e)
  return { ok: false, message: 'Não foi possível concluir a operação.', code: 'unknown' }
}

function revalidar(...rotas: string[]): void {
  for (const r of rotas) revalidatePath(r)
}

// ─── Personas (§3, §11.3) ───────────────────────────────────────────────────

export async function salvarPersonaAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro ?? SEM_SESSAO
  try {
    const v = await salvarPersona(supabase, input)
    revalidar('/agentes', '/agentes/personas')
    return { ok: true, data: { id: v.id } }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function pausarAgenteAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro ?? SEM_SESSAO
  try {
    await pausarAgente(supabase, input)
    revalidar('/agentes', '/agentes/personas')
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── Disjuntor (§9.2): reabertura só manual ─────────────────────────────────

export async function reabrirDisjuntorAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro ?? SEM_SESSAO
  try {
    await reabrirDisjuntor(supabase, input)
    revalidar('/agentes', '/agentes/personas')
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function salvarDisjuntorAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro ?? SEM_SESSAO
  try {
    await salvarDisjuntor(supabase, input)
    revalidar('/agentes/personas')
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── Caixas de e-mail (§4.2) ────────────────────────────────────────────────

export async function salvarCaixaEmailAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro ?? SEM_SESSAO
  try {
    const c = await salvarCaixaEmail(supabase, input)
    revalidar('/agentes/personas')
    return { ok: true, data: { id: c.id } }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── Materiais (§5) ─────────────────────────────────────────────────────────

export async function salvarMaterialAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro ?? SEM_SESSAO
  try {
    const m = await salvarMaterial(supabase, input)
    revalidar('/agentes/materiais')
    return { ok: true, data: { id: m.id } }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── Configurações (§12) ────────────────────────────────────────────────────

/**
 * Uma seção por vez (`{chave, valor}`), com merge parcial no banco. O kill switch passa
 * por aqui também (`geral.kill_switch`), e a RPC espelha nos dois switches antigos.
 */
export async function salvarConfigAgentesAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro ?? SEM_SESSAO
  try {
    await salvarConfigAgentes(supabase, input)
    revalidar('/agentes', '/agentes/config', '/comunicacao/config')
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── Regras de mandato (§2.3) ───────────────────────────────────────────────

export async function salvarRegraMandatoAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro ?? SEM_SESSAO
  try {
    const r = await salvarRegraMandato(supabase, input)
    revalidar('/agentes/config')
    return { ok: true, data: { id: r.id } }
  } catch (e) {
    return falhaDe(e)
  }
}

/**
 * Playbook POR TIPO DE MANDATO (§12). Mesma RPC dos playbooks de conversa
 * (`app_salvar_playbook`), que cria a versão nova herdando o tipo e aceita o gestor de
 * agentes quando o playbook é de mandato. Os de conversa continuam em Comunicação, com
 * admin — esta action recusa antes de ir ao banco para a mensagem dizer onde ir.
 *
 * `salvarPlaybook` é do core de Comunicação e lança o erro do zod ou o do banco crus; a
 * mensagem da RPC ("Somente a gestão comercial…") é a interface, então ela passa intacta.
 */
export async function salvarPlaybookMandatoAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro ?? SEM_SESSAO
  const dados = salvarPlaybookSchema.safeParse(input)
  if (!dados.success) {
    return { ok: false, message: dados.error.issues[0]?.message ?? 'Dados inválidos.', code: 'validation' }
  }
  if (!dados.data.tipo_mandato) {
    return {
      ok: false,
      message: 'Este playbook é do agente de conversa — ele se edita em Comunicação › Playbooks.',
      code: 'validation',
    }
  }
  try {
    await salvarPlaybook(supabase, dados.data)
    revalidar('/agentes/config')
    return { ok: true, data: { ok: true } }
  } catch (e) {
    if (e instanceof Error && !(e instanceof MutationError)) return { ok: false, message: e.message, code: 'unknown' }
    return falhaDe(e)
  }
}

export async function ligarRegraMandatoAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro ?? SEM_SESSAO
  try {
    await ligarRegraMandato(supabase, input)
    revalidar('/agentes/config')
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falhaDe(e)
  }
}

export interface PreviaRegra {
  populacao: 'empresas' | 'notas'
  casam_hoje: number
  mandatos_criaria: number
  teto_regra: number | null
  vagas_agente: number
  custo_estimado_centavos: number
}

/**
 * Grava a prévia calculada na tela (motor de filtros sob a RLS de quem viu). É o que
 * destrava o "ligar": `app_agentes_ligar_regra` recusa regra sem `ultima_previa`, e
 * salvar um filtro novo zera a prévia — um filtro novo tem um impacto que ninguém viu.
 */
export async function registrarPreviaRegraAction(
  id: string,
  previa: PreviaRegra,
): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro ?? SEM_SESSAO
  try {
    await registrarPreviaRegra(supabase, id, { ...previa })
    revalidar('/agentes/config')
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falhaDe(e)
  }
}
