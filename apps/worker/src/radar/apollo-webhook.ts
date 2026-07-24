import { createHash, timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '../db.js'
import { env } from '../env.js'
import { logger } from '../logger.js'

/**
 * Webhook do Apollo para telefones (§4): eles chegam DEPOIS, separados, quando o
 * bulk_match foi pedido com reveal_phone_number=true. Idempotente (o Apollo reenvia):
 * casar por apollo_person_id e escrever é a mesma operação toda vez.
 */

interface CorpoWebhook {
  people?: Array<{ id?: string; phone_numbers?: Array<{ raw_number?: string; sanitized_number?: string }> }>
  contacts?: Array<{ id?: string; phone_numbers?: Array<{ raw_number?: string; sanitized_number?: string }> }>
}

/** Compara o secret em tempo constante (SHA-256 dos dois lados → buffers de tamanho fixo). */
export function segredoWebhookValido(recebido: string | undefined): boolean {
  if (!env.APOLLO_WEBHOOK_SECRET || !recebido) return false
  const a = createHash('sha256').update(recebido).digest()
  const b = createHash('sha256').update(env.APOLLO_WEBHOOK_SECRET).digest()
  return timingSafeEqual(a, b)
}

export async function processarWebhookApollo(corpo: unknown): Promise<{ atualizados: number }> {
  const c = (corpo ?? {}) as CorpoWebhook
  const pessoas = [...(c.people ?? []), ...(c.contacts ?? [])]
  let atualizados = 0

  for (const p of pessoas) {
    if (!p.id) continue
    const tel = p.phone_numbers?.find((n) => n.sanitized_number || n.raw_number)
    const numero = tel?.sanitized_number ?? tel?.raw_number ?? null
    const patch = numero
      ? { telefone: numero, telefone_status: 'recebido' as const }
      : { telefone_status: 'indisponivel' as const }

    const { data, error } = await supabaseAdmin
      .from('contatos')
      .update(patch)
      .eq('apollo_person_id', p.id)
      .select('id')
    if (error) {
      logger.error({ apollo: p.id, erro: error.message }, 'Falha ao aplicar telefone do webhook Apollo.')
      continue
    }
    atualizados += data?.length ?? 0
  }

  return { atualizados }
}
