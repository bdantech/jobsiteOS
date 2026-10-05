import { z } from 'zod'
import { POLITICAS_IDENTIFICACAO, type PoliticaIdentificacao } from './identificacao.js'

/**
 * O VOCABULÁRIO do módulo Agentes (Prompt 09).
 *
 * ─── A UNIDADE DE TRABALHO É O MANDATO, NÃO A CONVERSA ──────────────────────
 * A conversa é presa a um número de telefone; o mandato não é. "Ligou, não era o
 * decisor, buscou outro contato no Apollo, ligou de novo, mandou e-mail, marcou" atravessa
 * três conversas e um contato que não existia no começo — e só existe como trabalho
 * contínuo se houver uma entidade acima delas (§2).
 *
 * ─── O CONTROLE É ESTRUTURAL, NÃO POR APROVAÇÃO ─────────────────────────────
 * O agente não pede autorização a cada mensagem: opera sob teto de orçamento, cota de
 * volume, escopo de população e um disjuntor que o para sozinho. Tudo que está neste
 * arquivo é uma dessas cercas ou o nome de alguma coisa que acontece dentro delas.
 */

// ─── Mandato ────────────────────────────────────────────────────────────────

export const TIPOS_MANDATO = ['originacao_nf', 'agendamento_reuniao', 'reativacao', 'qualificacao'] as const
export type TipoMandato = (typeof TIPOS_MANDATO)[number]

export const TIPO_MANDATO_LABELS: Record<TipoMandato, string> = {
  originacao_nf: 'Originação de NF',
  agendamento_reuniao: 'Agendamento de reunião',
  reativacao: 'Reativação',
  qualificacao: 'Qualificação',
}

export const ESTADOS_MANDATO = [
  'aberto',
  'em_andamento',
  'aguardando_externo',
  'pausado',
  'concluido',
  'encerrado_sem_sucesso',
  'escalado',
] as const
export type EstadoMandato = (typeof ESTADOS_MANDATO)[number]

export const ESTADO_MANDATO_LABELS: Record<EstadoMandato, string> = {
  aberto: 'Aberto',
  em_andamento: 'Em andamento',
  aguardando_externo: 'Aguardando retorno',
  pausado: 'Pausado',
  concluido: 'Concluído',
  encerrado_sem_sucesso: 'Encerrado sem sucesso',
  escalado: 'Com um humano',
}

/** Os que o ciclo pode pegar. `aguardando_externo` volta a `em_andamento` quando algo chega. */
export const ESTADOS_ATIVOS: readonly EstadoMandato[] = ['aberto', 'em_andamento', 'aguardando_externo']
export const ESTADOS_TERMINAIS: readonly EstadoMandato[] = ['concluido', 'encerrado_sem_sucesso', 'escalado']

/**
 * Por que um mandato terminou (§2.4). ESTRUTURADO de propósito: um agente que encerra 80%
 * por "contatos esgotados" tem problema de DADOS, não de conversa — e isso só aparece no
 * painel se o motivo for uma chave, não uma frase.
 */
export const MOTIVOS_ENCERRAMENTO = [
  'objetivo_atingido',
  'expirado',
  'max_acoes',
  'orcamento_esgotado',
  'contatos_esgotados',
  'pediu_nao_contatar',
  'em_cobranca',
  'suprimido',
  'sem_interesse',
  'escalado_humano',
  'assumido_manualmente',
  'encerrado_manualmente',
  'agente_desistiu',
] as const
export type MotivoEncerramento = (typeof MOTIVOS_ENCERRAMENTO)[number]

export const MOTIVO_ENCERRAMENTO_LABELS: Record<MotivoEncerramento, string> = {
  objetivo_atingido: 'Objetivo atingido',
  expirado: 'Prazo do mandato venceu',
  max_acoes: 'Limite de ações esgotado',
  orcamento_esgotado: 'Orçamento do mandato esgotado',
  contatos_esgotados: 'Todos os contatos tentados',
  pediu_nao_contatar: 'Pediu para não ser contatado',
  em_cobranca: 'Empresa entrou em cobrança',
  suprimido: 'Empresa ou contato suprimido',
  sem_interesse: 'Sem interesse',
  escalado_humano: 'Escalado para humano',
  assumido_manualmente: 'Assumido por uma pessoa',
  encerrado_manualmente: 'Encerrado por uma pessoa',
  agente_desistiu: 'O agente desistiu',
}

/** Motivos de PAUSA — o mandato não termina, espera (§8: orçamento novo retoma). */
export const MOTIVOS_PAUSA = ['orcamento_esgotado', 'disjuntor_aberto', 'agente_pausado', 'manual'] as const
export type MotivoPausa = (typeof MOTIVOS_PAUSA)[number]

export const ORIGENS_MANDATO = ['regra', 'manual', 'escalonamento'] as const
export type OrigemMandato = (typeof ORIGENS_MANDATO)[number]

// ─── O plano explícito (§2.2) ───────────────────────────────────────────────

/**
 * Requisito de produto, não enfeite: em qualquer momento tem que estar claro o que o
 * agente está tentando e por quê. É o que torna a autonomia supervisionável sem aprovar
 * mensagem por mensagem — e `atualizar_plano` é ferramenta OBRIGATÓRIA de todo ciclo.
 */
export const proximaAcaoPlanoSchema = z.object({
  // 120, não 60: com 60 o modelo estourava o limite em quase todo plano e gastava um passo
  // refazendo a chamada (dois em sete ciclos dos primeiros mandatos).
  acao: z.string().min(1).max(120),
  quando: z.string().min(1),
  contato: z.string().max(120).nullable().optional(),
  por_que: z.string().min(1).max(400),
  condicao: z.string().max(300).nullable().optional(),
  /**
   * O que esta ação ESPERA, quando é uma espera: a resposta de uma mensagem ou o resultado de
   * uma ligação. Os dois chegam sozinhos e acordam o mandato; o horário é só o teto.
   */
  aguarda: z.enum(['resposta', 'ligacao']).nullable().optional(),
  /**
   * O trecho da conversa em que o CLIENTE pediu este horário ("me liga amanhã às 10h"). É a
   * única coisa que autoriza uma espera maior que `espera_maxima_min` (regras de ritmo).
   */
  pedido_do_cliente: z.string().max(300).nullable().optional(),
})

export const planoSchema = z.object({
  objetivo_atual: z.string().min(1).max(400),
  hipotese: z.string().max(600).nullable().optional(),
  proximas_acoes: z.array(proximaAcaoPlanoSchema).max(8),
  bloqueios: z.array(z.string().max(300)).max(8).default([]),
  confianca: z.number().min(0).max(1),
})
export type PlanoMandato = z.infer<typeof planoSchema>
export type ProximaAcaoPlano = z.infer<typeof proximaAcaoPlanoSchema>

// ─── A persona (§3) ─────────────────────────────────────────────────────────

export const personaSchema = z.object({
  nome_exibicao: z.string().min(1).max(60),
  tom: z.string().max(400).nullable().optional(),
  assinatura_email: z.string().max(800).nullable().optional(),
  bio_curta: z.string().max(400).nullable().optional(),
  foto_path: z.string().max(300).nullable().optional(),
  genero_gramatical: z.enum(['feminino', 'masculino', 'neutro']).default('feminino'),
})
export type Persona = z.infer<typeof personaSchema>

export const MODOS_RODAGEM = ['piloto', 'pleno'] as const
export type ModoRodagem = (typeof MODOS_RODAGEM)[number]

/**
 * O escopo (§3.3). `filtro` é o de agora: a IA trabalha o que cai no filtro e não recebe
 * distribuição. `carteira` é o de depois — entra no rodízio como um humano — e já está
 * implementado e DESLIGADO por `agentes_config.geral.modo_carteira_habilitado`.
 *
 * `piloto` é um filtro aplicado POR CIMA enquanto `modo_rodagem = 'piloto'`: cota limita
 * volume, piloto limita a QUEM. Os dois juntos.
 *
 * As árvores são do motor de filtros do Prompt 02 (`criarFiltroEngine`), validadas contra
 * o catálogo de `escopo.ts` na hora de usar — aqui elas são só JSON.
 */
export const escopoSchema = z.object({
  modo: z.enum(['filtro', 'carteira']).default('filtro'),
  /** Árvore sobre `agentes_empresas_alvo` (tipos de mandato por empresa). */
  filtro: z.unknown().nullable().optional(),
  /** Árvore sobre `notas_funil` (originação de NF), no catálogo das faixas. */
  filtro_nf: z.unknown().nullable().optional(),
  piloto: z.unknown().nullable().optional(),
  piloto_nf: z.unknown().nullable().optional(),
})
export type EscopoAgente = z.infer<typeof escopoSchema>

/** As cotas (§9.1), em `vendedores.limites`. */
export const limitesSchema = z.object({
  ligacoes_por_dia: z.number().int().min(0).max(1000).default(30),
  mensagens_por_dia: z.number().int().min(0).max(2000).default(60),
  emails_por_dia: z.number().int().min(0).max(2000).default(40),
  mandatos_ativos: z.number().int().min(0).max(1000).default(25),
  acoes_por_mandato_por_dia: z.number().int().min(1).max(50).default(4),
  tentativas_por_contato: z.number().int().min(1).max(20).default(4),
  cooldown_minutos_mesmo_contato: z.number().int().min(0).max(10_080).default(180),
  /** Teto diário de gasto do agente, em centavos. 0 = sem teto próprio (vale o global). */
  gasto_diario_centavos: z.number().int().min(0).default(0),
})
export type LimitesAgente = z.infer<typeof limitesSchema>
export const LIMITES_AGENTE_PADRAO: LimitesAgente = limitesSchema.parse({})

export function lerLimitesAgente(bruto: unknown): LimitesAgente {
  const r = limitesSchema.safeParse(bruto ?? {})
  return r.success ? r.data : LIMITES_AGENTE_PADRAO
}

// ─── Configuração (§12) ─────────────────────────────────────────────────────

export const janelaAgentesSchema = z.object({
  hora_inicio: z.number().int().min(0).max(23).default(9),
  hora_fim: z.number().int().min(1).max(24).default(18),
  /** ISO: 1 = segunda … 7 = domingo — a mesma convenção da janela do 05A. */
  dias_semana: z.array(z.number().int().min(1).max(7)).default([1, 2, 3, 4, 5]),
  timezone: z.string().default('America/Sao_Paulo'),
})
export type JanelaAgentes = z.infer<typeof janelaAgentesSchema>

export const precosSchema = z.object({
  /** Dólar usado para converter o preço do modelo (que é em USD) para centavos de real. */
  cambio_usd_brl: z.number().positive().default(5.5),
  /** USD por milhão de tokens (tabela da Anthropic para o `AI_MODEL`). */
  modelo_entrada_usd_mtok: z.number().min(0).default(3),
  modelo_saida_usd_mtok: z.number().min(0).default(15),
  /** Custo estimado de cada ferramenta paga, em centavos. É o valor RESERVADO antes da chamada. */
  ferramentas_centavos: z.record(z.string(), z.number().int().min(0)).default({
    buscar_contatos_apollo: 200,
    enriquecer_telefone: 165,
    buscar_dominio_empresa: 30,
    enviar_whatsapp: 2,
    enviar_email: 1,
    enviar_material: 2,
    ligar: 350,
  }),
})
export type PrecosAgentes = z.infer<typeof precosSchema>

export const disjuntorPadraoSchema = z.object({
  janela_acoes: z.number().int().min(5).max(500).default(20),
  limiar_supressao: z.number().min(0).max(1).default(0.1),
  limiar_sem_interesse: z.number().min(0).max(1).default(0.6),
  limiar_escalacao: z.number().min(0).max(1).default(0.3),
  limiar_falha_tecnica: z.number().min(0).max(1).default(0.25),
})
export type DisjuntorPadrao = z.infer<typeof disjuntorPadraoSchema>

export const configGeralSchema = z.object({
  /** O kill switch ÚNICO de tudo que é automático (§9.2). Espelhado nos dois antigos. */
  kill_switch: z.boolean().default(false),
  identificacao: z.enum(POLITICAS_IDENTIFICACAO).default('se_perguntada'),
  max_passos_por_ciclo: z.number().int().min(1).max(20).default(8),
  intervalo_ciclo_min: z.number().int().min(1).max(60).default(5),
  mandatos_por_ciclo: z.number().int().min(1).max(200).default(20),
  tempo_limite_ciclo_s: z.number().int().min(10).max(600).default(120),
  /** §1.1(c): conversa sem mandato nem playbook é reavaliada neste intervalo, não já. */
  intervalo_sem_mandato_horas: z.number().int().min(1).max(720).default(24),
  horizonte_agendamento_dias_uteis: z.number().int().min(1).max(60).default(10),
  reuniao_duracao_min: z.number().int().min(15).max(240).default(30),
  reuniao_buffer_min: z.number().int().min(0).max(120).default(15),
  reserva_janela_min: z.number().int().min(5).max(240).default(30),
  voz_timeout_minutos: z.number().int().min(5).max(600).default(30),
  /**
   * RITMO: a próxima ação nasce em até isto (minutos) a partir do fim do ciclo, salvo quando
   * o cliente pediu outro horário (`pedido_do_cliente` no plano). Antes, o modelo marcava
   * "amanhã às 10h" por hábito, e um mandato andava um passo por dia.
   */
  espera_maxima_min: z.number().int().min(2).max(240).default(10),
  /**
   * Esperando resposta ou ligação SEM novidade, o ciclo acorda no ritmo acima mas não chama o
   * modelo — até passar isto (minutos) desde o último ciclo de verdade. A novidade (resposta,
   * resultado de ligação) acorda o mandato na hora de qualquer jeito.
   */
  espera_sem_novidade_max_min: z.number().int().min(10).max(1440).default(120),
  /** §3.3: `carteira` implementado e desligado — é uma flag, não um projeto. */
  modo_carteira_habilitado: z.boolean().default(false),
  /** Hora (São Paulo) do digest diário por agente. */
  digest_hora: z.number().int().min(0).max(23).default(18),
})
export type ConfigGeralAgentes = z.infer<typeof configGeralSchema>

export const orcamentoConfigSchema = z.object({
  /** O teto do mês quando a linha do mês ainda não existe. 0 = nada pago roda. */
  teto_mensal_centavos: z.number().int().min(0).default(0),
  alertas_pct: z.array(z.number().int().min(1).max(99)).default([50, 80, 95]),
})
export type OrcamentoConfig = z.infer<typeof orcamentoConfigSchema>

export interface ConfigAgentes {
  geral: ConfigGeralAgentes
  janela: JanelaAgentes
  precos: PrecosAgentes
  disjuntor: DisjuntorPadrao
  orcamento: OrcamentoConfig
}

export const CONFIG_AGENTES_PADRAO: ConfigAgentes = {
  geral: configGeralSchema.parse({}),
  janela: janelaAgentesSchema.parse({}),
  precos: precosSchema.parse({}),
  disjuntor: disjuntorPadraoSchema.parse({}),
  orcamento: orcamentoConfigSchema.parse({}),
}

/**
 * Merge por chave com o default, a mesma regra dos outros `*_config`: linha ausente ou
 * pela metade faz tudo rodar com o padrão da spec. Um valor inválido numa chave derruba
 * SÓ aquela chave para o default — não o módulo inteiro.
 */
export function montarConfigAgentes(linhas: ReadonlyArray<{ chave: string; valor: unknown }>): ConfigAgentes {
  const por = new Map(linhas.map((l) => [l.chave, l.valor]))
  const ler = <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, chave: string, padrao: T): T => {
    const bruto = por.get(chave)
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return padrao
    const r = schema.safeParse({ ...(padrao as object), ...(bruto as object) })
    return r.success ? r.data : padrao
  }
  return {
    geral: ler(configGeralSchema, 'geral', CONFIG_AGENTES_PADRAO.geral),
    janela: ler(janelaAgentesSchema, 'janela', CONFIG_AGENTES_PADRAO.janela),
    precos: ler(precosSchema, 'precos', CONFIG_AGENTES_PADRAO.precos),
    disjuntor: ler(disjuntorPadraoSchema, 'disjuntor', CONFIG_AGENTES_PADRAO.disjuntor),
    orcamento: ler(orcamentoConfigSchema, 'orcamento', CONFIG_AGENTES_PADRAO.orcamento),
  }
}

export type { PoliticaIdentificacao }

// ─── Materiais (§5) ─────────────────────────────────────────────────────────

export const TIPOS_MATERIAL = ['pdf', 'link', 'imagem', 'video', 'texto'] as const
export type TipoMaterial = (typeof TIPOS_MATERIAL)[number]

export const TIPO_MATERIAL_LABELS: Record<TipoMaterial, string> = {
  pdf: 'PDF',
  link: 'Link',
  imagem: 'Imagem',
  video: 'Vídeo',
  texto: 'Texto',
}

export const materialSchema = z
  .object({
    id: z.string().uuid().optional(),
    nome: z.string().trim().min(2).max(120),
    descricao: z.string().trim().min(5).max(600),
    quando_usar: z.string().trim().min(10).max(600),
    tipo: z.enum(TIPOS_MATERIAL),
    arquivo_path: z.string().max(400).nullable().optional(),
    url: z.string().url().max(800).nullable().optional(),
    corpo: z.string().max(4000).nullable().optional(),
    tags: z.array(z.string().max(40)).max(20).default([]),
    canais: z.array(z.enum(['email', 'whatsapp'])).min(1).default(['email', 'whatsapp']),
    ativo: z.boolean().default(true),
  })
  .superRefine((m, ctx) => {
    if ((m.tipo === 'pdf' || m.tipo === 'imagem' || m.tipo === 'video') && !m.arquivo_path && !m.url) {
      ctx.addIssue({ code: 'custom', message: 'Envie o arquivo ou informe a URL.', path: ['arquivo_path'] })
    }
    if (m.tipo === 'link' && !m.url) {
      ctx.addIssue({ code: 'custom', message: 'Link exige a URL.', path: ['url'] })
    }
    if (m.tipo === 'texto' && !m.corpo?.trim()) {
      ctx.addIssue({ code: 'custom', message: 'Texto exige o corpo.', path: ['corpo'] })
    }
  })
export type MaterialInput = z.infer<typeof materialSchema>

// ─── Regras de criação de mandato (§2.3) ────────────────────────────────────

export const mandatoRegraSchema = z.object({
  id: z.string().uuid().optional(),
  nome: z.string().trim().min(3).max(120),
  tipo_mandato: z.enum(TIPOS_MANDATO),
  agente_id: z.string().uuid(),
  filtro: z.unknown(),
  objetivo_template: z.string().trim().min(10).max(600),
  orcamento_centavos: z.number().int().min(0).max(10_000_000),
  max_acoes: z.number().int().min(1).max(500),
  prazo_dias: z.number().int().min(1).max(180),
  teto_mandatos_ativos: z.number().int().min(1).max(10_000).nullable().optional(),
  prioridade: z.number().int().min(0).max(100).default(50),
  playbook_id: z.string().uuid().nullable().optional(),
})
export type MandatoRegraInput = z.infer<typeof mandatoRegraSchema>

/**
 * O objetivo do mandato criado por regra: o template com `{empresa}`, `{nf_numero}`,
 * `{nf_valor}` e `{sacado}` preenchidos. Chave sem valor fica como está — é o mesmo
 * princípio do compositor: o placeholder sobrevivente é VISTO, não inventado.
 */
export function objetivoDoTemplate(
  template: string,
  valores: Partial<Record<'empresa' | 'nf_numero' | 'nf_valor' | 'sacado', string | null | undefined>>,
): string {
  return template.replace(/\{(empresa|nf_numero|nf_valor|sacado)\}/g, (inteiro, chave: string) => {
    const v = valores[chave as keyof typeof valores]
    return v ? v : inteiro
  })
}

// ─── Mandato manual ─────────────────────────────────────────────────────────

export const criarMandatoSchema = z.object({
  tipo: z.enum(TIPOS_MANDATO),
  objetivo: z.string().trim().min(10).max(600),
  empresa_id: z.string().uuid(),
  nota_access_key: z.string().min(10).max(80).nullable().optional(),
  agente_id: z.string().uuid(),
  playbook_id: z.string().uuid().nullable().optional(),
  orcamento_centavos: z.number().int().min(0).max(10_000_000),
  max_acoes: z.number().int().min(1).max(500),
  prazo_dias: z.number().int().min(1).max(180),
  prioridade: z.number().int().min(0).max(100).default(50),
})
export type CriarMandatoInput = z.infer<typeof criarMandatoSchema>

/** Os padrões do botão "Delegar ao agente", por tipo — o gestor ajusta na hora. */
/*
 * `prazo_dias` é em DIAS ÚTEIS (0275). O orçamento subiu depois dos primeiros mandatos: R$ 15
 * acabava no primeiro dia (enriquecimento R$ 1,65 + duas ligações R$ 7,00 + quatro ciclos de
 * modelo ~R$ 4), e o mandato parava sem ter falado com ninguém.
 */
export const PADROES_MANDATO_MANUAL: Record<TipoMandato, { orcamento_centavos: number; max_acoes: number; prazo_dias: number }> = {
  originacao_nf: { orcamento_centavos: 4000, max_acoes: 20, prazo_dias: 10 },
  agendamento_reuniao: { orcamento_centavos: 5000, max_acoes: 25, prazo_dias: 15 },
  reativacao: { orcamento_centavos: 4000, max_acoes: 20, prazo_dias: 15 },
  qualificacao: { orcamento_centavos: 4000, max_acoes: 20, prazo_dias: 10 },
}

// ─── Disjuntor ──────────────────────────────────────────────────────────────

export const ESTADOS_DISJUNTOR = ['ok', 'alerta', 'aberto'] as const
export type EstadoDisjuntor = (typeof ESTADOS_DISJUNTOR)[number]

export const ESTADO_DISJUNTOR_LABELS: Record<EstadoDisjuntor, string> = {
  ok: 'Normal',
  alerta: 'Em alerta',
  aberto: 'Disjuntor aberto',
}

/** Estado do cartão na faixa de agentes (§11.1). */
export type EstadoAgenteAoVivo = 'operando' | 'ocioso' | 'pausado' | 'disjuntor_aberto' | 'sem_linha'

export const ESTADO_AGENTE_AO_VIVO_LABELS: Record<EstadoAgenteAoVivo, string> = {
  operando: 'Operando',
  ocioso: 'Ocioso',
  pausado: 'Pausado',
  disjuntor_aberto: 'Disjuntor aberto',
  sem_linha: 'Sem linha de WhatsApp',
}

// ─── Versão da Ana (§15.4) ──────────────────────────────────────────────────

export const VERSOES_VOZ = ['v1', 'v2', 'desconhecida'] as const
export type VersaoVoz = (typeof VERSOES_VOZ)[number]

export const OBJETIVOS_LIGACAO = ['ofertar_antecipacao', 'agendar_reuniao', 'qualificar', 'reativar'] as const
export type ObjetivoLigacao = (typeof OBJETIVOS_LIGACAO)[number]

export const OBJETIVO_LIGACAO_LABELS: Record<ObjetivoLigacao, string> = {
  ofertar_antecipacao: 'Ofertar antecipação de uma NF',
  agendar_reuniao: 'Agendar reunião',
  qualificar: 'Qualificar interesse',
  reativar: 'Reativar cliente',
}

/**
 * AS VOZES DA ANA. `voz_conta_id` não é um cadastro do lado dela: é o NOME da voz do
 * GPT-Live (resposta da Ana à v2, 28/09/2026). Nome desconhecido não derruba a ligação —
 * cai na voz padrão dela, `bossa`, e fica registrado. Vazio também é `bossa`.
 */
export const VOZES_ANA = ['bossa', 'tempo', 'marin', 'cedar', 'vale'] as const
export const VOZ_ANA_PADRAO = 'bossa'
export const VOZ_ANA_LABELS: Record<(typeof VOZES_ANA)[number], string> = {
  bossa: 'bossa — feminina, português do Brasil (padrão da Ana)',
  tempo: 'tempo',
  marin: 'marin',
  cedar: 'cedar',
  vale: 'vale',
}

/** O agente dono deste tipo de mandato fala como SDR (reunião) ou como originador (NF)? */
export function tipoVendedorDoMandato(tipo: TipoMandato): 'sdr' | 'originador' {
  return tipo === 'originacao_nf' ? 'originador' : 'sdr'
}

// ─── Entradas das ações da tela ─────────────────────────────────────────────

export const salvarPersonaSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  nome: z.string().trim().min(2).max(80),
  tipo: z.enum(['sdr', 'originador']),
  persona: personaSchema,
  whatsapp_conta_id: z.string().uuid().nullable().optional(),
  email_remetente: z.string().email().max(200).nullable().optional(),
  email_caixa_id: z.string().uuid().nullable().optional(),
  voz_conta_id: z.string().trim().max(120).nullable().optional(),
  closer_id: z.string().uuid().nullable().optional(),
  closer_substituto_id: z.string().uuid().nullable().optional(),
  escopo: escopoSchema.default({ modo: 'filtro' }),
  limites: limitesSchema.default({}),
  modo_rodagem: z.enum(MODOS_RODAGEM).default('piloto'),
  autonomo: z.boolean().default(false),
  ativo: z.boolean().default(true),
})
export type SalvarPersonaInput = z.infer<typeof salvarPersonaSchema>

export const ACOES_HUMANAS_MANDATO = ['pausar', 'retomar', 'assumir', 'encerrar', 'reatribuir', 'ajustar_orcamento'] as const
export type AcaoHumanaMandato = (typeof ACOES_HUMANAS_MANDATO)[number]

export const ACAO_HUMANA_LABELS: Record<AcaoHumanaMandato, string> = {
  pausar: 'Pausar',
  retomar: 'Retomar',
  assumir: 'Assumir manualmente',
  encerrar: 'Encerrar',
  reatribuir: 'Reatribuir agente',
  ajustar_orcamento: 'Ajustar orçamento',
}

export const acaoMandatoSchema = z.object({
  mandato_id: z.string().uuid(),
  acao: z.enum(ACOES_HUMANAS_MANDATO),
  agente_id: z.string().uuid().nullable().optional(),
  orcamento_centavos: z.number().int().min(0).max(10_000_000).nullable().optional(),
  max_acoes: z.number().int().min(1).max(500).nullable().optional(),
  expira_em: z.string().nullable().optional(),
  resultado: z.string().max(600).nullable().optional(),
})
export type AcaoMandatoInput = z.infer<typeof acaoMandatoSchema>

export const decidirPropostaSchema = z.object({
  id: z.string().uuid(),
  aprovar: z.boolean(),
  motivo: z.string().max(600).nullable().optional(),
  agente_id: z.string().uuid().nullable().optional(),
  orcamento_centavos: z.number().int().min(0).nullable().optional(),
  max_acoes: z.number().int().min(1).nullable().optional(),
  prazo_dias: z.number().int().min(1).max(180).nullable().optional(),
})

export const salvarConfigAgentesSchema = z.discriminatedUnion('chave', [
  z.object({ chave: z.literal('geral'), valor: configGeralSchema.partial() }),
  z.object({ chave: z.literal('janela'), valor: janelaAgentesSchema.partial() }),
  z.object({ chave: z.literal('precos'), valor: precosSchema.partial() }),
  z.object({ chave: z.literal('disjuntor'), valor: disjuntorPadraoSchema.partial() }),
  z.object({ chave: z.literal('orcamento'), valor: orcamentoConfigSchema.partial() }),
])
export type SalvarConfigAgentesInput = z.infer<typeof salvarConfigAgentesSchema>

export const reabrirDisjuntorSchema = z.object({ agente_id: z.string().uuid(), motivo: z.string().trim().min(5).max(600) })
export const pausarAgenteSchema = z.object({ agente_id: z.string().uuid(), pausar: z.boolean(), motivo: z.string().max(300).nullable().optional() })
export const salvarDisjuntorSchema = disjuntorPadraoSchema.partial().extend({ agente_id: z.string().uuid() })
export const salvarCaixaSchema = z.object({
  endereco: z.string().email().max(200),
  provedor: z.enum(['google_workspace', 'resend']).default('google_workspace'),
  ativa: z.boolean().default(true),
})
export const ligarRegraSchema = z.object({ id: z.string().uuid(), ativa: z.boolean() })
