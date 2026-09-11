import { notify } from '../../../packages/core/src/server/notify.js'
import { EVENTO_TIPOS, type EventoTipo } from '../../../packages/core/src/constants.js'
import {
  FONTE_INGESTAO_LABELS,
  type FonteIngestao,
} from '../../../packages/core/src/mercado/schemas.js'
import { supabaseAdmin } from './db.js'
import { env } from './env.js'
import { logger } from './logger.js'

/**
 * The run log. Every ingestion writes here from the first byte to the last, so
 * the Ingestões admin page (§5.6) can answer "what is it doing right now?" and,
 * more importantly, "why is the pyramid a month stale?".
 */

export interface Contadores {
  linhas_processadas?: number
  linhas_novas?: number
  linhas_atualizadas?: number
}

export type Meta = Record<string, unknown>

export async function abrirIngestao(fonte: FonteIngestao, meta: Meta = {}): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('mercado_ingestoes')
    .insert({ fonte, status: 'executando', meta: meta as never })
    .select('id')
    .single()

  if (error) throw new Error(`Falha ao abrir a ingestão: ${error.message}`)
  return data.id
}

export async function atualizarIngestao(
  id: string,
  campos: Contadores & { tentativa?: number; meta?: Meta },
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('mercado_ingestoes')
    .update({ ...campos, meta: campos.meta as never })
    .eq('id', id)

  if (error) logger.error({ id, erro: error.message }, 'Falha ao atualizar a ingestão.')
}

/** Merges into `meta` instead of overwriting it — counters from different phases coexist. */
export async function anotarMeta(id: string, patch: Meta): Promise<void> {
  const { data } = await supabaseAdmin.from('mercado_ingestoes').select('meta').eq('id', id).single()
  const atual = (data?.meta ?? {}) as Meta
  await atualizarIngestao(id, { meta: { ...atual, ...patch } })
}

export async function concluirIngestao(
  id: string,
  fonte: FonteIngestao,
  contadores: Contadores,
  meta: Meta = {},
): Promise<void> {
  const { data } = await supabaseAdmin.from('mercado_ingestoes').select('meta').eq('id', id).single()

  const { error } = await supabaseAdmin
    .from('mercado_ingestoes')
    .update({
      status: 'concluida',
      terminado_em: new Date().toISOString(),
      ...contadores,
      meta: { ...((data?.meta ?? {}) as Meta), ...meta } as never,
    })
    .eq('id', id)

  if (error) throw new Error(`Falha ao concluir a ingestão: ${error.message}`)

  await registrarEvento(EVENTO_TIPOS.MERCADO_INGESTAO_CONCLUIDA, {
    titulo: `Ingestão concluída — ${rotuloFonte(fonte)}`,
    resumo:
      `${(contadores.linhas_processadas ?? 0).toLocaleString('pt-BR')} linhas processadas, ` +
      `${(contadores.linhas_novas ?? 0).toLocaleString('pt-BR')} novas e ` +
      `${(contadores.linhas_atualizadas ?? 0).toLocaleString('pt-BR')} atualizadas.`,
    url: `/mercado/ingestoes/${id}`,
  })
}

/**
 * The failure path, which is the one that actually matters: the run is MONTHLY,
 * so a silent failure means nobody notices until the pyramid is a month stale and
 * the numbers in a board deck are wrong.
 *
 * Two channels on purpose:
 *   - the `empresa_eventos` row → the durable record, and the fan-out trigger
 *     (0014) turns it into a bell notification for the Admin perfil (seeded rule).
 *   - notify() → the same message, but it also PUSHES (Web Push + Expo). The
 *     trigger cannot push; it only writes rows.
 * See the report: this costs one duplicated bell row per failure.
 *
 * The message always carries the manual fallback instruction. The fallback is
 * NEVER automatic — an admin decides to trust the mirror, from the UI.
 */
export async function falharIngestao(
  id: string,
  fonte: FonteIngestao,
  erro: unknown,
  contadores: Contadores = {},
): Promise<void> {
  const mensagem = erro instanceof Error ? erro.message : String(erro)

  await supabaseAdmin
    .from('mercado_ingestoes')
    .update({
      status: 'falhou',
      terminado_em: new Date().toISOString(),
      erro: mensagem.slice(0, 4000),
      ...contadores,
    })
    .eq('id', id)

  const titulo = `Ingestão falhou — ${rotuloFonte(fonte)}`
  const corpo =
    `${mensagem.slice(0, 300)}\n\n` +
    `Todas as ${env.RETRY_TENTATIVAS} tentativas foram esgotadas. ${COMO_REEXECUTAR[fonte]}`
  const url = `/mercado/ingestoes/${id}`

  await registrarEvento(EVENTO_TIPOS.MERCADO_INGESTAO_FALHOU, { titulo, resumo: corpo, url })

  try {
    const admins = await idsAdmins()
    if (admins.length > 0) {
      await notify(supabaseAdmin, admins, { titulo, corpo, url })
    }
  } catch (e) {
    // A push failure must never mask the ingestion failure we are reporting.
    logger.error({ erro: String(e) }, 'Falha ao notificar os admins.')
  }
}

/**
 * A SYSTEM event: no empresa_id. The fan-out trigger prefers payload.titulo and
 * payload.url when they are present — without them the bell would read the
 * literal string "Empresa — mercado.ingestao_falhou".
 */
export async function registrarEvento(
  tipo: EventoTipo,
  payload: { titulo: string; resumo: string; url: string },
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('empresa_eventos')
    .insert({ empresa_id: null, tipo, payload: payload as never, ator_usuario_id: null })

  if (error) logger.error({ tipo, erro: error.message }, 'Falha ao registrar o evento.')
}

async function idsAdmins(): Promise<string[]> {
  const { data: perfil } = await supabaseAdmin
    .from('perfis')
    .select('id')
    .eq('nome', 'Admin')
    .maybeSingle()

  if (!perfil) return []

  const { data: usuarios } = await supabaseAdmin
    .from('usuarios')
    .select('id')
    .eq('perfil_id', perfil.id)
    .eq('ativo', true)

  return (usuarios ?? []).map((u) => u.id)
}

/**
 * O NOME DA FONTE NO ALERTA, e ele precisa ser o certo.
 *
 * Isto era uma escada de três degraus escrita aqui: `receita_cnpj`, `cno`, e
 * "Importação de lista" para todo o resto. As quatro fontes da Onepay nasceram
 * depois e caíram no `return` final — então treze falhas seguidas do sync de
 * ANTECIPAÇÕES tocaram o sino dizendo "Ingestão falhou — Importação de lista".
 * Quem recebeu não tinha como saber do que se tratava, e ninguém foi olhar.
 *
 * A lista completa já existia em `FONTE_INGESTAO_LABELS`, no core, e é a mesma
 * que a tela de Ingestões usa. Duas listas para a mesma coisa é como uma delas
 * envelhece sem que ninguém perceba.
 */
function rotuloFonte(fonte: FonteIngestao): string {
  return FONTE_INGESTAO_LABELS[fonte] ?? fonte
}

/**
 * O QUE FAZER, por fonte — e não a mesma frase para todas.
 *
 * O texto era único e falava em Receita Federal e espelho manual. Numa falha da
 * Onepay isso não é só inútil: é desorientador, porque manda conferir uma fonte
 * que não tem nada a ver com o que quebrou. Uma instrução que não se aplica
 * ensina a ignorar o alerta inteiro.
 */
const REEXECUTAR_PELA_TELA =
  'Abra a ingestão em Mercado → Ingestões para ver o erro completo e use "Sincronizar agora" ' +
  'quando a origem voltar. A janela do próximo ciclo cobre os últimos dias, então uma ' +
  'indisponibilidade curta se resolve sozinha — uma longa, não.'

const COMO_REEXECUTAR: Record<FonteIngestao, string> = {
  receita_cnpj:
    `A fonte primária é sempre a Receita Federal. Para reexecutar pelo espelho manual ` +
    `(${env.RECEITA_FALLBACK_URL}), abra a ingestão em Mercado → Ingestões e use ` +
    `"Reexecutar com fallback". O fallback nunca é automático.`,
  cno:
    `A fonte primária é sempre a Receita Federal. Para reexecutar pelo espelho manual ` +
    `(${env.RECEITA_FALLBACK_URL}), abra a ingestão em Mercado → Ingestões e use ` +
    `"Reexecutar com fallback". O fallback nunca é automático.`,
  lista: 'Reenvie o arquivo em Mercado → Ingestões.',
  onepay_nf: REEXECUTAR_PELA_TELA,
  onepay_certificados: REEXECUTAR_PELA_TELA,
  onepay_antecipacoes:
    'Enquanto isto não voltar, NENHUMA operação nova entra — e o que não entra não vira ' +
    'cessão, não vira comissão e não aparece no relatório de ninguém. ' +
    REEXECUTAR_PELA_TELA,
  onepay_credit_analyses: REEXECUTAR_PELA_TELA,
}
