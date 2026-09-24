import 'server-only'

// ⚠️ RELATIVE IMPORT ON PURPOSE — DO NOT "TIDY" THIS INTO A PACKAGE SPECIFIER.
//
// `@jobsiteos/core/src/server/notify.js` does not resolve: core declares an
// `exports` map ({ ".", "./registry", "./schemas", "./types" }) and that subpath
// is not in it, so both tsc (moduleResolution: Bundler) and webpack reject it.
// The cost is contained to this one file: every other module imports from here.
import {
  emitirNotificacao,
  entregarEnvios,
  type ConfigEmailInterno,
} from '../../../../packages/core/src/server/notify.js'

import { createAdminClient } from '@/lib/supabase/admin'

/** O remetente interno, se configurado. Sem ele o canal e-mail é ignorado. */
export function emailInterno(): ConfigEmailInterno | null {
  const apiKey = process.env.RESEND_API_KEY
  const remetente = process.env.RESEND_REMETENTE_INTERNO ?? process.env.RESEND_FROM_EMAIL
  if (!apiKey || !remetente) return null
  return { apiKey, remetente, urlBase: process.env.NEXT_PUBLIC_APP_URL ?? null }
}

/**
 * O jeito de a web AVISAR (0262): emite pelo motor de avisos e entrega o push na
 * hora. Quem recebe, o texto e o canal são das regras do tipo no painel de Admin
 * (/admin/notificacoes); o `payload` leva o texto padrão e os dados de que os papéis
 * precisam (`destinatarios`, `vendedor_id`…).
 *
 * SERVER ONLY, and deliberately NOT a server action: it runs on the service-role
 * client, so if this were exported from a `'use server'` module Next would mint an
 * RPC endpoint for it and any authenticated browser could push an arbitrary
 * title/body/url to anyone. Callers must be server code that already authorised it.
 *
 * Best-effort: nunca lança. O fato que gerou o aviso já foi gravado, e um push que
 * não sai não pode desfazê-lo nem virar erro numa tela onde a ação deu certo.
 */
export async function avisar(
  tipo: string,
  payload: Record<string, unknown>,
  opcoes: { empresaId?: string | null; ator?: string | null } = {},
): Promise<void> {
  try {
    const admin = createAdminClient()
    const ids = await emitirNotificacao(admin, tipo, payload, opcoes)
    if (ids.length) await entregarAgora(ids)
  } catch {
    // Ver acima.
  }
}

/**
 * Como `avisar`, mas devolve o que aconteceu — para quem precisa dizer à pessoa se
 * o push chegou (o botão de teste). Lança se o aviso não pôde ser gravado.
 */
export async function avisarEContar(
  tipo: string,
  payload: Record<string, unknown>,
  opcoes: { empresaId?: string | null; ator?: string | null } = {},
): Promise<{ avisos: number; push: number }> {
  const admin = createAdminClient()
  const ids = await emitirNotificacao(admin, tipo, payload, opcoes)
  const r = ids.length
    ? await entregarEnvios(admin, { notificacaoIds: ids, email: emailInterno() })
    : { push: 0 }
  return { avisos: ids.length, push: r.push }
}

/** Entrega já o push (e o e-mail) destes avisos — sem esperar a varredura. */
export async function entregarAgora(notificacaoIds: readonly string[]): Promise<void> {
  if (!notificacaoIds.length) return
  try {
    await entregarEnvios(createAdminClient(), { notificacaoIds, email: emailInterno() })
  } catch {
    // A varredura de cinco minutos pega o que ficou.
  }
}

/**
 * Entrega o que está vencido na fila — para depois de uma RPC que emitiu evento.
 *
 * O aviso de um evento nasce dentro do banco, e o banco não fala HTTP: sem isto o
 * push esperaria a varredura de cinco minutos. É o que devolve ao "pedi a análise"
 * o push imediato que o time de Crédito tinha.
 */
export async function varrerAgora(): Promise<void> {
  try {
    await entregarEnvios(createAdminClient(), { limite: 50, email: emailInterno() })
  } catch {
    // A varredura de cinco minutos pega o que ficou.
  }
}
