import { z } from 'zod'
import { CHAVES_CONFIG_QUALIDADE, TIPOS_INTERACAO, TIPOS_PENDENCIA, TIPOS_RESPOSTA, VEREDITOS_CONTESTACAO } from './tipos.js'

/**
 * As entradas das RPCs da Inteligência de Conversas. As RPCs revalidam tudo — estes
 * schemas existem para o erro sair no formulário, campo a campo, antes da ida ao banco.
 */

const uuid = z.string().uuid()

export const salvarConfigQualidadeSchema = z.object({
  chave: z.enum(CHAVES_CONFIG_QUALIDADE),
  valor: z.record(z.string(), z.unknown()),
})

export const SEGREDOS_QUALIDADE = ['fireflies_api_key', 'fireflies_webhook_secret', 'jev_api_key'] as const
export type SegredoQualidade = (typeof SEGREDOS_QUALIDADE)[number]

export const SEGREDO_LABELS: Record<SegredoQualidade, string> = {
  fireflies_api_key: 'Chave da API do Fireflies',
  fireflies_webhook_secret: 'Segredo do webhook do Fireflies',
  jev_api_key: 'Chave da API do Jev (TypeSafe)',
}

export const salvarSegredoQualidadeSchema = z.object({
  chave: z.enum(SEGREDOS_QUALIDADE),
  /** Vazio apaga. */
  valor: z.string().max(500),
})

export const salvarPessoaQualidadeSchema = z.object({
  vendedor_id: uuid,
  captura_ativa: z.boolean().optional(),
  analise_ativa: z.boolean().optional(),
})

export const eventoReuniaoSchema = z.object({ evento_id: uuid })

export const dispensarCapturaSchema = z.object({
  evento_id: uuid,
  dispensar: z.boolean(),
  motivo: z.enum(['nao_gravar', 'reuniao_interna', 'cliente_nao_autorizou']).optional(),
})

export const MOTIVO_DISPENSA_LABELS: Record<string, string> = {
  nao_gravar: 'Não gravar',
  reuniao_interna: 'Reunião interna',
  cliente_nao_autorizou: 'O cliente não autorizou',
  sem_link: 'Sem link de conferência (presencial ou telefone)',
  pessoa_sem_captura: 'Captura desligada para quem conduz',
  cancelada: 'Reunião cancelada',
}

export const contestarSchema = z.object({
  analise_item_id: uuid,
  justificativa: z.string().trim().min(5, 'Diga em uma frase por que discorda.').max(2000),
})

export const ROTULOS_HUMANOS = ['atendido', 'nao_atendido', 'nao_aplicavel'] as const
export type RotuloHumano = (typeof ROTULOS_HUMANOS)[number]

export const ROTULO_HUMANO_LABELS: Record<RotuloHumano, string> = {
  atendido: 'Atendeu',
  nao_atendido: 'Não atendeu',
  nao_aplicavel: 'Não se aplicava',
}

export const decidirContestacaoSchema = z
  .object({
    id: uuid,
    veredito: z.enum(VEREDITOS_CONTESTACAO),
    resposta: z.string().max(2000).optional(),
    rotulo_humano: z.enum(ROTULOS_HUMANOS).optional(),
  })
  .refine((v) => v.veredito !== 'procedente' || !!v.rotulo_humano, {
    message: 'Procedente exige dizer qual era a resposta certa.',
    path: ['rotulo_humano'],
  })

export const rotularSchema = z.object({
  analise_id: uuid,
  rotulos: z
    .array(
      z.object({
        chave: z.string().min(1),
        aplicavel: z.boolean(),
        atendido: z.boolean().nullable().optional(),
        resultado: z.string().nullable().optional(),
      }),
    )
    .min(1),
})

export const itemRubricaEntradaSchema = z.object({
  chave: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Use letras minúsculas, números e _ (ex.: explorou_dor).'),
  etapa: z.string().max(60).nullable().optional(),
  rotulo: z.string().trim().min(2).max(80),
  pergunta: z.string().trim().min(10, 'Escreva a pergunta inteira, como vai ao classificador.').max(1000),
  tipo_resposta: z.enum(TIPOS_RESPOSTA),
  opcoes: z.array(z.string().min(1)).nullable().optional(),
  atende: z.array(z.string().min(1)).nullable().optional(),
  peso: z.number().min(0).max(99),
  condicao_aplicabilidade: z.string().max(1000).nullable().optional(),
  orientacao: z.string().trim().min(10, 'A orientação é o que o vendedor lê quando falha.').max(2000),
  gera_pendencia: z.enum(TIPOS_PENDENCIA).nullable().optional(),
  ativo: z.boolean().optional(),
})
export type ItemRubricaEntrada = z.infer<typeof itemRubricaEntradaSchema>

export const salvarRubricaSchema = z
  .object({
    tipo_interacao: z.enum(TIPOS_INTERACAO),
    nome: z.string().trim().min(2).max(120),
    descricao: z.string().max(2000).nullable().optional(),
    itens: z.array(itemRubricaEntradaSchema).min(1, 'A rubrica precisa de pelo menos um item.'),
  })
  .superRefine((r, ctx) => {
    const vistas = new Set<string>()
    r.itens.forEach((i, idx) => {
      if (vistas.has(i.chave)) ctx.addIssue({ code: 'custom', message: `Chave repetida: ${i.chave}.`, path: ['itens', idx, 'chave'] })
      vistas.add(i.chave)
      if (i.tipo_resposta === 'escolha' && !(i.opcoes && i.opcoes.length >= 2)) {
        ctx.addIssue({ code: 'custom', message: 'Escolha precisa de pelo menos duas opções.', path: ['itens', idx, 'opcoes'] })
      }
    })
  })

export const rubricaIdSchema = z.object({ rubrica_id: uuid })

export const overrideLimiarSchema = z.object({
  item_id: uuid,
  limiar: z.number().gt(0).lt(1),
  motivo: z.string().trim().min(5, 'O override exige o motivo.').max(500),
})

export const resolverPendenciaSchema = z.object({ id: uuid, descartar: z.boolean().optional() })

export const auditarVinculoSchema = z.object({ id: uuid, correta: z.boolean() })

export const decidirSugestaoSchema = z.object({ id: uuid, aceitar: z.boolean() })
