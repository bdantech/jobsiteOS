import {
  ALERTA_SAUDE_TEXTOS,
  avaliarSaude,
  contasSuspeitas,
  type DesempenhoDaConta,
} from '../../../../../packages/core/src/campanhas/index.js'
import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { notify } from '../../../../../packages/core/src/server/notify.js'
import { lerLimitesCampanhas } from '../../campanhas/config.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { emitirEvento } from '../../radar/eventos.js'

/**
 * SAÚDE DE CANAL, VARRIDA (§6).
 *
 * O painel de uma campanha é calculado sob demanda pelo RPC — quem abre a tela
 * quer o número de agora. Este job existe para a pergunta oposta: **ninguém está
 * olhando**. Ele varre as campanhas vivas e avisa quando opt-out ou bounce passam
 * do limiar, porque campanha ruim queima domínio e número, e o número queimado
 * leva junto a conversa de todo mundo que já falava por ele.
 *
 * O alerta é emitido UMA VEZ por campanha por tipo. Um alerta que se repete a
 * cada 30 minutos é um alerta que o time filtra no segundo dia.
 */

export interface ResultadoMetricas {
  campanhas: number
  alertas: number
  contas_suspeitas: number
}

export async function varrerSaudeDasCampanhas(): Promise<ResultadoMetricas> {
  const limites = await lerLimitesCampanhas(true)

  const { data: campanhas } = await supabaseAdmin
    .from('campanhas')
    .select('id, nome, canal')
    .in('status', ['agendada', 'executando'])

  const acc: ResultadoMetricas = { campanhas: (campanhas ?? []).length, alertas: 0, contas_suspeitas: 0 }
  if (acc.campanhas === 0) return acc

  const gestores = await idsDosGestores()

  for (const c of campanhas ?? []) {
    const { data } = await supabaseAdmin.rpc('app_campanha_metricas', {
      p: { campanha_id: c.id } as never,
    })
    const m = (data ?? {}) as {
      resumo?: { enviadas?: number; optouts?: number; falhas?: number }
      por_conta?: { conta: string; enviadas: number; entregues: number }[]
    }

    const saude = avaliarSaude(
      {
        enviadas: Number(m.resumo?.enviadas ?? 0),
        optouts: Number(m.resumo?.optouts ?? 0),
        bounces: Number(m.resumo?.falhas ?? 0),
      },
      limites,
    )

    for (const alerta of saude.alertas) {
      if (await jaAlertado(c.id, alerta)) continue

      await emitirEvento(null, EVENTO_TIPOS.CAMPANHA_ALERTA_SAUDE, {
        campanha_id: c.id,
        nome: c.nome,
        tipo: alerta,
        optout_pct: saude.optoutPct,
        bounce_pct: saude.bouncePct,
        enviadas: saude.enviadas,
        url: `/comercial/campanhas/${c.id}`,
      })

      await notify(supabaseAdmin, gestores, {
        titulo: `Campanha "${c.nome}": ${alerta === 'optout' ? 'opt-out' : 'bounce'} acima do limiar`,
        corpo: ALERTA_SAUDE_TEXTOS[alerta],
        url: `/comercial/campanhas/${c.id}`,
      })
      acc.alertas += 1
    }

    const suspeitas = contasSuspeitas((m.por_conta ?? []) as DesempenhoDaConta[])
    if (suspeitas.length > 0) {
      acc.contas_suspeitas += suspeitas.length
      logger.warn(
        { campanha: c.nome, contas: suspeitas.map((s) => s.conta) },
        'Conta com entrega muito abaixo das irmãs na mesma campanha.',
      )
    }
  }

  logger.info(acc, 'Saúde das campanhas varrida.')
  return acc
}

/**
 * Já avisamos? A pergunta é feita ao próprio log de eventos, e não a uma coluna
 * de controle: o evento é a coisa que existe, e uma flag paralela poderia dizer
 * "avisado" quando o aviso falhou.
 */
async function jaAlertado(campanhaId: string, tipo: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('empresa_eventos')
    .select('id')
    .eq('tipo', EVENTO_TIPOS.CAMPANHA_ALERTA_SAUDE)
    .contains('payload', { campanha_id: campanhaId, tipo })
    .limit(1)
    .maybeSingle()
  return !!data
}

async function idsDosGestores(): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('usuarios')
    .select('id, perfis!inner(nome)')
    .eq('ativo', true)
    .in('perfis.nome', ['Admin', 'Comercial'])
  return (data ?? []).map((u) => u.id)
}
