import {
  traduzirPedido,
  type ContextoLigacao,
} from '../../../../../packages/core/src/agentes/voz-adapter.js'
import type { ObjetivoLigacao, VersaoVoz } from '../../../../../packages/core/src/agentes/schemas.js'
import type { PedidoLigacao } from '../../../../../packages/core/src/voz/schemas.js'
import { pool, supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { configDaVoz, enfileirarLigacao, versaoDaAna } from '../../voz/api.js'
import { lerConfigVoz } from '../../voz/config.js'
import { remontarPedidoDaNota } from '../../voz/pedido-fresco.js'

/**
 * Leva para a Ana o que está na fila.
 *
 * ── POR QUE DOIS PASSOS, E NÃO UM ──────────────────────────────────────────
 * Enfileirar é decidir; enviar é gastar. Separados, a fila pode ser olhada antes de
 * sair — e no dia em que a Ana estiver fora do ar, o que falha é o envio, não a
 * decisão: o `a_enviar` continua lá.
 *
 * ── O PORTÃO RODA DE NOVO AQUI, E O PEDIDO É REMONTADO (09 §1.3) ───────────
 * Entre pôr na fila e discar passam trinta minutos — ou dias, se a voz estava
 * desligada. Duas coisas podem ter mudado nesse meio tempo, e as duas são refeitas:
 *
 *   permissão  supressão, cobrança, Procon, base legal — `app__voz_portao`, a MESMA
 *              função que a RPC de enfileiramento chamou;
 *   conteúdo   taxa, TAC, líquido, vencimento, estágio da nota — remontados de
 *              `notas_funil` pelo mesmo portão do core que a tela usa.
 *
 * Qualquer um que falhe CANCELA a ligação com o motivo à vista. Se ela era de um
 * mandato, o mandato é acordado: é o agente quem decide se recalcula a oferta, tenta
 * outro contato ou desiste — não este job.
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
  /** Canceladas no envio: portão de permissão ou de conteúdo recusou com dados frescos. */
  canceladas: number
  versao: VersaoVoz | null
}

interface LinhaFila {
  id: string
  access_key: string | null
  id_externo: string
  pedido: unknown
  tentativas: number
  telefone: string | null
  fornecedor_cnpj: string | null
  empresa_id: string | null
  contato_id: string | null
  objetivo: string
  origem: string
  mandato_id: string | null
}

/** O `pedido` de uma ligação de mandato: o contexto que o agente montou ao pedir. */
interface PedidoDeMandato {
  contexto: Omit<ContextoLigacao, 'pedido_v1' | 'id_externo'>
}

function ehPedidoDeMandato(p: unknown): p is PedidoDeMandato {
  return !!p && typeof p === 'object' && 'contexto' in (p as Record<string, unknown>)
}

export async function enviarFilaDeVoz(limite?: number): Promise<ResultadoEnvioVoz> {
  const zero: ResultadoEnvioVoz = { candidatas: 0, enviadas: 0, reagendadas: 0, falhadas: 0, canceladas: 0, versao: null }
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
  const { rows } = await pool.query<LinhaFila>(
    `select v.id, v.access_key, v.id_externo, v.pedido, v.tentativas, v.telefone,
            v.fornecedor_cnpj, v.empresa_id, v.contato_id, v.objetivo, v.origem, v.mandato_id
       from voz_ligacoes v
      where v.status = 'a_enviar'
        and v.pedido is not null
        and (v.agendada_para is null or v.agendada_para <= $1)
      order by v.criada_em
      limit $2`,
    [agora.toISOString(), limite ?? cfg.maximo_por_envio],
  )
  if (rows.length === 0) return zero

  // Uma pergunta por corrida, não por ligação. O painel mostra esta versão (§15.4).
  const versao = await versaoDaAna(conexao)
  await registrarVersao(versao)

  const acc: ResultadoEnvioVoz = { ...zero, candidatas: rows.length, versao }

  for (const linha of rows) {
    // ── Permissão, com dados de agora ─────────────────────────────────────
    const { rows: portao } = await pool.query<{ motivo: string | null }>(
      'select public.app__voz_portao($1, $2, $3, $4, $5) as motivo',
      [linha.telefone, linha.contato_id, linha.empresa_id, linha.fornecedor_cnpj, linha.access_key],
    )
    const recusaPermissao = portao[0]?.motivo ?? null
    if (recusaPermissao) {
      await cancelar(linha, recusaPermissao)
      acc.canceladas++
      continue
    }

    // ── Conteúdo, com dados de agora ──────────────────────────────────────
    const objetivo = linha.objetivo as ObjetivoLigacao
    let pedidoV1: PedidoLigacao | null = null
    if (linha.access_key && objetivo === 'ofertar_antecipacao') {
      const fresco = await remontarPedidoDaNota({
        accessKey: linha.access_key,
        contatoId: linha.contato_id,
        telefone: linha.telefone ?? '',
        cfg,
      })
      if (!fresco.ok) {
        await cancelar(linha, fresco.motivo)
        acc.canceladas++
        continue
      }
      pedidoV1 = fresco.pedido
    }

    let payload: Record<string, unknown>
    if (ehPedidoDeMandato(linha.pedido)) {
      const t = traduzirPedido(versao, {
        ...linha.pedido.contexto,
        objetivo,
        id_externo: linha.id_externo,
        pedido_v1: pedidoV1,
      })
      if (!t.ok) {
        await cancelar(linha, t.codigo, t.erro)
        acc.canceladas++
        continue
      }
      payload = t.payload
    } else {
      // Ligação posta por uma pessoa na tela de Ligações: sempre oferta de NF, formato v1.
      if (!pedidoV1) {
        await cancelar(linha, 'sem_nota')
        acc.canceladas++
        continue
      }
      payload = { ...pedidoV1, id_externo: linha.id_externo }
    }

    // O `id_externo` é o da LINHA: a segunda tentativa da mesma nota é outra ligação,
    // não reenvio da primeira — e é isso que a Ana usa para decidir.
    const r = await enfileirarLigacao(conexao, payload)

    if (r.ok) {
      acc.enviadas++
      await pool.query(
        `update voz_ligacoes
            set status = 'enviada', ligacao_id = $2, enviada_em = now(), versao_api = $3,
                tentativas = tentativas + 1, ultima_tentativa_em = now(), erro = null,
                pedido = case when pedido ? 'contexto' then pedido || jsonb_build_object('enviado', $4::jsonb)
                              else $4::jsonb end
          where id = $1`,
        [linha.id, r.resposta.id, 'versao' in payload ? 'v2' : 'v1', JSON.stringify(payload)],
      )
      continue
    }

    const tentativas = linha.tentativas + 1
    const podeTentar = r.retryavel && tentativas < MAX_TENTATIVAS
    if (podeTentar) acc.reagendadas++
    else acc.falhadas++

    await pool.query(
      `update voz_ligacoes
          set tentativas = $2, ultima_tentativa_em = now(), erro = $3,
              status = case when $4 then 'a_enviar' else 'falhou' end,
              agendada_para = case when $4 then $5::timestamptz else agendada_para end,
              encerrada_em = case when $4 then null else now() end
        where id = $1`,
      [
        linha.id,
        tentativas,
        r.erro.slice(0, 500),
        podeTentar,
        // 5 min, depois 25 min — o mesmo passo da outbox de mensagens.
        new Date(agora.getTime() + 5 * 60_000 * 5 ** (tentativas - 1)).toISOString(),
      ],
    )

    if (!podeTentar) {
      logger.error({ id_externo: linha.id_externo, tentativas, erro: r.erro }, 'Ligação esgotou as tentativas de envio.')
      await acordarMandato(linha.mandato_id)
    }
  }

  logger.info(acc, 'Fila de voz enviada.')
  return acc
}

async function cancelar(linha: LinhaFila, motivo: string, detalhe?: string): Promise<void> {
  await pool.query(
    `update voz_ligacoes
        set status = 'cancelada', motivo_recusa = $2, erro = $3, encerrada_em = now()
      where id = $1`,
    [linha.id, motivo, detalhe ?? null],
  )
  logger.info({ id_externo: linha.id_externo, motivo }, 'Ligação cancelada no envio: o portão recusou com dados de agora.')
  await acordarMandato(linha.mandato_id)
}

/**
 * Devolve o controle ao mandato: ele volta ao topo do próximo ciclo e o agente lê, no
 * contexto, que a ligação não saiu e por quê.
 */
async function acordarMandato(mandatoId: string | null): Promise<void> {
  if (!mandatoId) return
  await pool.query(
    `update mandatos set proxima_acao_em = now(),
            estado = case when estado = 'aguardando_externo' then 'em_andamento' else estado end
      where id = $1 and estado in ('aberto', 'em_andamento', 'aguardando_externo')`,
    [mandatoId],
  )
}

/** A versão vista, para o painel dizer em qual contrato a Ana está (§15.4). */
async function registrarVersao(versao: VersaoVoz): Promise<void> {
  const { error } = await supabaseAdmin
    .from('agentes_config')
    .upsert({ chave: 'voz_status', valor: { versao, detectada_em: new Date().toISOString() } as never })
  if (error) logger.warn({ erro: error.message }, 'Não foi possível registrar a versão da Ana.')
}
