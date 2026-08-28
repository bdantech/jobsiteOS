import { SITUACOES_ATIVAS } from '../../../../../packages/core/src/juridico/schemas.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { todasAsPaginas } from '../../paginar.js'
import {
  ehDiaDeSincronizar,
  lerBenchmarkFases,
  lerMonitoramento,
  lerNossosCnpjs,
  lerRegrasFase,
} from '../../juridico/config.js'
import { capaDoProcesso, movimentacoesDoProcesso, solicitarAtualizacao } from '../../juridico/escavador.js'
import { persistirProcesso } from './persistir.js'

/**
 * Sincronização agendada (08 §4).
 *
 * ── A AGENDA É CONFERIDA AQUI, E NÃO NO CRON ───────────────────────────────
 * O Vercel Cron dispara todo dia; é este job que decide se hoje é dia. Codificar os
 * dias da semana no `vercel.json` obrigaria um deploy para mudar a agenda — e a
 * agenda é uma setting que o gestor mexe na tela, justamente porque o custo muda
 * com ela.
 *
 * ── DUAS INTENSIDADES, E A CARA É A SEGUNDA ────────────────────────────────
 * Ler a base do Escavador (capa + movimentações) custa pouco e é o padrão. Pedir ao
 * ROBÔ que vá ao tribunal (`solicitar-atualizacao`) custa crédito por processo por
 * rodada, e por isso `forcar_atualizacao_tribunal` nasce desligado: ligado com 300
 * processos e 5 dias por semana são 1.500 chamadas pagas por semana.
 */

export interface ResultadoSincronizacao {
  executado: boolean
  motivo?: string
  processos: number
  atualizados: number
  movimentacoes_novas: number
  relevantes: number
  mudaram_de_fase: number
  atualizacoes_solicitadas: number
  creditos: number
  erros: { numero_cnj: string; erro: string }[]
}

export async function sincronizarProcessos(
  opcoes: { forcarAgenda?: boolean; numeroCnj?: string } = {},
): Promise<ResultadoSincronizacao> {
  const cfg = await lerMonitoramento()

  const r: ResultadoSincronizacao = {
    executado: true,
    processos: 0,
    atualizados: 0,
    movimentacoes_novas: 0,
    relevantes: 0,
    mudaram_de_fase: 0,
    atualizacoes_solicitadas: 0,
    creditos: 0,
    erros: [],
  }

  // Um CNJ explícito é o botão "Atualizar agora" e ignora a agenda de propósito:
  // quem clicou está olhando a tela e quer o resultado.
  if (!opcoes.numeroCnj && !opcoes.forcarAgenda && !ehDiaDeSincronizar(cfg)) {
    return { ...r, executado: false, motivo: 'Hoje não é dia de sincronizar (juridico_config.monitoramento).' }
  }

  const [regras, benchmark, nossos] = await Promise.all([
    lerRegrasFase(),
    lerBenchmarkFases(),
    lerNossosCnpjs(),
  ])
  const nossosCnpjs = nossos.map((c) => c.cnpj)

  const alvos = opcoes.numeroCnj
    ? [{ numero_cnj: opcoes.numeroCnj }]
    : await todasAsPaginas<{ numero_cnj: string }>((de, ate) => {
        let q = supabaseAdmin.from('processos').select('numero_cnj').range(de, ate)
        if (cfg.apenas_ativos) q = q.in('situacao_interna', SITUACOES_ATIVAS as unknown as string[])
        return q
      })

  r.processos = alvos.length

  for (const { numero_cnj } of alvos) {
    try {
      /*
       * A ORDEM importa: solicitar a atualização ANTES de ler.
       *
       * O robô do tribunal leva minutos e responde por callback — o resultado dele
       * NÃO chega a tempo desta leitura, e não é para chegar. Pedir antes é o que
       * garante que a próxima rodada (ou o callback, que dispara um re-sync) leia
       * dado fresco. Pedir depois desperdiçaria uma rodada inteira de defasagem.
       */
      if (cfg.forcar_atualizacao_tribunal) {
        const s = await solicitarAtualizacao(numero_cnj)
        r.creditos += s.creditos
        r.atualizacoes_solicitadas++
      }

      const capa = await capaDoProcesso(numero_cnj)
      r.creditos += capa.creditos
      if (!capa.processo) continue

      const movs = await movimentacoesDoProcesso(numero_cnj)
      r.creditos += movs.creditos

      const p = await persistirProcesso(capa.processo, {
        nossosCnpjs,
        regras,
        benchmark,
        movimentacoes: movs.movimentacoes,
        origem: 'sincronizacao',
      })
      if (!p) continue

      r.atualizados++
      r.movimentacoes_novas += p.movimentacoes_novas
      r.relevantes += p.relevantes
      if (p.fase_atual !== p.fase_anterior) r.mudaram_de_fase++
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e)
      logger.error({ cnj: numero_cnj, erro }, 'Falha ao sincronizar processo.')
      r.erros.push({ numero_cnj, erro })
    }
  }

  logger.info(r, 'Sincronização do Jurídico concluída.')
  return r
}

/**
 * Drena o que a tool da IA e o botão da tela enfileiraram em `juridico_sync_log`
 * com status `solicitada_pela_ia`.
 *
 * A tool roda com o client do USUÁRIO e não tem o token do Escavador — ela deixa a
 * marca, e é este job que gasta o crédito. É a mesma separação de sempre: o que
 * custa dinheiro roda no worker, com service role, onde há log e limite.
 */
export async function drenarSolicitacoes(limite = 25): Promise<{ processadas: number; creditos: number }> {
  const { data } = await supabaseAdmin
    .from('juridico_sync_log')
    .select('id, numero_cnj')
    .eq('status', 'solicitada_pela_ia')
    .not('numero_cnj', 'is', null)
    .order('executado_em')
    .limit(limite)

  let creditos = 0
  let processadas = 0

  for (const linha of data ?? []) {
    if (!linha.numero_cnj) continue
    try {
      const s = await solicitarAtualizacao(linha.numero_cnj)
      creditos += s.creditos
      processadas++
      await supabaseAdmin.from('juridico_sync_log').update({ status: 'enviada' }).eq('id', linha.id)
    } catch (e) {
      await supabaseAdmin
        .from('juridico_sync_log')
        .update({ status: 'erro', erro: e instanceof Error ? e.message : String(e) })
        .eq('id', linha.id)
    }
  }

  return { processadas, creditos }
}
