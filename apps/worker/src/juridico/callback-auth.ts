import { createHash, timingSafeEqual } from 'node:crypto'
import { env } from '../env.js'

/**
 * Valida o segredo do callback do Escavador em tempo constante.
 *
 * SHA-256 dos dois lados antes de comparar, pelo mesmo motivo do webhook do Apollo:
 * `timingSafeEqual` lança quando os buffers têm tamanhos diferentes, e a exceção em
 * si já vazaria o comprimento do segredo. O digest normaliza os dois para 32 bytes.
 *
 * Sem `ESCAVADOR_CALLBACK_TOKEN` configurado, NADA é aceito. Falha fechada: um
 * deploy mal configurado tem de recusar os callbacks, não recebê-los de qualquer um.
 */
export function callbackEscavadorValido(recebido: string | undefined): boolean {
  if (!env.ESCAVADOR_CALLBACK_TOKEN || !recebido) return false
  const a = createHash('sha256').update(recebido).digest()
  const b = createHash('sha256').update(env.ESCAVADOR_CALLBACK_TOKEN).digest()
  return timingSafeEqual(a, b)
}
