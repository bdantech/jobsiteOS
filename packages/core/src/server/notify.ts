import { Expo, type ExpoPushMessage } from 'expo-server-sdk'
import webpush from 'web-push'
import type { Supabase } from '../registry/types.js'
import { prefsNotificacoesSchema } from '../schemas/index.js'
import { TransporteResend } from '../transportes/resend.js'
import type { Json } from '../types/database.js'

/**
 * SERVER ONLY. Never import from a client component or from apps/mobile.
 *
 * ── O CAMINHO DE UM AVISO (0262) ────────────────────────────────────────────
 * Quem avisa não escolhe mais destinatário nem texto: chama `emitirNotificacao`
 * com o TIPO e os dados, e o motor no banco (`notificacao_emitir`) decide pelas
 * regras do painel quem recebe, com que texto, por qual canal e quando. O sino é
 * gravado lá; push e e-mail entram numa fila (`notificacoes_envios`) que
 * `entregarEnvios` esvazia — na hora, por quem emitiu, e numa varredura a cada
 * cinco minutos para o que o horário de silêncio segurou.
 *
 * Os avisos de RESUMO não tocam o sino na hora: vão para `notificacoes_resumo`, e
 * `entregarResumos` os junta num aviso só por pessoa, às 8h.
 *
 * Requires a SERVICE-ROLE client: `web_push_subscriptions` and `expo_push_tokens`
 * are not granted to `authenticated` on any row (migration 0005), precisely so
 * that no browser session can enumerate a colleague's push endpoints.
 */

export interface NotifyPayload {
  titulo: string
  corpo?: string
  /** Deep link. Web uses it as a route; mobile resolves it via the linking config. */
  url?: string
}

export interface NotifyResult {
  notificacoes: number
  webPushEnviados: number
  expoPushEnviados: number
  inscricoesRemovidas: number
}

interface WebPushSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

let vapidConfigured = false

function configureVapid(): boolean {
  if (vapidConfigured) return true

  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!publicKey || !privateKey || !subject) return false

  webpush.setVapidDetails(subject, publicKey, privateKey)
  vapidConfigured = true
  return true
}

function vazio(): NotifyResult {
  return { notificacoes: 0, webPushEnviados: 0, expoPushEnviados: 0, inscricoesRemovidas: 0 }
}

/**
 * O push de um aviso que já está no sino. Nunca lança, respeita `push_web` e
 * `push_mobile` de cada pessoa e apaga as inscrições de navegador revogadas.
 */
export async function enviarPush(
  supabaseAdmin: Supabase,
  userIds: readonly string[],
  payload: NotifyPayload,
): Promise<NotifyResult> {
  const result = vazio()
  if (userIds.length === 0) return result

  const { data: usuarios } = await supabaseAdmin
    .from('usuarios')
    .select('id, web_push_subscriptions, expo_push_tokens, prefs_notificacoes')
    .in('id', userIds as string[])
    .eq('ativo', true)

  if (!usuarios?.length) return result

  const expo = new Expo()
  const expoMessages: ExpoPushMessage[] = []
  const webPushJobs: Promise<void>[] = []
  const deadEndpoints: { userId: string; endpoint: string }[] = []

  for (const usuario of usuarios) {
    const prefs = prefsNotificacoesSchema.safeParse(usuario.prefs_notificacoes)
    const wantsWeb = prefs.success ? prefs.data.push_web : true
    const wantsMobile = prefs.success ? prefs.data.push_mobile : true

    if (wantsWeb && configureVapid()) {
      const subs = (usuario.web_push_subscriptions ?? []) as unknown as WebPushSubscription[]
      for (const sub of subs) {
        webPushJobs.push(
          webpush
            .sendNotification(sub, JSON.stringify(payload))
            .then(() => {
              result.webPushEnviados++
            })
            .catch((err: { statusCode?: number }) => {
              // 404/410 = the browser revoked this subscription. Anything else is
              // transient (network, push service hiccup) and we keep the sub.
              if (err.statusCode === 404 || err.statusCode === 410) {
                deadEndpoints.push({ userId: usuario.id, endpoint: sub.endpoint })
              }
            }),
        )
      }
    }

    if (wantsMobile) {
      const tokens = (usuario.expo_push_tokens ?? []) as unknown as { token: string }[]
      for (const { token } of tokens) {
        if (!Expo.isExpoPushToken(token)) continue
        expoMessages.push({
          to: token,
          title: payload.titulo,
          body: payload.corpo ?? '',
          data: payload.url ? { url: payload.url } : {},
          sound: 'default',
        })
      }
    }
  }

  await Promise.all(webPushJobs)

  for (const chunk of expo.chunkPushNotifications(expoMessages)) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk)
      result.expoPushEnviados += tickets.filter((t) => t.status === 'ok').length
    } catch {
      // Expo is down or the chunk was rejected wholesale. The notificacoes rows
      // are already committed, so the user still sees this in the bell.
    }
  }

  // 3. Garbage-collect revoked browser subscriptions, so they aren't retried forever.
  for (const { userId, endpoint } of deadEndpoints) {
    const usuario = usuarios.find((u) => u.id === userId)
    if (!usuario) continue
    const subs = (usuario.web_push_subscriptions ?? []) as unknown as WebPushSubscription[]
    const restantes = subs.filter((s) => s.endpoint !== endpoint)
    await supabaseAdmin
      .from('usuarios')
      .update({ web_push_subscriptions: restantes as never })
      .eq('id', userId)
    result.inscricoesRemovidas++
  }

  return result
}

// ─── O motor ────────────────────────────────────────────────────────────────

export interface OpcoesDeEmissao {
  /** A empresa do fato. Dá o nome `{{empresa}}` e o papel "dono da empresa". */
  empresaId?: string | null
  /** Quem causou — não é avisado do próprio ato. */
  ator?: string | null
}

/**
 * Emite um aviso pelo motor. `payload` leva o texto padrão (`titulo`, `resumo`,
 * `url` — usado quando o painel não tem modelo para o tipo), as variáveis dos
 * modelos, e os dados de que os papéis precisam (`lead_id`, `vendedor_id`,
 * `destinatarios`…). `chave` no payload controla a repetição.
 *
 * Devolve os ids do sino criados agora, para `entregarEnvios` mandar o push sem
 * esperar a varredura.
 */
export async function emitirNotificacao(
  supabaseAdmin: Supabase,
  tipo: string,
  payload: Record<string, unknown>,
  opcoes: OpcoesDeEmissao = {},
): Promise<string[]> {
  const { data, error } = await supabaseAdmin.rpc('notificacao_emitir', {
    p_tipo: tipo,
    p_empresa_id: opcoes.empresaId ?? undefined,
    p_payload: payload as Json,
    p_ator: opcoes.ator ?? undefined,
  })
  if (error) throw new Error(`Falha ao emitir aviso ${tipo}: ${error.message}`)
  return (data ?? []) as string[]
}

/** O remetente dos e-mails internos (aviso e resumo). Sem ele, o canal e-mail é ignorado. */
export interface ConfigEmailInterno {
  apiKey: string
  remetente: string
  /** Base para transformar o link relativo do aviso num link clicável no e-mail. */
  urlBase?: string | null
}

export interface ResultadoEntrega {
  push: number
  email: number
  ignorados: number
  falhas: number
}

/**
 * Esvazia a fila de push e e-mail: o que venceu o horário (ou os ids pedidos).
 *
 * A linha é REIVINDICADA antes do envio (`pendente` → `enviado` num update
 * condicional): a web entrega na hora e a varredura do worker passa a cada cinco
 * minutos, e as duas podem ver a mesma linha. Quem não conseguiu reivindicar não
 * manda — é o que impede o mesmo push de sair duas vezes.
 */
export async function entregarEnvios(
  supabaseAdmin: Supabase,
  opcoes: { notificacaoIds?: readonly string[]; limite?: number; email?: ConfigEmailInterno | null } = {},
): Promise<ResultadoEntrega> {
  const r: ResultadoEntrega = { push: 0, email: 0, ignorados: 0, falhas: 0 }
  if (opcoes.notificacaoIds && opcoes.notificacaoIds.length === 0) return r

  let q = supabaseAdmin
    .from('notificacoes_envios')
    .select('id, notificacao_id, usuario_id, canal')
    .eq('status', 'pendente')
    .lte('agendado_para', new Date().toISOString())
    .order('agendado_para')
    .limit(opcoes.limite ?? 200)
  if (opcoes.notificacaoIds) q = q.in('notificacao_id', opcoes.notificacaoIds as string[])
  const { data: pendentes, error } = await q
  if (error) throw new Error(`Falha ao ler a fila de envios: ${error.message}`)
  if (!pendentes?.length) return r

  const { data: reivindicados } = await supabaseAdmin
    .from('notificacoes_envios')
    .update({ status: 'enviado', enviado_em: new Date().toISOString() })
    .in('id', pendentes.map((p) => p.id))
    .eq('status', 'pendente')
    .select('id')
  const meus = new Set((reivindicados ?? []).map((x) => x.id))
  const linhas = pendentes.filter((p) => meus.has(p.id))
  if (!linhas.length) return r

  const { data: avisos } = await supabaseAdmin
    .from('notificacoes')
    .select('id, titulo, corpo, url')
    .in('id', [...new Set(linhas.map((l) => l.notificacao_id))])
  const avisoPorId = new Map((avisos ?? []).map((a) => [a.id, a]))

  const marcar = async (id: string, status: 'ignorado' | 'falhou', erro: string) => {
    await supabaseAdmin.from('notificacoes_envios').update({ status, erro }).eq('id', id)
  }

  // ── push ──
  for (const l of linhas.filter((x) => x.canal === 'push')) {
    const aviso = avisoPorId.get(l.notificacao_id)
    if (!aviso) {
      await marcar(l.id, 'ignorado', 'O aviso foi apagado antes do envio.')
      r.ignorados++
      continue
    }
    const envio = await enviarPush(supabaseAdmin, [l.usuario_id], {
      titulo: aviso.titulo,
      corpo: aviso.corpo ?? undefined,
      url: aviso.url ?? undefined,
    })
    if (envio.webPushEnviados + envio.expoPushEnviados > 0) r.push++
    else {
      // Sem aparelho ou navegador registrado não é falha: é o caso de hoje para
      // todo mundo, e o sino já tem o aviso.
      await marcar(l.id, 'ignorado', 'Nenhum aparelho ou navegador registrado para push.')
      r.ignorados++
    }
  }

  // ── e-mail ──
  const deEmail = linhas.filter((x) => x.canal === 'email')
  if (deEmail.length) {
    if (!opcoes.email) {
      for (const l of deEmail) await marcar(l.id, 'ignorado', 'E-mail interno não configurado.')
      r.ignorados += deEmail.length
    } else {
      const transporte = new TransporteResend({ apiKey: opcoes.email.apiKey, remetente: opcoes.email.remetente })
      const { data: pessoas } = await supabaseAdmin
        .from('usuarios')
        .select('id, email')
        .in('id', [...new Set(deEmail.map((l) => l.usuario_id))])
      const emailDe = new Map((pessoas ?? []).map((p) => [p.id, p.email]))
      for (const l of deEmail) {
        const aviso = avisoPorId.get(l.notificacao_id)
        const destino = emailDe.get(l.usuario_id)
        if (!aviso || !destino) {
          await marcar(l.id, 'ignorado', 'Sem aviso ou sem e-mail cadastrado.')
          r.ignorados++
          continue
        }
        const res = await transporte.enviar({
          destino,
          assunto: aviso.titulo,
          corpo: corpoDoEmail(aviso.corpo, aviso.url, opcoes.email.urlBase),
        })
        if (res.ok) r.email++
        else {
          await marcar(l.id, 'falhou', res.erro ?? 'Falha no envio.')
          r.falhas++
        }
      }
    }
  }

  return r
}

function corpoDoEmail(corpo: string | null, url: string | null, base?: string | null): string {
  const link = url ? (url.startsWith('http') ? url : base ? `${base.replace(/\/$/, '')}${url}` : null) : null
  return [corpo ?? '', link ? `\nAbrir no JobsiteOS: ${link}` : '', '\n— JobsiteOS']
    .filter(Boolean)
    .join('\n')
}

/**
 * O RESUMO DIÁRIO: um aviso por pessoa com o que as regras mandaram para o resumo
 * desde o último.
 *
 * Um aviso só, e não os itens soltos no sino: o ponto do resumo é justamente não
 * tocar o sino uma vez por item. O corpo conta por tipo e cita os primeiros; o
 * e-mail, que tem espaço, leva a lista inteira. Push sai se algum item tinha push
 * na regra; e-mail, se algum item tinha e-mail ou a pessoa pediu o resumo por
 * e-mail nas preferências.
 */
export async function entregarResumos(
  supabaseAdmin: Supabase,
  opcoes: { email?: ConfigEmailInterno | null } = {},
): Promise<{ pessoas: number; itens: number }> {
  const { data: itens, error } = await supabaseAdmin
    .from('notificacoes_resumo')
    .select('id, usuario_id, tipo, titulo, corpo, url, canais, criado_em')
    .is('entregue_em', null)
    .order('criado_em')
    .limit(5000)
  if (error) throw new Error(`Falha ao ler o resumo: ${error.message}`)
  if (!itens?.length) return { pessoas: 0, itens: 0 }

  const tipos = [...new Set(itens.map((i) => i.tipo))]
  const { data: catalogo } = await supabaseAdmin.from('notificacao_tipos').select('tipo, nome').in('tipo', tipos)
  const nomeDo = new Map((catalogo ?? []).map((c) => [c.tipo, c.nome]))

  const porPessoa = new Map<string, typeof itens>()
  for (const i of itens) porPessoa.set(i.usuario_id, [...(porPessoa.get(i.usuario_id) ?? []), i])

  const { data: pessoas } = await supabaseAdmin
    .from('usuarios')
    .select('id, ativo, email, prefs_notificacoes')
    .in('id', [...porPessoa.keys()])
  const pessoa = new Map((pessoas ?? []).map((p) => [p.id, p]))

  const criados: string[] = []
  for (const [usuarioId, lista] of porPessoa) {
    const p = pessoa.get(usuarioId)
    if (p?.ativo) {
      const porTipo = new Map<string, typeof lista>()
      for (const i of lista) porTipo.set(i.tipo, [...(porTipo.get(i.tipo) ?? []), i])
      const linhas = [...porTipo.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([tipo, xs]) => `${xs.length}× ${nomeDo.get(tipo) ?? tipo}`)
      const titulo = `Seu resumo: ${lista.length} ${lista.length === 1 ? 'aviso' : 'avisos'}`
      const corpo = linhas.slice(0, 4).join(' · ') + (linhas.length > 4 ? ` · e mais ${linhas.length - 4} tipo(s)` : '')

      const { data: aviso } = await supabaseAdmin
        .from('notificacoes')
        .insert({ usuario_id: usuarioId, titulo, corpo, url: '/notificacoes', tipo: 'plataforma.resumo_diario' })
        .select('id')
        .single()

      if (aviso) {
        criados.push(aviso.id)
        if (lista.some((i) => i.canais.includes('push'))) {
          await supabaseAdmin
            .from('notificacoes_envios')
            .insert({ notificacao_id: aviso.id, usuario_id: usuarioId, canal: 'push' })
        }
        /*
         * O e-mail sai daqui, e não pela fila: ele leva a LISTA INTEIRA, que no sino
         * seria ruído e no e-mail é o ponto — é o canal de quem não abre o sistema.
         */
        const prefs = prefsNotificacoesSchema.safeParse(p.prefs_notificacoes)
        const querEmail = (prefs.success && prefs.data.resumo_email) || lista.some((i) => i.canais.includes('email'))
        if (querEmail && opcoes.email && p.email) {
          const detalhe = lista.map((i) => `• ${i.titulo}${i.corpo ? ` — ${i.corpo}` : ''}`).join('\n')
          await new TransporteResend({ apiKey: opcoes.email.apiKey, remetente: opcoes.email.remetente }).enviar({
            destino: p.email,
            assunto: titulo,
            corpo: corpoDoEmail(`${corpo}\n\n${detalhe}`, '/notificacoes', opcoes.email.urlBase),
          })
        }
      }
    }
    await supabaseAdmin
      .from('notificacoes_resumo')
      .update({ entregue_em: new Date().toISOString() })
      .in('id', lista.map((i) => i.id))
  }

  await entregarEnvios(supabaseAdmin, { notificacaoIds: criados, email: opcoes.email })
  return { pessoas: criados.length, itens: itens.length }
}
