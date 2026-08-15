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
export const MOTIVOS_FAIXA = [
  'regra',
  'expirada',
  'suprimido',
  'nao_operavel',
  'fora_das_faixas',
] as const
export type MotivoFaixa = (typeof MOTIVOS_FAIXA)[number]
export const MOTIVO_FAIXA_LABELS: Record<MotivoFaixa, string> = {
  regra: 'Classificada pela regra ativa',
  expirada: 'Vencimento perto demais para operar',
  suprimido: 'Fornecedor suprimido',
  nao_operavel: 'Natureza da operação não gera crédito',
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

/**
 * Promover o fornecedor a partir do funil. Só o CNPJ entra: `tipo` e `origem` são
 * fixados pelo RPC (migration 0068), nunca pelo cliente — é o que impede que este
 * caminho crie uma "construtora" e envenene a pirâmide comercial.
 */
export const promoverFornecedorSchema = z.object({
  cnpj: cnpjSchema.describe('CNPJ do fornecedor (14 dígitos, com ou sem pontuação).'),
})
export type PromoverFornecedorInput = z.infer<typeof promoverFornecedorSchema>

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

// ─── Fornecedor sem interesse em se CADASTRAR (prospecção) ──────────────────

/**
 * Duas coisas parecidas que não são a mesma, e o nome de cada uma importa:
 *
 *   `marcarSemInteresse` (acima)  → SUPRESSÃO DE CANAL. Não tocar este CNPJ por
 *     e-mail/telefone/WhatsApp, com validade e peso de LGPD. Mora em `supressao`,
 *     e o Radar inteiro consulta antes de qualquer disparo.
 *
 *   `marcarFornecedorSemInteresse` (aqui) → QUALIFICAÇÃO DO LEAD. O fornecedor da
 *     lista a prospectar foi trabalhado e não vai se cadastrar. Tira o CNPJ da lista
 *     e as notas dele dos funis, é reversível num clique e não bloqueia canal nenhum.
 *
 * O motivo é ENUMERADO, e não texto livre como o da supressão: esta resposta é
 * contável. "Quantos leads perdemos porque já operam com outro?" é uma pergunta que
 * só tem resposta se a razão vier de uma lista fechada.
 */
export const MOTIVOS_SEM_INTERESSE = [
  'nao_utiliza_antecipacao',
  'ja_opera_com_outro',
  'caixa_confortavel',
  'nao_quer_plataforma',
  'sem_contato',
  'porte_incompativel',
  'outro',
] as const
export const motivoSemInteresseSchema = z.enum(MOTIVOS_SEM_INTERESSE)
export type MotivoSemInteresse = z.infer<typeof motivoSemInteresseSchema>

export const MOTIVO_SEM_INTERESSE_LABELS: Record<MotivoSemInteresse, string> = {
  nao_utiliza_antecipacao: 'Não utiliza antecipação',
  ja_opera_com_outro: 'Já opera com outra financeira',
  caixa_confortavel: 'Não precisa — caixa confortável',
  nao_quer_plataforma: 'Não quer se cadastrar na plataforma',
  sem_contato: 'Não conseguimos contato',
  porte_incompativel: 'Porte ou perfil incompatível',
  outro: 'Outro',
}

export const MOTIVO_SEM_INTERESSE_DESCRICOES: Record<MotivoSemInteresse, string> = {
  nao_utiliza_antecipacao: 'Não antecipa recebível, por política ou por não precisar.',
  ja_opera_com_outro: 'Já tem banco ou fintech fazendo isso — é disputa, não aquisição.',
  caixa_confortavel: 'Antecipa eventualmente, mas hoje não precisa. Vale revisitar.',
  nao_quer_plataforma: 'Antecipa, mas não quer se cadastrar aqui.',
  sem_contato: 'Não conseguimos falar com quem decide.',
  porte_incompativel: 'Porte ou perfil fora do que a operação atende.',
  outro: 'Qualquer outro caso — a observação passa a ser obrigatória.',
}

export const marcarFornecedorSemInteresseSchema = z
  .object({
    cnpj: cnpjSchema.describe('CNPJ do fornecedor (14 dígitos, com ou sem pontuação).'),
    motivo: motivoSemInteresseSchema.describe('Por que ele não vai se cadastrar.'),
    observacao: z
      .string()
      .trim()
      .max(500)
      .optional()
      .nullable()
      .describe('Detalhe livre. Obrigatório quando o motivo é "outro".'),
    /**
     * O nome que a tela já tem em mãos. Vai junto para a lista de descartados
     * continuar legível depois que o fornecedor sair da janela de 90 dias e não
     * houver mais nota de onde tirar um nome. Sem ele, o RPC busca na última nota.
     */
    fornecedor_nome: z.string().trim().max(200).optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.motivo === 'outro' && !v.observacao?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['observacao'],
        message: 'Descreva o motivo.',
      })
    }
  })
export type MarcarFornecedorSemInteresseInput = z.infer<typeof marcarFornecedorSemInteresseSchema>

export const reverterFornecedorSemInteresseSchema = z.object({
  cnpj: cnpjSchema.describe('CNPJ do fornecedor a devolver para a lista a prospectar.'),
})
export type ReverterFornecedorSemInteresseInput = z.infer<typeof reverterFornecedorSemInteresseSchema>

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

/**
 * A fila de revisão (04e §6): vincular a antecipação a uma NF, ou tirá-la da
 * fila com motivo.
 *
 * `access_key` obrigatório quando `acao = 'casar'`, motivo obrigatório quando
 * `acao = 'ignorar'` — ignorar sem dizer por quê apaga a única informação que
 * torna a fila auditável depois.
 */
export const casarAntecipacaoSchema = z
  .object({
    id_externo: z.number().int().describe('Id da antecipação na plataforma Onepay.'),
    acao: z
      .enum(['casar', 'ignorar'])
      .default('casar')
      .describe('casar = vincula à NF informada; ignorar = tira da fila de revisão.'),
    access_key: z
      .string()
      .trim()
      .max(60)
      .optional()
      .nullable()
      .describe('Chave de acesso da NF. Obrigatória ao casar.'),
    motivo: z
      .string()
      .trim()
      .max(500)
      .optional()
      .nullable()
      .describe('Por que ignorar. Obrigatório ao ignorar.'),
  })
  .superRefine((v, ctx) => {
    if (v.acao === 'casar' && !v.access_key) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['access_key'],
        message: 'Escolha a nota fiscal.',
      })
    }
    if (v.acao === 'ignorar' && !v.motivo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['motivo'],
        message: 'Informe o motivo.',
      })
    }
  })
export type CasarAntecipacaoInput = z.infer<typeof casarAntecipacaoSchema>

export const statusConversoesSchema = z.object({
  dias: z
    .number()
    .int()
    .min(1)
    .max(365)
    .default(30)
    .describe('Janela em dias, contada da data de criação da antecipação.'),
})
export type StatusConversoesInput = z.infer<typeof statusConversoesSchema>

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
  CONVERSAO: 'conversao',
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

/**
 * Os limites aqui NÃO são preferências — são o contrato do endpoint de NFs:
 *
 *   sync_hours ∈ [1, 4]   e SUBSTITUI o filtro de datas (mandar os dois → 400)
 *   start_date/end_date   filtram por EMISSÃO, com intervalo máximo de 10 dias
 *
 * Mexer em `sync_horas_max` ou `intervalo_max_dias` para além disso não amplia a
 * janela: faz o endpoint responder 400.
 */
export interface ConfigSync {
  /** Teto de `sync_hours`. O endpoint recusa acima de 4. */
  sync_horas_max: number
  /** Teto do intervalo de emissão por requisição. O endpoint recusa acima de 10. */
  intervalo_max_dias: number
  page_size: number
  /** Primeira execução (sem histórico): quantos dias de EMISSÃO trazer. */
  janela_inicial_dias: number
  /**
   * A rede de segurança do job diário. `sync_hours` só enxerga 4 horas para trás,
   * e o cron roda de 4 em 4 — uma corrida que falhe abre um buraco que nenhum
   * `sync_hours` posterior alcança. Esta varredura por emissão o fecha em até 24h.
   */
  varredura_dias: number
}
export const CONFIG_SYNC_PADRAO: ConfigSync = {
  sync_horas_max: 4,
  intervalo_max_dias: 10,
  page_size: 200,
  janela_inicial_dias: 60,
  varredura_dias: 30,
}

export interface ConfigLookup {
  max_tentativas: number
  max_por_execucao: number
  receitaws_intervalo_ms: number
  /**
   * Teto de TEMPO da corrida. Sem ele, o teto por quantidade não protege nada: se a
   * primeira fonte cair, a cascata desce para a ReceitaWS a 21s por CNPJ e 2.000
   * CNPJs viram 11 horas de job — segurando o sync de NFs atrás dele.
   */
  orcamento_ms: number
}
export const CONFIG_LOOKUP_PADRAO: ConfigLookup = {
  max_tentativas: 10,
  // 300 era menos que a chegada diária de CNPJs novos: a fila CRESCIA. As fontes são
  // gratuitas e a primeira responde em ~250ms, então o custo de subir isto é tempo de
  // job, limitado pelo orçamento abaixo.
  max_por_execucao: 2_000,
  receitaws_intervalo_ms: 21_000,
  orcamento_ms: 10 * 60_000,
}

/**
 * Conversão automática (04e). A lista de status vive em CONFIG e não em código
 * por um motivo prático: a plataforma cria status novo (foi assim que nasceu
 * `EXTENDED_BILL_SWAPPED`), e a diferença entre "editar settings" e "esperar um
 * deploy" é a diferença entre uma tarde e uma semana de conversões não contadas.
 */
export interface ConfigConversao {
  /** Os status em que a antecipação JÁ representa dinheiro operado. */
  status_conversores: string[]
  /** Sincronizados e casados para visibilidade, mas nunca convertem. */
  status_nao_conversores: string[]
  /** Janela do `period` por data de CRIAÇÃO, em dias. */
  janela_sync_dias: number
  /**
   * Por quantos dias uma antecipação sem NF continua sendo re-tentada a cada
   * ciclo. Depois disso o `sem_nf` vira definitivo e emite evento — deixar
   * re-tentando para sempre transforma o job numa varredura da base inteira.
   */
  janela_rematch_dias: number
  /** Tolerância de valor no desempate e no fuzzy, em %. */
  tolerancia_valor_pct: number
  /** Tolerância de vencimento no fuzzy, em dias. */
  tolerancia_vencimento_dias: number
  /** Janela da calibração de economia (§5), em dias. */
  calibracao_dias: number
}

export const CONFIG_CONVERSAO_PADRAO: ConfigConversao = {
  status_conversores: [
    'APPROVED',
    'REVISION',
    'PAY_OUT',
    'BILLET_SWAPPED',
    'PROGRAMED_PAYMENT',
    'CONCLUDED',
    'EXPIRED_BILL_SWAPPED',
    'EXTENDED_BILL_SWAPPED',
    'IN_EXTENSION_BILL_SWAPPED',
  ],
  status_nao_conversores: [
    'DRAFT',
    'REQUESTED',
    'REPROVED',
    'DENY_BY_CONTRACTED',
    'PAYMENT_REPROVED',
  ],
  janela_sync_dias: 3,
  janela_rematch_dias: 7,
  tolerancia_valor_pct: 1,
  tolerancia_vencimento_dias: 5,
  calibracao_dias: 90,
}

/**
 * Um status DESCONHECIDO nunca converte. É a assimetria que importa: deixar de
 * converter aparece na fila de revisão e alguém corrige a config; converter por
 * engano marca como antecipada uma nota que ninguém antecipou, e nada denuncia.
 */
export function statusConverte(status: string | null | undefined, cfg: ConfigConversao): boolean {
  if (!status) return false
  return cfg.status_conversores.includes(status.toUpperCase())
}
