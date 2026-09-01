import { timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '../db.js'
import { env } from '../env.js'

/**
 * Autenticação dos webhooks de comunicação.
 *
 * FALHA FECHADA: sem a variável configurada, a rota recusa TODO webhook. A
 * alternativa — aceitar quando não há segredo — transformaria um deploy com env
 * incompleta numa porta aberta para qualquer um gravar mensagens no ledger em
 * nome de qualquer contato.
 *
 * Comparação em tempo constante: o segredo chega em cada requisição, e um
 * `===` sobre strings vaza o prefixo correto pelo tempo de resposta a quem
 * insistir o suficiente. É a mesma régua do callback do Escavador.
 */

function iguais(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export function segredoWasenderValido(recebido: string | undefined): boolean {
  return iguais(recebido, env.WASENDER_WEBHOOK_SECRET)
}

/**
 * O segredo de webhook DE ALGUMA CONTA ATIVA.
 *
 * O Wasender emite um par (access token, webhook secret) por número. O token já
 * era por conta desde a 0045; o segredo virou por conta na 0152, guardado como
 * HASH — ele nunca é lido, só comparado.
 *
 * A comparação acontece no BANCO, por índice: trazer os hashes para a memória do
 * worker para comparar aqui seria manter material de credencial num processo que
 * não precisa dele, e o índice já resolve em uma consulta.
 *
 * `WASENDER_WEBHOOK_SECRET` continua valendo como fallback — é o caminho de quem
 * tem um número só, e sem ele ligar o primeiro exigiria cadastrar a conta antes
 * de o webhook existir.
 */
export async function webhookWasenderAutorizado(recebido: string | undefined): Promise<boolean> {
  if (!recebido) return false
  if (segredoWasenderValido(recebido)) return true
  const { data, error } = await supabaseAdmin.rpc('app__conta_do_webhook', { p_segredo: recebido })
  // Erro de banco não vira "autorizado": falha fechada, como o resto do módulo.
  if (error) return false
  return Array.isArray(data) ? data.length > 0 : data !== null
}

/**
 * O Resend assina com Svix. Enquanto a verificação de assinatura completa não
 * estiver ligada, o segredo compartilhado no header é o que separa um evento
 * nosso de um POST qualquer — e ele é obrigatório: o efeito de um webhook falso
 * aqui é escrever na lista de supressão.
 */
export function segredoResendValido(recebido: string | undefined): boolean {
  return iguais(recebido, env.RESEND_WEBHOOK_SECRET)
}
