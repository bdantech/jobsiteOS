import { z } from 'zod'

/**
 * As duas fontes novas do funil (04s) — pré-autorizações e parcelas do Sienge.
 *
 * ── O PRINCÍPIO QUE GOVERNA O ARQUIVO INTEIRO ───────────────────────────────
 * As listas não se misturam no banco, só na tela. Três tabelas independentes,
 * cada uma espelhando fielmente a sua fonte; a união existe apenas na projeção
 * de leitura. Por isso aqui não há um "status unificado": cada fonte guarda o
 * vocabulário DELA, e a tradução para o card acontece no fim, uma vez.
 *
 * Um enum unificado seria mais curto e mentiria: `EXPIRED` de uma pré-autorização
 * (a construtora ofereceu e o prazo acabou) e `paid_in_erp` de uma parcela (a
 * construtora pagou por fora) são os dois "perdemos", e são perdas de naturezas
 * opostas — uma é relógio, a outra é concorrência. Somá-las num rótulo só apaga
 * exatamente a informação que a métrica de perda (§9) existe para mostrar.
 */

// ─── Tipos de oportunidade ──────────────────────────────────────────────────

export const TIPOS_OPORTUNIDADE = ['nf', 'pre_autorizacao', 'titulo'] as const
export const tipoOportunidadeSchema = z.enum(TIPOS_OPORTUNIDADE)
export type TipoOportunidade = z.infer<typeof tipoOportunidadeSchema>

/** O selo do card. Curto porque divide a linha de chips com o número e a tipagem. */
export const TIPO_OPORTUNIDADE_LABELS: Record<TipoOportunidade, string> = {
  nf: 'NF',
  pre_autorizacao: 'Pré-aut.',
  titulo: 'Título',
}

export const TIPO_OPORTUNIDADE_DESCRICOES: Record<TipoOportunidade, string> = {
  nf: 'Nota fiscal capturada pelo certificado digital do fornecedor.',
  pre_autorizacao: 'Oferta de antecipação que a construtora já fez ao fornecedor.',
  titulo: 'Parcela de título do ERP da construtora, lida pela conexão Sienge.',
}

// ─── Pré-autorizações ───────────────────────────────────────────────────────

/**
 * `WAITING_CONTRACTED` É O SINAL MAIS QUENTE DO SISTEMA INTEIRO.
 *
 * A construtora já ofereceu, o crédito já existe, o dinheiro já está reservado —
 * e o fornecedor só não clicou. Não há nada a convencer: há alguém a lembrar. E
 * tem RELÓGIO (`expiresAt`, tipicamente poucos dias), que é o que separa este
 * estado de todos os outros do funil: um card de NF que ninguém tocou hoje
 * continua lá amanhã; uma pré-autorização que ninguém tocou hoje pode não existir.
 */
export const STATUS_PRE_AUTORIZACAO = [
  'WAITING_CONTRACTED',
  'ANTICIPATION_REQUESTED',
  'EXPIRED',
  'REVOKED',
  'AUTOMATICALLY_REVOKED',
] as const
export type StatusPreAutorizacao = (typeof STATUS_PRE_AUTORIZACAO)[number]

export const STATUS_PRE_AUTORIZACAO_LABELS: Record<string, string> = {
  WAITING_CONTRACTED: 'Aguardando o fornecedor',
  ANTICIPATION_REQUESTED: 'Antecipação solicitada',
  EXPIRED: 'Expirada',
  REVOKED: 'Revogada',
  AUTOMATICALLY_REVOKED: 'Revogada automaticamente',
}

/**
 * De onde veio a oferta. `sienge` só existe em pré-autorizações PÓS-migração
 * (`migrated: false`); as que vieram por integração antiga saem como
 * `integration`, e é por isso que a origem não serve como proxy de "tem título
 * do outro lado" — quem responde isso é o `sienge.billId`.
 */
export const ORIGENS_PRE_AUTORIZACAO = [
  'nfe',
  'sienge',
  'integration',
  'manual',
  'file',
  'lite',
] as const
export type OrigemPreAutorizacao = (typeof ORIGENS_PRE_AUTORIZACAO)[number]

export const ORIGEM_PRE_AUTORIZACAO_LABELS: Record<string, string> = {
  nfe: 'NF-e',
  sienge: 'Sienge',
  integration: 'Integração',
  manual: 'Manual',
  file: 'Arquivo',
  lite: 'Lite',
}

// ─── Títulos Sienge ─────────────────────────────────────────────────────────

/**
 * A situação da PARCELA, no vocabulário do ERP.
 *
 * `removed_in_erp` VENCE AS DEMAIS e mantém `anticipation` preenchido como
 * histórico da operação cancelada — ler o `anticipation` sem olhar a situação faz
 * uma parcela removida parecer convertida.
 */
export const SITUACOES_TITULO = [
  'ready_to_create',
  'awaiting_evaluation',
  'held_by_client_filter',
  'not_eligible',
  'offer_created',
  'paid_in_erp',
  'removed_in_erp',
] as const
export type SituacaoTitulo = (typeof SITUACOES_TITULO)[number]

export const SITUACAO_TITULO_LABELS: Record<string, string> = {
  ready_to_create: 'Pronta para ofertar',
  awaiting_evaluation: 'Aguardando avaliação',
  held_by_client_filter: 'Retida por filtro do cliente',
  not_eligible: 'Não elegível',
  offer_created: 'Oferta criada',
  paid_in_erp: 'Paga no ERP',
  removed_in_erp: 'Removida no ERP',
}

/**
 * Os `guardReason` que um ORIGINADOR resolve — e é isso que os separa do resto.
 *
 * `SUPPLIER_CNPJ_MISSING` é trabalho de originador: basta cadastrar o fornecedor
 * e a parcela passa a ser ofertável. `SUPPLIER_NOT_REGISTERED` é o mesmo caso com
 * outro nome do lado deles. Uma trava de limite ou de política do cliente, não:
 * ali não há o que um vendedor faça, e pôr no funil é encher a fila de trabalho
 * que não é trabalho.
 *
 * É lista de CONFIG, e não constante, porque o vocabulário é deles: um motivo
 * novo aparece sem aviso, e descobrir isso não pode exigir deploy.
 */
export const GUARD_REASONS_RECUPERAVEIS_PADRAO = [
  'SUPPLIER_CNPJ_MISSING',
  'SUPPLIER_NOT_REGISTERED',
  /*
   * O motivo REAL, descoberto no primeiro sync de títulos (22/09/2026).
   *
   * O Prompt citava `SUPPLIER_CNPJ_MISSING` como exemplo, e ele existe — em UM
   * caso, que é um credor pessoa física e portanto NÃO tem conserto (pessoa física
   * não tem CNPJ para cadastrar). O que aparece de verdade é
   * `SUPPLIER_CONTACT_MISSING`: 26 parcelas, R$ 277 mil, 21 credores distintos,
   * todos com CNPJ. Falta o CONTATO do fornecedor — que é exatamente o trabalho do
   * originador, e exatamente o que a aba Fornecedor do card existe para resolver.
   */
  'SUPPLIER_CONTACT_MISSING',
] as const

/**
 * Os motivos REAIS, lidos do primeiro sync (22/09/2026). Os três primeiros são
 * trabalho de originador; o resto não tem conserto do nosso lado — é o dado da
 * construtora, o calendário ou o tamanho da parcela.
 */
export const GUARD_REASON_LABELS: Record<string, string> = {
  SUPPLIER_CONTACT_MISSING: 'Fornecedor sem contato cadastrado',
  SUPPLIER_CNPJ_MISSING: 'Fornecedor sem CNPJ no ERP',
  SUPPLIER_NOT_REGISTERED: 'Fornecedor sem cadastro na plataforma',
  BILL_NOT_CONSISTENT: 'Título inconsistente no ERP da construtora',
  BASE_BELOW_MIN: 'Valor abaixo do mínimo operável',
  DUE_DATE_TOO_SOON: 'Vencimento perto demais',
  DUE_DATE_TOO_FAR: 'Vencimento longe demais',
  INSTALLMENT_PAID: 'Parcela já paga no ERP',
  INSTALLMENT_REMOVED: 'Parcela removida no ERP',
  CREDIT_LIMIT_EXCEEDED: 'Limite de crédito da construtora estourado',
  CLIENT_FILTER: 'Filtro da construtora',
}

// ─── Config ─────────────────────────────────────────────────────────────────

/**
 * QUEM GANHA QUANDO O MESMO RECEBÍVEL CHEGA PELOS DOIS CAMINHOS.
 *
 * A NF vem pelo certificado do fornecedor; a parcela vem pela conexão Sienge da
 * construtora. São o mesmo dinheiro visto de dois lados, e mostrar os dois é
 * mostrar trabalho dobrado.
 *
 * O default é `titulo`, e a razão é operacional: a PARCELA é a unidade que vira
 * oferta e é antecipada. Uma NF de R$ 55 mil com três parcelas, exibida inteira,
 * esconde que só uma delas está disponível agora — e o originador liga oferecendo
 * um valor que não existe.
 */
export const PRIORIDADES_NF_VS_TITULO = ['titulo', 'nf'] as const
export type PrioridadeNfVsTitulo = (typeof PRIORIDADES_NF_VS_TITULO)[number]

export const configFunilOportunidadesSchema = z.object({
  prioridade_nf_vs_titulo: z.enum(PRIORIDADES_NF_VS_TITULO).default('titulo'),
  /** Janela de recuperação das pré-autorizações mortas (expirada/revogada). */
  recuperacao_dias: z.number().int().min(0).max(180).default(15),
  /** Só estes `guardReason` fazem uma parcela `not_eligible` entrar no funil. */
  guard_reasons_recuperaveis: z.array(z.string()).default([...GUARD_REASONS_RECUPERAVEIS_PADRAO]),
  /** D-2: quando a pré-autorização passa a gritar. */
  aviso_expiracao_dias: z.number().int().min(1).max(10).default(2),
  /** Janela curta do ciclo de 4h, sobre a data de ENTRADA. */
  janela_novidade_dias: z.number().int().min(1).max(30).default(7),
  /**
   * Varredura diária de ESTADO dos TÍTULOS. Teto do endpoint: 92 dias, e aqui o
   * teto é o número certo — uma parcela vive até o vencimento dela, que pode estar
   * noventa dias à frente, e ela pode sair de `ready_to_create` para
   * `offer_created` no dia sessenta. Encurtar isto é deixar de ver a parcela
   * virar oferta.
   */
  janela_estado_dias: z.number().int().min(1).max(92).default(92),
  /**
   * Varredura diária de ESTADO das PRÉ-AUTORIZAÇÕES — e ela é MUITO mais curta,
   * de propósito.
   *
   * Uma oferta tem relógio de poucos dias: ou o fornecedor aceita, ou ela expira,
   * ou a construtora revoga. Medido no primeiro carregamento real (22/09/2026): a
   * `WAITING_CONTRACTED` mais antiga tinha CINCO DIAS, e tudo anterior a isso já
   * estava em estado terminal.
   *
   * Com 92 dias, o primeiro sync gravou 1.075 ofertas já convertidas — seis semanas
   * de arquivo para trazer 77 cards vivos. Trinta dias cobrem o ciclo inteiro de
   * uma oferta com folga larga, e ainda dão um mês de denominador para a taxa de
   * conversão e para o bloco de perdas.
   */
  janela_estado_preauth_dias: z.number().int().min(1).max(92).default(30),
  page_size: z.number().int().min(1).max(200).default(200),
})

export type ConfigFunilOportunidades = z.infer<typeof configFunilOportunidadesSchema>

export const CONFIG_FUNIL_OPORTUNIDADES_PADRAO: ConfigFunilOportunidades =
  configFunilOportunidadesSchema.parse({})

// ─── Motivos de ocultação ───────────────────────────────────────────────────

export const MOTIVOS_OCULTACAO = ['tem_original', 'duplicado_canal'] as const
export type MotivoOcultacao = (typeof MOTIVOS_OCULTACAO)[number]

export const MOTIVO_OCULTACAO_LABELS: Record<MotivoOcultacao, string> = {
  tem_original: 'Escondido porque o documento original já está no funil',
  duplicado_canal: 'O mesmo recebível chegou pelo outro canal',
}

// ─── Tools (§10) ────────────────────────────────────────────────────────────

export const oportunidadesFunilSchema = z.object({
  tipo: z
    .array(tipoOportunidadeSchema)
    .optional()
    .describe('Filtra por origem: nf, pre_autorizacao, titulo. Vazio = os três.'),
  faixa: z.enum(['alta', 'boa', 'media']).optional(),
  fornecedor_cnpj: z.string().optional(),
  sacado_cnpj: z.string().optional().describe('Casa contra a MATRIZ do sacado.'),
  limite: z.number().int().min(1).max(100).default(30),
})
export type OportunidadesFunilInput = z.infer<typeof oportunidadesFunilSchema>

export const preauthsExpirandoSchema = z.object({
  dias: z
    .number()
    .int()
    .min(0)
    .max(30)
    .default(3)
    .describe('Quantos dias de relógio ainda restam. 0 = expira hoje.'),
  limite: z.number().int().min(1).max(100).default(50),
})
export type PreauthsExpirandoInput = z.infer<typeof preauthsExpirandoSchema>

// ─── Mover a oportunidade (§11: nenhuma ação nova, só as que já existem) ────

export const moverOportunidadeSchema = z.object({
  tipo: z.enum(['pre_autorizacao', 'titulo']),
  id: z.string().min(1),
  estagio_funil: z.enum([
    'a_prospectar',
    'em_prospeccao',
    'em_negociacao',
    'antecipacao_andamento',
    'convertida',
    'perdida',
    'expirada',
  ]),
  perda_motivo: z.string().trim().min(3).max(500).optional(),
})
export type MoverOportunidadeInput = z.infer<typeof moverOportunidadeSchema>
