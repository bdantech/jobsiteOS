import { z } from 'zod'

/**
 * O CONTRATO do serviço de voz da OnePay — a Ana.
 *
 * Ela liga para o fornecedor, oferece a antecipação daquela nota e devolve o que
 * aconteceu. Nós mandamos um pedido; a fila é dela (uma ligação por vez, em
 * horário comercial) e o resultado volta por webhook assinado.
 *
 * Vive no core pelo mesmo motivo de `antecipacao-payload.ts`: é o formato de uma
 * API que não controlamos, e errar um nome de campo aqui não aparece em
 * typecheck — aparece como ligação que nunca sai, com HTTP 422.
 *
 * ── A REGRA QUE EXPLICA OS PORTÕES (voz/pedido.ts) ─────────────────────────
 * A Ana FALA estes números em voz alta, numa ligação gravada. O que ela disser é
 * o que a proposta escrita precisa confirmar dois dias depois. Por isso um campo
 * duvidoso não vira "estimativa" na ligação: vira ligação que não acontece.
 */

// ─── Config ─────────────────────────────────────────────────────────────────

export interface ConfigVoz {
  /** Desligada por padrão: a ligação é o canal mais caro de errar. */
  ligada: boolean
  /** Para tudo, sem apagar a fila. É a primeira recusa do portão. */
  kill_switch: boolean
  faixas: string[]
  /** Teto por rodada do gerador — a Ana liga uma por vez, não adianta encher. */
  maximo_por_rodada: number
  /** Quantas mandar para a fila dela a cada corrida do enviador. */
  maximo_por_envio: number
  /** Dias de validade da proposta que a Ana pode citar. */
  validade_dias: number
}

export const CONFIG_VOZ_PADRAO: ConfigVoz = {
  ligada: false,
  kill_switch: false,
  faixas: ['alta', 'boa'],
  maximo_por_rodada: 50,
  maximo_por_envio: 10,
  validade_dias: 3,
}

// ─── O que mandamos ─────────────────────────────────────────────────────────

export const contatoVozSchema = z.object({
  nome: z.string().min(1),
  cargo: z.string().nullable().optional(),
  /** E.164. É o que sai do enriquecimento (`normalizarTelefoneBr`), não o texto livre da ficha. */
  telefone_e164: z.string().regex(/^\+55\d{10,11}$/),
  email: z.string().nullable().optional(),
})

export const cedenteVozSchema = z.object({
  razao_social: z.string().min(1),
  nome_fantasia: z.string().nullable().optional(),
  cnpj: z.string().min(11),
  contato: contatoVozSchema,
})

export const sacadoVozSchema = z.object({
  razao_social: z.string().min(1),
  cnpj: z.string().min(11),
  prazo_medio_pagamento_dias: z.number().int().nullable().optional(),
  pontualidade_pct_12m: z.number().nullable().optional(),
})

export const recebivelVozSchema = z.object({
  nf_numero: z.string().min(1),
  nf_serie: z.string().nullable().optional(),
  data_emissao: z.string().nullable().optional(),
  data_vencimento: z.string(),
  prazo_dias: z.number().int(),
  valor_face: z.number(),
  taxa_am: z.number(),
  valor_desconto: z.number(),
  valor_iof: z.number(),
  valor_liquido: z.number(),
})

export const ofertaVozSchema = z.object({
  cedente: cedenteVozSchema,
  sacado: sacadoVozSchema,
  recebiveis: z.array(recebivelVozSchema).min(1),
  cadastro: z.object({ ativo: z.boolean(), pendencias: z.array(z.string()) }),
  resumo_oferta: z.object({
    qtd_notas: z.number().int().positive(),
    valor_face_total: z.number(),
    valor_liquido_total: z.number(),
    taxa_media_am: z.number(),
    validade_proposta: z.string(),
  }),
})

export const pedidoLigacaoSchema = z.object({
  /** A `access_key` da NF. É o que impede a mesma pessoa receber duas ligações. */
  id_externo: z.string().min(1),
  telefone: z.string().regex(/^\+55\d{10,11}$/),
  oferta: ofertaVozSchema,
})

export type ContatoVoz = z.infer<typeof contatoVozSchema>
export type OfertaVoz = z.infer<typeof ofertaVozSchema>
export type PedidoLigacao = z.infer<typeof pedidoLigacaoSchema>

// ─── O que a fila responde ──────────────────────────────────────────────────

export const STATUS_LIGACAO = [
  'na_fila',
  'discando',
  'em_curso',
  'concluida',
  'nao_atendida',
  'falhou',
  'cancelada',
] as const
export type StatusLigacao = (typeof STATUS_LIGACAO)[number]

/** Os três que geram resultado. `cancelada` morre sem ligação. */
export const STATUS_TERMINAIS = ['concluida', 'nao_atendida', 'falhou'] as const

export const respostaEnfileiramentoSchema = z.object({
  id: z.string(),
  id_externo: z.string(),
  telefone: z.string(),
  oferta_id: z.string(),
  status: z.enum(STATUS_LIGACAO),
  criada_em: z.string(),
  posicao_na_fila: z.number().int().nullable().optional(),
  ja_existia: z.boolean().optional(),
})
export type RespostaEnfileiramento = z.infer<typeof respostaEnfileiramentoSchema>

// ─── O que volta quando a ligação acaba ─────────────────────────────────────

export const DESFECHOS_LIGACAO = [
  'antecipacao_solicitada',
  'cadastro_iniciado',
  'proposta_enviada',
  'interesse_futuro',
  'retorno_agendado',
  'agendado_com_decisor',
  'quer_negociar',
  'transferido_humano',
  'pediu_para_nao_contatar',
  'recusa',
  'objecao_taxa',
  'nao_tem_interesse',
  'pessoa_errada',
  'caixa_postal',
  'nao_atendeu',
  'indefinido',
] as const
export type DesfechoLigacao = (typeof DESFECHOS_LIGACAO)[number]

/**
 * O único desfecho irreversível.
 *
 * Da recusa comercial se volta em 90 dias (é o que a `supressao.expira_em` já
 * faz). Deste não se volta: a pessoa pediu para não ser mais procurada, e ela
 * disse isso numa ligação gravada nossa.
 */
export const DESFECHO_QUE_SUPRIME: DesfechoLigacao = 'pediu_para_nao_contatar'

/**
 * O corpo do webhook. Campos desconhecidos passam de propósito: a Ana evolui e
 * um campo novo não pode derrubar a nossa ponta — quem precisa dele mapeia
 * depois, e enquanto isso o resultado continua entrando.
 */
export const resultadoLigacaoSchema = z.object({
  evento: z.literal('ligacao.encerrada'),
  ligacao_id: z.string(),
  id_externo: z.string(),
  status: z.enum(STATUS_LIGACAO),
  telefone: z.string(),
  oferta_id: z.string().nullable().optional(),
  criada_em: z.string().nullable().optional(),
  iniciada_em: z.string().nullable().optional(),
  encerrada_em: z.string().nullable().optional(),
  outcome: z.enum(DESFECHOS_LIGACAO).nullable().optional(),
  erro: z.string().nullable().optional(),
  chamada: z
    .object({
      call_id: z.string().optional(),
      resumo: z.string().nullable().optional(),
      proximo_passo: z.string().nullable().optional(),
      duracao_s: z.number().nullable().optional(),
      atendida: z.boolean().optional(),
      identidade_verificada: z.boolean().optional(),
      falou_com_decisor: z.boolean().optional(),
      valor_negociado: z.number().nullable().optional(),
      objecoes: z.array(z.record(z.string(), z.unknown())).optional(),
      decisor: z.record(z.string(), z.unknown()).nullable().optional(),
      nao_contatar: z
        .object({ escopo: z.string().optional(), literal: z.string().optional() })
        .nullable()
        .optional(),
      transcricao: z.array(z.record(z.string(), z.unknown())).optional(),
      roteiro: z.record(z.string(), z.unknown()).optional(),
    })
    .nullable()
    .optional(),
})
export type ResultadoLigacao = z.infer<typeof resultadoLigacaoSchema>

/**
 * O desfecho vira estado no funil? Só estes três fecham a nota; o resto é
 * conversa em aberto, e quem decide o próximo toque é a cadência de sempre.
 */
export const DESFECHOS_DE_FECHAMENTO: readonly DesfechoLigacao[] = [
  'antecipacao_solicitada',
  'cadastro_iniciado',
  'proposta_enviada',
]
