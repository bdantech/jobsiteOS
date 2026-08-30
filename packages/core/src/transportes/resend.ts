import { statusRetryavel, type MensagemParaEnviar, type ResultadoEnvio, type Transporte } from './tipos.js'

/**
 * Resend (§3.2): o e-mail do SISTEMA e da IA, de domínio próprio.
 *
 * É o outro caminho de e-mail, e o "outro" é o ponto: o Gmail OAuth manda COMO A
 * PESSOA (relacionamento humano, caixa dela, thread dela); o Resend manda como a
 * casa, de um subdomínio dedicado à automação. Misturar os dois queimaria a
 * reputação do domínio principal com volume de máquina — e um domínio queimado
 * derruba junto o e-mail que as pessoas mandam à mão.
 */

export interface ConfigResend {
  apiKey: string
  /** "Carina da ONE OS <carina@envio.oneos.com.br>" */
  remetente: string
  responderPara?: string | null
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export class TransporteResend implements Transporte {
  readonly nome = 'resend' as const
  readonly canal = 'email' as const

  // Campo declarado e atribuído à mão: o `--experimental-strip-types` do Node,
  // que é como os testes deste repo rodam, não implementa parameter properties.
  private readonly cfg: ConfigResend

  constructor(cfg: ConfigResend) {
    this.cfg = cfg
  }

  async enviar(msg: MensagemParaEnviar): Promise<ResultadoEnvio> {
    const f = this.cfg.fetchImpl ?? fetch
    try {
      const res = await f('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.cfg.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.cfg.remetente,
          to: [msg.destino],
          subject: msg.assunto ?? '(sem assunto)',
          text: msg.corpo,
          ...(this.cfg.responderPara ? { reply_to: this.cfg.responderPara } : {}),
          ...(msg.emRespostaA
            ? { headers: { 'In-Reply-To': msg.emRespostaA, References: msg.emRespostaA } }
            : {}),
        }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 20_000),
      })

      const corpo = (await res.json().catch(() => ({}))) as { id?: string; message?: string }
      if (!res.ok) {
        return { ok: false, erro: corpo.message ?? `HTTP ${res.status}`, retryavel: statusRetryavel(res.status) }
      }
      return { ok: true, idExterno: corpo.id ?? null, threadExterna: corpo.id ?? null }
    } catch (erro) {
      return { ok: false, erro: String(erro), retryavel: true }
    }
  }
}

// ─── Webhook de eventos ─────────────────────────────────────────────────────

export type EventoResend =
  | { tipo: 'status'; idExterno: string; status: 'enviada' | 'entregue' | 'lida' | 'falhou' }
  | { tipo: 'supressao'; idExterno: string; email: string; motivo: 'hard_bounce' | 'descadastro' }

/**
 * `bounced` e `complained` NÃO são apenas status — são supressão.
 *
 * Um hard bounce é um endereço que não existe: continuar mandando para ele
 * derruba a reputação do domínio inteiro, e a próxima mensagem legítima cai no
 * spam de quem paga a conta. Uma reclamação é alguém apertando "isto é spam", que
 * é a mesma coisa com um humano por trás.
 *
 * Por isso os dois viram linha em `supressao` automaticamente (§3.2), e por isso
 * este parser distingue o caso em vez de mapear tudo para `status_envio`.
 */
export function lerWebhookResend(payload: unknown): EventoResend | null {
  const p = payload as Record<string, any> | null
  if (!p) return null

  const tipo = String(p.type ?? '')
  const dados = p.data ?? {}
  const id: string | undefined = dados.email_id ?? dados.id
  if (!id) return null

  const email: string | undefined = Array.isArray(dados.to) ? dados.to[0] : dados.to

  switch (tipo) {
    case 'email.sent':
      return { tipo: 'status', idExterno: id, status: 'enviada' }
    case 'email.delivered':
      return { tipo: 'status', idExterno: id, status: 'entregue' }
    case 'email.opened':
      return { tipo: 'status', idExterno: id, status: 'lida' }
    case 'email.delivery_delayed':
      return null
    case 'email.bounced':
      // Soft bounce (caixa cheia, indisponível) não suprime: é temporário, e
      // suprimir por ele apagaria um contato bom por uma semana ruim dele.
      if (String(dados.bounce?.type ?? dados.type ?? 'hard').toLowerCase().startsWith('soft')) {
        return { tipo: 'status', idExterno: id, status: 'falhou' }
      }
      return email
        ? { tipo: 'supressao', idExterno: id, email, motivo: 'hard_bounce' }
        : { tipo: 'status', idExterno: id, status: 'falhou' }
    case 'email.complained':
      return email
        ? { tipo: 'supressao', idExterno: id, email, motivo: 'descadastro' }
        : { tipo: 'status', idExterno: id, status: 'falhou' }
    default:
      return null
  }
}
