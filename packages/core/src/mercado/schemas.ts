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

// ─── Prévia da regra (§5.1) ─────────────────────────────────────────────────
// The dry-run's shape, shared by the worker (which computes it against live data
// with compileToSql) and the web (which renders it). Keeping it here is what lets
// the worker's answer type-check straight into the confirmation card.

/** Where the companies leaving a layer land, as their FINAL assigned layer. */
export interface PreviaDestino {
  camada: Camada
  total: number
}

export interface PreviaRegra {
  camada: CamadaComRegra
  /** Companies NOT in this layer today that the proposed rule set pulls IN. */
  subindo: number
  /** Companies in this layer today that the proposed rule set moves OUT. */
  descendo: number
  /** Companies in this layer today that stay. */
  permanecem: number
  /** Breakdown of `descendo` by where each company ends up. */
  destinos: PreviaDestino[]
  totalMovidas: number
}

export const SITUACOES_CADASTRAIS = ['ativa', 'suspensa', 'inapta', 'baixada', 'nula'] as const

export const FONTES_INGESTAO = [
  'receita_cnpj',
  'cno',
  'lista',
  'onepay_nf',
  'onepay_certificados',
  'onepay_antecipacoes',
  'onepay_credit_analyses',
] as const
export const fonteIngestaoSchema = z.enum(FONTES_INGESTAO)
export type FonteIngestao = z.infer<typeof fonteIngestaoSchema>

export const FONTE_INGESTAO_LABELS: Record<FonteIngestao, string> = {
  receita_cnpj: 'Receita Federal (CNPJ)',
  cno: 'CNO (obras)',
  lista: 'Importação de lista',
  onepay_nf: 'Notas fiscais (Onepay)',
  onepay_certificados: 'Certificados digitais (Onepay)',
  onepay_antecipacoes: 'Antecipações (Onepay)',
  onepay_credit_analyses: 'Análises de crédito (Onepay)',
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
  /**
   * O default é 'construtora' porque esta promoção nasceu no Explorador, onde
   * todo mundo é construtora. O funil de Antecipação promove FORNECEDOR, e
   * gravar 'construtora' num fabricante de esquadria envenena a base: a pirâmide
   * comercial, os segmentos e o TAM leem essa coluna.
   *
   * Precisa estar aqui, e não só no RPC: zod DESCARTA chave desconhecida em
   * silêncio, então um `tipo` que não existisse no schema chegaria ao banco como
   * ausente — e o erro apareceria meses depois, como um fornecedor contado no TAM.
   */
  tipo: z
    .enum(['construtora', 'fornecedor'])
    .optional()
    .describe('Tipo da empresa criada. Padrão: construtora.'),
  origem: z
    .enum(['mercado', 'antecipacao'])
    .optional()
    .describe('De qual módulo partiu a promoção. Padrão: mercado.'),
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
  'faturamento_anual',
  'funcionarios',
  'patrimonio_liquido',
  'contato.nome',
  'contato.email',
  'contato.telefone',
  'contato.cargo',
] as const
export type CampoImportacao = (typeof CAMPOS_IMPORTACAO)[number]

/**
 * Os campos que viram SÉRIE, e não coluna.
 *
 * Eles são diferentes de todos os outros em duas coisas. Primeira: cada um vale
 * para um ANO — "Receita Bruta 2023" e "Receita Bruta 2024" são a mesma métrica em
 * dois pontos do tempo, não duas colunas disputando o mesmo campo. Segunda: eles
 * não são gravados em `empresas` por UPDATE; passam pela hierarquia de origem
 * (empresa_metricas + cache), porque um número de lista não pode apagar o que o
 * cliente declarou.
 */
export const CAMPOS_METRICA_IMPORTACAO = [
  'faturamento_anual',
  'funcionarios',
  'patrimonio_liquido',
] as const
export type CampoMetricaImportacao = (typeof CAMPOS_METRICA_IMPORTACAO)[number]

export function ehCampoMetrica(campo: CampoImportacao | null): campo is CampoMetricaImportacao {
  return campo !== null && (CAMPOS_METRICA_IMPORTACAO as readonly string[]).includes(campo)
}

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
  faturamento_anual: 'Faturamento anual (por ano)',
  funcionarios: 'Funcionários (por ano)',
  patrimonio_liquido: 'Patrimônio líquido (por ano)',
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

/** Ano de referência por COLUNA da planilha: { "Receita Bruta 2023 (R$)": 2023 }. */
export const anosColunasSchema = z.record(z.string(), z.number().int().min(2000).max(2100))
export type AnosColunas = z.infer<typeof anosColunasSchema>

/**
 * O ano escrito no cabeçalho da coluna — "Receita Bruta 2023 (R$)" → 2023.
 *
 * É um PALPITE, como o resto do mapeamento: a tela mostra o que foi detectado e a
 * pessoa confirma ou corrige antes de aplicar. Detectar em silêncio um ano errado
 * gravaria a série inteira deslocada, e ninguém descobriria até a variação 12m sair
 * absurda meses depois.
 *
 * Pega a PRIMEIRA ocorrência: num cabeçalho como "PL 2024 (base 2023)" o ano do
 * título é o que a coluna diz ser, e a pessoa corrige se discordar.
 */
export function anoDoCabecalho(cabecalho: string): number | null {
  const achado = cabecalho.match(/\b(20\d{2})\b/)
  if (!achado?.[1]) return null
  const ano = Number(achado[1])
  return ano >= 2000 && ano <= 2100 ? ano : null
}

export const resolverLinhaSchema = z.object({
  linha_id: z.string().uuid(),
  cnpj: cnpjSchema.optional(),
  ignorar: z.boolean().default(false),
})
export type ResolverLinhaInput = z.infer<typeof resolverLinhaSchema>
