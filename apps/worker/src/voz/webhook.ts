import { assinaturaConfere } from '../../../../packages/core/src/server/credito-api.js'
import { resultadoLigacaoSchema } from '../../../../packages/core/src/voz/schemas.js'
import { consumirDesfechoNoMandato } from '../agentes/voz-mandato.js'
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
 *
 * Depois da RPC, e FORA da transação dela, o desfecho estruturado volta ao mandato
 * (09 §4.3): contato indicado vira contato, retorno agendado vira próxima ação. Fora
 * porque é trabalho de outro módulo e porque uma falha ali não pode desfazer a gravação
 * do que foi dito ao telefone — a Ana reenviaria o webhook e a RPC, idempotente,
 * devolveria a linha já fechada sem nunca refazer o consumo.
 */
export async function registrarResultadoDaLigacao(corpo: unknown): Promise<ResultadoDoWebhook> {
  const lido = resultadoLigacaoSchema.safeParse(corpo)
  if (!lido.success) {
    // Corpo que não entendemos não vai virar retentativa eterna do outro lado.
    return { ok: false, erro: lido.error.issues.map((i) => i.message).join('; '), recusar: true }
  }
  // Outro evento (a v2 pode avisar "ligação iniciada"): recebido, nada a gravar ainda.
  if (lido.data.evento !== 'ligacao.encerrada') {
    logger.info({ evento: lido.data.evento, id_externo: lido.data.id_externo }, 'Evento de voz ignorado.')
    return { ok: true, access_key: lido.data.id_externo, status: lido.data.status }
  }

  /*
   * O CORPO CRU vai para a RPC, não `lido.data` (09 §1.6). O schema é `passthrough`
   * agora, mas a regra é mais simples de manter do que de lembrar: o que a Ana mandou é
   * evidência de uma conversa gravada, e a RPC é quem decide o que mapear.
   */
  try {
    await pool.query('select public.app__voz_registrar_resultado($1::jsonb)', [JSON.stringify(corpo)])
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

  try {
    await consumirDesfechoNoMandato(lido.data.id_externo, corpo)
  } catch (erro) {
    logger.error(
      { id_externo: lido.data.id_externo, erro: String(erro) },
      'Resultado gravado, mas o consumo pelo mandato falhou.',
    )
  }

  logger.info(
    { access_key: lido.data.id_externo, outcome: lido.data.outcome, status: lido.data.status },
    'Resultado da ligação registrado.',
  )
  return { ok: true, access_key: lido.data.id_externo, status: lido.data.status }
}
