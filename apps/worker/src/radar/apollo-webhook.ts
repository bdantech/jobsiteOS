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

    let q = supabaseAdmin.from('contatos').update(patch).eq('apollo_person_id', p.id)
    // 'indisponivel' nunca invalida um número que já temos: o Apollo reenvia o
    // webhook, e uma entrega vazia depois de uma cheia não pode desfazer a cheia.
    if (!numero) q = q.is('telefone', null)
    const { data, error } = await q.select('id')
    if (error) {
      logger.error({ apollo: p.id, erro: error.message }, 'Falha ao aplicar telefone do webhook Apollo.')
      continue
    }
    const n = data?.length ?? 0
    if (n === 0) {
      // Não é ruído: significa telefone chegando para um contato que não existe
      // (webhook mais rápido que o insert do lote, ou person_id de outro ambiente).
      // Sem este log o número sumia e o 200 dizia que estava tudo bem.
      logger.warn({ apollo: p.id, tinha_numero: !!numero }, 'Webhook Apollo não casou nenhum contato.')
    }
    atualizados += n
  }

  return { atualizados }
}
