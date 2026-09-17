import { DESFECHOS_DE_FECHAMENTO, type DesfechoLigacao, type PedidoLigacao } from './schemas.js'

/**
 * O portão da LIGAÇÃO, e o construtor do pedido que vai para a fila da Ana.
 *
 * ── POR QUE UM PORTÃO PRÓPRIO, SE JÁ EXISTE O DA COMUNICAÇÃO ───────────────
 * O de `comunicacao/portao.ts` decide se PODEMOS falar com a pessoa — supressão,
 * base legal, cooldown, janela. Tudo isso continua valendo e é checado lá; uma
 * ligação é uma comunicação de saída como qualquer outra.
 *
 * Este aqui decide algo que só existe na voz: se o que temos para DIZER está de
 * pé. A Ana fala o líquido, a taxa e a data de vencimento em voz alta, numa
 * ligação gravada, e a proposta escrita chega depois. Um número "estimado" numa
 * tela é uma estimativa; o mesmo número dito ao telefone é uma promessa.
 *
 * Por isso a regra é dura: dado duvidoso não vira ligação com ressalva — vira
 * ligação que não acontece. O motivo volta para quem chamou, e aparece na tela
 * como "por que esta nota não foi ligada".
 *
 * A ordem das recusas é a mesma ideia do outro portão: da mais permanente para
 * a mais temporária. Quem está no Procon nunca vai ser ligado; a nota sem IOF
 * calculado passa a poder no dia em que a conta existir.
 */

export type MotivoNaoLigar =
  | 'kill_switch'
  | 'suprimido'
  | 'sem_contato'
  | 'sem_base_legal'
  | 'no_procon'
  | 'telefone_invalido'
  | 'nota_cancelada'
  | 'nao_operavel'
  | 'sem_vencimento'
  | 'vencimento_estimado'
  | 'vencida'
  | 'sem_taxa'
  | 'taxa_padrao'
  | 'sem_desconto'
  | 'sem_liquido'
  | 'sem_numero_da_nota'

export const MOTIVO_NAO_LIGAR_LABELS: Record<MotivoNaoLigar, string> = {
  kill_switch: 'Disparos desligados',
  suprimido: 'A pessoa pediu para não ser procurada',
  sem_contato: 'Sem contato com telefone',
  sem_base_legal: 'Contato sem base legal',
  no_procon: 'Número na lista do Procon',
  telefone_invalido: 'Telefone fora do formato E.164',
  nota_cancelada: 'Nota cancelada',
  nao_operavel: 'Nota não operável',
  sem_vencimento: 'Nota sem vencimento',
  vencimento_estimado: 'Vencimento estimado, não confirmado',
  vencida: 'Nota já vencida',
  sem_taxa: 'Sem taxa para a operação',
  taxa_padrao: 'Taxa padrão, sem análise do sacado',
  sem_desconto: 'Sem o deságio calculado',
  sem_liquido: 'Sem o líquido a receber',
  sem_numero_da_nota: 'Nota sem número',
}

export interface ContatoDaLigacao {
  nome: string | null
  cargo?: string | null
  /** E.164, como sai do enriquecimento. O texto livre da ficha não serve. */
  telefone_e164: string | null
  email?: string | null
  base_legal?: string | null
  /** O provedor marca `PROCON`. Ligar para quem está na lista é risco jurídico. */
  no_procon?: boolean
}

export interface NotaDaLigacao {
  access_key: string
  numero: string | null
  serie?: string | null
  emitida_em?: string | null
  vencimento: string | null
  vencimento_origem?: 'xml' | 'endpoint' | 'estimado' | null
  valor: number
  /** `taxa_usada` — a mensal do snapshot do sacado. */
  taxa_am: number | null
  /** true quando a taxa caiu no default do `antecipacao_config`. */
  taxa_padrao?: boolean
  /** `receita_esperada`: o deságio, visto do lado do fornecedor. */
  valor_desconto: number | null
  /**
   * A operação é CESSÃO de recebível, não empréstimo: não há IOF (confirmado
   * com a OnePay em 17/09/2026). O campo fica opcional e zero porque um dia
   * pode existir operação que tenha — e, com zero, a Ana não menciona IOF em
   * nenhum momento: ela não fala de imposto que não existe.
   *
   * Consequência boa: `valor_liquido = valor − receita_esperada`, que é
   * exatamente o que `valorLiquidoEstimado` já calcula. O deságio é o custo
   * inteiro.
   */
  valor_iof?: number | null
  valor_liquido: number | null
  status_sync?: string | null
  cancelada?: boolean
  /** `notas_funil.operavel`: a régua de natureza de operação já disse que não. */
  operavel?: boolean | null
}

export interface FatosDaLigacao {
  killSwitch: boolean
  suprimido: boolean
  contato: ContatoDaLigacao | null
  nota: NotaDaLigacao
  fornecedor: { razao_social: string; nome_fantasia?: string | null; cnpj: string }
  sacado: {
    razao_social: string
    cnpj: string
    prazo_medio_pagamento_dias?: number | null
    pontualidade_pct_12m?: number | null
  }
  cadastro: { ativo: boolean; pendencias: string[] }
  /** Até quando a condição vale. A Ana usa isso uma vez, e só se a pessoa hesitar. */
  validade_proposta: string
  agora: Date
}

export type VeredictoLigacao = { pode: true } | { pode: false; motivo: MotivoNaoLigar }

const E164_BR = /^\+55\d{10,11}$/

/** Dias entre duas datas em UTC, sem hora — o vencimento é dia, não instante. */
export function diasAteOVencimento(vencimento: string, agora: Date): number {
  const alvo = Date.parse(`${vencimento.slice(0, 10)}T12:00:00Z`)
  const hoje = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), 12)
  return Math.round((alvo - hoje) / 86_400_000)
}

export function podeLigar(fatos: FatosDaLigacao): VeredictoLigacao {
  if (fatos.killSwitch) return { pode: false, motivo: 'kill_switch' }
  if (fatos.suprimido) return { pode: false, motivo: 'suprimido' }

  const contato = fatos.contato
  if (!contato || !contato.nome || !contato.telefone_e164) {
    return { pode: false, motivo: 'sem_contato' }
  }
  // Contato sem base legal nasce mudo — a mesma regra do portão da comunicação.
  if (!contato.base_legal) return { pode: false, motivo: 'sem_base_legal' }
  if (contato.no_procon) return { pode: false, motivo: 'no_procon' }
  if (!E164_BR.test(contato.telefone_e164)) return { pode: false, motivo: 'telefone_invalido' }

  const nota = fatos.nota
  if (nota.cancelada) return { pode: false, motivo: 'nota_cancelada' }
  // A régua de operabilidade já decidiu isto antes de nós (`nao_operavel_motivo`).
  if (nota.operavel === false) return { pode: false, motivo: 'nao_operavel' }
  if (!nota.numero) return { pode: false, motivo: 'sem_numero_da_nota' }
  if (!nota.vencimento) return { pode: false, motivo: 'sem_vencimento' }
  // A Ana diz a data em voz alta. Se ela foi estimada, o cliente sabe que está
  // errada antes de a frase acabar — e a conversa morre ali.
  if (nota.vencimento_origem === 'estimado') return { pode: false, motivo: 'vencimento_estimado' }
  if (diasAteOVencimento(nota.vencimento, fatos.agora) <= 0) return { pode: false, motivo: 'vencida' }

  if (nota.taxa_am === null || nota.taxa_am <= 0) return { pode: false, motivo: 'sem_taxa' }
  // Taxa do default é chute bom para ordenar o funil e ruim para dizer ao cliente.
  if (nota.taxa_padrao) return { pode: false, motivo: 'taxa_padrao' }
  if (nota.valor_desconto === null) return { pode: false, motivo: 'sem_desconto' }
  if (nota.valor_liquido === null) return { pode: false, motivo: 'sem_liquido' }

  return { pode: true }
}

export type ResultadoMontagem =
  | { ok: true; pedido: PedidoLigacao }
  | { ok: false; motivo: MotivoNaoLigar }

/**
 * O pedido que vai para `POST /api/ligacoes` da Ana.
 *
 * `id_externo` é a `access_key` da NF: chave estável e única. Reenviar o mesmo
 * pedido — por retry, por clique duplo, por job que rodou duas vezes — devolve a
 * ligação que já existe em vez de fazer a pessoa atender duas vezes.
 */
export function montarPedidoDeLigacao(fatos: FatosDaLigacao): ResultadoMontagem {
  const veredicto = podeLigar(fatos)
  if (!veredicto.pode) return { ok: false, motivo: veredicto.motivo }

  const { nota, contato } = fatos
  const prazo = diasAteOVencimento(nota.vencimento as string, fatos.agora)

  return {
    ok: true,
    pedido: {
      id_externo: nota.access_key,
      telefone: contato!.telefone_e164 as string,
      oferta: {
        cedente: {
          razao_social: fatos.fornecedor.razao_social,
          nome_fantasia: fatos.fornecedor.nome_fantasia ?? null,
          cnpj: fatos.fornecedor.cnpj,
          contato: {
            nome: contato!.nome as string,
            cargo: contato!.cargo ?? null,
            telefone_e164: contato!.telefone_e164 as string,
            email: contato!.email ?? null,
          },
        },
        sacado: {
          razao_social: fatos.sacado.razao_social,
          cnpj: fatos.sacado.cnpj,
          prazo_medio_pagamento_dias: fatos.sacado.prazo_medio_pagamento_dias ?? null,
          pontualidade_pct_12m: fatos.sacado.pontualidade_pct_12m ?? null,
        },
        recebiveis: [
          {
            nf_numero: nota.numero as string,
            nf_serie: nota.serie ?? null,
            data_emissao: nota.emitida_em ? nota.emitida_em.slice(0, 10) : null,
            data_vencimento: (nota.vencimento as string).slice(0, 10),
            prazo_dias: prazo,
            valor_face: nota.valor,
            taxa_am: nota.taxa_am as number,
            valor_desconto: nota.valor_desconto as number,
            valor_iof: nota.valor_iof ?? 0,
            valor_liquido: nota.valor_liquido as number,
          },
        ],
        cadastro: { ativo: fatos.cadastro.ativo, pendencias: fatos.cadastro.pendencias },
        resumo_oferta: {
          qtd_notas: 1,
          valor_face_total: nota.valor,
          valor_liquido_total: nota.valor_liquido as number,
          taxa_media_am: nota.taxa_am as number,
          validade_proposta: fatos.validade_proposta.slice(0, 10),
        },
      },
    },
  }
}

/**
 * O que o desfecho manda fazer do nosso lado. Fechado de propósito: um desfecho
 * novo da Ana cai em `nada` e aparece na tela, em vez de virar ação silenciosa.
 */
export type AcaoPosLigacao = 'suprimir' | 'fechar_nota' | 'reagendar' | 'higienizar_contato' | 'nada'

export function acaoDoDesfecho(outcome: DesfechoLigacao | null | undefined): AcaoPosLigacao {
  if (!outcome) return 'nada'
  if (outcome === 'pediu_para_nao_contatar') return 'suprimir'
  if (DESFECHOS_DE_FECHAMENTO.includes(outcome)) return 'fechar_nota'
  if (outcome === 'pessoa_errada') return 'higienizar_contato'
  if (outcome === 'retorno_agendado' || outcome === 'agendado_com_decisor') return 'reagendar'
  return 'nada'
}
