import { z } from 'zod'
import { MODOS_AGENTE, OBJETIVOS, type ObjetivoConversa } from '../comunicacao/schemas.js'

/**
 * Campanhas (05B): o vocabulário.
 *
 * A diferença essencial em relação ao 05A é a quantidade de destinatários, não o
 * mecanismo. Uma campanha não sabe enviar — ela decide QUEM e QUANDO, e empurra
 * para a mesma fila que o compositor usa. Por isso quase tudo aqui é sobre
 * público, ritmo e exclusão, e quase nada é sobre transporte.
 */

export const TIPOS_CAMPANHA = ['prospeccao', 'winback', 'operacional', 'anuncio'] as const
export type TipoCampanha = (typeof TIPOS_CAMPANHA)[number]

export const TIPO_CAMPANHA_LABELS: Record<TipoCampanha, string> = {
  prospeccao: 'Prospecção',
  winback: 'Reconquista',
  operacional: 'Operacional',
  anuncio: 'Anúncio',
}

export const TIPO_CAMPANHA_DESCRICOES: Record<TipoCampanha, string> = {
  prospeccao: 'Primeiro contato com quem ainda não é cliente.',
  winback: 'Ex-cliente. A mensagem muda conforme o motivo da saída.',
  operacional: 'Pendência concreta: documento, certificado, cadastro.',
  anuncio: 'Novidade para quem já nos conhece.',
}

export const CANAIS_CAMPANHA = ['whatsapp', 'email'] as const
export type CanalCampanha = (typeof CANAIS_CAMPANHA)[number]

export const ORIGENS_PUBLICO = ['segmento', 'filtro', 'lista_manual', 'preset'] as const
export type OrigemPublico = (typeof ORIGENS_PUBLICO)[number]

export const ORIGEM_PUBLICO_LABELS: Record<OrigemPublico, string> = {
  segmento: 'Segmento salvo',
  filtro: 'Filtro montado agora',
  lista_manual: 'Lista de empresas',
  preset: 'Atalho pronto',
}

export const STATUS_CAMPANHA = [
  'rascunho',
  'aguardando_aprovacao',
  'agendada',
  'executando',
  'pausada',
  'concluida',
  'cancelada',
] as const
export type StatusCampanha = (typeof STATUS_CAMPANHA)[number]

export const STATUS_CAMPANHA_LABELS: Record<StatusCampanha, string> = {
  rascunho: 'Rascunho',
  aguardando_aprovacao: 'Aguardando aprovação',
  agendada: 'Agendada',
  executando: 'Executando',
  pausada: 'Pausada',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
}

/** Campanha viva: consome teto de número e aparece no badge do Company 360. */
export function campanhaAtiva(status: string): boolean {
  return status === 'agendada' || status === 'executando'
}

// ─── Presets ────────────────────────────────────────────────────────────────

export const PRESETS_CAMPANHA = [
  'winback_ex_clientes',
  'spes_sem_certificado',
  'docs_pendentes',
  'fornecedores_a_cadastrar',
] as const
export type PresetCampanha = (typeof PRESETS_CAMPANHA)[number]

export interface DefinicaoPreset {
  id: PresetCampanha
  label: string
  /** O que ele monta, em uma frase — é o que a tela mostra no cartão. */
  descricao: string
  tipoSugerido: TipoCampanha
  objetivoSugerido: ObjetivoConversa | null
  /**
   * O preset exige uma escolha antes de poder rodar? `winback` exige, e essa é a
   * regra mais importante desta lista: reativação genérica é spam com nostalgia.
   */
  exigeParametro?: 'motivo_saida'
}

export const PRESETS: readonly DefinicaoPreset[] = [
  {
    id: 'winback_ex_clientes',
    label: 'Reconquista de ex-clientes',
    descricao:
      'Ex-clientes agrupados pelo MOTIVO da saída. Quem saiu por taxa alta recebe proposta ' +
      'recalibrada; quem saiu porque o caixa melhorou recebe mensagem de disponibilidade.',
    tipoSugerido: 'winback',
    objetivoSugerido: 'reativar',
    exigeParametro: 'motivo_saida',
  },
  {
    id: 'spes_sem_certificado',
    label: 'SPEs sem certificado válido',
    descricao:
      'A cauda de SPEs descobertas sem certificado. O destinatário é o ponto focal da MATRIZ — ' +
      'a SPE quase nunca tem gente própria para responder.',
    tipoSugerido: 'operacional',
    objetivoSugerido: 'renovar_certificado',
  },
  {
    id: 'docs_pendentes',
    label: 'Documentação parada',
    descricao:
      'Cards de venda em "aguardando documentação" há mais de N dias. É cobrança de pendência, ' +
      'não prospecção: quem está aqui já disse sim.',
    tipoSugerido: 'operacional',
    objetivoSugerido: 'cobrar_documentacao',
  },
  {
    id: 'fornecedores_a_cadastrar',
    label: 'Fornecedores a cadastrar',
    descricao: 'O funil de cadastro (04l), filtrado por potencial mensal mínimo.',
    tipoSugerido: 'prospeccao',
    objetivoSugerido: 'cadastrar_fornecedor',
  },
]

export function preset(id: string): DefinicaoPreset | undefined {
  return PRESETS.find((p) => p.id === id)
}

// ─── Motivos de exclusão ────────────────────────────────────────────────────

/**
 * Cada motivo é uma resposta diferente à mesma pergunta ("por que esta empresa
 * não recebeu?"), e é por isso que eles não podem ser colapsados num
 * `inelegivel` genérico: metade do valor da simulação é a pessoa olhar a lista e
 * dizer "opa, 400 sem contato — está faltando enriquecer, não filtrar".
 */
export const MOTIVOS_EXCLUSAO = [
  'suprimido',
  'sem_contato',
  'contatado_recente',
  'conversa_aberta',
  'sem_base_legal',
  'teto_diario',
  'duplicado',
  'processo_juridico',
  'passivo',
  'outra_campanha',
  'frequencia_90d',
  'cancelada',
] as const
export type MotivoExclusao = (typeof MOTIVOS_EXCLUSAO)[number]

export const MOTIVO_EXCLUSAO_LABELS: Record<MotivoExclusao, string> = {
  suprimido: 'Na lista de supressão',
  sem_contato: 'Sem contato no canal escolhido',
  contatado_recente: 'Falamos com ela há pouco',
  conversa_aberta: 'Já tem conversa em andamento',
  sem_base_legal: 'Contato sem base legal registrada',
  teto_diario: 'Teto diário do número atingido',
  duplicado: 'Outra pessoa da mesma empresa já entrou',
  processo_juridico: 'Temos processo jurídico ativo contra ela',
  passivo: 'Conta passiva — não recebe prospecção',
  outra_campanha: 'Já está em outra campanha ativa',
  frequencia_90d: 'Já recebeu campanhas demais nos últimos 90 dias',
  cancelada: 'A campanha foi cancelada antes de chegar nela',
}

export const MOTIVO_EXCLUSAO_EXPLICACOES: Record<MotivoExclusao, string> = {
  suprimido: 'Pediu para não ser abordada, ou o e-mail deu hard bounce. Nunca é furado.',
  sem_contato:
    'Não há e-mail (ou WhatsApp) válido cadastrado. Não é filtro: é enriquecimento faltando.',
  contatado_recente: 'Dentro da janela de "excluir contatados nos últimos N dias" da campanha.',
  conversa_aberta:
    'Tem thread viva. Um disparo por cima de uma conversa em andamento é o pior erro possível.',
  sem_base_legal: 'Sem base legal para o canal. É requisito de LGPD, não preferência.',
  teto_diario: 'Os números disponíveis já mandaram o que aguentam hoje. Vai para amanhã.',
  duplicado: 'Uma empresa gera um destinatário. Duas pessoas da mesma empresa é a mesma abordagem.',
  processo_juridico: 'Cobrar quem estamos processando é o tipo de erro que vira print.',
  passivo: 'A conta foi classificada como passiva: por decisão, não recebe prospecção.',
  outra_campanha: 'Ninguém em duas campanhas ativas ao mesmo tempo.',
  frequencia_90d: 'O teto de campanhas por contato em 90 dias protege a relação.',
  cancelada: 'A campanha foi cancelada e o que não saiu não sai.',
}

export const STATUS_DESTINATARIO = [
  'pendente',
  'agendada',
  'enviada',
  'falhou',
  'excluida',
  'respondida',
  'optout',
] as const
export type StatusDestinatario = (typeof STATUS_DESTINATARIO)[number]

export const STATUS_DESTINATARIO_LABELS: Record<StatusDestinatario, string> = {
  pendente: 'Na fila',
  agendada: 'Agendada',
  enviada: 'Enviada',
  falhou: 'Falhou',
  excluida: 'Excluída',
  respondida: 'Respondeu',
  optout: 'Descadastrou',
}

// ─── Variantes e sequência ──────────────────────────────────────────────────

export const MAX_PASSOS = 3

/**
 * Uma variante é um template com peso. `passo` transforma o conjunto numa
 * sequência leve: até 3 toques, com `dias_apos` medido do toque ANTERIOR.
 *
 * Três é o teto por decisão, não por limitação: sequências longas e ramificadas
 * são trabalho do Agente (05A), que sabe ler a resposta. Uma campanha que insiste
 * cinco vezes sem ler nada é a definição de spam.
 */
export const varianteSchema = z.object({
  id: z.string().trim().min(1).max(40),
  template_id: z.string().uuid(),
  peso: z.number().int().min(1).max(100).default(1),
  passo: z.number().int().min(1).max(MAX_PASSOS).default(1),
  /** Dias após o toque anterior. Ignorado no passo 1. */
  dias_apos: z.number().int().min(1).max(60).default(3),
})
export type Variante = z.infer<typeof varianteSchema>

export const criarCampanhaSchema = z
  .object({
    id: z.string().uuid().optional(),
    nome: z.string().trim().min(1, 'Dê um nome à campanha.').max(120),
    tipo: z.enum(TIPOS_CAMPANHA),
    objetivo: z.enum(OBJETIVOS).optional().nullable(),
    canal: z.enum(CANAIS_CAMPANHA),

    origem_publico: z.enum(ORIGENS_PUBLICO),
    segmento_id: z.string().uuid().optional().nullable(),
    definicao_filtro: z.unknown().optional().nullable(),
    preset: z.enum(PRESETS_CAMPANHA).optional().nullable(),
    preset_params: z.record(z.string(), z.unknown()).default({}),
    empresas_manuais: z.array(z.string().uuid()).default([]),

    variantes: z.array(varianteSchema).min(1, 'A campanha precisa de pelo menos uma variante.'),

    contas_remetentes: z.array(z.string().uuid()).default([]),
    vendedor_id: z.string().uuid().optional().nullable(),
    inicio_em: z.string().datetime({ offset: true }).optional().nullable(),
    ritmo_por_dia: z.number().int().min(1).max(5000).default(50),
    respeitar_janela: z.boolean().default(true),

    excluir_contatados_dias: z.number().int().min(0).max(3650).default(14),
    excluir_conversa_aberta: z.boolean().default(true),
    modo_agente_ao_responder: z.enum(['sugestao', 'autonomo']).default('sugestao'),
  })
  .superRefine((v, ctx) => {
    const fonte: Record<OrigemPublico, unknown> = {
      segmento: v.segmento_id,
      filtro: v.definicao_filtro,
      preset: v.preset,
      lista_manual: v.empresas_manuais.length > 0 ? v.empresas_manuais : null,
    }
    if (!fonte[v.origem_publico]) {
      ctx.addIssue({
        code: 'custom',
        message: `Escolha a fonte do público (${ORIGEM_PUBLICO_LABELS[v.origem_publico]}).`,
        path: [v.origem_publico === 'lista_manual' ? 'empresas_manuais' : v.origem_publico],
      })
    }

    // O passo 1 é obrigatório: uma sequência que começa no segundo toque nunca
    // manda o primeiro, e a campanha ficaria eternamente parada esperando um
    // envio que não existe.
    if (!v.variantes.some((x) => x.passo === 1)) {
      ctx.addIssue({
        code: 'custom',
        message: 'A sequência precisa de pelo menos uma variante no passo 1.',
        path: ['variantes'],
      })
    }

    const ids = new Set<string>()
    for (const x of v.variantes) {
      if (ids.has(x.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Variante duplicada: ${x.id}.`,
          path: ['variantes'],
        })
      }
      ids.add(x.id)
    }

    if (v.preset === 'winback_ex_clientes' && v.origem_publico === 'preset') {
      const motivo = v.preset_params['motivo_saida']
      const porVariante = v.preset_params['motivo_por_variante'] === true
      // A regra do §2, dita onde ela é verificável: ou se escolhe o motivo, ou
      // cada motivo vira uma variante. Reativação genérica é spam com nostalgia.
      if (!motivo && !porVariante) {
        ctx.addIssue({
          code: 'custom',
          message:
            'Reconquista exige escolher o motivo da saída, ou tratar cada motivo como variante.',
          path: ['preset_params'],
        })
      }
    }
  })
export type CriarCampanhaInput = z.infer<typeof criarCampanhaSchema>

export const idCampanhaSchema = z.object({ id: z.string().uuid() })
export const pausarCampanhaSchema = z.object({
  id: z.string().uuid(),
  motivo: z.string().trim().max(300).optional(),
})
export const metricasCampanhaSchema = z.object({ campanha_id: z.string().uuid() })

// ─── Config ─────────────────────────────────────────────────────────────────

export interface LimitesCampanhas {
  max_campanhas_ativas: number
  max_campanhas_por_contato_90d: number
  alerta_optout_pct: number
  alerta_bounce_pct: number
  minimo_para_alertar: number
}

/**
 * O default de fábrica. Existe pelo mesmo motivo do `CONFIG_COMUNICACAO_PADRAO`:
 * um worker que sobe antes do seed não pode cair — e, se cair no default, tem de
 * cair no lado conservador.
 */
export const LIMITES_PADRAO: LimitesCampanhas = {
  max_campanhas_ativas: 3,
  max_campanhas_por_contato_90d: 2,
  alerta_optout_pct: 2.0,
  alerta_bounce_pct: 5.0,
  minimo_para_alertar: 50,
}

export function lerLimites(bruto: unknown): LimitesCampanhas {
  const v = (bruto ?? {}) as Partial<Record<keyof LimitesCampanhas, unknown>>
  const num = (x: unknown, padrao: number): number => {
    const n = Number(x)
    return Number.isFinite(n) && n >= 0 ? n : padrao
  }
  return {
    max_campanhas_ativas: num(v.max_campanhas_ativas, LIMITES_PADRAO.max_campanhas_ativas),
    max_campanhas_por_contato_90d: num(
      v.max_campanhas_por_contato_90d,
      LIMITES_PADRAO.max_campanhas_por_contato_90d,
    ),
    alerta_optout_pct: num(v.alerta_optout_pct, LIMITES_PADRAO.alerta_optout_pct),
    alerta_bounce_pct: num(v.alerta_bounce_pct, LIMITES_PADRAO.alerta_bounce_pct),
    minimo_para_alertar: num(v.minimo_para_alertar, LIMITES_PADRAO.minimo_para_alertar),
  }
}

/** Os modos que uma campanha pode entregar ao Agente. `desligado` não é opção. */
export const MODOS_AGENTE_CAMPANHA = MODOS_AGENTE.filter((m) => m !== 'desligado')
