import { fimDoExpedienteDaVoz } from '../../../../../packages/core/src/agentes/agenda.js'
import { lerConfigAgentes } from '../../agentes/config.js'
import { pool } from '../../db.js'
import { logger } from '../../logger.js'
import { cancelarLigacao, configDaVoz } from '../../voz/api.js'

/**
 * A LIGAÇÃO ÓRFÃ (Prompt 09 §1.5b), em dois caminhos desde a v2 da Ana (0274).
 *
 * Enquanto uma ligação ficava `enviada`, a nota não aceitava nova tentativa e o mandato
 * esperava — para sempre, se nada olhasse para ela. Mas "sem resultado" tem duas causas
 * que pedem remédios diferentes, porque a fila da Ana é UMA ligação por vez, só das 9h às
 * 18h em dia útil:
 *
 *   1. DISCADA e sem `ligacao.encerrada` há mais de `voz_timeout_minutos`: a Ana perdeu a
 *      ligação ou o resultado se perdeu. Marca `falhou` (motivo `timeout`) na RPC.
 *   2. NUNCA DISCADA até o fim do expediente em que devia ser (`fimDoExpedienteDaVoz` a
 *      partir de `enviada_em`): ainda está na fila dela. Contar 30 minutos da entrada na
 *      fila marcava falha em ligação boa, o agente ligava de novo, e a Ana ligava duas
 *      vezes. Agora pede o DELETE e só marca o que ela confirmou que não vai discar
 *      (`cancelada` ou `nao_existe`). `ja_discou` fica: o `ligacao.encerrada`, durável,
 *      fecha a linha — é também o caso do `ligacao.iniciada` perdido.
 *
 * Nos dois, o motivo é `timeout` e a RPC de resultado REABRE a linha se o webhook chegar
 * depois: o timeout é a nossa desistência, não um fato da ligação.
 */
export async function varrerLigacoesOrfas(): Promise<{ marcadas: number; canceladas_na_fila: number }> {
  const cfg = await lerConfigAgentes()
  const minutos = cfg.geral.voz_timeout_minutos

  const { rows: discadas } = await pool.query<{ id: string; id_externo: string; mandato_id: string | null }>(
    'select * from public.app__voz_varrer_orfas($1)',
    [minutos],
  )
  const naFila = await desistirDaFilaVencida()
  const rows = [...discadas, ...naFila]

  const mandatos = [...new Set(rows.map((r) => r.mandato_id).filter((m): m is string => !!m))]
  if (mandatos.length) {
    await pool.query(
      `update mandatos set proxima_acao_em = now(),
              estado = case when estado = 'aguardando_externo' then 'em_andamento' else estado end
        where id = any($1::uuid[]) and estado in ('aberto', 'em_andamento', 'aguardando_externo')`,
      [mandatos],
    )
  }

  if (rows.length) {
    logger.warn(
      { discadas: discadas.length, na_fila: naFila.length, minutos },
      'Ligações sem resultado marcadas como falha por timeout.',
    )
  }
  return { marcadas: rows.length, canceladas_na_fila: naFila.length }
}

/** O caminho 2: ligação ainda na fila da Ana depois do expediente em que devia ser discada. */
async function desistirDaFilaVencida(): Promise<{ id: string; id_externo: string; mandato_id: string | null }[]> {
  const conexao = configDaVoz()
  if (!conexao) return []
  const { rows: candidatas } = await pool.query<{
    id: string
    id_externo: string
    mandato_id: string | null
    ligacao_id: string | null
    enviada_em: Date
  }>(
    `select id, id_externo, mandato_id, ligacao_id, enviada_em
       from voz_ligacoes
      where status = 'enviada' and iniciada_em is null and enviada_em is not null
        and enviada_em < now() - interval '1 hour'
      order by enviada_em
      limit 50`,
  )
  const agora = Date.now()
  const saida: { id: string; id_externo: string; mandato_id: string | null }[] = []
  for (const c of candidatas) {
    if (fimDoExpedienteDaVoz(c.enviada_em).getTime() > agora) continue
    const resposta = c.ligacao_id ? await cancelarLigacao(conexao, c.ligacao_id) : 'nao_existe'
    if (resposta !== 'cancelada' && resposta !== 'nao_existe') {
      if (resposta === 'erro') logger.warn({ id_externo: c.id_externo }, 'A Ana não respondeu ao cancelamento da fila vencida.')
      continue
    }
    const { rowCount } = await pool.query(
      `update voz_ligacoes set
          status = 'falhou',
          erro = 'timeout: não discada até o fim do expediente da Ana (' || $2 || ')',
          motivo_recusa = 'timeout',
          encerrada_em = now()
        where id = $1 and status = 'enviada' and iniciada_em is null`,
      [c.id, resposta],
    )
    if (rowCount) saida.push({ id: c.id, id_externo: c.id_externo, mandato_id: c.mandato_id })
  }
  return saida
}

/**
 * O DELETE do lado da Ana, depois que a tela cancelou do nosso (§1.5c). Só funciona
 * enquanto ninguém discou; se ela já discou, o webhook que chegar é aceito do mesmo jeito.
 */
export async function cancelarNaAna(ligacaoId: string): Promise<{ ok: boolean; motivo?: string }> {
  const conexao = configDaVoz()
  if (!conexao) return { ok: false, motivo: 'VOZ_API_URL/VOZ_API_TOKEN ausentes no worker.' }
  const ok = (await cancelarLigacao(conexao, ligacaoId)) === 'cancelada'
  if (!ok) logger.warn({ ligacaoId }, 'A Ana não aceitou o cancelamento (talvez já tenha discado).')
  return ok ? { ok } : { ok, motivo: 'A Ana não aceitou o cancelamento — a ligação pode já ter começado.' }
}
