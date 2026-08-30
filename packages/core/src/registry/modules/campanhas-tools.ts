import { z } from 'zod'
import {
  STATUS_CAMPANHA_LABELS,
  TIPO_CAMPANHA_LABELS,
  type StatusCampanha,
  type TipoCampanha,
} from '../../campanhas/schemas.js'
import { salvarCampanha, pausarCampanha } from '../../campanhas/mutations.js'
import type { ModuleTool, ToolContext } from '../types.js'

/**
 * As tools de campanha (05B §9), e a assimetria que as define:
 *
 *   ler        pode. Status e placar são perguntas naturais para um assistente.
 *   criar      pode — SEMPRE EM RASCUNHO. Nunca simula, nunca aprova, nunca dispara.
 *   pausar     pode. Parar algo é sempre mais seguro que continuar.
 *
 * Aprovar não é tool, e não é esquecimento. A aprovação é o passo que transforma
 * um rascunho em mil mensagens saindo, e ele existe justamente para ter um dono
 * humano com nome — `campanhas.aprovada_por` é uma coluna, não um log. Uma tool
 * que aprovasse tornaria essa coluna uma ficção.
 */

const statusSchema = z.object({
  campanha_id: z.string().uuid().optional(),
  apenas_ativas: z.boolean().optional(),
})

const criarSchema = z.object({
  nome: z.string().min(1),
  tipo: z.enum(['prospeccao', 'winback', 'operacional', 'anuncio']),
  canal: z.enum(['whatsapp', 'email']),
  segmento_id: z.string().uuid().describe('Segmento salvo do Mercado que define o público.'),
  template_id: z.string().uuid().describe('Template da mensagem do primeiro toque.'),
  ritmo_por_dia: z.number().int().min(1).max(5000).optional(),
  objetivo: z.string().optional(),
})

const pausarSchema = z.object({
  campanha_id: z.string().uuid(),
  motivo: z.string().max(300).optional(),
})

async function statusDasCampanhas(
  input: z.infer<typeof statusSchema>,
  ctx: ToolContext,
): Promise<unknown> {
  let q = ctx.supabase
    .from('campanhas_lista')
    .select(
      'id, nome, tipo, canal, status, total, enviadas, respondidas, excluidas, optouts, pendentes, vendedor_nome, segmento_nome',
    )
    .order('criada_em', { ascending: false })
    .limit(20)

  if (input.campanha_id) q = q.eq('id', input.campanha_id)
  if (input.apenas_ativas) q = q.in('status', ['agendada', 'executando'])

  const { data, error } = await q
  if (error) throw new Error(error.message)

  return {
    campanhas: (data ?? []).map((c) => ({
      id: c.id,
      nome: c.nome,
      tipo: TIPO_CAMPANHA_LABELS[c.tipo as TipoCampanha] ?? c.tipo,
      canal: c.canal === 'email' ? 'e-mail' : 'WhatsApp',
      status: STATUS_CAMPANHA_LABELS[c.status as StatusCampanha] ?? c.status,
      dono: c.vendedor_nome ?? 'casa / IA',
      publico: c.segmento_nome,
      total: c.total,
      enviadas: c.enviadas,
      respondidas: c.respondidas,
      // A taxa vem calculada: pedir ao modelo que divida dois números é pedir
      // que ele erre um deles de vez em quando.
      taxa_resposta:
        (c.enviadas ?? 0) > 0
          ? `${((((c.respondidas ?? 0) / (c.enviadas ?? 1)) * 100)).toFixed(1)}%`
          : null,
      na_fila: c.pendentes,
      excluidas: c.excluidas,
      optouts: c.optouts,
    })),
  }
}

async function criarRascunho(
  input: z.infer<typeof criarSchema>,
  ctx: ToolContext,
): Promise<unknown> {
  const c = await salvarCampanha(ctx.supabase, {
    nome: input.nome,
    tipo: input.tipo,
    canal: input.canal,
    objetivo: input.objetivo ?? null,
    origem_publico: 'segmento',
    segmento_id: input.segmento_id,
    variantes: [
      { id: '1a', template_id: input.template_id, peso: 1, passo: 1, dias_apos: 3 },
    ],
    ritmo_por_dia: input.ritmo_por_dia ?? 50,
  })

  return {
    id: c.id,
    status: c.status,
    aviso:
      'Rascunho criado. Nada sai daqui: é preciso rodar a simulação e uma pessoa aprovar em ' +
      'Comercial → Campanhas. Aprovar não é uma ação que eu possa fazer.',
  }
}

async function pausar(input: z.infer<typeof pausarSchema>, ctx: ToolContext): Promise<unknown> {
  const c = await pausarCampanha(ctx.supabase, { id: input.campanha_id, motivo: input.motivo })
  return {
    id: c.id,
    status: c.status,
    resultado: 'Campanha pausada. O que estava na fila e não saiu foi descartado.',
  }
}

export const campanhasTools: ModuleTool[] = [
  {
    id: 'campanhas.status',
    name: 'Status das campanhas',
    description:
      'Placar das campanhas: público, enviadas, respostas, taxa de resposta, opt-outs e quantos ' +
      'ainda estão na fila. Use para "como está a campanha X?" e "temos campanha rodando?".',
    inputSchema: statusSchema,
    mutates: false,
    execute: (input, ctx) => statusDasCampanhas(input as z.infer<typeof statusSchema>, ctx),
  },
  {
    id: 'campanhas.criar',
    name: 'Criar campanha (rascunho)',
    description:
      'Cria uma campanha em RASCUNHO a partir de um segmento salvo e um template. NÃO simula, ' +
      'NÃO aprova e NÃO dispara nada — quem aprova é uma pessoa, na tela, depois de ver o ' +
      'dry-run. Diga isso a quem pediu em vez de sugerir que a campanha vai sair.',
    inputSchema: criarSchema,
    mutates: true,
    execute: (input, ctx) => criarRascunho(input as z.infer<typeof criarSchema>, ctx),
  },
  {
    id: 'campanhas.pausar',
    name: 'Pausar campanha',
    description:
      'Pausa uma campanha em execução: o que ainda não saiu não sai. Peça confirmação antes — ' +
      'pausar é reversível, mas interrompe trabalho que alguém aprovou.',
    inputSchema: pausarSchema,
    mutates: true,
    execute: (input, ctx) => pausar(input as z.infer<typeof pausarSchema>, ctx),
  },
]
