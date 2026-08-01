import { z } from 'zod'

/**
 * Vocabulário, config e schemas de entrada do Perfil de Quem Opera (04f).
 *
 * As COMPARAÇÕES são fixas e não configuráveis (§2). É uma decisão de produto:
 * três contrastes bem escolhidos que qualquer pessoa entende valem mais que um
 * construtor de coortes que ninguém usa — e que produziria comparações sem
 * controle, que é exatamente o erro que este módulo existe para não cometer.
 */

export const TRILHAS = ['sacados', 'fornecedores'] as const
export const trilhaSchema = z.enum(TRILHAS)
export type Trilha = z.infer<typeof trilhaSchema>

export const TRILHA_LABELS: Record<Trilha, string> = {
  sacados: 'Sacados',
  fornecedores: 'Fornecedores',
}

export const TRILHA_PERGUNTAS: Record<Trilha, string> = {
  sacados: 'Como são as construtoras que mais operam?',
  fornecedores: 'Como são os fornecedores cujas notas convertem?',
}

/** As três comparações do §2, com o rótulo de cada lado já resolvido. */
export const COMPARACOES = [
  {
    id: 'pesados_x_dormentes',
    trilha: 'sacados',
    label: 'Pesados × dormentes',
    rotulo_a: 'sacados pesados',
    rotulo_b: 'sacados dormentes',
    descricao:
      'Quem consome limite e antecipa com frequência, contra quem está na base e parou. ' +
      'É o contraste com o melhor controle da trilha: os dois lados já são clientes.',
  },
  {
    id: 'clientes_x_som',
    trilha: 'sacados',
    label: 'Clientes × SOM não-cliente',
    rotulo_a: 'clientes',
    rotulo_b: 'empresas do SOM que ainda não são clientes',
    descricao:
      'O que separa quem fechou de quem a régua considera endereçável e não fechou. ' +
      'É o contraste que alimenta as regras de camada.',
  },
  {
    id: 'conversores_x_expostos',
    trilha: 'fornecedores',
    label: 'Conversores × expostos não-conversores',
    rotulo_a: 'fornecedores que converteram',
    rotulo_b: 'fornecedores expostos que não converteram',
    descricao:
      'O controle principal da trilha: os dois lados tiveram NF em faixa no período, ' +
      'ou seja, a mesma exposição. O que muda é o desfecho.',
  },
] as const

export type ComparacaoId = (typeof COMPARACOES)[number]['id']

export function comparacao(id: string) {
  return COMPARACOES.find((c) => c.id === id)
}

export function comparacoesDaTrilha(trilha: Trilha) {
  return COMPARACOES.filter((c) => c.trilha === trilha)
}

// ─── Config ─────────────────────────────────────────────────────────────────

export const PERFIL_CONFIG_CHAVES = {
  COORTES: 'coortes',
  ANALISE: 'analise',
} as const

export interface ConfigCoortes {
  /** Fração do limite consumida a partir da qual o sacado é "pesado". */
  pesado_consumo_pct: number
  /** Antecipações em 2 meses a partir das quais o sacado é "pesado". */
  pesado_antecipacoes_2m: number
  /** Dias sem antecipar a partir dos quais o sacado é "dormente". */
  dormente_dias: number
  /** Janela, em dias, para considerar um fornecedor "conversor". */
  conversor_janela_dias: number
}

export const CONFIG_COORTES_PADRAO: ConfigCoortes = {
  pesado_consumo_pct: 0.6,
  pesado_antecipacoes_2m: 6,
  dormente_dias: 30,
  conversor_janela_dias: 90,
}

export interface ConfigAnalise {
  n_minimo: number
  cobertura_minima: number
  lift_minimo: number
  fracao_barrada_minima: number
  cobertura_alvo: number
  /** Teto de linhas por coorte de controle — o SOM tem 1.692 e o universo, milhões. */
  max_linhas_controle: number
}

export const CONFIG_ANALISE_PADRAO: ConfigAnalise = {
  n_minimo: 15,
  cobertura_minima: 0.4,
  lift_minimo: 2,
  fracao_barrada_minima: 0.1,
  cobertura_alvo: 0.95,
  max_linhas_controle: 20_000,
}

// ─── Tools e mutações ───────────────────────────────────────────────────────

export const perfilResumoSchema = z.object({
  trilha: trilhaSchema
    .optional()
    .describe('Recorta a uma trilha: sacados ou fornecedores. Ausente = as duas.'),
})
export type PerfilResumoInput = z.infer<typeof perfilResumoSchema>

export const perfilSugestoesSchema = z.object({
  trilha: trilhaSchema.optional().describe('Recorta a uma trilha. Ausente = as duas.'),
})
export type PerfilSugestoesInput = z.infer<typeof perfilSugestoesSchema>

/**
 * O registro do um-clique (§6). `aceita` NÃO ativa regra nenhuma: ela só carimba
 * a decisão e devolve o id que o editor usa para carregar o rascunho — a
 * ativação continua sendo o fluxo de sempre, com preview e confirmação.
 */
export const registrarSugestaoSchema = z.object({
  snapshot_id: z.string().uuid(),
  sugestao_id: z.string().min(1).max(200),
  acao: z.enum(['aceita', 'descartada']),
  motivo: z.string().trim().max(500).optional().nullable(),
})
export type RegistrarSugestaoInput = z.infer<typeof registrarSugestaoSchema>

/** Fecha o ciclo: a versão que o editor criou a partir da sugestão aceita. */
export const vincularVersaoSugestaoSchema = z.object({
  log_id: z.string().uuid(),
  regra_versao_criada: z.number().int().positive(),
})
export type VincularVersaoSugestaoInput = z.infer<typeof vincularVersaoSugestaoSchema>

export const salvarPerfilConfigSchema = z.object({
  chave: z.string().min(1).max(60),
  valor: z.unknown(),
})
export type SalvarPerfilConfigInput = z.infer<typeof salvarPerfilConfigSchema>
