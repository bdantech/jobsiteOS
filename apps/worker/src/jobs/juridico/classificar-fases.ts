import {
  classificarMovimentacao,
  montarCronograma,
} from '../../../../../packages/core/src/juridico/index.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { todasAsPaginas } from '../../paginar.js'
import { lerBenchmarkFases, lerRegrasFase } from '../../juridico/config.js'

/**
 * Reclassificação das fases sobre as movimentações JÁ gravadas (08 §5).
 *
 * ── POR QUE ISTO É UM JOB SEPARADO ─────────────────────────────────────────
 * A tabela de regras é EDITÁVEL. Quando alguém corrige uma palavra-chave — porque
 * um tribunal escreve "auto de constrição" onde os outros escrevem "penhora" —, a
 * correção só vale para as movimentações que chegarem DEPOIS, a não ser que algo
 * reclassifique o passado. Sem este job, a regra nova conserta o futuro e deixa
 * intacto o cronograma errado que motivou a correção.
 *
 * Não gasta crédito nenhum: relê o que já está no banco.
 */

export interface ResultadoClassificacao {
  processos: number
  movimentacoes: number
  reclassificadas: number
  fases_alteradas: number
}

export async function classificarFases(
  opcoes: { numeroCnj?: string } = {},
): Promise<ResultadoClassificacao> {
  const [regras, benchmark] = await Promise.all([lerRegrasFase(), lerBenchmarkFases()])

  const processos = opcoes.numeroCnj
    ? [{ numero_cnj: opcoes.numeroCnj, fase_atual: null as string | null }]
    : await todasAsPaginas<{ numero_cnj: string; fase_atual: string | null }>((de, ate) =>
        supabaseAdmin.from('processos').select('numero_cnj, fase_atual').range(de, ate),
      )

  const r: ResultadoClassificacao = {
    processos: processos.length,
    movimentacoes: 0,
    reclassificadas: 0,
    fases_alteradas: 0,
  }

  for (const p of processos) {
    const movs = await todasAsPaginas<{
      id: number
      data: string
      conteudo: string
      fase_detectada: string | null
      relevante: boolean
      termo_detectado: string | null
    }>((de, ate) =>
      supabaseAdmin
        .from('processo_movimentacoes')
        .select('id, data, conteudo, fase_detectada, relevante, termo_detectado')
        .eq('numero_cnj', p.numero_cnj)
        .range(de, ate),
    )

    r.movimentacoes += movs.length
    const classificadas: { data: string; fase_detectada: string | null }[] = []

    for (const m of movs) {
      const c = classificarMovimentacao(m.conteudo, regras)
      classificadas.push({ data: m.data, fase_detectada: c.fase })

      // Só escreve o que MUDOU: um update por movimentação numa base com dezenas de
      // milhares de linhas é uma varredura de escrita por nada, e ela dispararia o
      // `atualizado_em` de todas elas.
      if (c.fase !== m.fase_detectada || c.relevante !== m.relevante || c.termo !== m.termo_detectado) {
        r.reclassificadas++
        await supabaseAdmin
          .from('processo_movimentacoes')
          .update({ fase_detectada: c.fase, relevante: c.relevante, termo_detectado: c.termo })
          .eq('id', m.id)
      }
    }

    const cronograma = montarCronograma(classificadas, benchmark)
    if (cronograma.fase_atual !== p.fase_atual) {
      r.fases_alteradas++
      await supabaseAdmin
        .from('processos')
        .update({ fase_atual: cronograma.fase_atual, fase_desde: cronograma.fase_desde })
        .eq('numero_cnj', p.numero_cnj)
    }
  }

  logger.info(r, 'Fases reclassificadas.')
  return r
}
