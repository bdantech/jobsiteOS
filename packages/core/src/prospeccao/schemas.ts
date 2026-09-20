import { z } from 'zod'
import { normalizeCnpj } from '../schemas/cnpj.js'

/**
 * Vocabulário do funil de SACADOS POR NF (04r).
 *
 * Funil próprio, e não mais uma faixa do funil de notas (04), porque a pergunta é
 * outra. Lá o sacado tem crédito aprovado e a dúvida é "o fornecedor vai antecipar?".
 * Aqui o sacado não tem análise nenhuma, e a dúvida é "conseguimos operar isso?" — o
 * gargalo é a esteira de crédito, não a conversa comercial. Estágios que descrevem
 * conversa não descrevem esteira, e um kanban emprestado faria o originador arrastar
 * cards por colunas que não são o trabalho dele.
 *
 * A UNIDADE É O SACADO. Três fornecedores emitindo contra a mesma construtora são UMA
 * oportunidade com o triplo de evidência, não três cards: a análise de crédito
 * acontece uma vez por CNPJ, e é ela que destrava (ou não) as três.
 */

// ─── Estágios ───────────────────────────────────────────────────────────────

/*
 * A ordem É a ordem das colunas do kanban, e ela segue o caminho real até operar:
 *
 *   identificado           o job achou fluxo e ninguém olhou ainda.
 *   fornecedor_consultado  falamos com o FORNECEDOR (nunca com a construtora — §6).
 *   apresentacao_solicitada pedimos a ponte; a bola está com o fornecedor.
 *   analise_solicitada     a esteira recebeu o pedido. Daqui em diante quem manda é ela.
 *   em_analise             a seguradora está com o caso.
 *
 * E quatro saídas, que pedem coisas diferentes depois:
 *
 *   aprovado      ganhou. Vira carteira do originador (§7) e as notas caem no funil de NFs.
 *   recusado      a esteira disse não. Não é culpa da abordagem, e voltar a trabalhá-lo
 *                 exige limite novo, não insistência.
 *   sem_interesse o fornecedor não quis fazer a ponte, ou a construtora não quis falar.
 *   descartado    nós decidimos que não vale — porte, CNAE errado, nota fora do escopo.
 */
export const ESTAGIOS_PROSPECCAO = [
  'identificado',
  'fornecedor_consultado',
  'apresentacao_solicitada',
  'analise_solicitada',
  'em_analise',
  'aprovado',
  'recusado',
  'sem_interesse',
  'descartado',
] as const
export const estagioProspeccaoSchema = z.enum(ESTAGIOS_PROSPECCAO)
export type EstagioProspeccao = z.infer<typeof estagioProspeccaoSchema>

export const ESTAGIO_PROSPECCAO_LABELS: Record<EstagioProspeccao, string> = {
  identificado: 'Identificado',
  fornecedor_consultado: 'Fornecedor consultado',
  apresentacao_solicitada: 'Apresentação pedida',
  analise_solicitada: 'Análise solicitada',
  em_analise: 'Em análise',
  aprovado: 'Aprovado',
  recusado: 'Recusado',
  sem_interesse: 'Sem interesse',
  descartado: 'Descartado',
}

export const ESTAGIO_PROSPECCAO_DESCRICOES: Record<EstagioProspeccao, string> = {
  identificado: 'O fluxo apareceu nas notas e ninguém trabalhou este sacado ainda.',
  fornecedor_consultado: 'Falamos com o fornecedor sobre antecipar o que ele tem a receber.',
  apresentacao_solicitada: 'Pedimos a ponte ao fornecedor. A bola está com ele.',
  analise_solicitada: 'A esteira de crédito recebeu o pedido.',
  em_analise: 'A seguradora está com o caso. Daqui a decisão move o card sozinha.',
  aprovado: 'Limite aprovado. O sacado entra na carteira de quem o descobriu.',
  recusado: 'A esteira disse não. Voltar a trabalhá-lo exige limite novo, não insistência.',
  sem_interesse: 'A ponte não aconteceu — o fornecedor não quis, ou a construtora não quis falar.',
  descartado: 'Decidimos que não vale trabalhar. O motivo é obrigatório.',
}

/**
 * As colunas do kanban. As quatro saídas ficam fora: elas são resultado, não trabalho,
 * e quatro colunas de histórico empurrariam o que importa para fora da tela. A lista
 * de encerrados é um filtro, como no funil de NFs.
 */
export const ESTAGIOS_PROSPECCAO_ABERTOS: readonly EstagioProspeccao[] = [
  'identificado',
  'fornecedor_consultado',
  'apresentacao_solicitada',
  'analise_solicitada',
  'em_analise',
]

export const ESTAGIOS_PROSPECCAO_ENCERRADOS: readonly EstagioProspeccao[] = [
  'aprovado',
  'recusado',
  'sem_interesse',
  'descartado',
]

/**
 * Os estágios que a TELA pode definir arrastando o card.
 *
 * As quatro saídas automáticas ficam de fora, e cada uma por um motivo próprio:
 * `aprovado` e `recusado` são FATO da esteira (o trigger de `analises_credito` é quem
 * os escreve — marcá-los à mão faria o card mentir sobre uma decisão que ninguém
 * tomou), e `sem_interesse`/`descartado` exigem motivo, que um gesto de arrastar não
 * tem onde pedir. Para esses dois existe o diálogo próprio.
 */
export const ESTAGIOS_PROSPECCAO_MANUAIS: readonly EstagioProspeccao[] = [
  'identificado',
  'fornecedor_consultado',
  'apresentacao_solicitada',
]

/** Estágios em que o card está esperando a esteira, e não uma pessoa. É o número do painel. */
export const ESTAGIOS_TRAVADOS_NA_ESTEIRA: readonly EstagioProspeccao[] = [
  'analise_solicitada',
  'em_analise',
]

// ─── Motivos de saída ───────────────────────────────────────────────────────

/**
 * Os motivos default de descarte (§8 deixa a lista configurável).
 *
 * Eles NÃO são os `MOTIVOS_SEM_INTERESSE` da Antecipação, e a diferença é o sujeito:
 * lá quem recusa é o FORNECEDOR ("não antecipo", "já opero com outro"); aqui quem não
 * anda é a ponte até uma CONSTRUTORA que ainda não é nossa. "Caixa confortável" não
 * descreve nada do que acontece nesta tela, e "fornecedor não fez a ponte" não tem
 * onde ser dito lá. Vocabulários iguais para funis diferentes dariam uma contagem que
 * soma coisas que não se somam.
 */
export const MOTIVOS_SAIDA_PROSPECCAO = [
  'fornecedor_nao_apresentou',
  'sacado_sem_interesse',
  'ja_opera_com_outro',
  'porte_incompativel',
  'fora_do_perfil',
  'fluxo_pontual',
  'risco_conhecido',
  'outro',
] as const
export const motivoSaidaProspeccaoSchema = z.enum(MOTIVOS_SAIDA_PROSPECCAO)
export type MotivoSaidaProspeccao = z.infer<typeof motivoSaidaProspeccaoSchema>

export const MOTIVO_SAIDA_PROSPECCAO_LABELS: Record<MotivoSaidaProspeccao, string> = {
  fornecedor_nao_apresentou: 'Fornecedor não fez a ponte',
  sacado_sem_interesse: 'Construtora não tem interesse',
  ja_opera_com_outro: 'Já opera com outra financeira',
  porte_incompativel: 'Porte incompatível',
  fora_do_perfil: 'Fora do perfil (CNAE ou atividade)',
  fluxo_pontual: 'Fluxo pontual — não se repete',
  risco_conhecido: 'Risco conhecido',
  outro: 'Outro',
}

// ─── Origem do "seguir" ─────────────────────────────────────────────────────

/**
 * `titularidade` é espelhada do `vendedor_carteira` todo dia; `manual` é o botão
 * "Seguir". Elas coexistem na mesma tabela e NÃO se sobrescrevem: perder a
 * titularidade por dormência não pode apagar um seguir que alguém escolheu (§2).
 */
export const ORIGENS_SEGUIDO = ['manual', 'titularidade'] as const
export type OrigemSeguido = (typeof ORIGENS_SEGUIDO)[number]

export const ORIGEM_SEGUIDO_LABELS: Record<OrigemSeguido, string> = {
  manual: 'Seguido manualmente',
  titularidade: 'Titular na carteira',
}

// ─── Contratos das mutações ─────────────────────────────────────────────────

const cnpj = z
  .string()
  .transform(normalizeCnpj)
  .refine((v) => /^\d{14}$/.test(v), 'CNPJ precisa ter 14 dígitos.')

export const moverSacadoProspeccaoSchema = z.object({
  cnpj_sacado: cnpj.describe('CNPJ da construtora, com ou sem máscara.'),
  estagio: z
    .enum(['identificado', 'fornecedor_consultado', 'apresentacao_solicitada'])
    .describe(
      'Só estágios manuais. Aprovado e recusado são decisão da esteira; sem interesse e ' +
        'descartado exigem motivo e têm porta própria.',
    ),
})
export type MoverSacadoProspeccaoInput = z.infer<typeof moverSacadoProspeccaoSchema>

export const descartarSacadoProspeccaoSchema = z
  .object({
    cnpj_sacado: cnpj,
    /** `descartado` = nós desistimos. `sem_interesse` = eles disseram não. */
    estagio: z.enum(['descartado', 'sem_interesse']).default('descartado'),
    motivo: motivoSaidaProspeccaoSchema,
    observacao: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.motivo !== 'outro' || (v.observacao?.length ?? 0) >= 3, {
    path: ['observacao'],
    message: 'Com motivo "Outro", a observação é obrigatória.',
  })
export type DescartarSacadoProspeccaoInput = z.infer<typeof descartarSacadoProspeccaoSchema>

export const reatribuirSacadoProspeccaoSchema = z.object({
  cnpj_sacado: cnpj,
  /** null devolve o card à fila sem dono, que é a tela do gestor. */
  originador_id: z.string().uuid().nullable(),
})
export type ReatribuirSacadoProspeccaoInput = z.infer<typeof reatribuirSacadoProspeccaoSchema>

/**
 * Pedir análise de crédito para um sacado deste funil.
 *
 * O limite é opcional porque o RPC sabe cair no `limite_potencial` já calculado (04c);
 * digitá-lo é a exceção, não a regra. Ele é arredondado para milhares no servidor,
 * como em todo o resto da esteira — um limite sugerido com centavos denuncia que
 * ninguém decidiu o número.
 */
export const solicitarAnaliseProspeccaoSchema = z.object({
  cnpj_sacado: cnpj,
  limite_solicitado: z.coerce.number().positive().optional().nullable(),
  observacoes: z.string().trim().max(2000).optional(),
})
export type SolicitarAnaliseProspeccaoInput = z.infer<typeof solicitarAnaliseProspeccaoSchema>

/**
 * "Enriquecer sacado" — a ação PAGA (§5).
 *
 * `forcar` é do gestor: libera quem estourou o teto do mês. O custo é mostrado na tela
 * antes do clique; o schema não o carrega de propósito, porque um preço que vem do
 * cliente é um preço que o cliente escolheu.
 */
export const enriquecerSacadoSchema = z.object({
  cnpj_sacado: cnpj,
  forcar: z.boolean().default(false),
})
export type EnriquecerSacadoInput = z.infer<typeof enriquecerSacadoSchema>

export const seguirFornecedorSchema = z.object({
  fornecedor_cnpj: cnpj,
  /** false deixa de seguir. O seguir por titularidade não se apaga por aqui. */
  seguir: z.boolean().default(true),
  /** Só o gestor pode seguir em nome de outra pessoa. Ausente = eu mesmo. */
  originador_id: z.string().uuid().nullable().optional(),
})
export type SeguirFornecedorInput = z.infer<typeof seguirFornecedorSchema>

export const pedirApresentacaoSacadoSchema = z.object({
  cnpj_sacado: cnpj,
  fornecedor_cnpj: cnpj,
  contato_fornecedor_id: z.string().uuid().nullable().optional(),
  mensagem: z.string().min(10).max(4000),
})
export type PedirApresentacaoSacadoInput = z.infer<typeof pedirApresentacaoSacadoSchema>

export const salvarProspeccaoConfigSchema = z.object({
  chave: z.string().min(1).max(60),
  valor: z.unknown(),
})
export type SalvarProspeccaoConfigInput = z.infer<typeof salvarProspeccaoConfigSchema>

// ─── Leituras (tools de IA) ─────────────────────────────────────────────────

export const meusSacadosSchema = z.object({
  estagio: estagioProspeccaoSchema.optional().describe('Filtra por um estágio do funil.'),
  originador_id: z
    .string()
    .uuid()
    .optional()
    .describe('Carteira de outra pessoa. Só o gestor enxerga; para os demais a RLS recusa.'),
  limite: z.coerce.number().int().min(1).max(50).default(15),
})
export type MeusSacadosInput = z.infer<typeof meusSacadosSchema>

export const detalheSacadoProspeccaoSchema = z.object({
  cnpj_sacado: cnpj,
  /** Traz também as notas, fornecedor a fornecedor. Caro na resposta, então é opt-in. */
  incluir_notas: z.boolean().default(false),
})
export type DetalheSacadoProspeccaoInput = z.infer<typeof detalheSacadoProspeccaoSchema>
