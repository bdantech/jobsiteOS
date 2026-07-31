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
