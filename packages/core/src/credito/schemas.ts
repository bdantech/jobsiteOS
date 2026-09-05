import { z } from 'zod'
import type { DecisaoFinal } from './analise.js'

// Vocabulário e schemas do módulo Crédito. Mesmas convenções do resto do core:
// tupla SCREAMING `as const` → enum zod camelCase → tipo PascalCase → LABELS pt-BR,
// e todo campo que chega à IA carrega .describe().

// ─── Estágios da esteira ────────────────────────────────────────────────────

export const ESTAGIOS_ANALISE = [
  'rascunho',
  'solicitada',
  'docs_pendentes',
  'docs_recebidos',
  'enviada_seguradora',
  'em_analise',
  'aprovada',
  'aprovada_parcial',
  'negada',
  'cancelada',
] as const
export const estagioAnaliseSchema = z.enum(ESTAGIOS_ANALISE)
export type EstagioAnalise = z.infer<typeof estagioAnaliseSchema>

export const ESTAGIO_ANALISE_LABELS: Record<EstagioAnalise, string> = {
  rascunho: 'Rascunho',
  solicitada: 'Solicitada',
  docs_pendentes: 'Documentos pendentes',
  docs_recebidos: 'Documentos recebidos',
  enviada_seguradora: 'Enviada à seguradora',
  em_analise: 'Em análise',
  aprovada: 'Aprovada',
  aprovada_parcial: 'Aprovada parcial',
  negada: 'Negada',
  cancelada: 'Cancelada',
}

/**
 * A ordem do kanban. `cancelada` fica fora das colunas: é um fim de linha administrativo,
 * não uma etapa — e uma coluna de canceladas cresceria para sempre no canto da tela.
 *
 * NÃO HÁ `expirada`. Ela era uma coluna para um fato que já mora em `expira_em`: uma
 * data no passado diz "venceu" sem apagar o desfecho: depois de expirar, ninguém mais
 * sabia se aquilo tinha sido aprovado ou aprovado parcial.
 */
export const COLUNAS_ESTEIRA: readonly EstagioAnalise[] = [
  'rascunho',
  'solicitada',
  'docs_pendentes',
  'docs_recebidos',
  'enviada_seguradora',
  'em_analise',
  'aprovada',
  'aprovada_parcial',
  'negada',
]

/** Estágios que ainda estão em curso — o que impede uma segunda solicitação. */
export const ESTAGIOS_ANALISE_ABERTOS: readonly EstagioAnalise[] = [
  'rascunho',
  'solicitada',
  'docs_pendentes',
  'docs_recebidos',
  'enviada_seguradora',
  'em_analise',
]

/** Estágios que a TELA pode definir. O resto vem da seguradora, pelo worker. */
export const ESTAGIOS_MANUAIS: readonly EstagioAnalise[] = [
  'rascunho',
  'solicitada',
  'docs_pendentes',
  'docs_recebidos',
  'cancelada',
]

/**
 * De onde uma análise pode ir à seguradora.
 *
 * `docs_recebidos` entra porque é o estado normal de quem tem a pasta em mãos — e
 * `solicitada` fica porque uma análise pedida aqui dentro nasce nele, sem checklist
 * avaliado. Envio é chamada PAGA: oferecer o botão fora destes dois seria desenhar um
 * clique que o worker recusa.
 */
export const ESTAGIOS_QUE_ENVIAM: readonly EstagioAnalise[] = ['solicitada', 'docs_recebidos']

export function podeEnviarASeguradora(estagio: string): boolean {
  return (ESTAGIOS_QUE_ENVIAM as readonly string[]).includes(estagio)
}

/**
 * De onde a decisão do confronto pode CONCLUIR a esteira.
 *
 * Antes de `docs_recebidos` não há o que concluir: a pasta ainda não foi conferida.
 * Depois dela sim — inclusive com o pedido aberto na seguradora, porque
 * `operar_sem_cobertura` é uma decisão completa que não espera resposta de ninguém.
 */
export const ESTAGIOS_CONCLUIVEIS: readonly EstagioAnalise[] = [
  'docs_recebidos',
  'enviada_seguradora',
  'em_analise',
]

export function podeConcluirPelaDecisao(estagio: string): boolean {
  return (ESTAGIOS_CONCLUIVEIS as readonly string[]).includes(estagio)
}

export function ehEstagioDecidido(estagio: string): boolean {
  return ['aprovada', 'aprovada_parcial', 'negada'].includes(estagio)
}

// ─── Mutações ───────────────────────────────────────────────────────────────

export const solicitarAnaliseSchema = z.object({
  empresa_id: z.string().uuid().describe('Empresa (sacado) para a qual pedir análise de crédito.'),
  limite_solicitado: z.coerce
    .number()
    .nonnegative()
    .optional()
    .nullable()
    .describe('Limite pretendido em reais. Ausente = usa o limite potencial calculado.'),
  observacoes: z.string().trim().max(2000).optional().describe('Contexto para quem vai analisar.'),
})
export type SolicitarAnaliseInput = z.infer<typeof solicitarAnaliseSchema>

export const moverAnaliseSchema = z.object({
  id: z.string().uuid(),
  estagio: z
    .enum(['rascunho', 'solicitada', 'docs_pendentes', 'docs_recebidos', 'cancelada'])
    .describe('Só estágios manuais. Decisão da seguradora não se define pela tela.'),
  limite_solicitado: z.coerce.number().nonnegative().optional().nullable(),
  observacoes: z.string().trim().max(2000).optional(),
})
export type MoverAnaliseInput = z.infer<typeof moverAnaliseSchema>

/**
 * O desfecho que cada decisão do confronto produz na esteira.
 *
 * `operar_limite_reduzido` vira `aprovada_parcial` porque é literalmente isso: um sim
 * menor que o pedido. `operar_sem_cobertura` vira `aprovada` — a ausência de cobertura
 * é uma condição da operação, não uma reprovação, e o que ficou menor foi o risco que
 * aceitamos, não o limite que demos.
 *
 * Este mapa é a ÚNICA fonte da sugestão que o diálogo de conclusão mostra. O RPC
 * `app_concluir_analise` não confia nele: lá a checagem é entre `decisao_interna` e o
 * estágio pedido, porque um mapa na tela é conveniência e o banco precisa de garantia.
 */
export const DESFECHO_DA_DECISAO: Record<DecisaoFinal, EstagioAnalise> = {
  operar_com_cobertura: 'aprovada',
  operar_sem_cobertura: 'aprovada',
  operar_limite_reduzido: 'aprovada_parcial',
  nao_operar: 'negada',
}

export const concluirAnaliseSchema = z.object({
  id: z.string().uuid().describe('A análise da esteira, não a proprietária.'),
  estagio: z
    .enum(['aprovada', 'aprovada_parcial', 'negada'])
    .describe('O desfecho. Tem de corresponder à decisão já registrada no confronto.'),
  motivo: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .nullable()
    .describe('Vai para o campo `motivo` da esteira, que é o que aparece no card.'),
})
export type ConcluirAnaliseInput = z.infer<typeof concluirAnaliseSchema>

export const registrarDocSchema = z.object({
  analise_id: z.string().uuid(),
  tipo: z.string().trim().min(1).max(60),
  arquivo_url: z.string().trim().min(1).max(500),
  nome_arquivo: z.string().trim().max(300).optional(),
})
export type RegistrarDocInput = z.infer<typeof registrarDocSchema>

export const salvarScorecardSchema = z.object({
  definicao: z.record(z.unknown()).describe('Definição completa dos fatores (pesos, faixas, casos).'),
  nome: z.string().trim().max(120).optional(),
})
export type SalvarScorecardInput = z.infer<typeof salvarScorecardSchema>

export const ativarScorecardSchema = z.object({ id: z.string().uuid() })
export type AtivarScorecardInput = z.infer<typeof ativarScorecardSchema>

export const salvarCreditoConfigSchema = z.object({
  chave: z.string().min(1).max(60),
  valor: z.unknown(),
})
export type SalvarCreditoConfigInput = z.infer<typeof salvarCreditoConfigSchema>

// ─── Ex-clientes (04h) ──────────────────────────────────────────────────────

export const definirExClienteMotivoSchema = z.object({
  empresa_id: z.string().uuid(),
  motivo_id: z
    .string()
    .uuid()
    .describe('Id de motivos_perda no contexto `ex_cliente`. O RPC recusa outros contextos.'),
  observacao: z
    .string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .describe('Detalhe livre do caso — o que a lista fechada de motivos não cobre.'),
})
export type DefinirExClienteMotivoInput = z.infer<typeof definirExClienteMotivoSchema>

export const exClientesSchema = z.object({
  meses: z
    .number()
    .int()
    .min(1)
    .max(120)
    .optional()
    .describe('Só quem saiu nos últimos N meses. Ausente = todos os ex-clientes.'),
})
export type ExClientesInput = z.infer<typeof exClientesSchema>

export const statusCnpjSchema = z.object({
  cnpj: z.string().describe('CNPJ (14 dígitos, com ou sem pontuação).'),
})
export type StatusCnpjInput = z.infer<typeof statusCnpjSchema>

// ─── Tools de leitura (IA) ──────────────────────────────────────────────────

export const potencialEmpresaSchema = z.object({
  cnpj: z.string().describe('CNPJ da empresa (14 dígitos, com ou sem pontuação).'),
})
export type PotencialEmpresaInput = z.infer<typeof potencialEmpresaSchema>

export const scoreEmpresaSchema = z.object({
  cnpj: z.string().describe('CNPJ da empresa (14 dígitos, com ou sem pontuação).'),
})
export type ScoreEmpresaInput = z.infer<typeof scoreEmpresaSchema>

export const statusEsteiraSchema = z.object({
  estagio: estagioAnaliseSchema
    .optional()
    .describe('Recorta por estágio. Ausente = todos os estágios.'),
})
export type StatusEsteiraInput = z.infer<typeof statusEsteiraSchema>

// ─── Análise proprietária (04j) ─────────────────────────────────────────────

export const rodarAnalisePropriaSchema = z.object({
  analise_credito_id: z
    .string()
    .uuid()
    .describe('A análise da esteira. É nela que os documentos contábeis estão pendurados.'),
  tipo: z.enum(['inicial', 'reanalise']).default('inicial'),
  gatilho: z.enum(['manual', 'automatico_envio_atradius']).default('manual'),
  /**
   * O que consultar de protesto ANTES de analisar. A matriz entra sozinha (sujeita à
   * janela de recência); as SPEs são escolha humana, porque consulta é paga por CNPJ e um
   * grupo pode ter dezenas delas.
   */
  protestos: z
    .object({
      incluir_spes: z.boolean().default(false),
      ano_min: z.coerce.number().int().min(1900).max(2200).nullable().default(null),
      somente_afiancadas: z.boolean().default(false),
    })
    .default({ incluir_spes: false, ano_min: null, somente_afiancadas: false }),
})
export type RodarAnalisePropriaInput = z.infer<typeof rodarAnalisePropriaSchema>

export const revisarExtracaoSchema = z.object({
  id: z.string().uuid(),
  correcoes: z
    .array(
      z.object({
        exercicio: z.coerce.number().int(),
        campo: z.string().min(1),
        // `null` é uma correção legítima: "o modelo achou um número, mas ele não é este
        // campo". Sem isso, o único jeito de desfazer uma leitura errada seria zerá-la —
        // e zero é uma afirmação sobre o balanço que ninguém fez.
        valor: z.coerce.number().nullable(),
      }),
    )
    .min(1, 'Nada a confirmar.'),
})
export type RevisarExtracaoInput = z.infer<typeof revisarExtracaoSchema>

export const editarParecerSchema = z.object({
  id: z.string().uuid(),
  texto: z.string().trim().max(60_000),
})
export type EditarParecerInput = z.infer<typeof editarParecerSchema>

export const registrarDecisaoCreditoSchema = z.object({
  id: z.string().uuid(),
  decisao_final: z.enum([
    'operar_com_cobertura',
    'operar_sem_cobertura',
    'operar_limite_reduzido',
    'nao_operar',
  ]),
  decisao_limite: z.coerce.number().nonnegative().optional().nullable(),
  decisao_motivo: z.string().trim().max(4000).optional().nullable(),
})
export type RegistrarDecisaoCreditoInput = z.infer<typeof registrarDecisaoCreditoSchema>

export const salvarParametrosAnaliseSchema = z.object({
  definicao: z.record(z.unknown()),
  nome: z.string().trim().max(120).optional(),
  ativar: z.boolean().default(true),
})
export type SalvarParametrosAnaliseInput = z.infer<typeof salvarParametrosAnaliseSchema>

/** Tool de leitura: o resultado consolidado de um CNPJ. */
export const analisePropriaSchema = z.object({
  cnpj: z.string().describe('CNPJ do sacado (14 dígitos, com ou sem pontuação).'),
})
export type AnalisePropriaInput = z.infer<typeof analisePropriaSchema>

/** Tool de mutação: dispara a análise. NUNCA decide. */
export const rodarAnaliseToolSchema = z.object({
  cnpj: z.string().describe('CNPJ do sacado. Precisa ter uma análise aberta na esteira.'),
  tipo: z.enum(['inicial', 'reanalise']).default('inicial'),
})
export type RodarAnaliseToolInput = z.infer<typeof rodarAnaliseToolSchema>

/** Tool de leitura: quadrantes e divergências do período. */
export const compararSeguradoraSchema = z.object({
  dias: z.coerce
    .number()
    .int()
    .min(1)
    .max(365)
    .default(90)
    .describe('Janela em dias, contada das análises concluídas.'),
})
export type CompararSeguradoraInput = z.infer<typeof compararSeguradoraSchema>

// ─── Condições comerciais e precificação (04o) ──────────────────────────────

/**
 * Os campos do formulário de condições. O `coerce` existe porque eles chegam de
 * `<input type="number">` — e um "2.9" em texto que virasse `NaN` silencioso
 * publicaria uma taxa nula para a plataforma de produção.
 *
 * As regras (faixas, cruzadas, TAC) NÃO estão aqui: elas moram em
 * `validarCondicoes`, que é o espelho do Zod deles e roda no formulário a cada
 * tecla. Este schema só garante que chegou número onde se espera número — repetir
 * as regras nos dois lugares criaria duas verdades sobre o mesmo campo.
 */
export const condicoesCamposSchema = z.object({
  credit_limit: z.coerce.number(),
  max_invoice_amount: z.coerce.number(),
  max_due_date_days: z.coerce.number(),
  expires_at: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Validade em AAAA-MM-DD.'),
  monthly_rate_d0: z.coerce.number(),
  monthly_rate_d1: z.coerce.number(),
  fee_d0: z.coerce.number(),
  fee_min_d0: z.coerce.number(),
  fee_d1: z.coerce.number(),
  fee_min_d1: z.coerce.number(),
  commission_percent: z.coerce.number(),
  extension_rate_percent: z.coerce.number(),
  bill_fine_percent: z.coerce.number(),
  invest_back_limit: z.coerce.number(),
  invest_back_commission_percent: z.coerce.number(),
  has_insurance: z.boolean(),
  has_referral: z.boolean(),
  fidc_ready: z.boolean(),
})
export type CondicoesCamposInput = z.infer<typeof condicoesCamposSchema>

export const salvarCondicoesSchema = z.object({
  analise_credito_id: z.string().uuid(),
  condicoes: condicoesCamposSchema,
  /** O que o motor sugeriu, para a linha registrar de onde o analista partiu. */
  sugestao: z.record(z.unknown()),
  /** O que ele mudou, campo a campo, e a justificativa do que saiu da faixa. */
  ajustes: z.record(z.unknown()).optional().nullable(),
  matriz_versao: z.coerce.number().int().positive(),
})
export type SalvarCondicoesInput = z.infer<typeof salvarCondicoesSchema>

/**
 * A publicação. `erro_validacao` é preenchido pela action quando o espelho do Zod
 * de produção recusou: aí a linha nasce `falha_validacao`, NENHUM webhook sai, e a
 * mensagem exata fica gravada. A tentativa que falhou é registro, não silêncio.
 */
export const publicarCondicoesSchema = salvarCondicoesSchema.extend({
  erro_validacao: z.string().trim().max(4000).optional().nullable(),
})
export type PublicarCondicoesInput = z.infer<typeof publicarCondicoesSchema>

export const salvarMatrizPrecificacaoSchema = z.object({
  definicao: z.record(z.unknown()).describe('Faixas globais, ajustes e as células da matriz.'),
  ativar: z.boolean().default(true),
})
export type SalvarMatrizPrecificacaoInput = z.infer<typeof salvarMatrizPrecificacaoSchema>

export const ativarMatrizPrecificacaoSchema = z.object({
  versao: z.coerce.number().int().positive(),
})
export type AtivarMatrizPrecificacaoInput = z.infer<typeof ativarMatrizPrecificacaoSchema>

/** Tool de leitura: as condições vigentes de um CNPJ. */
export const condicoesDoCnpjSchema = z.object({
  cnpj: z.string().describe('CNPJ do sacado (14 dígitos, com ou sem pontuação).'),
})
export type CondicoesDoCnpjInput = z.infer<typeof condicoesDoCnpjSchema>
