import type { PedidoLigacao } from '../../../../../packages/core/src/voz/schemas.js'
import { pool } from '../../db.js'
import { logger } from '../../logger.js'
import { configDaVoz, enfileirarLigacao } from '../../voz/api.js'
import { lerConfigVoz } from '../../voz/config.js'

/**
 * Leva para a Ana o que o gerador aprovou.
 *
 * ── POR QUE DOIS JOBS, E NÃO UM ────────────────────────────────────────────
 * Gerar é decidir; enviar é gastar. Separados, a fila pode ser olhada antes de
 * sair — e no dia em que a Ana estiver fora do ar, o que falha é o envio, não a
 * decisão: o `a_enviar` continua lá, com o pedido já montado.
 *
 * ── TRÊS TENTATIVAS, DEPOIS PARA ───────────────────────────────────────────
 * Mesmo desenho da `mensagens_outbox`: backoff de 5 e 25 minutos, e o que a Ana
 * recusou por conteúdo (422) não é retentado — o corpo não vai melhorar sozinho.
 */

const MAX_TENTATIVAS = 3

export interface ResultadoEnvioVoz {
  candidatas: number
  enviadas: number
  reagendadas: number
  falhadas: number
  /** Suprimidas DEPOIS de entrar na fila: a ligação não sai e a linha fecha. */
  suprimidas: number
}

interface LinhaFila {
  access_key: string
  id_externo: string
  pedido: PedidoLigacao
  tentativas: number
  telefone: string | null
  fornecedor_cnpj: string
  suprimido: boolean
}

export async function enviarFilaDeVoz(limite?: number): Promise<ResultadoEnvioVoz> {
  const zero = { candidatas: 0, enviadas: 0, reagendadas: 0, falhadas: 0, suprimidas: 0 }
  const cfg = await lerConfigVoz()
  if (!cfg.ligada || cfg.kill_switch) {
    logger.info({ ligada: cfg.ligada, kill_switch: cfg.kill_switch }, 'Voz não está enviando.')
    return zero
  }

  const conexao = configDaVoz()
  if (!conexao) {
    logger.warn('VOZ_API_URL/VOZ_API_TOKEN ausentes; a fila fica parada.')
    return zero
  }

  const agora = new Date()
  /*
   * ── A SUPRESSÃO É RECONFERIDA AQUI, E NÃO SÓ NO CLIQUE ────────────────────
   * Entre pôr na fila e discar passam trinta minutos — ou dias, se a Ana estiver
   * fora do ar ou o kill switch subir. Quem pediu para não ser procurado nesse
   * meio tempo foi suprimido DEPOIS da checagem da RPC, e sem esta segunda
   * conferência a ligação sai assim mesmo. É o único erro desta fila que não tem
   * desfazer: o telefone toca.
   */
  const { rows } = await pool.query<LinhaFila>(
    `select v.access_key, v.id_externo, v.pedido, v.tentativas,
            v.telefone, v.fornecedor_cnpj,
            exists (
              select 1 from supressao s
               where ((s.escopo in ('telefone', 'whatsapp')
                       and s.valor = regexp_replace(coalesce(v.telefone, ''), '[^0-9]', '', 'g'))
                   or (s.escopo = 'empresa' and s.valor = v.fornecedor_cnpj))
                 and (s.expira_em is null or s.expira_em >= current_date)
            ) as suprimido
       from voz_ligacoes v
      where v.status = 'a_enviar'
        and v.pedido is not null
        and (v.agendada_para is null or v.agendada_para <= $1)
      order by v.criada_em
      limit $2`,
    [agora.toISOString(), limite ?? cfg.maximo_por_envio],
  )

  let enviadas = 0
  let reagendadas = 0
  let falhadas = 0
  let suprimidas = 0

  for (const linha of rows) {
    if (linha.suprimido) {
      suprimidas++
      await pool.query(
        `update voz_ligacoes
            set status = 'cancelada', motivo_recusa = 'suprimido', encerrada_em = now()
          where id_externo = $1`,
        [linha.id_externo],
      )
      logger.info(
        { access_key: linha.access_key },
        'Ligação cancelada: a pessoa foi suprimida depois de entrar na fila.',
      )
      continue
    }

    // O `id_externo` é o da LINHA: a segunda tentativa da mesma nota é outra
    // ligação, não reenvio da primeira — e é isso que a Ana usa para decidir.
    const r = await enfileirarLigacao(conexao, { ...linha.pedido, id_externo: linha.id_externo })

    if (r.ok) {
      enviadas++
      await pool.query(
        `update voz_ligacoes
            set status = 'enviada', ligacao_id = $2, enviada_em = now(),
                tentativas = tentativas + 1, ultima_tentativa_em = now(), erro = null
          where id_externo = $1`,
        [linha.id_externo, r.resposta.id],
      )
      continue
    }

    const tentativas = linha.tentativas + 1
    const podeTentar = r.retryavel && tentativas < MAX_TENTATIVAS
    if (podeTentar) reagendadas++
    else falhadas++

    await pool.query(
      `update voz_ligacoes
          set tentativas = $2, ultima_tentativa_em = now(), erro = $3,
              status = case when $4 then 'a_enviar' else 'falhou' end,
              agendada_para = case when $4 then $5::timestamptz else agendada_para end
        where id_externo = $1`,
      [
        linha.id_externo,
        tentativas,
        r.erro.slice(0, 500),
        podeTentar,
        // 5 min, depois 25 min — o mesmo passo da outbox de mensagens.
        new Date(agora.getTime() + 5 * 60_000 * 5 ** (tentativas - 1)).toISOString(),
      ],
    )

    if (!podeTentar) {
      logger.error(
        { access_key: linha.access_key, tentativas, erro: r.erro },
        'Ligação esgotou as tentativas de envio.',
      )
    }
  }

  const resultado = { candidatas: rows.length, enviadas, reagendadas, falhadas, suprimidas }
  logger.info(resultado, 'Fila de voz enviada.')
  return resultado
}
