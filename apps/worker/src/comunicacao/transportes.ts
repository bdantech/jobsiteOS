import {
  TransporteGmail,
  TransporteResend,
  TransporteWasender,
  type Transporte,
} from '../../../../packages/core/src/transportes/index.js'
import { supabaseAdmin } from '../db.js'
import { env } from '../env.js'
import { logger } from '../logger.js'
import { lerSegredo } from './vault.js'

/**
 * A fábrica dos três canos. O worker de envio pede um transporte para a conta que
 * a linha da fila escolheu e não sabe qual dos três recebeu.
 *
 * O token é lido do Vault A CADA construção e nunca fica em memória entre jobs:
 * um cache de credencial é a coisa que sobrevive a uma revogação.
 */

export interface ContaWhatsapp {
  id: string
  apelido: string
  numero: string
  tipo: string
  mensagens_por_dia: number
  warmup_iniciado_em: string | null
  intervalo_min_seg: number
  intervalo_max_seg: number
  token_secret_id: string | null
  ativo: boolean
}

const COLUNAS_CONTA =
  'id, apelido, numero, tipo, mensagens_por_dia, warmup_iniciado_em, intervalo_min_seg, intervalo_max_seg, token_secret_id, ativo'

export async function buscarConta(id: string): Promise<ContaWhatsapp | null> {
  const { data } = await supabaseAdmin
    .from('whatsapp_contas')
    .select(COLUNAS_CONTA)
    .eq('id', id)
    .maybeSingle()
  return (data as ContaWhatsapp | null) ?? null
}

/**
 * A conta que envia quando a linha da fila não escolheu uma.
 *
 * `tipo` decide, e é aqui que o §1.3 vira código: mensagem de IA sai por conta de
 * IA, mensagem de gente sai por conta de relacionamento. Nunca o contrário — o
 * número da persona aparecendo como o do originador é a confusão que destrói a
 * confiança do outro lado.
 *
 * Entre as contas do tipo certo, a menos usada hoje. É o round-robin do §3.1,
 * feito pela realidade (quantas saíram) e não por um contador em memória que
 * zera a cada deploy.
 */
export async function escolherConta(tipo: 'relacionamento' | 'ia' | 'plantao'): Promise<ContaWhatsapp | null> {
  const { data } = await supabaseAdmin
    .from('whatsapp_contas')
    .select(COLUNAS_CONTA)
    .eq('tipo', tipo)
    .eq('ativo', true)
  const contas = (data ?? []) as ContaWhatsapp[]
  if (contas.length === 0) return null
  if (contas.length === 1) return contas[0]!

  const inicio = new Date()
  inicio.setUTCHours(0, 0, 0, 0)
  const usos = await Promise.all(
    contas.map(async (c) => {
      const { count } = await supabaseAdmin
        .from('comunicacoes')
        .select('id', { count: 'exact', head: true })
        .eq('conta_remetente', c.numero)
        .eq('direcao', 'saida')
        .gte('criado_em', inicio.toISOString())
      return { conta: c, usos: count ?? 0 }
    }),
  )
  return usos.sort((a, b) => a.usos - b.usos)[0]!.conta
}

/**
 * O transporte de WhatsApp, ou O MOTIVO exato pelo qual ele não existe.
 *
 * Devolver só `null` custou uma investigação: a fila registrou "credencial
 * ausente" num envio cuja conta TINHA token no Vault, e quem leu a mensagem foi
 * conferir a credencial — que estava certa. O que faltava era a
 * `WASENDER_BASE_URL`, uma variável do worker, do outro lado do sistema.
 *
 * São duas faltas com dois donos diferentes: o token é da CONTA e se resolve na
 * tela de Comunicação; a base URL é da APLICAÇÃO e se resolve no Railway. Uma
 * mensagem de erro que não distingue as duas manda a pessoa para o lugar errado,
 * e ela volta de lá achando que o sistema está quebrado.
 */
export async function transporteWhatsapp(
  conta: ContaWhatsapp,
): Promise<{ transporte: Transporte | null; motivo: string | null }> {
  if (!env.WASENDER_BASE_URL) {
    logger.warn('WASENDER_BASE_URL não configurada — envio de WhatsApp indisponível.')
    return {
      transporte: null,
      motivo: 'WASENDER_BASE_URL não configurada no worker — nenhum envio de WhatsApp sai sem ela.',
    }
  }
  const token = await lerSegredo(conta.token_secret_id)
  if (!token) {
    // "Não configurado" e "quebrado" são coisas diferentes, e a tela precisa
    // distinguir as duas. Mesma régua do Radar e do Jurídico.
    logger.warn({ conta: conta.apelido }, 'Conta de WhatsApp sem token no Vault — envio pulado.')
    return {
      transporte: null,
      motivo: `A conta "${conta.apelido}" não tem token da API do Wasender — cadastre-o em Comunicação › Contas de WhatsApp.`,
    }
  }
  return {
    transporte: new TransporteWasender({
      baseUrl: env.WASENDER_BASE_URL,
      token,
      numero: conta.numero,
    }),
    motivo: null,
  }
}

export function transporteResend(remetente: string, responderPara?: string | null): Transporte | null {
  if (!env.RESEND_API_KEY) {
    logger.warn('RESEND_API_KEY não configurada — envio de e-mail do sistema indisponível.')
    return null
  }
  return new TransporteResend({ apiKey: env.RESEND_API_KEY, remetente, responderPara })
}

export interface ContaGmail {
  usuario_id: string
  endereco: string
  refresh_token_secret_id: string | null
  access_token_secret_id: string | null
  access_token_expira_em: string | null
  history_id: string | null
  ativo: boolean
}

export async function contaGmailDoUsuario(usuarioId: string): Promise<ContaGmail | null> {
  const { data } = await supabaseAdmin
    .from('gmail_contas')
    .select('usuario_id, endereco, refresh_token_secret_id, access_token_secret_id, access_token_expira_em, history_id, ativo')
    .eq('usuario_id', usuarioId)
    .eq('ativo', true)
    .maybeSingle()
  return (data as ContaGmail | null) ?? null
}

/**
 * O access token, renovado quando falta menos de um minuto para vencer.
 *
 * A margem existe porque o token pode vencer ENTRE a checagem e a chamada. Sem
 * ela, uma fatia pequena mas constante dos envios falha com 401 — e um 401
 * intermitente é o tipo de erro que se investiga por semanas.
 */
export async function accessTokenGmail(conta: ContaGmail): Promise<string | null> {
  const expira = conta.access_token_expira_em ? new Date(conta.access_token_expira_em) : null
  if (expira && expira.getTime() - Date.now() > 60_000) {
    const atual = await lerSegredo(conta.access_token_secret_id)
    if (atual) return atual
  }

  const refresh = await lerSegredo(conta.refresh_token_secret_id)
  if (!refresh || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    logger.warn({ usuario: conta.usuario_id }, 'Gmail sem refresh token ou sem credencial de app.')
    return null
  }

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: refresh,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const corpo = (await res.json()) as { access_token?: string; expires_in?: number; error?: string }
    if (!res.ok || !corpo.access_token) {
      // Refresh revogado: a conta é marcada e a tela pede reconexão guiada. Não
      // adianta tentar de novo — o consentimento tem de ser dado de novo.
      await supabaseAdmin
        .from('gmail_contas')
        .update({ ultimo_erro: corpo.error ?? `HTTP ${res.status}`, ativo: res.status !== 400 })
        .eq('usuario_id', conta.usuario_id)
      return null
    }

    const expiraEm = new Date(Date.now() + (corpo.expires_in ?? 3600) * 1000)
    await supabaseAdmin.rpc('app_salvar_gmail_conta', {
      p: {
        usuario_id: conta.usuario_id,
        endereco: conta.endereco,
        access_token: corpo.access_token,
        access_token_expira_em: expiraEm.toISOString(),
      } as never,
    })
    return corpo.access_token
  } catch (erro) {
    logger.error({ erro: String(erro) }, 'Falha ao renovar o access token do Gmail.')
    return null
  }
}

export async function transporteGmail(
  conta: ContaGmail,
  nomeExibicao?: string | null,
): Promise<Transporte | null> {
  const accessToken = await accessTokenGmail(conta)
  if (!accessToken) return null
  return new TransporteGmail({ accessToken, endereco: conta.endereco, nomeExibicao })
}
