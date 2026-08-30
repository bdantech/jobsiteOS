import { timingSafeEqual } from 'node:crypto'
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
 * O Resend assina com Svix. Enquanto a verificação de assinatura completa não
 * estiver ligada, o segredo compartilhado no header é o que separa um evento
 * nosso de um POST qualquer — e ele é obrigatório: o efeito de um webhook falso
 * aqui é escrever na lista de supressão.
 */
export function segredoResendValido(recebido: string | undefined): boolean {
  return iguais(recebido, env.RESEND_WEBHOOK_SECRET)
}
