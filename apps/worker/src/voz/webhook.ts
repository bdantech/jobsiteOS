import { assinaturaConfere } from '../../../../packages/core/src/server/credito-api.js'
import { resultadoLigacaoSchema } from '../../../../packages/core/src/voz/schemas.js'
import { pool } from '../db.js'
import { env } from '../env.js'
import { logger } from '../logger.js'

/**
 * O resultado da ligação, chegando da Ana.
 *
 * ── O CORPO É CRU, E ISSO NÃO É DETALHE ────────────────────────────────────
 * A assinatura cobre os BYTES que vieram no fio. Fazer `JSON.parse` e
 * re-serializar antes de conferir assina outra coisa — e aí ou tudo passa, ou
 * nada passa, dependendo de como o outro lado ordenou as chaves. Por isso a
 * rota lê `text()` e só decodifica depois de autorizar.
 *
 * ── REENVIO É ESPERADO ─────────────────────────────────────────────────────
 * A Ana reenvia até receber 2xx (30s, 1min, 2min... até 1h, dez vezes). A
 * idempotência é da RPC: a segunda entrega não gera segunda linha de ledger nem
 * segunda supressão. Aqui, 2xx significa "recebi e gravei", nunca "li".
 */

const PREFIXO = 'sha256='

/**
 * HMAC-SHA256 do corpo cru, em hex, com o prefixo que a Ana manda.
 * Falha fechada: sem segredo configurado, nada entra.
 */
export function assinaturaDaVozConfere(corpoCru: string, cabecalho: string | null): boolean {
  const segredo = env.VOZ_WEBHOOK_SECRET
  if (!segredo || !cabecalho) return false
  const recebida = cabecalho.startsWith(PREFIXO) ? cabecalho.slice(PREFIXO.length) : cabecalho
  return assinaturaConfere(segredo, corpoCru, recebida)
}

export type ResultadoDoWebhook =
  | { ok: true; access_key: string; status: string }
  | { ok: false; erro: string; recusar: boolean }

/**
 * Grava o desfecho. Tudo o que acontece em seguida — ledger, estágio, supressão —
 * é da RPC `app__voz_registrar_resultado`, numa transação só: um ledger sem a
 * supressão é uma promessa quebrada com quem pediu para não ser mais ligado.
 */
export async function registrarResultadoDaLigacao(corpo: unknown): Promise<ResultadoDoWebhook> {
  const lido = resultadoLigacaoSchema.safeParse(corpo)
  if (!lido.success) {
    // Corpo que não entendemos não vai virar retentativa eterna do outro lado.
    return { ok: false, erro: lido.error.issues.map((i) => i.message).join('; '), recusar: true }
  }

  /*
   * SQL direto, e não `supabaseAdmin.rpc`: a função nasceu na 0211 e os tipos de
   * `database.ts` são GERADOS do banco. Enquanto o `pnpm db:types` não roda, o
   * PostgREST tipado não conhece o nome — e o resto da fila de voz já fala por
   * `pool` de qualquer forma.
   */
  try {
    await pool.query('select public.app__voz_registrar_resultado($1::jsonb)', [lido.data])
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro)
    logger.error(
      { ligacao: lido.data.ligacao_id, access_key: lido.data.id_externo, erro: mensagem },
      'Falha ao registrar o resultado da ligação.',
    )
    // Ligação que não conhecemos não volta a ser tentada; o resto pode ser
    // transitório e merece o reenvio da Ana.
    return { ok: false, erro: mensagem, recusar: mensagem.includes('Ligação desconhecida') }
  }

  logger.info(
    { access_key: lido.data.id_externo, outcome: lido.data.outcome, status: lido.data.status },
    'Resultado da ligação registrado.',
  )
  return { ok: true, access_key: lido.data.id_externo, status: lido.data.status }
}
