import {
  escolherVariante,
  proximoPasso,
  sequenciaCessouPara,
  type Variante,
} from '../../../../../packages/core/src/campanhas/index.js'
import { pool, supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'

/**
 * O SEGUNDO E O TERCEIRO TOQUE (§5). Diário.
 *
 * A regra dura é uma frase: **para no primeiro sinal**. Antes de agendar qualquer
 * toque seguinte, este job pergunta quatro coisas sobre a pessoa — respondeu?
 * descadastrou? entrou na supressão? o Agente assumiu a conversa? — e uma só
 * resposta positiva encerra a sequência ali.
 *
 * ─── POR QUE A CAMPANHA CEDE O LUGAR AO AGENTE ──────────────────────────────
 * O Agente lê a conversa; a campanha não lê nada. No momento em que há uma
 * conversa de verdade, insistir com o toque programado é falar por cima de quem
 * está ouvindo. A campanha existe para começar conversas, não para conduzi-las.
 */

export interface ResultadoSequencia {
  avaliados: number
  avancados: number
  encerrados: number
}

export async function avancarSequencias(): Promise<ResultadoSequencia> {
  const { data: campanhas } = await supabaseAdmin
    .from('campanhas')
    .select('id, nome, variantes')
    .in('status', ['agendada', 'executando'])

  const acc: ResultadoSequencia = { avaliados: 0, avancados: 0, encerrados: 0 }

  for (const c of campanhas ?? []) {
    const variantes = (c.variantes ?? []) as unknown as Variante[]
    // Campanha de um toque só não tem sequência para avançar — e perguntar isso
    // antes evita varrer os destinatários dela todo dia sem motivo.
    if (!variantes.some((v) => v.passo > 1)) continue

    const r = await avancarUma(c.id, c.nome, variantes)
    acc.avaliados += r.avaliados
    acc.avancados += r.avancados
    acc.encerrados += r.encerrados
  }

  logger.info(acc, 'Sequências de campanha avaliadas.')
  return acc
}

async function avancarUma(
  campanhaId: string,
  nome: string,
  variantes: readonly Variante[],
): Promise<ResultadoSequencia> {
  /*
   * Uma consulta traz o destinatário E os quatro sinais. Buscá-los um a um
   * transformaria o job diário em milhares de round-trips — e, pior, abriria a
   * janela para o quarto sinal ser esquecido no dia em que alguém mexer aqui.
   */
  const { rows } = await pool.query<{
    id: string
    contato_id: string | null
    passo: number
    enviada_em: string
    respondeu: boolean
    optout: boolean
    suprimido: boolean
    agente_assumiu: boolean
  }>(
    `select d.id, d.contato_id, d.passo, d.enviada_em,
            d.status = 'respondida' as respondeu,
            d.status = 'optout' as optout,
            exists (
              select 1 from supressao s
              where (s.expira_em is null or s.expira_em >= current_date)
                and (
                  (s.escopo = 'email' and s.valor = ct.email)
                  or (s.escopo in ('whatsapp', 'telefone') and s.valor in (ct.whatsapp, ct.telefone))
                )
            ) as suprimido,
            exists (
              select 1 from agente_decisoes ad
              where ad.conversa_id = d.conversa_id and ad.criado_em > d.enviada_em
            ) as agente_assumiu
     from campanha_destinatarios d
     left join contatos ct on ct.id = d.contato_id
     where d.campanha_id = $1
       and d.status in ('enviada', 'respondida', 'optout')
       and d.passo < 3
       and d.enviada_em is not null`,
    [campanhaId],
  )

  const acc: ResultadoSequencia = { avaliados: rows.length, avancados: 0, encerrados: 0 }

  for (const d of rows) {
    if (
      sequenciaCessouPara({
        respondeu: d.respondeu,
        optout: d.optout,
        suprimido: d.suprimido,
        agenteAssumiu: d.agente_assumiu,
      })
    ) {
      acc.encerrados += 1
      continue
    }

    const proximo = proximoPasso(variantes, d.passo, new Date(d.enviada_em))
    if (!proximo) continue
    // Ainda não chegou o dia. `dias_apos` conta do toque anterior, então "cedo"
    // aqui é literalmente cedo demais, não um erro.
    if (proximo.quando.getTime() > Date.now()) continue

    const variante = escolherVariante(variantes, proximo.passo, d.contato_id ?? d.id)
    if (!variante) continue

    /*
     * Volta para `pendente` no passo novo, e o EXECUTOR faz o resto. A alternativa
     * — enfileirar direto daqui — duplicaria a lógica de ritmo, de teto e de
     * escolha de conta num segundo lugar, e os dois divergiriam no primeiro ajuste.
     */
    const { error } = await supabaseAdmin
      .from('campanha_destinatarios')
      .update({
        passo: proximo.passo,
        variante_id: variante.id,
        status: 'pendente',
        agendada_para: null,
        enviada_em: null,
        comunicacao_id: null,
      })
      .eq('id', d.id)
      // Só `enviada` chega aqui: quem respondeu ou descadastrou já saiu pelo
      // `sequenciaCessouPara` acima. A condição no UPDATE é a trava contra a
      // corrida — se uma resposta chegou entre a leitura e a escrita, o trigger
      // do ledger já mudou o status e este update não acha mais a linha.
      .eq('status', 'enviada')

    if (error) {
      logger.error({ erro: error.message, destinatario: d.id }, 'Falha ao avançar sequência.')
      continue
    }
    acc.avancados += 1
  }

  if (acc.avancados > 0 || acc.encerrados > 0) {
    logger.info({ campanha: nome, ...acc }, 'Sequência avançada.')
  }
  return acc
}
