import { z } from 'zod'

/**
 * Vocabulário do módulo de Comunicação (05A).
 *
 * Uma fonte só para os seis consumidores: o inbox da web, o inbox do celular, os
 * workers de envio/triagem/agente, os webhooks, as tools de IA e as RPCs. Canal,
 * direção, ação do agente e intenção são gravados como texto com CHECK no banco —
 * se o TypeScript e o CHECK discordarem, quem descobre é o usuário, no meio de um
 * envio que não pode ser desfeito.
 */

// ─── Canais ─────────────────────────────────────────────────────────────────

/**
 * `whatsapp` e `email` são canais de THREAD: existe um identificador por onde a
 * pessoa responde, e por isso existe conversa. Os outros três são registros de
 * contato sem caixa de entrada — uma ligação entra na thread de WhatsApp daquele
 * número, uma reunião e um alerta interno não têm thread nenhuma.
 */
export const CANAIS_THREAD = ['whatsapp', 'email'] as const
export type CanalThread = (typeof CANAIS_THREAD)[number]

export const CANAIS_COMUNICACAO = ['whatsapp', 'email', 'ligacao', 'reuniao', 'interno'] as const
export type CanalComunicacao = (typeof CANAIS_COMUNICACAO)[number]

export const CANAL_COMUNICACAO_LABELS: Record<CanalComunicacao, string> = {
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  ligacao: 'Ligação',
  reuniao: 'Reunião',
  interno: 'Interno',
}

export const DIRECOES = ['entrada', 'saida'] as const
export type Direcao = (typeof DIRECOES)[number]

export const PROVEDORES = ['wasender', 'gmail', 'resend', 'app_link', 'manual'] as const
export type Provedor = (typeof PROVEDORES)[number]

export const STATUS_ENVIO = ['pendente', 'enviada', 'entregue', 'lida', 'falhou', 'descartada'] as const
export type StatusEnvio = (typeof STATUS_ENVIO)[number]

export const STATUS_ENVIO_LABELS: Record<StatusEnvio, string> = {
  pendente: 'Na fila',
  enviada: 'Enviada',
  entregue: 'Entregue',
  lida: 'Lida',
  falhou: 'Falhou',
  descartada: 'Descartada',
}

/**
 * De onde a mensagem partiu. Espelha `comunicacoes_origem_check` no banco.
 *
 * `campanha` estava no CHECK desde o 05B e nunca chegou aqui — o worker gravava
 * um valor que o tipo dizia não existir, e só não quebrou porque quem grava
 * campanha passa por outro caminho. `celular` é a mensagem digitada no APARELHO,
 * fora da plataforma (0162): ela entra no ledger pelo webhook `message.sent`
 * para o histórico não mentir, mas NÃO passou pelo portão — e é por isso que
 * precisa ser distinguível de `compositor` numa auditoria de supressão.
 */
export const ORIGENS = [
  'compositor',
  'outbox',
  'agente',
  'app_toque',
  'inbox',
  'sistema',
  'campanha',
  'celular',
] as const
export type OrigemComunicacao = (typeof ORIGENS)[number]

export const FUNIS = ['nfs', 'fornecedores', 'sdr', 'vendas', 'certificados'] as const
export type Funil = (typeof FUNIS)[number]

export const FUNIL_LABELS: Record<Funil, string> = {
  nfs: 'Notas fiscais',
  fornecedores: 'Fornecedores',
  sdr: 'SDR',
  vendas: 'Vendas',
  certificados: 'Certificados',
}

/**
 * O estágio de "ninguém falou com esta pessoa ainda" e o de "alguém falou", por
 * funil. É o que a triagem move quando chega a PRIMEIRA resposta (§6): sem este
 * mapa, cada funil precisaria de um caso especial no worker, e o funil que
 * alguém esquecesse continuaria mentindo que ninguém foi contatado.
 */
export const PRIMEIRO_CONTATO_MOVE: Partial<Record<Funil, { de: string; para: string; tabela: string; coluna: string }>> = {
  fornecedores: { de: 'a_cadastrar', para: 'em_prospeccao', tabela: 'fornecedores_funil', coluna: 'estagio' },
  sdr: { de: 'a_contatar', para: 'em_conversa', tabela: 'sdr_leads', coluna: 'estagio' },
  nfs: { de: 'a_prospectar', para: 'em_prospeccao', tabela: 'notas_fiscais', coluna: 'estagio_funil' },
  certificados: { de: 'universo', para: 'prospeccao', tabela: 'certificado_cards', coluna: 'estagio' },
}

// ─── Base legal ─────────────────────────────────────────────────────────────

export const BASES_LEGAIS = [
  'formulario_aceite',
  'relacao_comercial',
  'dado_publico_nfe',
  'indicacao',
  'manual',
] as const
export type BaseLegal = (typeof BASES_LEGAIS)[number]

export const BASE_LEGAL_LABELS: Record<BaseLegal, string> = {
  formulario_aceite: 'Aceite em formulário',
  relacao_comercial: 'Relação comercial',
  dado_publico_nfe: 'Dado público (NF-e)',
  indicacao: 'Indicação',
  manual: 'Cadastro manual',
}

/**
 * Só o aceite explícito dispensa o link de descadastro. Todas as outras bases são
 * legítimas para abordar e nenhuma delas é permissão de marketing — a diferença
 * está exatamente aí, e é por isso que esta função existe em vez de um `if` solto
 * no worker de envio.
 */
export function exigeDescadastro(canal: CanalComunicacao, base: BaseLegal | null): boolean {
  return canal === 'email' && base !== 'formulario_aceite'
}

// ─── Conversas ──────────────────────────────────────────────────────────────

export const OBJETIVOS = [
  'agendar_reuniao',
  'cadastrar_fornecedor',
  'cobrar_documentacao',
  'renovar_analise',
  'reativar',
  'antecipar_nf',
  'renovar_certificado',
  'nenhum',
] as const
export type ObjetivoConversa = (typeof OBJETIVOS)[number]

export const OBJETIVO_LABELS: Record<ObjetivoConversa, string> = {
  agendar_reuniao: 'Agendar reunião',
  cadastrar_fornecedor: 'Cadastrar fornecedor',
  cobrar_documentacao: 'Cobrar documentação',
  renovar_analise: 'Renovar análise',
  reativar: 'Reativar',
  antecipar_nf: 'Antecipar nota',
  renovar_certificado: 'Renovar certificado',
  nenhum: 'Sem objetivo',
}

export const MODOS_AGENTE = ['sugestao', 'autonomo', 'desligado'] as const
export type ModoAgente = (typeof MODOS_AGENTE)[number]

export const MODO_AGENTE_LABELS: Record<ModoAgente, string> = {
  sugestao: 'Sugestão',
  autonomo: 'Autônomo',
  desligado: 'Desligado',
}

export const MODO_AGENTE_DESCRICOES: Record<ModoAgente, string> = {
  sugestao: 'A decisão aparece pronta no card e no inbox. Quem envia é você.',
  autonomo: 'O agente executa sozinho, respeitando todos os guardrails.',
  desligado: 'Nenhuma decisão é tomada nesta conversa.',
}

export const STATUS_CONVERSA = ['ativa', 'aguardando_resposta', 'pausada', 'encerrada'] as const
export type StatusConversa = (typeof STATUS_CONVERSA)[number]

export const STATUS_CONVERSA_LABELS: Record<StatusConversa, string> = {
  ativa: 'Ativa',
  aguardando_resposta: 'Aguardando resposta',
  pausada: 'Pausada',
  encerrada: 'Encerrada',
}

// ─── Contas de WhatsApp ─────────────────────────────────────────────────────

export const TIPOS_CONTA_WHATSAPP = ['relacionamento', 'ia', 'plantao'] as const
export type TipoContaWhatsapp = (typeof TIPOS_CONTA_WHATSAPP)[number]

export const TIPO_CONTA_LABELS: Record<TipoContaWhatsapp, string> = {
  relacionamento: 'Relacionamento (humano)',
  ia: 'Persona de IA',
  plantao: 'Plantão interno',
}

export const TIPO_CONTA_DESCRICOES: Record<TipoContaWhatsapp, string> = {
  relacionamento: 'O número de uma pessoa da casa. Passa pelo portão inteiro.',
  ia: 'Número próprio da persona. NUNCA o mesmo de um humano.',
  plantao: 'Alerta interno. Não passa por warmup, supressão, janela nem teto.',
}

// ─── Zod: entradas das mutações ─────────────────────────────────────────────

export const enfileirarMensagemSchema = z.object({
  canal: z.enum(CANAIS_THREAD),
  contato_id: z.string().uuid(),
  assunto: z.string().max(300).optional().nullable(),
  corpo: z.string().min(1, 'A mensagem está vazia.'),
  template_id: z.string().uuid().optional().nullable(),
  whatsapp_conta_id: z.string().uuid().optional().nullable(),
  funil: z.enum(FUNIS).optional().nullable(),
  funil_card_id: z.string().optional().nullable(),
  /** Furar a janela exige confirmação explícita de quem está enviando (§5). */
  forcar_janela: z.boolean().optional(),
  ignorar_cooldown: z.boolean().optional(),
})
export type EnfileirarMensagemInput = z.infer<typeof enfileirarMensagemSchema>

export const vincularConversaSchema = z.object({
  id: z.string().uuid(),
  empresa_id: z.string().uuid(),
  nome: z.string().min(1, 'Informe o nome do contato.'),
  cargo: z.string().optional().nullable(),
})
export type VincularConversaInput = z.infer<typeof vincularConversaSchema>

export const idSchema = z.object({ id: z.string().uuid() })

/**
 * Ocultar aceita QUALQUER um dos dois lados, e nunca os dois vazios.
 *
 * O pedido nasce em dois lugares diferentes: no inbox, olhando para uma conversa
 * que já existe; e no painel de vinculação, olhando para uma linha da fila cujo
 * id de conversa a tela nem carrega. Exigir sempre o id da conversa obrigaria a
 * segunda tela a resolver o problema antes de poder dispensá-lo.
 */
export const ocultarConversaSchema = z
  .object({
    conversa_id: z.string().uuid().optional().nullable(),
    nao_vinculada_id: z.string().uuid().optional().nullable(),
    motivo: z.string().max(120).optional().nullable(),
  })
  .refine((v) => Boolean(v.conversa_id ?? v.nao_vinculada_id), {
    message: 'Informe a conversa a ocultar.',
  })
export type OcultarConversaInput = z.infer<typeof ocultarConversaSchema>

export const reexibirConversaSchema = z.object({ conversa_id: z.string().uuid() })

export const definirModoAgenteSchema = z.object({
  id: z.string().uuid(),
  modo_agente: z.enum(MODOS_AGENTE),
  objetivo: z.enum(OBJETIVOS).optional().nullable(),
  playbook_id: z.string().uuid().optional().nullable(),
})
export type DefinirModoAgenteInput = z.infer<typeof definirModoAgenteSchema>

export const aceitarSugestaoSchema = z.object({
  id: z.string().uuid(),
  /** Editar antes de enviar é o caso normal, não a exceção. */
  corpo: z.string().optional().nullable(),
  assunto: z.string().optional().nullable(),
})
export type AceitarSugestaoInput = z.infer<typeof aceitarSugestaoSchema>

export const salvarTemplateSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  nome: z.string().min(1),
  canal: z.enum(CANAIS_THREAD),
  funil: z.enum(FUNIS).optional().nullable(),
  objetivo: z.string().optional().nullable(),
  assunto: z.string().optional().nullable(),
  corpo: z.string().min(1),
  variaveis: z.array(z.string()).default([]),
  ativo: z.boolean().default(true),
})
export type SalvarTemplateInput = z.infer<typeof salvarTemplateSchema>

export const salvarPlaybookSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  nome: z.string().min(1),
  funil: z.enum(FUNIS),
  objetivo: z.string().min(1),
  instrucoes: z.string().min(1),
  acoes_permitidas: z.array(z.string()).min(1, 'Um playbook sem ações não decide nada.'),
  templates_disponiveis: z.array(z.string().uuid()).default([]),
  prazos: z
    .object({
      silencio_dias: z.number().int().min(0).max(365).optional(),
      max_tentativas: z.number().int().min(0).max(20).optional(),
      desistir_apos_dias: z.number().int().min(0).max(365).optional(),
    })
    .default({}),
  ativo: z.boolean().default(true),
})
export type SalvarPlaybookInput = z.infer<typeof salvarPlaybookSchema>

export const atividadeSchema = z.object({
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  canal: z.enum(CANAIS_THREAD).optional(),
})
export type AtividadeInput = z.infer<typeof atividadeSchema>

export const enviarApresentacaoSchema = z.object({
  id: z.string().uuid(),
  canal: z.enum(CANAIS_THREAD).default('email'),
  assunto: z.string().optional().nullable(),
  corpo: z.string().optional().nullable(),
})
export type EnviarApresentacaoInput = z.infer<typeof enviarApresentacaoSchema>

// ─── Config do módulo ───────────────────────────────────────────────────────

export interface JanelaEnvio {
  /** 1 = segunda … 7 = domingo (ISO). */
  dias_semana: number[]
  hora_inicio: number
  hora_fim: number
  timezone: string
}

export interface ConfigAgente {
  kill_switch: boolean
  confianca_minima: number
  /** Ferramenta DECLARADA e desligada (§7.2). Ver `acoes.ts`. */
  ligacao_habilitada: boolean
  cadencia_fallback_dias: number[]
}

export interface ConfigWarmup {
  inicial_por_dia: number
  incremento_semanal: number
}

export interface ConfigComunicacao {
  janela: JanelaEnvio
  cooldown_dias: number
  teto_diario_por_thread: number
  warmup: ConfigWarmup
  inatividade_horas: number
  agente: ConfigAgente
  plantao: { eventos: string[]; perfis: string[] }
}

/**
 * O padrão de fábrica, em código, e a razão de ele existir aqui: a config vive no
 * banco, mas um worker que suba antes do seed — ou depois de alguém apagar uma
 * chave — não pode decidir enviar de madrugada porque a janela veio `undefined`.
 * Faltando a chave, vale isto.
 */
export const CONFIG_COMUNICACAO_PADRAO: ConfigComunicacao = {
  janela: { dias_semana: [1, 2, 3, 4, 5], hora_inicio: 9, hora_fim: 18, timezone: 'America/Sao_Paulo' },
  cooldown_dias: 3,
  teto_diario_por_thread: 3,
  warmup: { inicial_por_dia: 20, incremento_semanal: 20 },
  inatividade_horas: 4,
  agente: {
    kill_switch: false,
    confianca_minima: 0.6,
    ligacao_habilitada: false,
    cadencia_fallback_dias: [0, 3, 7],
  },
  plantao: {
    eventos: [
      'orcamento.estourado',
      'mercado.ingestao_falhou',
      'lote.aguardando_aprovacao',
      'analise_propria.divergencia_seguradora',
      'analise.limite_reduzido',
      'sdr.aceite_pendente',
    ],
    perfis: ['Admin'],
  },
}
