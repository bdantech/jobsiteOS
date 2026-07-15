import { z } from 'zod'
import { cnpjSchema } from '../schemas/index.js'
import { arvoreSchema } from './filters.js'

// Mercado's vocabulary and input schemas. Same conventions as schemas/index.ts:
// SCREAMING tuple `as const` → camelCase zod enum → PascalCase type → LABELS
// record in pt-BR, and every field that reaches the AI carries a .describe().

// ─── Vocabulário ────────────────────────────────────────────────────────────

export const CAMADAS = ['universo', 'tam', 'sam', 'som'] as const
export const camadaSchema = z.enum(CAMADAS)
export type Camada = z.infer<typeof camadaSchema>

export const CAMADA_LABELS: Record<Camada, string> = {
  universo: 'Universo',
  tam: 'TAM',
  sam: 'SAM',
  som: 'SOM',
}

export const CAMADA_DESCRICOES: Record<Camada, string> = {
  universo: 'Todo o universo de CNPJs filtrado da Receita Federal.',
  tam: 'Mercado total endereçável: quem existe e tem o perfil mínimo.',
  sam: 'Mercado atingível: quem está na nossa geografia e tem porte.',
  som: 'Mercado conquistável: quem tem sinal de compra hoje.',
}

/** Só estas são calculadas por regra. `universo` é o resto — quem não subiu. */
export const CAMADAS_COM_REGRA = ['tam', 'sam', 'som'] as const
export const camadaComRegraSchema = z.enum(CAMADAS_COM_REGRA)
export type CamadaComRegra = z.infer<typeof camadaComRegraSchema>

export const SITUACOES_CADASTRAIS = ['ativa', 'suspensa', 'inapta', 'baixada', 'nula'] as const

export const FONTES_INGESTAO = ['receita_cnpj', 'cno', 'lista'] as const
export const fonteIngestaoSchema = z.enum(FONTES_INGESTAO)
export type FonteIngestao = z.infer<typeof fonteIngestaoSchema>

export const FONTE_INGESTAO_LABELS: Record<FonteIngestao, string> = {
  receita_cnpj: 'Receita Federal (CNPJ)',
  cno: 'CNO (obras)',
  lista: 'Importação de lista',
}

export const STATUS_INGESTAO = ['executando', 'concluida', 'falhou'] as const
export type StatusIngestao = (typeof STATUS_INGESTAO)[number]
export const STATUS_INGESTAO_LABELS: Record<StatusIngestao, string> = {
  executando: 'Executando',
  concluida: 'Concluída',
  falhou: 'Falhou',
}

export const STATUS_IMPORTACAO = ['mapeando', 'processando', 'revisao', 'concluida'] as const
export type StatusImportacao = (typeof STATUS_IMPORTACAO)[number]
export const STATUS_IMPORTACAO_LABELS: Record<StatusImportacao, string> = {
  mapeando: 'Mapeando colunas',
  processando: 'Processando',
  revisao: 'Aguardando revisão',
  concluida: 'Concluída',
}

export const STATUS_LINHA = ['pendente', 'resolvida', 'ambigua', 'ignorada'] as const
export type StatusLinha = (typeof STATUS_LINHA)[number]
export const STATUS_LINHA_LABELS: Record<StatusLinha, string> = {
  pendente: 'Pendente',
  resolvida: 'Resolvida',
  ambigua: 'Ambígua',
  ignorada: 'Ignorada',
}

// ─── Exploração ─────────────────────────────────────────────────────────────

export const explorarSchema = z.object({
  termo: z
    .string()
    .trim()
    .max(120)
    .optional()
    .describe('Busca por razão social, nome fantasia ou CNPJ. Aceita trechos parciais.'),
  camada: camadaSchema.optional().describe('Filtra por camada da pirâmide.'),
  uf: z.string().length(2).optional().describe('Sigla do estado, ex: SP.'),
  filtro: arvoreSchema
    .optional()
    .describe('Árvore de filtros composta (formato do engine de filtros do Mercado).'),
  limite: z.coerce.number().int().min(1).max(100).default(25),
  pagina: z.coerce.number().int().min(0).default(0),
})
export type ExplorarInput = z.infer<typeof explorarSchema>

export const resumoPiramideSchema = z.object({
  uf: z.string().length(2).optional().describe('Restringe os números a um estado.'),
  tipo: z.enum(['construtora', 'fornecedor']).optional().describe('Restringe a um tipo de empresa.'),
})
export type ResumoPiramideInput = z.infer<typeof resumoPiramideSchema>

export const detalharGrupoSchema = z
  .object({
    grupo_id: z.string().uuid().optional().describe('Id do grupo econômico.'),
    cnpj: z.string().optional().describe('CNPJ de qualquer empresa do grupo.'),
    nome: z.string().max(200).optional().describe('Nome (ou trecho) do grupo econômico.'),
  })
  .refine((v) => v.grupo_id || v.cnpj || v.nome, {
    message: 'Informe grupo_id, cnpj ou nome.',
  })
export type DetalharGrupoInput = z.infer<typeof detalharGrupoSchema>

// ─── Mutações ───────────────────────────────────────────────────────────────

export const promoverEmpresaSchema = z.object({
  cnpj: cnpjSchema.describe(
    'CNPJ (14 dígitos) da empresa no universo que será promovida para a base de Empresas.',
  ),
})
export type PromoverEmpresaInput = z.infer<typeof promoverEmpresaSchema>

export const criarSegmentoSchema = z.object({
  nome: z.string().trim().min(1, 'O segmento precisa de um nome.').max(120),
  descricao: z.string().max(500).optional().nullable(),
  definicao: arvoreSchema.describe(
    'Árvore de filtros que define quem entra no segmento. Grupos "e"/"ou" aninhados sobre ' +
      'condições { variavel, operador, valor }. As variáveis válidas estão no catálogo do Mercado.',
  ),
})
export type CriarSegmentoInput = z.infer<typeof criarSegmentoSchema>

export const salvarCamadaRegraSchema = z.object({
  camada: camadaComRegraSchema,
  definicao: arvoreSchema,
  /** Activating triggers reclassification of the whole universe. */
  ativar: z.boolean().default(false),
})
export type SalvarCamadaRegraInput = z.infer<typeof salvarCamadaRegraSchema>

export const ativarCamadaRegraSchema = z.object({
  id: z.string().uuid(),
})
export type AtivarCamadaRegraInput = z.infer<typeof ativarCamadaRegraSchema>

// ─── Importação de listas ───────────────────────────────────────────────────

/** Canonical fields a spreadsheet column may be mapped onto (§5.5). */
export const CAMPOS_IMPORTACAO = [
  'cnpj',
  'razao_social',
  'nome_fantasia',
  'uf',
  'municipio',
  'erp_atual',
  'erp_mrr',
  'erp_detalhes.qtd_usuarios',
  'erp_detalhes.usuarios_ativos',
  'erp_detalhes.qtd_sistemas',
  'erp_detalhes.canal',
  'erp_detalhes.modalidade',
  'churn_erp_concorrente',
  'contato.nome',
  'contato.email',
  'contato.telefone',
  'contato.cargo',
] as const
export type CampoImportacao = (typeof CAMPOS_IMPORTACAO)[number]

export const CAMPO_IMPORTACAO_LABELS: Record<CampoImportacao, string> = {
  cnpj: 'CNPJ',
  razao_social: 'Razão social',
  nome_fantasia: 'Nome fantasia',
  uf: 'UF',
  municipio: 'Município',
  erp_atual: 'ERP atual',
  erp_mrr: 'MRR do ERP (o que a empresa paga hoje)',
  'erp_detalhes.qtd_usuarios': 'Usuários contratados',
  'erp_detalhes.usuarios_ativos': 'Usuários ativos',
  'erp_detalhes.qtd_sistemas': 'Qtd. de sistemas',
  'erp_detalhes.canal': 'Canal / representante',
  'erp_detalhes.modalidade': 'Modalidade',
  churn_erp_concorrente: 'Churn em ERP concorrente',
  'contato.nome': 'Contato — nome',
  'contato.email': 'Contato — e-mail',
  'contato.telefone': 'Contato — telefone',
  'contato.cargo': 'Contato — cargo',
}

export const mapeamentoImportacaoSchema = z.record(
  z.string(),
  z.enum(CAMPOS_IMPORTACAO).nullable(),
)
export type MapeamentoImportacao = z.infer<typeof mapeamentoImportacaoSchema>

export const resolverLinhaSchema = z.object({
  linha_id: z.string().uuid(),
  cnpj: cnpjSchema.optional(),
  ignorar: z.boolean().default(false),
})
export type ResolverLinhaInput = z.infer<typeof resolverLinhaSchema>
