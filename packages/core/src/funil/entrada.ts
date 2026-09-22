import type { ConfigFunilOportunidades } from './schemas.js'

/**
 * O QUE ENTRA NO FUNIL (§7) — e, mais importante, o que NÃO entra.
 *
 * Um funil que aceita tudo não é um funil: é uma lista. Cada estado aqui foi
 * decidido por uma pergunta só — "existe trabalho de originador nisto hoje?" —, e
 * a resposta "não" tem três sabores diferentes que o código precisa distinguir:
 *
 *   JÁ CONVERTEU   (`ANTICIPATION_REQUESTED`) — o trabalho deu certo e acabou.
 *   ACABOU SEM NÓS (`paid_in_erp`)            — o dinheiro estava lá e passou.
 *                                               Vira MÉTRICA DE PERDA, não card.
 *   NÃO HÁ O QUE FAZER (`not_eligible` por trava de limite) — pôr no funil é
 *                                               encher a fila com trabalho que não
 *                                               é trabalho, e o custo disso é o
 *                                               originador deixar de confiar na fila.
 *
 * As três saem do funil pela mesma porta e por razões opostas. Por isso a função
 * devolve o MOTIVO junto do veredito: é ele que alimenta o bloco de perdas e o que
 * responde "por que este item sumiu?" sem obrigar ninguém a reler esta regra.
 */

export type ForaDoFunil =
  | 'ja_converteu'
  | 'fora_da_janela_de_recuperacao'
  | 'pago_no_erp'
  | 'removido_no_erp'
  | 'guard_reason_nao_recuperavel'
  | 'estado_desconhecido'

export type VereditoEntrada = { entra: true } | { entra: false; motivo: ForaDoFunil }

const ENTRA: VereditoEntrada = { entra: true }
const NAO = (motivo: ForaDoFunil): VereditoEntrada => ({ entra: false, motivo })

/** Dias corridos entre duas datas `YYYY-MM-DD`, ou null quando falta uma. */
function diasDesde(referencia: string | null, hoje: Date): number | null {
  if (!referencia) return null
  const d = new Date(`${referencia.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  const base = new Date(
    Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()),
  ).getTime()
  return Math.round((base - d.getTime()) / 86_400_000)
}

export function preAutorizacaoEntraNoFunil(
  pre: {
    status: string
    expira_em: string | null
    criada_em: string | null
  },
  cfg: Pick<ConfigFunilOportunidades, 'recuperacao_dias'>,
  hoje: Date = new Date(),
): VereditoEntrada {
  switch (pre.status) {
    /*
     * Prioridade máxima, e sem condição nenhuma: a construtora já ofereceu, o
     * crédito já existe e o fornecedor só não clicou. Nem sequer se pergunta pelo
     * relógio aqui — uma oferta que expira hoje é a mais urgente de todas, não a
     * menos elegível.
     */
    case 'WAITING_CONTRACTED':
      return ENTRA

    // Deu certo. O card virou operação e a operação tem tela própria.
    case 'ANTICIPATION_REQUESTED':
      return NAO('ja_converteu')

    /*
     * A janela de RECUPERAÇÃO. Uma oferta que expirou ontem ainda é um telefonema
     * — o fornecedor quase sempre não viu, e a construtora costuma reofertar. Uma
     * que expirou há dois meses é arqueologia, e mantê-la no funil rouba a atenção
     * do que ainda está vivo.
     */
    case 'EXPIRED':
    case 'REVOKED':
    case 'AUTOMATICALLY_REVOKED': {
      const dias = diasDesde(pre.expira_em ?? pre.criada_em, hoje)
      if (dias === null) return ENTRA
      return dias <= cfg.recuperacao_dias ? ENTRA : NAO('fora_da_janela_de_recuperacao')
    }

    /*
     * Estado que a API passou a devolver e nós ainda não conhecemos. ENTRA, de
     * propósito: um estado novo escondido é uma classe inteira de oportunidade
     * sumindo em silêncio, que é o defeito de 13/09. Visível e estranho é melhor
     * que invisível e errado — e o rótulo cru no card é o que faz alguém perguntar.
     */
    default:
      return ENTRA
  }
}

export function tituloEntraNoFunil(
  titulo: { situation: string; guard_reason: string | null },
  cfg: Pick<ConfigFunilOportunidades, 'guard_reasons_recuperaveis'>,
): VereditoEntrada {
  switch (titulo.situation) {
    case 'ready_to_create':
    case 'awaiting_evaluation':
    case 'held_by_client_filter':
      return ENTRA

    /*
     * `offer_created` ENTRA, e entra como ORIGINAL com o selo de pré-autorização.
     *
     * A tentação é tirá-la (já virou oferta, a pré-auth cuida dela). Mas a oferta
     * pendurada é justamente o card mais quente que existe, e quem a trabalha
     * precisa ver a PARCELA — valor, vencimento, número do documento — e não só a
     * oferta. O selo é o que amarra as duas leituras num card só.
     */
    case 'offer_created':
      return ENTRA

    /*
     * `not_eligible` só com motivo RECUPERÁVEL, que é a forma de dizer "só quando
     * existe um originador capaz de destravar isto". `SUPPLIER_CNPJ_MISSING` é
     * literalmente cadastrar o fornecedor; uma trava de limite da construtora não
     * é trabalho de ninguém nesta tela.
     */
    case 'not_eligible':
      return titulo.guard_reason && cfg.guard_reasons_recuperaveis.includes(titulo.guard_reason)
        ? ENTRA
        : NAO('guard_reason_nao_recuperavel')

    // Perdemos para o caixa da construtora. Métrica, nunca card (§9).
    case 'paid_in_erp':
      return NAO('pago_no_erp')

    /*
     * `removed_in_erp` VENCE AS DEMAIS SITUAÇÕES, e vem antes de qualquer leitura
     * do `anticipation` — que continua preenchido como histórico da operação
     * cancelada. Ler o `anticipation` primeiro faria uma parcela removida parecer
     * convertida, e ela apareceria no relatório como receita que não existe.
     */
    case 'removed_in_erp':
      return NAO('removido_no_erp')

    default:
      return ENTRA
  }
}
