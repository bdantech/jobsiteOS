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
 * do que foi dito ao telefone.
 *
 * O consumo é chamado em TODA entrega, inclusive no reenvio — a RPC devolve a linha já
 * fechada sem dizer se foi ela quem fechou. Quem garante o "uma vez só" é o próprio
 * consumo: ele reivindica o recibo `desfecho_ligacao` (índice único da 0271a) antes de
 * qualquer efeito, e o reenvio para ali sem duplicar ação, evento ou reunião.
 */
export async function registrarResultadoDaLigacao(corpo: unknown): Promise<ResultadoDoWebhook> {
  const evento = corpo && typeof corpo === 'object' ? (corpo as Record<string, unknown>).evento : null
  if (evento === 'ligacao.iniciada') return registrarDiscagem(corpo as Record<string, unknown>)

  const lido = resultadoLigacaoSchema.safeParse(corpo)
  if (!lido.success) {
    // Corpo que não entendemos não vai virar retentativa eterna do outro lado.
    return { ok: false, erro: lido.error.issues.map((i) => i.message).join('; '), recusar: true }
  }
  // Evento que ainda não conhecemos: recebido, nada a gravar.
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

/**
 * `ligacao.iniciada` (v2): a Ana discou. É o instante do qual a varredura conta o
 * `voz_timeout_minutos` (0274) — antes dele a ligação está na fila dela, que anda uma por
 * vez, e esperar não é sintoma de nada.
 *
 * O corpo deste evento é menor que o do resultado (`ligacao_id`, `telefone`, `objetivo`,
 * `iniciada_em`, e talvez o `id_externo`), então não passa pelo schema do resultado: a
 * linha é achada por qualquer um dos dois ids. É melhor esforço do lado dela, sem reenvio;
 * do nosso, um evento sem linha correspondente responde 200 do mesmo jeito — recusar não
 * traria o evento de volta.
 */
async function registrarDiscagem(corpo: Record<string, unknown>): Promise<ResultadoDoWebhook> {
  const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const idExterno = texto(corpo.id_externo)
  const ligacaoId = texto(corpo.ligacao_id)
  const quando = texto(corpo.iniciada_em)
  const instante = quando && Number.isFinite(Date.parse(quando)) ? new Date(quando) : new Date()
  if (!idExterno && !ligacaoId) return { ok: false, erro: 'ligacao.iniciada sem id_externo nem ligacao_id', recusar: true }

  const { rows } = await pool.query<{ id_externo: string }>(
    `update voz_ligacoes set iniciada_em = coalesce(iniciada_em, $3)
      where status = 'enviada'
        and (($1::text is not null and id_externo = $1) or ($2::text is not null and ligacao_id = $2))
      returning id_externo`,
    [idExterno, ligacaoId, instante.toISOString()],
  )
  if (!rows.length) logger.info({ id_externo: idExterno, ligacao_id: ligacaoId }, 'ligacao.iniciada sem ligação enviada correspondente.')
  return { ok: true, access_key: rows[0]?.id_externo ?? idExterno ?? ligacaoId ?? '', status: 'em_curso' }
}

// ─── O rastro de toda entrega (0275) ────────────────────────────────────────

/** O corpo cru guardado tem teto: o endpoint é público e não pode virar depósito. */
const MAX_CORPO = 200_000

export interface WebhookGuardado {
  id: string | null
  evento: string | null
  idExterno: string | null
}

/**
 * Grava a requisição ANTES de validar qualquer coisa — inclusive a de assinatura inválida,
 * que é justamente a que precisa ficar visível. Falhar aqui não pode derrubar o webhook:
 * sem o rastro, a entrega segue como seguia.
 */
export async function guardarWebhookDeVoz(e: { assinaturaOk: boolean; cru: string; temAssinatura: boolean }): Promise<WebhookGuardado> {
  let corpo: Record<string, unknown> | null = null
  try {
    const lido = JSON.parse(e.cru) as unknown
    if (lido && typeof lido === 'object' && !Array.isArray(lido)) corpo = lido as Record<string, unknown>
  } catch {
    corpo = null
  }
  const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null)
  const evento = texto(corpo?.evento)
  const idExterno = texto(corpo?.id_externo)
  try {
    const { rows } = await pool.query<{ id: string }>(
      `insert into voz_webhooks (assinatura_ok, evento, id_externo, ligacao_id, corpo, corpo_texto, erro)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7) returning id`,
      [
        e.assinaturaOk,
        evento,
        idExterno,
        texto(corpo?.ligacao_id),
        corpo && e.cru.length <= MAX_CORPO ? JSON.stringify(corpo) : null,
        corpo ? null : e.cru.slice(0, MAX_CORPO),
        e.temAssinatura ? null : 'sem cabeçalho de assinatura',
      ],
    )
    return { id: rows[0]?.id ?? null, evento, idExterno }
  } catch (erro) {
    logger.warn({ erro: String(erro) }, 'Não foi possível guardar o webhook da voz.')
    return { id: null, evento, idExterno }
  }
}

export async function fecharWebhookDeVoz(id: string | null, status: number, erro: string | null): Promise<void> {
  if (!id) return
  try {
    await pool.query('update voz_webhooks set status_http = $2, erro = coalesce($3, erro) where id = $1', [id, status, erro?.slice(0, 1000) ?? null])
  } catch (falha) {
    logger.warn({ erro: String(falha) }, 'Não foi possível fechar o registro do webhook da voz.')
  }
}
