import { lerConfigAgentes } from '../../agentes/config.js'
import { pool } from '../../db.js'
import { logger } from '../../logger.js'
import { cancelarLigacao, configDaVoz } from '../../voz/api.js'

/**
 * A LIGAÇÃO ÓRFÃ (Prompt 09 §1.5b).
 *
 * `enviada` sem webhook há mais de `voz_timeout_minutos` é ligação que a Ana perdeu, ou
 * resultado que se perdeu no caminho. Enquanto ela ficava `enviada`, a nota não aceitava
 * nova tentativa e sumia das candidatas — para sempre, porque nada mais olhava para ela.
 *
 * Marcar como `falhou` com o motivo `timeout` libera a nota e acorda o mandato. Se o
 * webhook chegar depois, a RPC de resultado REABRE a linha: o timeout é a nossa
 * desistência, não um fato da ligação.
 */
export async function varrerLigacoesOrfas(): Promise<{ marcadas: number }> {
  const cfg = await lerConfigAgentes()
  const minutos = cfg.geral.voz_timeout_minutos

  const { rows } = await pool.query<{ id: string; id_externo: string; mandato_id: string | null }>(
    'select * from public.app__voz_varrer_orfas($1)',
    [minutos],
  )

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
    logger.warn({ marcadas: rows.length, minutos }, 'Ligações sem resultado marcadas como falha por timeout.')
  }
  return { marcadas: rows.length }
}

/**
 * O DELETE do lado da Ana, depois que a tela cancelou do nosso (§1.5c). Só funciona
 * enquanto ninguém discou; se ela já discou, o webhook que chegar é aceito do mesmo jeito.
 */
export async function cancelarNaAna(ligacaoId: string): Promise<{ ok: boolean; motivo?: string }> {
  const conexao = configDaVoz()
  if (!conexao) return { ok: false, motivo: 'VOZ_API_URL/VOZ_API_TOKEN ausentes no worker.' }
  const ok = await cancelarLigacao(conexao, ligacaoId)
  if (!ok) logger.warn({ ligacaoId }, 'A Ana não aceitou o cancelamento (talvez já tenha discado).')
  return ok ? { ok } : { ok, motivo: 'A Ana não aceitou o cancelamento — a ligação pode já ter começado.' }
}
