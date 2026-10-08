import { z } from 'zod'

/**
 * O VOCABULÁRIO da Inteligência de Conversas (Prompt 05C).
 *
 * ─── ESTE MÓDULO NÃO ENVIA NADA E NÃO DECIDE NADA ───────────────────────────
 * Ele lê o que já aconteceu (reunião, ligação, janela de conversa), julga contra uma
 * rubrica versionada e devolve. As únicas escritas no mundo são o convite do Fireflies e
 * o write-back cadastral aditivo — todo o resto é anotação sobre o passado.
 *
 * ─── A NOTA É ARITMÉTICA ────────────────────────────────────────────────────
 * Os modelos respondem perguntas tipadas, item a item. A nota é a média ponderada dos
 * itens aplicáveis — nenhum modelo opina sobre ela, e é isso que a torna contestável.
 */

// ─── Interação ──────────────────────────────────────────────────────────────

export const ESCOPOS_ANALISE = ['reuniao', 'ligacao', 'janela_conversa'] as const
export type EscopoAnalise = (typeof ESCOPOS_ANALISE)[number]

export const ESCOPO_ANALISE_LABELS: Record<EscopoAnalise, string> = {
  reuniao: 'Reunião',
  ligacao: 'Ligação',
  janela_conversa: 'Conversa',
}

/** A rubrica é por tipo de interação; ligação e conversa de texto compartilham o formato. */
export const TIPOS_INTERACAO = ['reuniao', 'ligacao', 'conversa_texto'] as const
export type TipoInteracao = (typeof TIPOS_INTERACAO)[number]

export const TIPO_INTERACAO_LABELS: Record<TipoInteracao, string> = {
  reuniao: 'Reunião',
  ligacao: 'Ligação',
  conversa_texto: 'Conversa de texto',
}

export function tipoInteracaoDoEscopo(escopo: EscopoAnalise): TipoInteracao {
  return escopo === 'janela_conversa' ? 'conversa_texto' : escopo
}

export const MODOS_ANALISE = ['sombra', 'publicado'] as const
export type ModoAnalise = (typeof MODOS_ANALISE)[number]

export const PROVEDORES_ANALISE = ['jev', 'claude'] as const
export type ProvedorAnalise = (typeof PROVEDORES_ANALISE)[number]

export const PROVEDOR_ANALISE_LABELS: Record<ProvedorAnalise, string> = { jev: 'Jev (TypeSafe)', claude: 'Claude' }

// ─── Captura (Fireflies) ────────────────────────────────────────────────────

export const CAPTURA_STATUS = ['agendada', 'bot_entrou', 'transcrita', 'sem_captura', 'dispensada'] as const
export type CapturaStatus = (typeof CAPTURA_STATUS)[number]

export const CAPTURA_STATUS_LABELS: Record<CapturaStatus, string> = {
  agendada: 'Aguardando a reunião',
  bot_entrou: 'Gravando',
  transcrita: 'Transcrita',
  sem_captura: 'Sem captura',
  dispensada: 'Não gravada',
}

// ─── Rubrica ────────────────────────────────────────────────────────────────

export const TIPOS_RESPOSTA = ['sim_nao', 'escolha', 'score'] as const
export type TipoResposta = (typeof TIPOS_RESPOSTA)[number]

/**
 * O estado de calibração de UM item. Só `publicado` entra na nota que o vendedor vê;
 * os outros três rodam, gravam e ficam fora — e cada um diz por quê.
 */
export const STATUS_CALIBRACAO = ['nao_calibrado', 'publicado', 'sombra_f1', 'inativo_amostras'] as const
export type StatusCalibracao = (typeof STATUS_CALIBRACAO)[number]

export const STATUS_CALIBRACAO_LABELS: Record<StatusCalibracao, string> = {
  nao_calibrado: 'Não calibrado',
  publicado: 'Publicado',
  sombra_f1: 'Pergunta mal formulada (F1 abaixo do mínimo)',
  inativo_amostras: 'Amostras insuficientes',
}

/** As etapas da rubrica de reunião, na ordem em que a tela agrupa. */
export const ETAPAS_REUNIAO = ['Dor', 'Solução', 'Segurança', 'Próximos passos'] as const

// ─── Pendências ─────────────────────────────────────────────────────────────

export const TIPOS_PENDENCIA = ['pergunta_sem_resposta', 'pendencia_nossa', 'follow_up_atrasado', 'proximo_passo'] as const
export type TipoPendencia = (typeof TIPOS_PENDENCIA)[number]

export const TIPO_PENDENCIA_LABELS: Record<TipoPendencia, string> = {
  pergunta_sem_resposta: 'Pergunta sem resposta',
  pendencia_nossa: 'Pendência nossa',
  follow_up_atrasado: 'Retorno fora do prazo',
  proximo_passo: 'Próximo passo combinado',
}

// ─── Contestação ────────────────────────────────────────────────────────────

export const VEREDITOS_CONTESTACAO = ['procedente', 'improcedente', 'rubrica_ajustar'] as const
export type VereditoContestacao = (typeof VEREDITOS_CONTESTACAO)[number]

export const VEREDITO_LABELS: Record<VereditoContestacao, string> = {
  procedente: 'Procedente — o item muda',
  improcedente: 'Improcedente — o item fica',
  rubrica_ajustar: 'A pergunta precisa ser reescrita',
}

// ─── Settings (Comercial → Qualidade) ───────────────────────────────────────

export const capturaConfigSchema = z.object({
  /**
   * Desligada até alguém configurar a conta do Fireflies. Ligar antes poria o notetaker
   * em convite de cliente sem conta para receber o transcript — gravação que ninguém lê.
   */
  ligada: z.boolean().default(false),
  /** A conta central: dona dos transcripts e destino dos webhooks (§1.1). */
  email_conta_central: z.string().email().default('admin@oneos.com.br'),
  /** Quem dispara o join do bot. Sem ele no convite, o auto-join "quando eu convidar o fred" não age. */
  email_notetaker: z.string().email().default('fred@fireflies.ai'),
  minutos_para_bot: z.number().int().min(1).max(60).default(5),
  /** Idioma passado ao `addToLiveMeeting` no resgate manual. */
  idioma: z.string().min(2).max(5).default('pt'),
})
export type CapturaConfig = z.infer<typeof capturaConfigSchema>

export const classificacaoConfigSchema = z.object({
  /** O braço que roda em tudo. `claude` existe para quando o Jev não estiver disponível. */
  provedor: z.enum(PROVEDORES_ANALISE).default('jev'),
  /** Meia-largura da banda cinzenta em torno do limiar: dentro dela, decide o Claude. */
  delta: z.number().min(0).max(0.5).default(0.1),
  /** A partir de que probabilidade a condição de aplicabilidade conta como "sim". */
  limiar_aplicabilidade: z.number().min(0).max(1).default(0.5),
  /** Limiar dos itens ainda não calibrados — só serve à sombra, nunca chega ao vendedor. */
  limiar_padrao: z.number().min(0).max(1).default(0.5),
  /** Teto do texto enviado como estado. Uma reunião de uma hora tem ~60 mil caracteres. */
  max_caracteres_estado: z.number().int().min(2000).max(400_000).default(120_000),
})
export type ClassificacaoConfig = z.infer<typeof classificacaoConfigSchema>

export const calibracaoConfigSchema = z.object({
  f1_minimo: z.number().min(0).max(1).default(0.7),
  min_amostras_calibracao: z.number().int().min(5).max(1000).default(20),
  /**
   * Mínimo de casos de CADA lado (atendeu / não atendeu) entre as amostras. Sem nenhuma
   * falha rotulada não há como saber se o classificador enxerga falha — e falha é a
   * única saída que chega ao vendedor como cobrança.
   */
  min_por_classe: z.number().int().min(1).max(100).default(3),
  n_contestacoes_para_recalibrar: z.number().int().min(1).max(1000).default(15),
})
export type CalibracaoConfig = z.infer<typeof calibracaoConfigSchema>

export const janelaConfigSchema = z.object({
  /** Abaixo disto a janela não fecha: "oi / tudo bem" não tem rubrica aplicável. */
  min_mensagens: z.number().int().min(1).max(200).default(4),
  /** A janela só fecha depois de este tempo sem mensagem — não se julga conversa no meio. */
  horas_silencio: z.number().int().min(0).max(168).default(12),
})
export type JanelaConfig = z.infer<typeof janelaConfigSchema>

export const retencaoConfigSchema = z.object({
  /** Nulo = manter. A análise sobrevive ao texto: o expurgo apaga só a transcrição. */
  dias_transcricao: z.number().int().min(7).max(3650).nullable().default(null),
})
export type RetencaoConfig = z.infer<typeof retencaoConfigSchema>

export const vinculacaoConfigSchema = z.object({
  ligada: z.boolean().default(true),
  /** Probabilidade do Jev a partir da qual o par é aceito sem o Claude. */
  aceite_automatico: z.number().min(0.5).max(1).default(0.85),
  /** Abaixo disto o par vai direto para humano; entre isto e o aceite, decide o Claude. */
  banda_inferior: z.number().min(0).max(0.9).default(0.5),
  max_candidatas: z.number().int().min(1).max(50).default(20),
})
export type VinculacaoConfig = z.infer<typeof vinculacaoConfigSchema>

export const precosQualidadeSchema = z.object({
  cambio_usd_brl: z.number().positive().default(5.5),
  /** USD por milhão de tokens de entrada no Jev; a saída é grátis. */
  jev_entrada_usd_mtok: z.number().min(0).default(0.42),
  claude_entrada_usd_mtok: z.number().min(0).default(3),
  claude_saida_usd_mtok: z.number().min(0).default(15),
  /** Scribe v2 em lote, por hora de áudio (preço de 10/2026). */
  elevenlabs_stt_usd_hora: z.number().min(0).default(0.22),
  /** Acréscimo por hora quando a chamada leva termos-chave. */
  elevenlabs_termos_usd_hora: z.number().min(0).default(0.05),
})
export type PrecosQualidade = z.infer<typeof precosQualidadeSchema>

/**
 * Transcrição do áudio do WhatsApp (ElevenLabs). Mora aqui, e não na Comunicação, porque a
 * credencial e o custo são desta tela — e porque o primeiro leitor que precisou dela foi a
 * análise. Quem mais lê a fala (triagem, agente) lê o resultado, não a configuração.
 */
export const transcricaoConfigSchema = z.object({
  /** Desligada até a chave da ElevenLabs existir: a RPC recusa ligar sem ela. */
  ligada: z.boolean().default(false),
  modelo: z.string().trim().min(1).max(40).default('scribe_v2'),
  /** ISO-639-1 ou 639-3. Fixar o idioma evita o áudio curto ser lido como espanhol. */
  idioma: z.string().trim().min(2).max(3).default('por'),
  /**
   * Palavras que o modelo deve reconhecer, e que ele erraria por serem nossas ou do
   * mercado. Cada chamada com termos custa um acréscimo por hora; lista vazia não cobra.
   */
  termos_chave: z
    .array(z.string().trim().min(1).max(49))
    .max(200)
    .default([
      'OnePay',
      'antecipação',
      'recebíveis',
      'sacado',
      'cedente',
      'duplicata',
      'deságio',
      'TAC',
      'Sienge',
      'pré-autorização',
      'nota fiscal',
      'medição',
    ]),
  /** Acima disto o áudio não é transcrito: é aula, não conversa, e custa como tal. */
  max_segundos: z.number().int().min(10).max(3600).default(900),
})
export type TranscricaoConfig = z.infer<typeof transcricaoConfigSchema>

export const CHAVES_CONFIG_QUALIDADE = [
  'captura',
  'classificacao',
  'calibracao',
  'janela',
  'retencao',
  'vinculacao',
  'precos',
  'transcricao',
] as const
export type ChaveConfigQualidade = (typeof CHAVES_CONFIG_QUALIDADE)[number]

export interface ConfigQualidade {
  captura: CapturaConfig
  classificacao: ClassificacaoConfig
  calibracao: CalibracaoConfig
  janela: JanelaConfig
  retencao: RetencaoConfig
  vinculacao: VinculacaoConfig
  precos: PrecosQualidade
  transcricao: TranscricaoConfig
}

export const CONFIG_QUALIDADE_PADRAO: ConfigQualidade = {
  captura: capturaConfigSchema.parse({}),
  classificacao: classificacaoConfigSchema.parse({}),
  calibracao: calibracaoConfigSchema.parse({}),
  janela: janelaConfigSchema.parse({}),
  retencao: retencaoConfigSchema.parse({}),
  vinculacao: vinculacaoConfigSchema.parse({}),
  precos: precosQualidadeSchema.parse({}),
  transcricao: transcricaoConfigSchema.parse({}),
}

const SCHEMAS_CONFIG: Record<ChaveConfigQualidade, z.ZodTypeAny> = {
  captura: capturaConfigSchema,
  classificacao: classificacaoConfigSchema,
  calibracao: calibracaoConfigSchema,
  janela: janelaConfigSchema,
  retencao: retencaoConfigSchema,
  vinculacao: vinculacaoConfigSchema,
  precos: precosQualidadeSchema,
  transcricao: transcricaoConfigSchema,
}

/** Cada chave cai no padrão sozinha: um override inválido não derruba as outras. */
export function montarConfigQualidade(linhas: ReadonlyArray<{ chave: string; valor: unknown }>): ConfigQualidade {
  const por = new Map(linhas.map((l) => [l.chave, l.valor]))
  const saida = { ...CONFIG_QUALIDADE_PADRAO } as Record<ChaveConfigQualidade, unknown>
  for (const chave of CHAVES_CONFIG_QUALIDADE) {
    const bruto = por.get(chave)
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) continue
    const r = SCHEMAS_CONFIG[chave].safeParse({ ...(CONFIG_QUALIDADE_PADRAO[chave] as object), ...(bruto as object) })
    if (r.success) saida[chave] = r.data
  }
  return saida as unknown as ConfigQualidade
}

export function schemaDaConfigQualidade(chave: ChaveConfigQualidade): z.ZodTypeAny {
  return SCHEMAS_CONFIG[chave]
}

// ─── Custo ──────────────────────────────────────────────────────────────────

export function custoJevCentavos(tokensEntrada: number, precos: PrecosQualidade): number {
  return (Math.max(0, tokensEntrada) * precos.jev_entrada_usd_mtok * precos.cambio_usd_brl * 100) / 1_000_000
}

export function custoClaudeCentavos(t: { entrada: number; saida: number }, precos: PrecosQualidade): number {
  const usd =
    (Math.max(0, t.entrada) * precos.claude_entrada_usd_mtok + Math.max(0, t.saida) * precos.claude_saida_usd_mtok) /
    1_000_000
  return usd * precos.cambio_usd_brl * 100
}

/** O custo de uma transcrição, gravado na linha da mensagem com o preço do dia. */
export function custoTranscricaoCentavos(segundos: number, comTermos: boolean, precos: PrecosQualidade): number {
  const porHora = precos.elevenlabs_stt_usd_hora + (comTermos ? precos.elevenlabs_termos_usd_hora : 0)
  return (Math.max(0, segundos) / 3600) * porHora * precos.cambio_usd_brl * 100
}
