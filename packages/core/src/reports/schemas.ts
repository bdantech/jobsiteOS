import { z } from 'zod'

/**
 * Vocabulário de "Reportar bugs & melhorias" (04m).
 *
 * Duas esteiras, não uma. Um bug é consertado; uma melhoria é planejada e
 * entregue. Os verbos são diferentes porque o trabalho é diferente, e um seletor
 * único com os dez estados oferece transições que não querem dizer nada — o
 * caminho mais curto para um bug "entregue" que ninguém consegue explicar.
 *
 * Esta é a MESMA régua do CHECK cruzado `reports_status_do_tipo` (migração 0141).
 * Se as duas divergirem, quem descobre é o usuário, no meio de um clique.
 */

// ─── Tipo ───────────────────────────────────────────────────────────────────

export const TIPOS_REPORT = ['bug', 'melhoria'] as const
export type TipoReport = (typeof TIPOS_REPORT)[number]

export const TIPO_REPORT_LABELS: Record<TipoReport, string> = {
  bug: 'Bug',
  melhoria: 'Melhoria',
}

/**
 * O placeholder muda por tipo porque a pergunta é outra. "O que aconteceu?" para
 * quem viu algo quebrar; "o que facilitaria seu trabalho?" para quem quer algo
 * que ainda não existe. Um campo genérico rende descrições genéricas.
 */
export const DESCRICAO_PLACEHOLDER: Record<TipoReport, string> = {
  bug: 'O que aconteceu? O que você esperava?',
  melhoria: 'O que facilitaria seu trabalho?',
}

export const TITULO_PLACEHOLDER: Record<TipoReport, string> = {
  bug: 'Em uma linha: o que quebrou',
  melhoria: 'Em uma linha: o que você quer poder fazer',
}

// ─── Status ─────────────────────────────────────────────────────────────────

export const STATUS_BUG = [
  'aberto',
  'em_analise',
  'em_correcao',
  'resolvido',
  'nao_procede',
  'duplicado',
] as const

export const STATUS_MELHORIA = [
  'aberto',
  'em_analise',
  'planejado',
  'em_desenvolvimento',
  'entregue',
  'nao_planejado',
  'duplicado',
] as const

export type StatusBug = (typeof STATUS_BUG)[number]
export type StatusMelhoria = (typeof STATUS_MELHORIA)[number]
export type StatusReport = StatusBug | StatusMelhoria

/** A união, na ordem em que as duas esteiras andam. Para filtros que ignoram o tipo. */
export const STATUS_REPORT = [
  'aberto',
  'em_analise',
  'em_correcao',
  'planejado',
  'em_desenvolvimento',
  'resolvido',
  'entregue',
  'nao_procede',
  'nao_planejado',
  'duplicado',
] as const

export const STATUS_REPORT_LABELS: Record<StatusReport, string> = {
  aberto: 'Aberto',
  em_analise: 'Em análise',
  em_correcao: 'Em correção',
  planejado: 'Planejado',
  em_desenvolvimento: 'Em desenvolvimento',
  resolvido: 'Resolvido',
  entregue: 'Entregue',
  nao_procede: 'Não procede',
  nao_planejado: 'Não planejado',
  duplicado: 'Duplicado',
}

/**
 * O que cada status quer dizer para QUEM REPORTOU. É o texto do "Meus reports",
 * e ele existe porque "Não procede" sem explicação lê-se como desprezo — quando
 * o que se quer dizer é "olhamos, e o comportamento é o esperado".
 */
export const STATUS_REPORT_DESCRICOES: Record<StatusReport, string> = {
  aberto: 'Chegou e ainda não foi triado.',
  em_analise: 'Alguém está entendendo o que aconteceu.',
  em_correcao: 'A correção está sendo feita.',
  planejado: 'Entrou na fila para ser feito.',
  em_desenvolvimento: 'Está sendo construído.',
  resolvido: 'Corrigido. Se voltar a acontecer, comente aqui.',
  entregue: 'Já está no ar.',
  nao_procede: 'Analisamos e o comportamento é o esperado. O comentário explica.',
  nao_planejado: 'Não vamos fazer por ora. O comentário explica.',
  duplicado: 'Já existia um report igual — a conversa continua no original.',
}

/** Fecha o report: sai da fila e ganha data em `resolvido_em`. */
export const STATUS_REPORT_TERMINAIS: readonly StatusReport[] = [
  'resolvido',
  'entregue',
  'nao_procede',
  'nao_planejado',
  'duplicado',
]

/** Alguém está trabalhando nele agora. É o contador "em andamento" do painel. */
export const STATUS_REPORT_EM_ANDAMENTO: readonly StatusReport[] = [
  'em_analise',
  'em_correcao',
  'planejado',
  'em_desenvolvimento',
]

/** Os status que o seletor do admin pode oferecer para este report. */
export function statusDoTipo(tipo: TipoReport): readonly StatusReport[] {
  return tipo === 'bug' ? STATUS_BUG : STATUS_MELHORIA
}

export function statusPertenceAoTipo(tipo: TipoReport, status: string): boolean {
  return (statusDoTipo(tipo) as readonly string[]).includes(status)
}

export function ehStatusTerminal(status: string): boolean {
  return (STATUS_REPORT_TERMINAIS as readonly string[]).includes(status)
}

// ─── Prioridade ─────────────────────────────────────────────────────────────

/*
 * Prioridade é do ADMIN, nunca de quem reporta. Deixar o autor escolher faria
 * toda linha nascer "crítica" — não por má-fé, mas porque o bug que trava o
 * SEU dia é crítico, e é assim que o campo deixa de ordenar coisa alguma.
 */
export const PRIORIDADES_REPORT = ['baixa', 'media', 'alta', 'critica'] as const
export type PrioridadeReport = (typeof PRIORIDADES_REPORT)[number]

export const PRIORIDADE_REPORT_LABELS: Record<PrioridadeReport, string> = {
  baixa: 'Baixa',
  media: 'Média',
  alta: 'Alta',
  critica: 'Crítica',
}

/** Ordena da mais urgente para a menos. Sem prioridade vai para o fim. */
export const PESO_PRIORIDADE: Record<PrioridadeReport, number> = {
  critica: 4,
  alta: 3,
  media: 2,
  baixa: 1,
}

export function ordenarPorPrioridade(a: string | null, b: string | null): number {
  const pa = PESO_PRIORIDADE[a as PrioridadeReport] ?? 0
  const pb = PESO_PRIORIDADE[b as PrioridadeReport] ?? 0
  return pb - pa
}

// ─── Contexto técnico ───────────────────────────────────────────────────────

export const PLATAFORMAS_REPORT = ['web', 'ios', 'android', 'desconhecida'] as const
export type PlataformaReport = (typeof PLATAFORMAS_REPORT)[number]

export const PLATAFORMA_REPORT_LABELS: Record<PlataformaReport, string> = {
  web: 'Web',
  ios: 'iOS',
  android: 'Android',
  desconhecida: 'Desconhecida',
}

/**
 * Os limites são os MESMOS da RPC (`app_report_criar` corta nos mesmos números).
 * Duplicar aqui não é redundância inútil: o zod recusa com uma frase legível
 * antes da viagem ao banco, e a RPC corta porque nunca confia no cliente.
 */
export const contextoReportSchema = z.object({
  rota: z.string().max(200).nullable(),
  url: z.string().max(500).nullable(),
  plataforma: z.enum(PLATAFORMAS_REPORT),
  user_agent: z.string().max(500).nullable(),
  viewport: z.string().max(40).nullable(),
  app_versao: z.string().max(40).nullable(),
})
export type ContextoReport = z.infer<typeof contextoReportSchema>

// ─── Entradas ───────────────────────────────────────────────────────────────

export const criarReportSchema = z.object({
  tipo: z.enum(TIPOS_REPORT),
  titulo: z
    .string()
    .trim()
    .min(3, 'O título precisa de pelo menos 3 caracteres.')
    .max(140, 'O título precisa caber numa linha (até 140 caracteres).'),
  descricao: z
    .string()
    .trim()
    .min(5, 'Descreva o que aconteceu — cinco caracteres não contam a história.')
    .max(5000, 'A descrição passou de 5000 caracteres.'),
  contexto: contextoReportSchema,
  /** CAMINHO no bucket privado, não uma URL. Ver o comentário da coluna. */
  anexo_url: z.string().max(500).nullable().optional(),
})
export type CriarReport = z.infer<typeof criarReportSchema>

/**
 * `prioridade` distingue AUSENTE de NULO, e isso é de propósito: sem a chave, a
 * RPC mantém o que estava; com a chave em null, ela limpa. É o que permite
 * desfazer uma prioridade posta por engano sem inventar um valor "nenhuma".
 */
export const atualizarReportSchema = z
  .object({
    report_id: z.string().uuid(),
    status: z.enum(STATUS_REPORT).optional(),
    prioridade: z.enum(PRIORIDADES_REPORT).nullable().optional(),
    duplicado_de: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.status !== 'duplicado' || Boolean(v.duplicado_de), {
    message: 'Marcar como duplicado exige apontar o report original.',
    path: ['duplicado_de'],
  })
export type AtualizarReport = z.infer<typeof atualizarReportSchema>

export const comentarReportSchema = z.object({
  report_id: z.string().uuid(),
  texto: z
    .string()
    .trim()
    .min(1, 'O comentário está vazio.')
    .max(5000, 'O comentário passou de 5000 caracteres.'),
  /** Só admin. A RPC ignora a flag de quem não é — não recusa, ignora. */
  interno: z.boolean().optional(),
})
export type ComentarReport = z.infer<typeof comentarReportSchema>

export const definirBetaSchema = z
  .object({
    habilitado: z.boolean(),
    texto: z
      .string()
      .trim()
      .max(200, 'O texto do banner precisa caber numa linha (até 200 caracteres).'),
  })
  .refine((v) => !v.habilitado || v.texto.length > 0, {
    message: 'Ligar o modo beta sem texto deixaria uma tarja vazia no topo de todas as telas.',
    path: ['texto'],
  })
export type DefinirBeta = z.infer<typeof definirBetaSchema>

// ─── Modo beta ──────────────────────────────────────────────────────────────

export interface EstadoBeta {
  habilitado: boolean
  texto: string
}

export const BETA_PADRAO: EstadoBeta = {
  habilitado: false,
  texto: 'Plataforma em fase beta — sua opinião ajuda a melhorar.',
}

/**
 * Lê `app_config.beta` sem nunca lançar.
 *
 * O banner mora no shell de TODA a aplicação. Um jsonb inesperado aqui não pode
 * derrubar a moldura de todas as telas — desligado é o estado seguro, e uma
 * plataforma sem tarja é infinitamente melhor que uma plataforma sem casca.
 */
export function lerEstadoBeta(valor: unknown): EstadoBeta {
  if (typeof valor !== 'object' || valor === null) return { ...BETA_PADRAO }
  const v = valor as Record<string, unknown>
  const texto = typeof v.texto === 'string' ? v.texto.trim() : ''
  return {
    // Só `true` liga. Uma string "true" vinda de um valor mal gravado não conta:
    // ligar o banner da empresa inteira por coerção de tipo é o tipo de acidente
    // que ninguém consegue rastrear depois.
    habilitado: v.habilitado === true && texto.length > 0,
    texto: texto.length > 0 ? texto : BETA_PADRAO.texto,
  }
}
