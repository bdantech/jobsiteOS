import {
  deveIngerir,
  extrairEndereco,
  lerMensagemGmail,
  semCitacao,
  type EmailRecebido,
  type UniversoConhecido,
} from '../../../../../packages/core/src/transportes/index.js'
import { conversaPara, escreverNoLedger, tocarConversa } from '../../comunicacao/ledger.js'
import { enfileirarNaoVinculada, resolverRemetente } from '../../comunicacao/resolver.js'
import { accessTokenGmail, type ContaGmail } from '../../comunicacao/transportes.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'

/**
 * Sync do Gmail (§3.2).
 *
 * ─── PUB/SUB É O PREFERIDO; ESTE JOB É O FALLBACK QUE SEMPRE FUNCIONA ───────
 * O Gmail Watch avisa por Pub/Sub quando chega mensagem, e a rota de webhook
 * apenas chama `sincronizarUsuario` para o endereço avisado. Este job varre por
 * `historyId` a cada N minutos e existe para os dois casos em que o push falha:
 * o watch expira (7 dias) e o Pub/Sub perde uma entrega. Um canal de recebimento
 * que depende só de push perde mensagens em silêncio.
 *
 * ─── O FILTRO É A PARTE MAIS IMPORTANTE DESTE ARQUIVO ───────────────────────
 * Só entra no ledger e-mail que case com contato conhecido ou domínio de empresa
 * da base (`deveIngerir`). NUNCA a caixa inteira. Não é economia: é a diferença
 * entre um CRM e vigilância sobre o e-mail pessoal de quem trabalha aqui.
 */

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

export interface ResultadoGmailSync {
  contas: number
  mensagens_vistas: number
  ingeridas: number
  descartadas_pelo_filtro: number
  falhas: number
}

export async function sincronizarGmail(): Promise<ResultadoGmailSync> {
  const acc: ResultadoGmailSync = {
    contas: 0,
    mensagens_vistas: 0,
    ingeridas: 0,
    descartadas_pelo_filtro: 0,
    falhas: 0,
  }

  const { data } = await supabaseAdmin
    .from('gmail_contas')
    .select('usuario_id, endereco, refresh_token_secret_id, access_token_secret_id, access_token_expira_em, history_id, ativo')
    .eq('ativo', true)
  const contas = (data ?? []) as ContaGmail[]
  acc.contas = contas.length
  if (contas.length === 0) return acc

  const universo = await universoConhecido()

  for (const conta of contas) {
    try {
      const r = await sincronizarUsuario(conta, universo)
      acc.mensagens_vistas += r.vistas
      acc.ingeridas += r.ingeridas
      acc.descartadas_pelo_filtro += r.descartadas
    } catch (erro) {
      logger.error({ conta: conta.endereco, erro: String(erro) }, 'Falha ao sincronizar Gmail.')
      acc.falhas += 1
      await supabaseAdmin
        .from('gmail_contas')
        .update({ ultimo_erro: String(erro) })
        .eq('usuario_id', conta.usuario_id)
    }
  }

  logger.info(acc, 'Sync do Gmail concluído.')
  return acc
}

/**
 * O universo conhecido, carregado UMA vez por rodada.
 *
 * São centenas de contatos contra dezenas de mensagens: consultar o banco por
 * e-mail recebido faria a varredura custar uma ida ao banco por linha de
 * cabeçalho.
 */
async function universoConhecido(): Promise<UniversoConhecido> {
  const emails = new Set<string>()
  const dominios = new Set<string>()

  const { data: contatos } = await supabaseAdmin
    .from('contatos')
    .select('email')
    .not('email', 'is', null)
    .limit(20_000)
  for (const c of contatos ?? []) {
    const e = extrairEndereco(c.email)
    if (e) emails.add(e)
  }

  const { data: dominiosEmpresa } = await supabaseAdmin
    .from('empresas')
    .select('dominio')
    .not('dominio', 'is', null)
    .limit(20_000)
  for (const d of dominiosEmpresa ?? []) {
    const bruto = (d as { dominio: string | null }).dominio
    if (bruto) dominios.add(bruto.toLowerCase().replace(/^www\./, ''))
  }

  return { emails, dominios }
}

export async function sincronizarUsuario(
  conta: ContaGmail,
  universo: UniversoConhecido,
): Promise<{ vistas: number; ingeridas: number; descartadas: number }> {
  const token = await accessTokenGmail(conta)
  if (!token) return { vistas: 0, ingeridas: 0, descartadas: 0 }

  const ids = conta.history_id
    ? await idsPorHistorico(token, conta.history_id)
    : await idsRecentes(token)

  let ingeridas = 0
  let descartadas = 0

  for (const id of ids) {
    const bruto = await buscarMensagem(token, id)
    const email = bruto ? lerMensagemGmail(bruto) : null
    if (!email) continue

    if (!deveIngerir(email, universo)) {
      descartadas += 1
      continue
    }
    // A própria caixa mandando: é saída, e o envio já gravou a linha.
    if (email.de === conta.endereco.toLowerCase()) continue

    await ingerir(email, conta)
    ingeridas += 1
  }

  const novoHistoryId = await historyIdAtual(token)
  await supabaseAdmin
    .from('gmail_contas')
    .update({
      history_id: novoHistoryId ?? conta.history_id,
      ultimo_sync_em: new Date().toISOString(),
      ultimo_erro: null,
    })
    .eq('usuario_id', conta.usuario_id)

  return { vistas: ids.length, ingeridas, descartadas }
}

async function ingerir(email: EmailRecebido, conta: ContaGmail): Promise<void> {
  // A citação sai ANTES da triagem: sem isso o classificador lê a nossa própria
  // mensagem de volta e classifica o que nós dissemos.
  const corpo = semCitacao(email.corpo)

  const r = await resolverRemetente({ canal: 'email', identificador: email.de, corpo })
  const conversaId = await conversaPara({
    canal: 'email',
    identificador: email.de,
    empresaId: r.empresaId,
    contatoId: r.contatoId,
    vendedorId: r.vendedorId,
  })

  await escreverNoLedger({
    conversaId,
    empresaId: r.empresaId,
    contatoId: r.contatoId,
    canal: 'email',
    direcao: 'entrada',
    vendedorId: r.vendedorId,
    assunto: email.assunto,
    corpo,
    provedor: 'gmail',
    idExterno: email.idExterno,
    threadExterna: email.messageId ?? email.threadExterna,
    contaRemetente: conta.endereco,
    statusEnvio: 'entregue',
    origem: 'inbox',
    criadoEm: email.recebidoEm,
  })

  if (conversaId) {
    await tocarConversa({ conversaId, direcao: 'entrada', em: email.recebidoEm, novoStatus: 'ativa' })
  }

  if (!r.contatoId) {
    await enfileirarNaoVinculada({
      canal: 'email',
      identificador: email.de,
      nomeSugerido: email.nomeSugerido,
      contaRecebedora: conta.endereco,
      vendedorSugeridoId: r.vendedorId,
      em: email.recebidoEm,
    })
  }
}

// ─── Chamadas à API ─────────────────────────────────────────────────────────

async function idsPorHistorico(token: string, historyId: string): Promise<string[]> {
  const res = await fetch(
    `${API}/history?startHistoryId=${encodeURIComponent(historyId)}&historyTypes=messageAdded&maxResults=200`,
    { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) },
  )
  if (!res.ok) {
    /*
     * 404 aqui significa `historyId` velho demais — o Gmail expira o histórico.
     * Cair para "as mensagens recentes" é o comportamento certo: perder a
     * retomada incremental é um custo, perder as mensagens é uma falha.
     */
    if (res.status === 404) return idsRecentes(token)
    return []
  }
  const corpo = (await res.json()) as {
    history?: Array<{ messagesAdded?: Array<{ message?: { id?: string } }> }>
  }
  const ids = new Set<string>()
  for (const h of corpo.history ?? []) {
    for (const m of h.messagesAdded ?? []) {
      if (m.message?.id) ids.add(m.message.id)
    }
  }
  return [...ids]
}

/**
 * O primeiro sync (e o fallback do histórico expirado) olha só a CAIXA DE
 * ENTRADA das últimas 24h. Varrer a caixa inteira de alguém no primeiro dia é
 * exatamente o que o filtro de ingestão existe para não fazer — e o `newer_than`
 * garante que nem a lista de ids saia do Google.
 */
async function idsRecentes(token: string): Promise<string[]> {
  const q = encodeURIComponent('in:inbox newer_than:1d')
  const res = await fetch(`${API}/messages?q=${q}&maxResults=100`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) return []
  const corpo = (await res.json()) as { messages?: Array<{ id: string }> }
  return (corpo.messages ?? []).map((m) => m.id)
}

async function buscarMensagem(token: string, id: string): Promise<unknown | null> {
  const res = await fetch(`${API}/messages/${id}?format=full`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  })
  return res.ok ? await res.json() : null
}

async function historyIdAtual(token: string): Promise<string | null> {
  const res = await fetch(`${API}/profile`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) return null
  const corpo = (await res.json()) as { historyId?: string }
  return corpo.historyId ?? null
}

/**
 * Renova o Gmail Watch (Pub/Sub). Expira em 7 dias, então o job diário o renova
 * quando falta menos de 2 — sem isso, o push para de chegar em silêncio e o
 * sistema passa a depender só da varredura.
 */
export async function renovarWatches(): Promise<number> {
  const topico = process.env.GOOGLE_PUBSUB_TOPIC
  if (!topico) return 0

  const limite = new Date(Date.now() + 2 * 86_400_000).toISOString()
  const { data } = await supabaseAdmin
    .from('gmail_contas')
    .select('usuario_id, endereco, refresh_token_secret_id, access_token_secret_id, access_token_expira_em, history_id, ativo, watch_expira_em')
    .eq('ativo', true)
    .or(`watch_expira_em.is.null,watch_expira_em.lte.${limite}`)

  let n = 0
  for (const conta of (data ?? []) as (ContaGmail & { watch_expira_em: string | null })[]) {
    const token = await accessTokenGmail(conta)
    if (!token) continue
    try {
      const res = await fetch(`${API}/watch`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ topicName: topico, labelIds: ['INBOX'] }),
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) continue
      const corpo = (await res.json()) as { historyId?: string; expiration?: string }
      await supabaseAdmin
        .from('gmail_contas')
        .update({
          watch_expira_em: corpo.expiration
            ? new Date(Number(corpo.expiration)).toISOString()
            : null,
          history_id: corpo.historyId ?? conta.history_id,
        })
        .eq('usuario_id', conta.usuario_id)
      n += 1
    } catch (erro) {
      logger.error({ conta: conta.endereco, erro: String(erro) }, 'Falha ao renovar o Gmail Watch.')
    }
  }
  return n
}
