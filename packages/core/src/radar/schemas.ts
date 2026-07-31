import { z } from 'zod'
import { cnpjSchema } from '../schemas/index.js'
import { arvoreSchema } from '../mercado/filters.js'

// Radar's vocabulary and input schemas. Mesmas convenções do resto do core:
// tupla SCREAMING `as const` → enum zod camelCase → tipo PascalCase → LABELS pt-BR,
// e todo campo que chega à IA carrega .describe().

// ─── Vocabulário ────────────────────────────────────────────────────────────

// `funcionarios` entrou em 04c (migração 0069 já aceita os quatro no check de
// `lotes_enriquecimento` e o construtor de lotes já o oferece). Sem ele aqui, criar o
// lote morria na validação do zod ANTES de chegar ao banco: a tela oferecia um tipo que
// o schema recusava.
export const TIPOS_ENRIQUECIMENTO = ['dominio', 'contatos', 'protestos', 'funcionarios'] as const
export const tipoEnriquecimentoSchema = z.enum(TIPOS_ENRIQUECIMENTO)
export type TipoEnriquecimento = z.infer<typeof tipoEnriquecimentoSchema>
export const TIPO_ENRIQUECIMENTO_LABELS: Record<TipoEnriquecimento, string> = {
  dominio: 'Domínio',
  contatos: 'Contatos',
  protestos: 'Protestos',
  funcionarios: 'Funcionários',
}

export const STATUS_LOTE = [
  'rascunho', 'aguardando_aprovacao', 'aprovado', 'executando', 'concluido', 'cancelado', 'falhou',
] as const
export type StatusLote = (typeof STATUS_LOTE)[number]
export const STATUS_LOTE_LABELS: Record<StatusLote, string> = {
  rascunho: 'Rascunho',
  aguardando_aprovacao: 'Aguardando aprovação',
  aprovado: 'Aprovado',
  executando: 'Executando',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
  falhou: 'Falhou',
}

export const ESCOPOS_SUPRESSAO = ['email', 'telefone', 'whatsapp', 'empresa'] as const
export const escopoSupressaoSchema = z.enum(ESCOPOS_SUPRESSAO)
export type EscopoSupressao = z.infer<typeof escopoSupressaoSchema>
export const ESCOPO_SUPRESSAO_LABELS: Record<EscopoSupressao, string> = {
  email: 'E-mail',
  telefone: 'Telefone',
  whatsapp: 'WhatsApp',
  empresa: 'Empresa (CNPJ)',
}

export const MOTIVOS_SUPRESSAO = ['descadastro', 'hard_bounce', 'solicitacao_lgpd', 'nao_abordar'] as const
export const motivoSupressaoSchema = z.enum(MOTIVOS_SUPRESSAO)
export type MotivoSupressao = z.infer<typeof motivoSupressaoSchema>
export const MOTIVO_SUPRESSAO_LABELS: Record<MotivoSupressao, string> = {
  descadastro: 'Descadastro',
  hard_bounce: 'Hard bounce',
  solicitacao_lgpd: 'Solicitação LGPD',
  nao_abordar: 'Não abordar',
}

// ─── Lotes (mutações) ───────────────────────────────────────────────────────

export const criarLoteSchema = z.object({
  tipo: tipoEnriquecimentoSchema.describe('O que enriquecer: dominio, contatos ou protestos.'),
  nome: z.string().trim().min(1).max(120).optional().describe('Nome amigável do lote.'),
  definicao_filtro: arvoreSchema.describe(
    'Árvore de filtros (mesmo formato do Mercado): grupos "e"/"ou" sobre condições ' +
      '{ variavel, operador, valor }. Só variáveis do catálogo são aceitas.',
  ),
  parametros: z.record(z.unknown()).optional().describe(
    'Parâmetros do lote, ex.: { incluir_fora_sp: true, revelar_telefone: false }.',
  ),
  total_itens: z.number().int().nonnegative().optional(),
  custo_estimado_min: z.number().nonnegative().optional(),
  custo_estimado_esperado: z.number().nonnegative().optional(),
  // A IA e a UI só criam rascunho ou aguardando_aprovacao — nunca executam.
  status: z.enum(['rascunho', 'aguardando_aprovacao']).optional(),
})
export type CriarLoteInput = z.infer<typeof criarLoteSchema>

export const aprovarLoteSchema = z.object({ id: z.string().uuid() })
export type AprovarLoteInput = z.infer<typeof aprovarLoteSchema>

export const cancelarLoteSchema = z.object({ id: z.string().uuid() })
export type CancelarLoteInput = z.infer<typeof cancelarLoteSchema>

// ─── Supressão ──────────────────────────────────────────────────────────────

/** Onde a supressão nasceu. Uma lista só, com origem — nunca duas listas. */
export const CONTEXTOS_SUPRESSAO = ['geral', 'antecipacao'] as const
export const contextoSupressaoSchema = z.enum(CONTEXTOS_SUPRESSAO)
export type ContextoSupressao = z.infer<typeof contextoSupressaoSchema>
export const CONTEXTO_SUPRESSAO_LABELS: Record<ContextoSupressao, string> = {
  geral: 'Geral',
  antecipacao: 'Antecipação',
}

export const suprimirSchema = z.object({
  escopo: escopoSupressaoSchema.describe('email | telefone | whatsapp | empresa (CNPJ).'),
  valor: z.string().trim().min(1).describe('Endereço, número ou CNPJ a suprimir.'),
  motivo: motivoSupressaoSchema.describe('Por que suprimir — obrigatório.'),
  observacao: z.string().trim().max(500).optional(),
  expira_em: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.')
    .optional()
    .nullable()
    .describe('Data de expiração (AAAA-MM-DD). Ausente/nula = supressão ETERNA.'),
  contexto: contextoSupressaoSchema
    .optional()
    .describe('De onde veio a supressão. Default: geral.'),
})
export type SuprimirInput = z.infer<typeof suprimirSchema>

export const removerSupressaoSchema = z.object({ id: z.string().uuid() })
export type RemoverSupressaoInput = z.infer<typeof removerSupressaoSchema>

// ─── Config ─────────────────────────────────────────────────────────────────

export const salvarRadarConfigSchema = z.object({
  chave: z.string().min(1).max(60),
  valor: z.unknown(), // jsonb livre — validado por chave na UI
})
export type SalvarRadarConfigInput = z.infer<typeof salvarRadarConfigSchema>

// ─── Tools de leitura (IA) ──────────────────────────────────────────────────

export const statusEnriquecimentoSchema = z.object({
  camada: z
    .enum(['universo', 'tam', 'sam', 'som'])
    .optional()
    .describe('Camada da pirâmide para recortar a cobertura. Ausente = todas.'),
})
export type StatusEnriquecimentoInput = z.infer<typeof statusEnriquecimentoSchema>

export const buscarContatosEmpresaSchema = z.object({
  cnpj: cnpjSchema.describe('CNPJ da empresa (14 dígitos, com ou sem pontuação).'),
})
export type BuscarContatosEmpresaInput = z.infer<typeof buscarContatosEmpresaSchema>

export const protestosEmpresaSchema = z.object({
  cnpj: cnpjSchema.describe('CNPJ da empresa (14 dígitos, com ou sem pontuação).'),
})
export type ProtestosEmpresaInput = z.infer<typeof protestosEmpresaSchema>

// ─── Faturamento & funcionários (04c §9) ────────────────────────────────────

export const faturamentoEmpresaSchema = z.object({
  cnpj: z.string().describe('CNPJ da empresa (14 dígitos, com ou sem pontuação).'),
})
export type FaturamentoEmpresaInput = z.infer<typeof faturamentoEmpresaSchema>

export const atualizarFuncionariosSchema = z.object({
  cnpj: z.string().describe('CNPJ da empresa cujo headcount deve ser consultado no Apollo.'),
})
export type AtualizarFuncionariosInput = z.infer<typeof atualizarFuncionariosSchema>
