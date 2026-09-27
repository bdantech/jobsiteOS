/**
 * UMA interface para os três canos (§10).
 *
 * Wasender, Gmail e Resend não se parecem em nada por dentro — um é REST com
 * token por número, outro é OAuth por pessoa com refresh, o terceiro é uma API de
 * domínio com webhook de eventos. O worker de envio não pode saber disso: ele tem
 * uma fila e precisa de uma função que mande.
 *
 * O que a interface deliberadamente NÃO faz: decidir se PODE mandar. Isso é do
 * portão (`comunicacao/portao.ts`), e um transporte que checasse supressão seria
 * o quarto lugar onde essa regra vive.
 */

/**
 * Um anexo. O transporte usa o que sabe usar:
 *   • e-mail (Resend, Gmail) leva os BYTES (`conteudoBase64`) — um link no lugar do PDF
 *     de uma notificação extrajudicial não é anexo, é um convite a não abrir;
 *   • WhatsApp (Wasender) só aceita `documentUrl`, então leva a `url` assinada.
 * Quem monta a mensagem (a fila) resolve os dois a partir do Storage.
 */
export interface Anexo {
  nome: string
  /** URL pública/assinada ou data URI. */
  url?: string
  /** O conteúdo em base64 (sem prefixo `data:`). */
  conteudoBase64?: string
  mime?: string
}

export interface MensagemParaEnviar {
  /** Telefone E.164 sem "+" (WhatsApp) ou endereço (e-mail). */
  destino: string
  assunto?: string | null
  corpo: string
  anexos?: Anexo[]
  /**
   * Threading de e-mail: o `Message-ID` da mensagem que estamos respondendo. Sem
   * ele, a resposta abre uma conversa nova na caixa do outro lado — e a pessoa
   * lê "outro contato da mesma empresa" onde deveria ler "a mesma conversa".
   */
  emRespostaA?: string | null
}

export interface ResultadoEnvio {
  ok: boolean
  /** Message id do provedor. É a chave de idempotência do ledger. */
  idExterno?: string | null
  /** `Message-ID` gerado (e-mail), para o próximo `emRespostaA`. */
  threadExterna?: string | null
  erro?: string | null
  /**
   * Falha que vale retry (rede, 429, 5xx) contra falha permanente (número
   * inválido, credencial revogada). A distinção decide entre a segunda tentativa
   * e a notificação ao dono — insistir num número inexistente é gastar a conta.
   */
  retryavel?: boolean
}

export interface Transporte {
  readonly nome: 'wasender' | 'gmail' | 'resend'
  readonly canal: 'whatsapp' | 'email'
  enviar(msg: MensagemParaEnviar): Promise<ResultadoEnvio>
}

/** 429 e 5xx valem outra tentativa; 4xx do cliente, não. */
export function statusRetryavel(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}
