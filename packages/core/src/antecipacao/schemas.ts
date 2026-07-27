import { z } from 'zod'
import { cnpjSchema } from '../schemas/index.js'
import { arvoreFaixaSchema } from './faixas.js'

/**
 * Vocabulário e schemas de entrada da Antecipação. Mesmas convenções do resto do
 * core: tupla SCREAMING `as const` → enum zod camelCase → tipo PascalCase →
 * LABELS pt-BR, e todo campo que chega à IA carrega .describe().
 *
 * A separação que este arquivo existe para preservar:
 *   FAIXA   — classificação COMPUTADA por regra versionada. Ninguém "move" uma
 *             nota de faixa; muda-se a regra, ou muda-se o dado.
 *   ESTÁGIO — posição no funil, movida por AÇÃO humana.
 * É a mesma distinção de camada vs. estágio no Mercado, e pelo mesmo motivo:
 * misturar as duas transforma um sinal automático numa opinião editável.
 */

// ─── Faixas ─────────────────────────────────────────────────────────────────

export const FAIXAS = ['alta', 'boa', 'media'] as const
export const faixaSchema = z.enum(FAIXAS)
export type Faixa = z.infer<typeof faixaSchema>

export const FAIXA_LABELS: Record<Faixa, string> = {
  alta: 'Alta',
  boa: 'Boa',
  media: 'Média',
}

export const FAIXA_DESCRICOES: Record<Faixa, string> = {
  alta: 'Fornecedor já cadastrado, sacado aprovado e com limite que cobre a nota.',
  boa: 'Sacado aprovado, fornecedor ainda fora da plataforma — aquisição com crédito resolvido.',
  media: 'Sacado na base, crédito ainda não aprovado. Vale trabalhar, começando pelo crédito.',
}

/** Ordem de negócio, não alfabética. Usada em toda avaliação e ordenação. */
export const FAIXA_ORDEM: Record<Faixa, number> = { alta: 1, boa: 2, media: 3 }

/**
 * Por que a nota está (ou saiu) da faixa. Gravado em `faixa_motivo` para que
 * "sumiu do Kanban" tenha sempre uma explicação legível.
 */
export const MOTIVOS_FAIXA = ['regra', 'expirada', 'suprimido', 'fora_das_faixas'] as const
export type MotivoFaixa = (typeof MOTIVOS_FAIXA)[number]
export const MOTIVO_FAIXA_LABELS: Record<MotivoFaixa, string> = {
  regra: 'Classificada pela regra ativa',
  expirada: 'Vencimento perto demais para operar',
  suprimido: 'Fornecedor suprimido',
  fora_das_faixas: 'Nenhuma regra de faixa casou',
}

// ─── Estágios do funil ──────────────────────────────────────────────────────

export const ESTAGIOS_FUNIL = [
  'a_prospectar',
  'em_prospeccao',
  'em_negociacao',
  'antecipacao_andamento',
  'convertida',
  'perdida',
  'expirada',
] as const
export const estagioFunilSchema = z.enum(ESTAGIOS_FUNIL)
export type EstagioFunil = z.infer<typeof estagioFunilSchema>

export const ESTAGIO_FUNIL_LABELS: Record<EstagioFunil, string> = {
  a_prospectar: 'A prospectar',
  em_prospeccao: 'Em prospecção',
  em_negociacao: 'Em negociação',
  antecipacao_andamento: 'Antecipação em andamento',
  convertida: 'Convertida',
  perdida: 'Perdida',
  expirada: 'Expirada',
}

/** As colunas do Kanban. As encerradas ficam numa coluna à parte. */
export const ESTAGIOS_ABERTOS = [
  'a_prospectar',
  'em_prospeccao',
  'em_negociacao',
  'antecipacao_andamento',
] as const satisfies readonly EstagioFunil[]

export const ESTAGIOS_ENCERRADOS = [
  'convertida',
  'perdida',
  'expirada',
] as const satisfies readonly EstagioFunil[]

export function estagioAberto(estagio: string): boolean {
  return (ESTAGIOS_ABERTOS as readonly string[]).includes(estagio)
}

// ─── Tipagem comercial do fornecedor ────────────────────────────────────────

export const TIPAGENS = ['aquisicao', 'ativacao', 'recorrencia'] as const
export const tipagemSchema = z.enum(TIPAGENS)
export type Tipagem = z.infer<typeof tipagemSchema>

export const TIPAGEM_LABELS: Record<Tipagem, string> = {
  aquisicao: 'Aquisição',
  ativacao: 'Ativação',
  recorrencia: 'Recorrência',
}

export const TIPAGEM_DESCRICOES: Record<Tipagem, string> = {
  aquisicao: 'Não cadastrado na plataforma.',
  ativacao: 'Cadastrado, mas nunca antecipou.',
  recorrencia: 'Já antecipou e tem nota viva fora do funil de conversão.',
}

// ─── Outbox ─────────────────────────────────────────────────────────────────

export const CANAIS = ['email', 'whatsapp'] as const
export const canalSchema = z.enum(CANAIS)
export type Canal = z.infer<typeof canalSchema>
export const CANAL_LABELS: Record<Canal, string> = { email: 'E-mail', whatsapp: 'WhatsApp' }

export const STATUS_OUTBOX = ['pendente_envio', 'aprovada', 'enviada', 'falhou', 'descartada'] as const
export type StatusOutbox = (typeof STATUS_OUTBOX)[number]
export const STATUS_OUTBOX_LABELS: Record<StatusOutbox, string> = {
  pendente_envio: 'Pendente de envio',
  aprovada: 'Aprovada',
  enviada: 'Enviada',
  falhou: 'Falhou',
  descartada: 'Descartada',
}

/** Canais de TOQUE MANUAL do vendedor (§9). Não confundir com `Canal` da outbox. */
export const CANAIS_TOQUE = ['ligacao', 'whatsapp', 'email'] as const
export const canalToqueSchema = z.enum(CANAIS_TOQUE)
export type CanalToque = z.infer<typeof canalToqueSchema>
export const CANAL_TOQUE_LABELS: Record<CanalToque, string> = {
  ligacao: 'Ligação',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
}

// ─── Mutações ───────────────────────────────────────────────────────────────

export const moverEstagioSchema = z
  .object({
    access_key: z.string().trim().min(6).max(60).describe('Chave de acesso da NF (44 dígitos na NFe).'),
    estagio_funil: estagioFunilSchema.describe(
      'Estágio de destino: a_prospectar, em_prospeccao, em_negociacao, antecipacao_andamento, ' +
        'convertida, perdida ou expirada.',
    ),
    perda_motivo: z
      .string()
      .trim()
      .max(500)
      .optional()
      .describe('Obrigatório quando o destino é "perdida" — é o insumo da métrica por faixa.'),
  })
  .superRefine((v, ctx) => {
    if (v.estagio_funil === 'perdida' && !v.perda_motivo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['perda_motivo'],
        message: 'Informe o motivo da perda.',
      })
    }
  })
export type MoverEstagioInput = z.infer<typeof moverEstagioSchema>

export const marcarSemInteresseSchema = z.object({
  fornecedor_cnpj: cnpjSchema.describe('CNPJ do fornecedor (14 dígitos, com ou sem pontuação).'),
  motivo: z.string().trim().min(1, 'Informe o motivo.').max(500).describe('Por que não abordar — obrigatório.'),
  eterna: z
    .boolean()
    .default(false)
    .describe(
      'true = supressão ETERNA (LGPD, multinacional que nunca antecipa). false = soft, ' +
        'expira em `dias` e o fornecedor volta a ser elegível.',
    ),
  dias: z
    .number()
    .int()
    .min(1)
    .max(3650)
    .default(90)
    .describe('Duração da supressão soft, em dias. Ignorado quando eterna = true.'),
})
export type MarcarSemInteresseInput = z.infer<typeof marcarSemInteresseSchema>

export const salvarFaixaRegraSchema = z.object({
  faixa: faixaSchema,
  definicao: arvoreFaixaSchema,
  /** Ativar dispara a reclassificação de todo o funil. */
  ativar: z.boolean().default(false),
})
export type SalvarFaixaRegraInput = z.infer<typeof salvarFaixaRegraSchema>

export const ativarFaixaRegraSchema = z.object({ id: z.string().uuid() })
export type AtivarFaixaRegraInput = z.infer<typeof ativarFaixaRegraSchema>

export const salvarFaixaDisparoSchema = z.object({
  faixa: faixaSchema,
  email_habilitado: z.boolean().default(false),
  whatsapp_habilitado: z.boolean().default(false),
  whatsapp_contas: z.array(z.string().uuid()).default([]),
  cooldown_dias: z.number().int().min(0).max(365).default(7),
  assunto_email: z.string().trim().max(200).optional().nullable(),
  template_email: z.string().trim().max(8000).optional().nullable(),
  template_whatsapp: z.string().trim().max(4000).optional().nullable(),
})
export type SalvarFaixaDisparoInput = z.infer<typeof salvarFaixaDisparoSchema>

export const salvarWhatsappContaSchema = z.object({
  id: z.string().uuid().optional(),
  apelido: z.string().trim().min(1, 'Dê um apelido à conta.').max(80),
  numero: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v.length >= 10 && v.length <= 15, 'Número inválido (use DDI + DDD + número).'),
  provedor: z.string().trim().max(40).default('wasender'),
  /**
   * Só na escrita. Vai para o Vault e nunca volta — a UI mostra apenas
   * "definido em {data}" e a opção de substituir.
   */
  token: z.string().trim().min(8).max(500).optional(),
  usuario_responsavel: z.string().uuid().optional().nullable(),
  ativo: z.boolean().default(true),
})
export type SalvarWhatsappContaInput = z.infer<typeof salvarWhatsappContaSchema>

export const descartarMensagemSchema = z.object({
  id: z.string().uuid(),
  motivo: z.string().trim().min(1, 'Informe o motivo do descarte.').max(300),
})
export type DescartarMensagemInput = z.infer<typeof descartarMensagemSchema>

export const definirPontoFocalSchema = z.object({
  id: z.string().uuid().describe('Id do contato.'),
  ponto_focal: z.boolean().default(true),
})
export type DefinirPontoFocalInput = z.infer<typeof definirPontoFocalSchema>

export const registrarToqueManualSchema = z.object({
  fornecedor_cnpj: cnpjSchema,
  canal: canalToqueSchema,
  contato: z.string().trim().max(200).optional().nullable(),
  access_key: z.string().trim().max(60).optional().nullable(),
})
export type RegistrarToqueManualInput = z.infer<typeof registrarToqueManualSchema>

export const salvarAntecipacaoConfigSchema = z.object({
  chave: z.string().min(1).max(60),
  valor: z.unknown(), // jsonb livre — validado por chave na UI
})
export type SalvarAntecipacaoConfigInput = z.infer<typeof salvarAntecipacaoConfigSchema>

// ─── Tools de leitura (IA) ──────────────────────────────────────────────────

export const resumoFunilSchema = z.object({
  faixa: faixaSchema.optional().describe('Recorta o resumo a uma faixa. Ausente = todas.'),
  top: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe('Quantas oportunidades listar, ordenadas por receita esperada.'),
})
export type ResumoFunilInput = z.infer<typeof resumoFunilSchema>

export const notasFornecedorSchema = z.object({
  cnpj: cnpjSchema.describe('CNPJ do fornecedor (14 dígitos, com ou sem pontuação).'),
  incluir_encerradas: z
    .boolean()
    .default(false)
    .describe('Inclui notas convertidas, perdidas e expiradas. Por padrão só as vivas.'),
})
export type NotasFornecedorInput = z.infer<typeof notasFornecedorSchema>

export const capacidadeSacadoSchema = z.object({
  cnpj: cnpjSchema.describe('CNPJ do sacado (a construtora).'),
})
export type CapacidadeSacadoInput = z.infer<typeof capacidadeSacadoSchema>

// ─── Config do módulo (chaves e defaults) ───────────────────────────────────
// Espelham os seeds de `antecipacao_config` (migration 0048). Cada leitor tem o
// default embutido: se a linha sumir, o job roda com o padrão da spec em vez de
// quebrar.

export const ANTECIPACAO_CONFIG_CHAVES = {
  FUNIL: 'funil',
  ECONOMIA: 'economia',
  DISPARO: 'disparo',
  SUPRESSAO: 'supressao',
  SYNC: 'sync',
  LOOKUP: 'lookup_cadastral',
} as const

export interface ConfigFunil {
  minimo_operavel_dias: number
  janela_vencimento_min_dias: number
  janela_vencimento_max_dias: number
}
export const CONFIG_FUNIL_PADRAO: ConfigFunil = {
  minimo_operavel_dias: 7,
  janela_vencimento_min_dias: 15,
  janela_vencimento_max_dias: 120,
}

export interface ConfigEconomia {
  taxa_mensal_padrao: number
}
export const CONFIG_ECONOMIA_PADRAO: ConfigEconomia = { taxa_mensal_padrao: 1.99 }

export interface ConfigDisparo {
  cooldown_dias_padrao: number
  considerar_toque_manual: boolean
}
export const CONFIG_DISPARO_PADRAO: ConfigDisparo = {
  cooldown_dias_padrao: 7,
  considerar_toque_manual: true,
}

export interface ConfigSupressao {
  soft_dias_padrao: number
}
export const CONFIG_SUPRESSAO_PADRAO: ConfigSupressao = { soft_dias_padrao: 90 }

export interface ConfigSync {
  sobreposicao_horas: number
  page_size: number
  janela_inicial_dias: number
}
export const CONFIG_SYNC_PADRAO: ConfigSync = {
  sobreposicao_horas: 6,
  page_size: 200,
  janela_inicial_dias: 60,
}

export interface ConfigLookup {
  max_tentativas: number
  max_por_execucao: number
  receitaws_intervalo_ms: number
}
export const CONFIG_LOOKUP_PADRAO: ConfigLookup = {
  max_tentativas: 10,
  max_por_execucao: 300,
  receitaws_intervalo_ms: 21_000,
}
