import { z } from 'zod'
import { cnpjSchema } from '../schemas/index.js'

/**
 * Vocabulário e schemas do módulo Jurídico (Prompt 08).
 *
 * Mesmas convenções do resto do core: tupla SCREAMING `as const` → enum zod camelCase →
 * tipo PascalCase → LABELS pt-BR, e todo campo que chega à IA carrega `.describe()`.
 *
 * ── O RECORTE, ANTES DE QUALQUER CAMPO ──────────────────────────────────────
 * Este módulo é **judicial** e é **contra sacado devedor**. Cobrança extrajudicial
 * (notificação, protesto, acordo pré-judicial) é o Prompt 07 e ainda não existe;
 * `processos.vinculo_cobranca_id` está reservado para o dia em que existir. Processo
 * em que não somos parte é dado de risco do Radar, não entra aqui.
 */

// ─── O número do processo ───────────────────────────────────────────────────

/**
 * CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO (Resolução CNJ 65/2008).
 *
 * Guardado COM a máscara, e não só com os 20 dígitos: é a forma que o advogado lê,
 * digita e copia para a petição, e é a chave primária — normalizar para dígitos puros
 * obrigaria toda tela a remontar a máscara e todo log a ser ilegível.
 */
export const CNJ_REGEX = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/

export const numeroCnjSchema = z
  .string()
  .trim()
  .regex(CNJ_REGEX, 'Número CNJ inválido. Formato: 0000000-00.0000.0.00.0000.')
  .describe('Número único do processo no padrão CNJ, com máscara: 0000000-00.0000.0.00.0000.')

/** Aceita o número com ou sem máscara e devolve sempre COM. Vale para busca e colagem. */
export function formatarCnj(entrada: string): string {
  const digitos = entrada.replace(/\D/g, '')
  if (digitos.length !== 20) return entrada.trim()
  return (
    `${digitos.slice(0, 7)}-${digitos.slice(7, 9)}.${digitos.slice(9, 13)}.` +
    `${digitos.slice(13, 14)}.${digitos.slice(14, 16)}.${digitos.slice(16, 20)}`
  )
}

// ─── Situação interna (o que NÓS decidimos sobre o processo) ────────────────

/**
 * Não confundir com `status_predito`, que é a classificação do Escavador sobre o
 * andamento no tribunal. Esta coluna é gestão: onde a casa colocou o processo. As duas
 * discordam com frequência e é justamente aí que está a informação — um processo
 * `INATIVO` no tribunal e `em_andamento` aqui é um processo que parou e ninguém viu.
 */
export const SITUACOES_INTERNAS = [
  'em_andamento',
  'suspenso',
  'acordo',
  'ganho',
  'perdido',
  'encerrado',
] as const
export const situacaoInternaSchema = z.enum(SITUACOES_INTERNAS)
export type SituacaoInterna = z.infer<typeof situacaoInternaSchema>

export const SITUACAO_INTERNA_LABELS: Record<SituacaoInterna, string> = {
  em_andamento: 'Em andamento',
  suspenso: 'Suspenso',
  acordo: 'Acordo',
  ganho: 'Ganho',
  perdido: 'Perdido',
  encerrado: 'Encerrado',
}

/** As situações que ainda consomem trabalho. É o recorte do monitoramento e do knockout. */
export const SITUACOES_ATIVAS: readonly SituacaoInterna[] = ['em_andamento', 'suspenso', 'acordo']

export function situacaoEhAtiva(s: string | null | undefined): boolean {
  return SITUACOES_ATIVAS.includes(s as SituacaoInterna)
}

/**
 * As situações que somem da lista por padrão.
 *
 * Só `encerrado`. `ganho` e `perdido` continuam aparecendo de propósito: eles
 * têm dinheiro a receber ou custo a apurar depois do fim da ação, e uma lista
 * que os esconde faz a recuperação ser esquecida justamente quando ela é
 * possível. `encerrado` é o único que quer dizer "não há mais nada aqui".
 */
export const SITUACOES_OCULTAS_POR_PADRAO: readonly SituacaoInterna[] = ['encerrado']

/**
 * A ordem da lista: valor decrescente, com ACORDO no fim.
 *
 * Um processo em acordo já foi resolvido — o que resta dele é acompanhar o
 * pagamento, não decidir o que fazer. Deixá-lo no topo por ser o de maior valor
 * empurraria para baixo justamente os que ainda pedem decisão, que é a pergunta
 * que a lista existe para responder.
 *
 * Devolve a chave de ordenação; quem ordena passa por `sort` com ela.
 */
export function pesoNaCarteira(situacao: string | null | undefined): number {
  if (situacao === 'acordo') return 1
  return 0
}

/** A ordem do kanban. Espelha o ciclo de vida, não o alfabeto. */
export const COLUNAS_JURIDICO: readonly SituacaoInterna[] = [
  'em_andamento',
  'suspenso',
  'acordo',
  'ganho',
  'perdido',
  'encerrado',
]

// ─── Fases da ação (§5) ─────────────────────────────────────────────────────

/**
 * A ordem É a semântica: `fase_atual` é a fase MAIS AVANÇADA já detectada, e "mais
 * avançada" quer dizer "de índice maior nesta lista". Reordenar aqui reescreve o
 * cronograma de todo processo da base.
 */
export const FASES = [
  'distribuicao',
  'citacao',
  'contestacao_embargos',
  'instrucao',
  'sentenca',
  'recurso',
  'transito_julgado',
  'cumprimento_execucao',
  'penhora',
  'leilao_expropriacao',
  'arquivamento',
] as const
export const faseSchema = z.enum(FASES)
export type Fase = z.infer<typeof faseSchema>

export const FASE_LABELS: Record<Fase, string> = {
  distribuicao: 'Distribuição',
  citacao: 'Citação',
  contestacao_embargos: 'Contestação / embargos',
  instrucao: 'Instrução',
  sentenca: 'Sentença',
  recurso: 'Recurso',
  transito_julgado: 'Trânsito em julgado',
  cumprimento_execucao: 'Cumprimento / execução',
  penhora: 'Penhora',
  leilao_expropriacao: 'Leilão / expropriação',
  arquivamento: 'Arquivamento',
}

/** Posição na régua. -1 para o que não é fase — nunca avança nada. */
export function ordemDaFase(fase: string | null | undefined): number {
  return FASES.indexOf(fase as Fase)
}

// ─── Partes e polos ─────────────────────────────────────────────────────────

export const POLOS = ['ativo', 'passivo'] as const
export const poloSchema = z.enum(POLOS)
export type Polo = z.infer<typeof poloSchema>

export const POLO_LABELS: Record<Polo, string> = {
  ativo: 'Polo ativo',
  passivo: 'Polo passivo',
}

export const TIPOS_ADVOGADO = ['interno', 'externo'] as const
export const tipoAdvogadoSchema = z.enum(TIPOS_ADVOGADO)
export type TipoAdvogado = z.infer<typeof tipoAdvogadoSchema>

export const TIPO_ADVOGADO_LABELS: Record<TipoAdvogado, string> = {
  interno: 'Interno',
  externo: 'Externo',
}

// ─── Movimentações ──────────────────────────────────────────────────────────

export const TIPOS_MOVIMENTACAO = ['ANDAMENTO', 'PUBLICACAO'] as const
export const tipoMovimentacaoSchema = z.enum(TIPOS_MOVIMENTACAO)
export type TipoMovimentacao = z.infer<typeof tipoMovimentacaoSchema>

export const TIPO_MOVIMENTACAO_LABELS: Record<TipoMovimentacao, string> = {
  ANDAMENTO: 'Andamento',
  PUBLICACAO: 'Publicação',
}

// ─── Custos, recuperações e prazos ──────────────────────────────────────────

export const TIPOS_CUSTO = ['custas', 'honorarios', 'pericia', 'diligencia', 'outros'] as const
export const tipoCustoSchema = z.enum(TIPOS_CUSTO)
export type TipoCusto = z.infer<typeof tipoCustoSchema>

export const TIPO_CUSTO_LABELS: Record<TipoCusto, string> = {
  custas: 'Custas',
  honorarios: 'Honorários',
  pericia: 'Perícia',
  diligencia: 'Diligência',
  outros: 'Outros',
}

export const ORIGENS_RECUPERACAO = [
  'penhora',
  'acordo',
  'pagamento_espontaneo',
  'leilao',
] as const
export const origemRecuperacaoSchema = z.enum(ORIGENS_RECUPERACAO)
export type OrigemRecuperacao = z.infer<typeof origemRecuperacaoSchema>

export const ORIGEM_RECUPERACAO_LABELS: Record<OrigemRecuperacao, string> = {
  penhora: 'Penhora',
  acordo: 'Acordo',
  pagamento_espontaneo: 'Pagamento espontâneo',
  leilao: 'Leilão',
}

export const TIPOS_PRAZO = ['prazo', 'audiencia', 'pericia'] as const
export const tipoPrazoSchema = z.enum(TIPOS_PRAZO)
export type TipoPrazo = z.infer<typeof tipoPrazoSchema>

export const TIPO_PRAZO_LABELS: Record<TipoPrazo, string> = {
  prazo: 'Prazo',
  audiencia: 'Audiência',
  pericia: 'Perícia',
}

// ─── Parecer ────────────────────────────────────────────────────────────────

export const RISCOS = ['baixo', 'medio', 'alto'] as const
export const riscoSchema = z.enum(RISCOS)
export type Risco = z.infer<typeof riscoSchema>

export const RISCO_LABELS: Record<Risco, string> = {
  baixo: 'Baixo',
  medio: 'Médio',
  alto: 'Alto',
}

/**
 * O aviso que acompanha TODO parecer, na tela e na resposta das tools.
 *
 * Não é disclaimer de rodapé jurídico: é a diferença entre um resumo que ajuda a
 * preparar a conversa com o advogado e um texto que alguém junta aos autos. O modelo lê
 * movimentações e escreve português — ele não sabe o que é preclusão nem consulta prazo
 * processual, e a única defesa contra isso é dizê-lo em todo lugar onde o texto aparece.
 */
export const AVISO_PARECER =
  'Este parecer é gerado por IA a partir dos dados desta tela. NÃO é peça jurídica, ' +
  'não substitui a análise do advogado responsável e não deve ser juntado aos autos.'

// ─── Índices de correção monetária (§6) ─────────────────────────────────────

export const INDICES = ['ipca', 'igpm', 'inpc', 'tr', 'customizado'] as const
export const indiceSchema = z.enum(INDICES)
export type Indice = z.infer<typeof indiceSchema>

export const INDICE_LABELS: Record<Indice, string> = {
  ipca: 'IPCA',
  igpm: 'IGP-M',
  inpc: 'INPC',
  tr: 'TR',
  customizado: 'Customizado',
}

// ─── Eventos do Escavador tratados no callback (§3) ─────────────────────────

export const EVENTOS_CALLBACK = ['novo_processo', 'atualizacao_processo_concluida'] as const
export const eventoCallbackSchema = z.enum(EVENTOS_CALLBACK)
export type EventoCallback = z.infer<typeof eventoCallbackSchema>

/** Status da solicitação de atualização sob demanda (`GET .../status-atualizacao`). */
export const STATUS_ATUALIZACAO = ['PENDENTE', 'SUCESSO', 'NAO_ENCONTRADO', 'ERRO'] as const
export const statusAtualizacaoSchema = z.enum(STATUS_ATUALIZACAO)
export type StatusAtualizacao = z.infer<typeof statusAtualizacaoSchema>

export const STATUS_ATUALIZACAO_LABELS: Record<StatusAtualizacao, string> = {
  PENDENTE: 'O robô está buscando no tribunal…',
  SUCESSO: 'Atualizado no tribunal.',
  NAO_ENCONTRADO: 'O tribunal não devolveu este processo.',
  ERRO: 'O robô falhou ao consultar o tribunal.',
}

/** Tipos de chamada que consomem crédito, para o log e o painel de gasto (§3). */
export const TIPOS_SYNC = [
  'busca_cnpj',
  'atualizacao_processo',
  'callback',
  'monitoramento',
] as const
export const tipoSyncSchema = z.enum(TIPOS_SYNC)
export type TipoSync = z.infer<typeof tipoSyncSchema>

export const TIPO_SYNC_LABELS: Record<TipoSync, string> = {
  busca_cnpj: 'Busca por CNPJ',
  atualizacao_processo: 'Atualização do processo',
  callback: 'Callback recebido',
  monitoramento: 'Monitoramento de novos processos',
}

// ─── Settings (§3, §4, §5, §6) ──────────────────────────────────────────────

export const JURIDICO_CONFIG_CHAVES = {
  NOSSOS_CNPJS: 'nossos_cnpjs',
  MONITORAMENTO: 'monitoramento',
  BENCHMARK_FASES: 'benchmark_fases',
  CALCULO: 'calculo',
  CLASSIFICADOR: 'classificador',
} as const

export const nossoCnpjSchema = z.object({
  cnpj: cnpjSchema,
  apelido: z.string().trim().min(1).max(80),
  ativo: z.boolean().default(true),
})
export type NossoCnpj = z.infer<typeof nossoCnpjSchema>

/**
 * A agenda do monitoramento (§4). Dias da SEMANA, e não um intervalo em horas: a
 * pergunta que o gestor responde é "o robô olha às terças?", e um `intervalo_horas`
 * obrigaria a traduzir isso de cabeça toda vez.
 */
export const monitoramentoSchema = z.object({
  /** 0 = domingo … 6 = sábado, como `Date#getDay`. Vale para TODOS os processos. */
  dias_semana: z.array(z.number().int().min(0).max(6)).max(7).default([1, 2, 3, 4, 5]),
  /** Hora local (America/Sao_Paulo) em que o job deve rodar. */
  hora: z.number().int().min(0).max(23).default(7),
  /** Só processos com situação interna ativa. Desligar varre também os encerrados. */
  apenas_ativos: z.boolean().default(true),
  /**
   * Pedir ao robô do Escavador para ir ao TRIBUNAL, e não apenas ler a base dele.
   * Desligado por padrão porque CUSTA CRÉDITO por processo por rodada — ligar isso com
   * 300 processos e cinco dias na semana é uma fatura que ninguém aprovou.
   */
  forcar_atualizacao_tribunal: z.boolean().default(false),
  /** Sem movimentação há mais de N dias → evento `processo.sem_movimentacao`. */
  dias_sem_movimentacao: z.number().int().min(7).max(365).default(60),
  /**
   * Em que dia da semana o sync também regera os RESUMOS DE IA dos processos que
   * ficaram velhos. Sexta (5) por padrão.
   *
   * Um dia, e não todos: o resumo custa token por processo, e regerá-lo cinco
   * vezes por semana paga cinco vezes por um texto que muda quando chega
   * movimentação — não quando o relógio vira. Sexta porque é quando alguém olha
   * a carteira para planejar a semana seguinte.
   *
   * `null` desliga o automático; o botão de cada processo continua funcionando.
   * A escolha vive aqui, e não no código, pela mesma razão dos dias de sync: é a
   * setting que decide o custo, e mudá-la não pode exigir deploy.
   */
  dia_resumo_ia: z.number().int().min(0).max(6).nullable().default(5),
})
export type ConfigMonitoramento = z.infer<typeof monitoramentoSchema>

/** Dias esperados em cada fase. Estourou → badge vermelho + evento (§5). */
export const benchmarkFasesSchema = z.record(faseSchema, z.number().int().min(1).max(3650))
export type BenchmarkFases = z.infer<typeof benchmarkFasesSchema>

export const BENCHMARK_FASES_PADRAO: BenchmarkFases = {
  distribuicao: 30,
  citacao: 60,
  contestacao_embargos: 45,
  instrucao: 180,
  sentenca: 180,
  recurso: 365,
  transito_julgado: 60,
  cumprimento_execucao: 120,
  penhora: 90,
  leilao_expropriacao: 180,
  arquivamento: 3650,
}

export const parametrosCalculoSchema = z.object({
  indice: indiceSchema.default('ipca'),
  /** Juros de mora ao mês, em % (1.0 = 1% a.m.). */
  juros_am: z.number().min(0).max(20).default(1),
  juros_compostos: z.boolean().default(false),
  /** Multa contratual, em % sobre o principal corrigido. */
  multa_pct: z.number().min(0).max(100).default(2),
  /** Honorários advocatícios, em % sobre o subtotal. */
  honorarios_pct: z.number().min(0).max(100).default(20),
  /** Somar as `processo_custos` do período ao total. */
  incluir_custas: z.boolean().default(true),
})
export type ParametrosCalculo = z.infer<typeof parametrosCalculoSchema>

export const PARAMETROS_CALCULO_PADRAO: ParametrosCalculo = {
  indice: 'ipca',
  juros_am: 1,
  juros_compostos: false,
  multa_pct: 2,
  honorarios_pct: 20,
  incluir_custas: true,
}

// ─── Inputs das mutações ────────────────────────────────────────────────────

export const salvarAdvogadoSchema = z.object({
  id: z.string().uuid().optional(),
  nome: z.string().trim().min(2).max(160),
  tipo: tipoAdvogadoSchema,
  escritorio: z.string().trim().max(160).nullish(),
  oab_numero: z.string().trim().max(20).nullish(),
  oab_uf: z.string().trim().length(2).nullish(),
  email: z.string().trim().email().max(160).nullish(),
  telefone: z.string().trim().max(40).nullish(),
  usuario_id: z.string().uuid().nullish(),
  ativo: z.boolean().default(true),
})
export type SalvarAdvogadoInput = z.infer<typeof salvarAdvogadoSchema>

export const atualizarProcessoSchema = z.object({
  numero_cnj: numeroCnjSchema,
  situacao_interna: situacaoInternaSchema.optional(),
  advogado_id: z.string().uuid().nullish(),
  observacoes: z.string().trim().max(5000).nullish(),
  /** Vinculação manual quando o CNPJ do devedor não estava em `empresas` na importação. */
  empresa_devedora_id: z.string().uuid().nullish(),
})
export type AtualizarProcessoInput = z.infer<typeof atualizarProcessoSchema>

export const salvarOperacaoSchema = z.object({
  id: z.string().uuid().optional(),
  numero_cnj: numeroCnjSchema,
  antecipacao_id_externo: z.number().int().positive().nullish(),
  access_key: z.string().trim().length(44).nullish(),
  valor_original: z.number().positive().max(1e12),
  vencimento: z.string().date(),
  descricao: z.string().trim().max(300).nullish(),
})
export type SalvarOperacaoInput = z.infer<typeof salvarOperacaoSchema>

export const removerOperacaoSchema = z.object({ id: z.string().uuid() })
export type RemoverOperacaoInput = z.infer<typeof removerOperacaoSchema>

export const registrarCustoSchema = z.object({
  numero_cnj: numeroCnjSchema,
  tipo: tipoCustoSchema,
  descricao: z.string().trim().max(300).nullish(),
  valor: z.number().positive().max(1e10),
  data: z.string().date(),
  /** CAMINHO no bucket privado `juridico-comprovantes`, nunca uma URL pública. */
  comprovante_url: z.string().trim().max(400).nullish(),
})
export type RegistrarCustoInput = z.infer<typeof registrarCustoSchema>

export const registrarRecuperacaoSchema = z.object({
  numero_cnj: numeroCnjSchema,
  valor: z.number().positive().max(1e12),
  data: z.string().date(),
  origem: origemRecuperacaoSchema,
  observacao: z.string().trim().max(300).nullish(),
})
export type RegistrarRecuperacaoInput = z.infer<typeof registrarRecuperacaoSchema>

export const salvarPrazoSchema = z.object({
  id: z.string().uuid().optional(),
  numero_cnj: numeroCnjSchema,
  tipo: tipoPrazoSchema,
  descricao: z.string().trim().min(2).max(300),
  data: z.string().datetime({ offset: true }),
  responsavel_id: z.string().uuid().nullish(),
})
export type SalvarPrazoInput = z.infer<typeof salvarPrazoSchema>

export const concluirPrazoSchema = z.object({
  id: z.string().uuid(),
  concluido: z.boolean().default(true),
})
export type ConcluirPrazoInput = z.infer<typeof concluirPrazoSchema>

/**
 * `Juridico` no nome porque o Crédito já exporta `editarParecerSchema` (04j) e os dois
 * saem pelo mesmo barril. Homônimos em `export *` não dão erro de execução: dão um
 * `TS2308` no build, ou — pior — o import silencioso do parecer errado.
 */
export const editarParecerJuridicoSchema = z.object({
  numero_cnj: numeroCnjSchema,
  parecer_markdown: z.string().trim().min(20).max(60_000),
  proximo_passo: z.string().trim().min(3).max(500),
  risco: riscoSchema.nullish(),
})
export type EditarParecerJuridicoInput = z.infer<typeof editarParecerJuridicoSchema>

export const salvarJuridicoConfigSchema = z.object({
  chave: z.string().trim().min(1).max(120),
  valor: z.unknown(),
})
export type SalvarJuridicoConfigInput = z.infer<typeof salvarJuridicoConfigSchema>

export const salvarIndicesSchema = z.object({
  indice: indiceSchema,
  /** Uma linha por competência (mês). `valor` é a variação DO MÊS, em % (0.45 = 0,45%). */
  linhas: z
    .array(
      z.object({
        competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência no formato AAAA-MM.'),
        valor: z.number().min(-50).max(100),
      }),
    )
    .min(1)
    .max(1200),
})
export type SalvarIndicesInput = z.infer<typeof salvarIndicesSchema>

// ─── Inputs das tools de IA (§9) ────────────────────────────────────────────

export const processosEmpresaSchema = z.object({
  cnpj: cnpjSchema.describe('CNPJ da empresa devedora, com ou sem pontuação.'),
})
export type ProcessosEmpresaInput = z.infer<typeof processosEmpresaSchema>

export const resumoCarteiraSchema = z.object({
  situacao: situacaoInternaSchema
    .optional()
    .describe('Filtra por situação interna. Omita para ver a carteira inteira.'),
})
export type ResumoCarteiraInput = z.infer<typeof resumoCarteiraSchema>

export const atualizarProcessoToolSchema = z.object({
  numero_cnj: numeroCnjSchema,
})
export type AtualizarProcessoToolInput = z.infer<typeof atualizarProcessoToolSchema>

export const gerarCalculoToolSchema = z.object({
  numero_cnj: numeroCnjSchema,
  data_base: z
    .string()
    .date()
    .optional()
    .describe('Até quando corrigir (AAAA-MM-DD). Omita para usar hoje.'),
})
export type GerarCalculoToolInput = z.infer<typeof gerarCalculoToolSchema>

export const gerarParecerToolSchema = z.object({
  numero_cnj: numeroCnjSchema,
})
export type GerarParecerToolInput = z.infer<typeof gerarParecerToolSchema>
