import { dominioDoEmail, dominioIdentificaEmpresa } from '../comunicacao/identificador.js'
import { statusRetryavel, type MensagemParaEnviar, type ResultadoEnvio, type Transporte } from './tipos.js'

/**
 * Gmail OAuth por USUÁRIO (§3.2): envia e recebe COMO A PESSOA.
 *
 * É o canal do relacionamento humano. Quando o vendedor responde pelo sistema, a
 * mensagem sai da caixa dele, entra na thread que o cliente já tinha aberto, e
 * fica nos "Enviados" dele. O contrário — responder de um endereço da casa uma
 * conversa que a pessoa começou com o vendedor — quebra a thread do outro lado e
 * faz o cliente achar que trocou de interlocutor.
 *
 * ─── O FILTRO DE INGESTÃO É OBRIGATÓRIO, E É A PARTE MAIS IMPORTANTE ────────
 * Só entra no ledger e-mail cujo remetente/destinatário case com um contato
 * conhecido ou com um domínio de empresa da base. NUNCA a caixa inteira.
 *
 * Isso não é otimização de custo: é a diferença entre um CRM e uma ferramenta de
 * vigilância sobre o e-mail pessoal de quem trabalha aqui. A regra está em
 * `deveIngerir()`, é testada, e está escrita na tela de conexão e no README.
 */

export interface ConfigGmail {
  /** Access token JÁ RENOVADO pelo chamador. O refresh vive no Vault. */
  accessToken: string
  /** O endereço da conta. Vai no `From`. */
  endereco: string
  nomeExibicao?: string | null
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

export const ESCOPOS_GMAIL = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
] as const

/** RFC 2822 em base64url, que é o que o `messages.send` do Gmail aceita. */
export function montarRfc822(de: string, msg: MensagemParaEnviar): string {
  const linhas = [
    `From: ${de}`,
    `To: ${msg.destino}`,
    `Subject: ${codificarAssunto(msg.assunto ?? '(sem assunto)')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ]
  if (msg.emRespostaA) {
    linhas.push(`In-Reply-To: ${msg.emRespostaA}`, `References: ${msg.emRespostaA}`)
  }
  const corpo = Buffer.from(msg.corpo, 'utf8').toString('base64')
  return `${linhas.join('\r\n')}\r\n\r\n${corpo}`
}

/**
 * Assunto com acento precisa de MIME encoded-word: um `Subject:` cru com "ç" sai
 * como mojibake em metade dos clientes de e-mail, e o assunto é a única parte da
 * mensagem que a pessoa lê antes de decidir abrir.
 */
function codificarAssunto(assunto: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(assunto)) return assunto
  return `=?UTF-8?B?${Buffer.from(assunto, 'utf8').toString('base64')}?=`
}

export function base64Url(texto: string): string {
  return Buffer.from(texto, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export class TransporteGmail implements Transporte {
  readonly nome = 'gmail' as const
  readonly canal = 'email' as const

  // Campo declarado e atribuído à mão: o `--experimental-strip-types` do Node,
  // que é como os testes deste repo rodam, não implementa parameter properties.
  private readonly cfg: ConfigGmail

  constructor(cfg: ConfigGmail) {
    this.cfg = cfg
  }

  async enviar(msg: MensagemParaEnviar): Promise<ResultadoEnvio> {
    const f = this.cfg.fetchImpl ?? fetch
    const de = this.cfg.nomeExibicao
      ? `${this.cfg.nomeExibicao} <${this.cfg.endereco}>`
      : this.cfg.endereco

    try {
      const res = await f(`${API}/messages/send`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.cfg.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ raw: base64Url(montarRfc822(de, msg)) }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 20_000),
      })

      const corpo = (await res.json().catch(() => ({}))) as {
        id?: string
        threadId?: string
        error?: { message?: string }
      }
      if (!res.ok) {
        return {
          ok: false,
          erro: corpo.error?.message ?? `HTTP ${res.status}`,
          // 401 é token vencido: renovar e tentar de novo resolve, insistir com o
          // mesmo token não. O chamador trata o 401 renovando antes do retry.
          retryavel: statusRetryavel(res.status) || res.status === 401,
        }
      }
      return { ok: true, idExterno: corpo.id ?? null, threadExterna: corpo.threadId ?? null }
    } catch (erro) {
      return { ok: false, erro: String(erro), retryavel: true }
    }
  }
}

// ─── Ingestão ───────────────────────────────────────────────────────────────

export interface EmailRecebido {
  idExterno: string
  threadExterna: string | null
  /** `Message-ID` do cabeçalho: é o que a resposta usa em `In-Reply-To`. */
  messageId: string | null
  emRespostaA: string | null
  de: string
  nomeSugerido: string | null
  para: string[]
  assunto: string | null
  corpo: string | null
  recebidoEm: Date
}

export interface UniversoConhecido {
  /** E-mails de contatos já cadastrados, em minúsculas. */
  emails: ReadonlySet<string>
  /** Domínios de empresas da base, em minúsculas. */
  dominios: ReadonlySet<string>
}

/**
 * A regra de ingestão, isolada e testável.
 *
 * Casa por E-MAIL EXATO (o contato já existe) ou por DOMÍNIO de empresa conhecida
 * (é alguém novo da mesma empresa — exatamente o caso que o inbox de
 * identificação existe para resolver). Domínio genérico nunca casa: `gmail.com`
 * como critério transformaria "só o que é da base" em "tudo".
 */
export function deveIngerir(email: EmailRecebido, universo: UniversoConhecido): boolean {
  const candidatos = [email.de, ...email.para].map((e) => extrairEndereco(e)).filter(Boolean) as string[]

  for (const c of candidatos) {
    if (universo.emails.has(c)) return true
  }
  for (const c of candidatos) {
    const d = dominioDoEmail(c)
    if (dominioIdentificaEmpresa(d) && universo.dominios.has(d!)) return true
  }
  return false
}

/** "Nome Sobrenome <a@b.com>" → "a@b.com". */
export function extrairEndereco(bruto: string | null | undefined): string | null {
  if (!bruto) return null
  const m = bruto.match(/<([^>]+)>/)
  const cru = (m?.[1] ?? bruto).trim().toLowerCase()
  return cru.includes('@') ? cru : null
}

export function extrairNome(bruto: string | null | undefined): string | null {
  if (!bruto) return null
  const m = bruto.match(/^\s*"?([^"<]+?)"?\s*</)
  const nome = m?.[1]?.trim()
  return nome && nome !== '' ? nome : null
}

interface CabecalhoGmail {
  name: string
  value: string
}

/**
 * Normaliza o `messages.get(format=full)` do Gmail.
 *
 * O corpo pode vir no `payload.body`, na primeira parte `text/plain`, ou aninhado
 * dentro de um `multipart/alternative` dentro de um `multipart/mixed`. A busca é
 * recursiva e prefere `text/plain` — o HTML da assinatura corporativa é 90% do
 * peso e 0% do conteúdo.
 */
export function lerMensagemGmail(bruto: unknown): EmailRecebido | null {
  const m = bruto as Record<string, any> | null
  if (!m?.id) return null

  const cabecalhos: CabecalhoGmail[] = m.payload?.headers ?? []
  const h = (nome: string): string | null =>
    cabecalhos.find((c) => c.name?.toLowerCase() === nome.toLowerCase())?.value ?? null

  const de = h('From') ?? ''
  const paraBruto = [h('To'), h('Cc')].filter(Boolean).join(',')

  return {
    idExterno: String(m.id),
    threadExterna: m.threadId ? String(m.threadId) : null,
    messageId: h('Message-ID') ?? h('Message-Id'),
    emRespostaA: h('In-Reply-To'),
    de: extrairEndereco(de) ?? de,
    nomeSugerido: extrairNome(de),
    para: paraBruto
      .split(',')
      .map((p) => extrairEndereco(p))
      .filter((p): p is string => Boolean(p)),
    assunto: h('Subject'),
    corpo: corpoDe(m.payload) ?? (m.snippet ? String(m.snippet) : null),
    recebidoEm: m.internalDate ? new Date(Number(m.internalDate)) : new Date(),
  }
}

/*
 * DUAS varreduras da árvore inteira, e não uma recursão que testa os dois tipos
 * por nó.
 *
 * A recursão ingênua devolve o HTML de um `multipart/alternative` sempre que ele
 * vem ANTES do `text/plain` irmão — que é a ordem em que a maioria dos clientes
 * monta a mensagem. O resultado era a triagem lendo a assinatura corporativa
 * inteira em vez da frase que a pessoa escreveu.
 */
function corpoDe(parte: Record<string, any> | undefined): string | null {
  const puro = primeiroDoTipo(parte, 'text/plain')
  if (puro !== null) return decodificarBase64Url(puro)
  const html = primeiroDoTipo(parte, 'text/html')
  return html !== null ? semTags(decodificarBase64Url(html)) : null
}

function primeiroDoTipo(parte: Record<string, any> | undefined, mime: string): string | null {
  if (!parte) return null
  if (parte.mimeType === mime && parte.body?.data) return String(parte.body.data)
  for (const filha of parte.parts ?? []) {
    const achado = primeiroDoTipo(filha, mime)
    if (achado !== null) return achado
  }
  return null
}

export function decodificarBase64Url(dados: string): string {
  return Buffer.from(dados.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

function semTags(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Corta a citação da resposta ("Em 27/08/2026, Fulano escreveu:" e o `>` que vem
 * depois). Sem isso, a triagem lê a nossa própria mensagem de volta e classifica
 * o que nós dissemos como se fosse a resposta da pessoa.
 */
export function semCitacao(corpo: string | null): string | null {
  if (!corpo) return null
  const marcadores = [
    /\n\s*Em .{5,60}escreveu:/i,
    /\n\s*On .{5,60}wrote:/i,
    /\n-{2,}\s*Mensagem original\s*-{2,}/i,
    /\n-{2,}\s*Original Message\s*-{2,}/i,
    /\n_{5,}/,
  ]
  let corte = corpo.length
  for (const re of marcadores) {
    const m = corpo.match(re)
    if (m?.index !== undefined && m.index < corte) corte = m.index
  }
  const linhas = corpo
    .slice(0, corte)
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('>'))
  const limpo = linhas.join('\n').trim()
  return limpo === '' ? null : limpo
}
