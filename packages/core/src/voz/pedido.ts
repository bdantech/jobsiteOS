import { calcularReceitaEsperada, valorLiquidoEstimado } from '../antecipacao/economia.js'
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
  | 'sem_tac'
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
  taxa_padrao: 'Sem análise de crédito do sacado nem da empresa-mãe',
  sem_tac: 'Sem a TAC calculada',
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
  /**
   * A taxa mensal que a Ana DIZ — `taxa_analise_am`, da análise de crédito da
   * plataforma, e não `taxa_usada`.
   *
   * As duas são a mesma coisa na maioria das notas, e diferentes justamente onde
   * importa: `taxa_usada` cai no default da config quando o sacado não tem
   * análise, porque para ORDENAR o funil um chute bom serve. Dita ao telefone,
   * ela deixa de ordenar e vira condição.
   */
  taxa_am: number | null
  /**
   * De quem é a análise: do próprio sacado, ou da empresa-mãe quando ele é SPE
   * ou filial. Nula quando não existe nenhuma — e aí não há ligação.
   */
  taxa_origem?: 'sacado' | 'holding' | null
  /** O deságio — o juros do prazo, recalculado com a taxa que a Ana vai dizer. */
  valor_desconto: number | null
  /** A TAC do sacado (`tac_estimada`). É tarifa: não anda com o prazo. */
  valor_tac?: number | null
  /** O seguro por nota (`seguro_estimado`). R$ 125 desde 15/09/2026. */
  valor_seguro?: number | null
  /**
   * A operação é CESSÃO de recebível, não empréstimo: não há IOF (confirmado
   * com a OnePay em 17/09/2026). O campo fica opcional e zero porque um dia
   * pode existir operação que tenha — e, com zero, a Ana não menciona IOF em
   * nenhum momento: ela não fala de imposto que não existe.
   */
  valor_iof?: number | null
  /**
   * O que o fornecedor recebe: valor − deságio − TAC − seguro.
   *
   * A conta era `valor − deságio` até a 0221 mostrar que faltavam a TAC e os
   * R$ 125 de seguro — nas notas que esta tela oferece, R$ 282 a mais em média e
   * até R$ 573. Errar esse número para cima numa ligação gravada é prometer o
   * que a plataforma não deposita.
   */
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

  // Sem análise do sacado NEM da empresa-mãe, a única taxa que existe é o default
  // da config — chute bom para ordenar o funil e condição de ninguém ao telefone.
  if (nota.taxa_am === null || !nota.taxa_origem) return { pode: false, motivo: 'taxa_padrao' }
  // Análise existe mas traz taxa zerada ou negativa: é dado quebrado, não oferta.
  if (nota.taxa_am <= 0) return { pode: false, motivo: 'sem_taxa' }
  // A TAC entra no líquido desde a 0221. Nula, ela sairia como zero e o líquido
  // voltaria a ser dito alto — que é exatamente o erro que a 0221 corrigiu.
  if (nota.valor_tac === null || nota.valor_tac === undefined) {
    return { pode: false, motivo: 'sem_tac' }
  }
  if (nota.valor_desconto === null) return { pode: false, motivo: 'sem_desconto' }
  if (nota.valor_liquido === null) return { pode: false, motivo: 'sem_liquido' }

  return { pode: true }
}

/**
 * Uma linha de `notas_funil`, no pouco que a ligação precisa.
 *
 * Existe para o cron e a TELA não divergirem: as duas montam os mesmos fatos a
 * partir da mesma view. Divergirem significaria a tela dizer "dá para ligar" e
 * o job recusar de noite, sem ninguém entender por quê.
 */
export interface NotaDoFunil {
  access_key: string
  numero: string | null
  serie?: string | null
  emitida_em?: string | null
  vencimento: string | null
  vencimento_origem?: string | null
  valor: number | string
  taxa_usada: number | string | null
  /** A taxa da análise de crédito (0225). É esta que a Ana diz, não a `taxa_usada`. */
  taxa_analise_am?: number | string | null
  /** `sacado` ou `holding` — de quem é a análise que precificou. */
  taxa_analise_origem?: string | null
  receita_esperada: number | string | null
  tac_estimada?: number | string | null
  seguro_estimado?: number | string | null
  status_sync?: string | null
  operavel?: boolean | null
  fornecedor_cnpj: string
  fornecedor_nome?: string | null
  fornecedor_cadastrado?: boolean | null
  fornecedor_suprimido?: boolean | null
  sacado_cnpj: string
  sacado_nome?: string | null
  sacado_razao_social?: string | null
}

const numero = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function fatosDaNotaDoFunil(
  nota: NotaDoFunil,
  contato: ContatoDaLigacao | null,
  opcoes: { killSwitch?: boolean; suprimido?: boolean; validadeDias?: number; agora?: Date } = {},
): FatosDaLigacao {
  const agora = opcoes.agora ?? new Date()
  const valor = numero(nota.valor) ?? 0
  const tac = numero(nota.tac_estimada)
  const seguro = numero(nota.seguro_estimado)

  /*
   * O DESÁGIO É RECALCULADO, E NÃO LIDO DA VIEW.
   *
   * `receita_esperada` foi calculada com `taxa_usada`, que pode ser o default da
   * config. Se a Ana dissesse a taxa da análise e o deságio da view, ela falaria
   * dois números que não fecham entre si — e quem está do outro lado tem
   * calculadora. Uma taxa, uma conta: a mesma `calcularReceitaEsperada` que
   * gravou a da nota, agora com a taxa que será dita.
   *
   * Na maioria das notas os dois números são o mesmo, porque a análise é
   * justamente a fonte de `taxa_usada` quando ela existe.
   */
  const taxa = numero(nota.taxa_analise_am)
  const origem = nota.taxa_analise_origem === 'holding' ? 'holding' : nota.taxa_analise_origem === 'sacado' ? 'sacado' : null
  const dias = nota.vencimento ? diasAteOVencimento(nota.vencimento, agora) : null
  const desagio =
    taxa === null || taxa <= 0
      ? null
      : calcularReceitaEsperada({ valor, diasParaVencimento: dias, taxaMensal: taxa }).receita

  return {
    killSwitch: Boolean(opcoes.killSwitch),
    suprimido: Boolean(opcoes.suprimido) || Boolean(nota.fornecedor_suprimido),
    contato,
    nota: {
      access_key: nota.access_key,
      numero: nota.numero,
      serie: nota.serie ?? null,
      emitida_em: nota.emitida_em ?? null,
      vencimento: nota.vencimento,
      vencimento_origem: (nota.vencimento_origem ?? null) as NotaDaLigacao['vencimento_origem'],
      valor,
      taxa_am: taxa,
      taxa_origem: origem,
      valor_desconto: desagio,
      valor_tac: tac,
      valor_seguro: seguro,
      // Cessão de recebível não tem IOF: o deságio, a TAC e o seguro são o custo.
      valor_iof: 0,
      // A mesma conta da tela e do mobile, num lugar só (0221).
      valor_liquido: valorLiquidoEstimado({
        valor,
        receitaEsperada: desagio,
        tac,
        seguro,
      }),
      cancelada: (nota.status_sync ?? '').toLowerCase().includes('cancel'),
      operavel: nota.operavel ?? null,
    },
    fornecedor: { razao_social: nota.fornecedor_nome ?? '', cnpj: nota.fornecedor_cnpj },
    sacado: {
      razao_social: nota.sacado_razao_social ?? nota.sacado_nome ?? '',
      cnpj: nota.sacado_cnpj,
    },
    cadastro: { ativo: Boolean(nota.fornecedor_cadastrado), pendencias: [] },
    validade_proposta: new Date(agora.getTime() + (opcoes.validadeDias ?? 3) * 86_400_000)
      .toISOString()
      .slice(0, 10),
    agora,
  }
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
            // A TAC e o seguro vão EXPLÍCITOS: sem eles o líquido não fecha com o
            // resto da conta, e a primeira pergunta de quem está do outro lado
            // com uma calculadora é exatamente essa diferença.
            valor_tac: nota.valor_tac ?? 0,
            valor_seguro: nota.valor_seguro ?? 0,
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
