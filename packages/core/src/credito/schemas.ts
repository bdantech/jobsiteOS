import { z } from 'zod'

// Vocabulário e schemas do módulo Crédito. Mesmas convenções do resto do core:
// tupla SCREAMING `as const` → enum zod camelCase → tipo PascalCase → LABELS pt-BR,
// e todo campo que chega à IA carrega .describe().

// ─── Estágios da esteira ────────────────────────────────────────────────────

export const ESTAGIOS_ANALISE = [
  'rascunho',
  'solicitada',
  'docs_pendentes',
  'enviada_seguradora',
  'em_analise',
  'aprovada',
  'aprovada_parcial',
  'negada',
  'expirada',
  'cancelada',
] as const
export const estagioAnaliseSchema = z.enum(ESTAGIOS_ANALISE)
export type EstagioAnalise = z.infer<typeof estagioAnaliseSchema>

export const ESTAGIO_ANALISE_LABELS: Record<EstagioAnalise, string> = {
  rascunho: 'Rascunho',
  solicitada: 'Solicitada',
  docs_pendentes: 'Documentos pendentes',
  enviada_seguradora: 'Enviada à seguradora',
  em_analise: 'Em análise',
  aprovada: 'Aprovada',
  aprovada_parcial: 'Aprovada parcial',
  negada: 'Negada',
  expirada: 'Expirada',
  cancelada: 'Cancelada',
}

/**
 * A ordem do kanban. `cancelada` fica fora das colunas: é um fim de linha administrativo,
 * não uma etapa — e uma coluna de canceladas cresceria para sempre no canto da tela.
 */
export const COLUNAS_ESTEIRA: readonly EstagioAnalise[] = [
  'rascunho',
  'solicitada',
  'docs_pendentes',
  'enviada_seguradora',
  'em_analise',
  'aprovada',
  'aprovada_parcial',
  'negada',
  'expirada',
]

/** Estágios que ainda estão em curso — o que impede uma segunda solicitação. */
export const ESTAGIOS_ANALISE_ABERTOS: readonly EstagioAnalise[] = [
  'rascunho',
  'solicitada',
  'docs_pendentes',
  'enviada_seguradora',
  'em_analise',
]

/** Estágios que a TELA pode definir. O resto vem da seguradora, pelo worker. */
export const ESTAGIOS_MANUAIS: readonly EstagioAnalise[] = [
  'rascunho',
  'solicitada',
  'docs_pendentes',
  'cancelada',
]

export function ehEstagioDecidido(estagio: string): boolean {
  return ['aprovada', 'aprovada_parcial', 'negada', 'expirada'].includes(estagio)
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
    .enum(['rascunho', 'solicitada', 'docs_pendentes', 'cancelada'])
    .describe('Só estágios manuais. Decisão da seguradora não se define pela tela.'),
  limite_solicitado: z.coerce.number().nonnegative().optional().nullable(),
  observacoes: z.string().trim().max(2000).optional(),
})
export type MoverAnaliseInput = z.infer<typeof moverAnaliseSchema>

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
