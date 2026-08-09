import { z } from 'zod'
import {
  ESTAGIO_SDR_LABELS,
  ESTAGIO_VENDA_LABELS,
  ORIGEM_LANCAMENTO_LABELS,
  STATUS_LANCAMENTO_LABELS,
  TIPO_VENDEDOR_LABELS,
  moverLeadSchema,
  moverVendaSchema,
  type EstagioSdr,
  type EstagioVenda,
  type MoverLeadInput,
  type MoverVendaInput,
  type OrigemLancamento,
  type StatusLancamento,
  type TipoVendedorId,
} from '../../comercial/index.js'
import { moverLeadSdr, moverVenda } from '../../comercial/mutations.js'
import type { AppModule, ToolContext } from '../types.js'

/**
 * Módulo Comercial (04g): quem vende o quê, para quem, e quanto isso paga.
 *
 * As tools resolvem o vendedor pelo USUÁRIO LOGADO, nunca por parâmetro. "Qual a minha
 * comissão?" tem que ser uma pergunta sobre quem pergunta — deixar o modelo escolher o
 * id abriria a porta para ele responder sobre o colega por engano, e comissão é o dado
 * mais pessoal que este sistema guarda.
 */

const brl = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '—'
    : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function rotularContagem(mapa: unknown, labels: Record<string, string>): Record<string, number> {
  if (typeof mapa !== 'object' || mapa === null) return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(mapa as Record<string, unknown>)) {
    out[labels[k] ?? k] = Number(v) || 0
  }
  return out
}

interface ResumoRpc {
  tem_acesso?: boolean
  sem_vendedor?: boolean
  vendedor?: { id: string; nome: string; tipo: string; is_ia: boolean }
  leads_por_estagio?: Record<string, number>
  vendas_por_estagio?: Record<string, number>
  nfs_vivas?: number
  passivas_geridas?: number
  proximas_reunioes?: { id: string; titulo: string; inicio_em: string }[]
  comissao_mes?: { competencia: string; total: number; por_status: Record<string, number> }
}

async function meuResumo(_input: unknown, ctx: ToolContext) {
  const { data, error } = await ctx.supabase.rpc('comercial_resumo_vendedor', { p_vendedor_id: undefined })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as ResumoRpc

  if (!r.tem_acesso) return { tem_acesso: false, aviso: 'Sem acesso ao módulo Comercial.' }
  if (r.sem_vendedor) {
    // Gestor sem cadastro de vendedor é normal. Dizer "você não tem funil" é diferente
    // de "você não tem acesso", e confundir os dois manda a pessoa pedir permissão que
    // ela já tem.
    return {
      tem_acesso: true,
      sou_vendedor: false,
      aviso: 'Seu usuário não está cadastrado como vendedor. Você enxerga os painéis pelo seletor.',
    }
  }

  const tipo = (r.vendedor?.tipo ?? '') as TipoVendedorId
  return {
    tem_acesso: true,
    sou_vendedor: true,
    vendedor: r.vendedor?.nome,
    tipo: TIPO_VENDEDOR_LABELS[tipo] ?? tipo,
    // Só o que faz sentido para o tipo: um SDR não tem NF roteada, e listar zero para
    // ele sugere um problema onde não há nenhum.
    funil_de_reunioes: tipo === 'sdr' ? rotularContagem(r.leads_por_estagio, ESTAGIO_SDR_LABELS) : undefined,
    funil_de_vendas: tipo === 'vendedor' ? rotularContagem(r.vendas_por_estagio, ESTAGIO_VENDA_LABELS) : undefined,
    nfs_vivas: tipo === 'originador' ? r.nfs_vivas : undefined,
    contas_passivas_geridas: tipo === 'vendedor' ? r.passivas_geridas : undefined,
    proximas_reunioes: (r.proximas_reunioes ?? []).map((e) => ({
      titulo: e.titulo,
      quando: new Date(e.inicio_em).toLocaleString('pt-BR'),
    })),
    comissao_do_mes: {
      competencia: r.comissao_mes?.competencia,
      total: brl(r.comissao_mes?.total),
      por_status: rotularContagem(r.comissao_mes?.por_status, STATUS_LANCAMENTO_LABELS),
      ressalva: 'Apurado ainda não é aprovado, e aprovado ainda não é pago.',
    },
    route: '/comercial',
  }
}

const comissaoSchema = z.object({
  competencia: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Use AAAA-MM.')
    .optional()
    .describe('Mês da competência, AAAA-MM. Omitido = mês corrente.'),
})

async function comissaoVendedor(input: z.infer<typeof comissaoSchema>, ctx: ToolContext) {
  const mes = input.competencia ?? new Date().toISOString().slice(0, 7)
  const competencia = `${mes}-01`

  // Sem filtro por vendedor: a RLS de `comissao_lancamentos` já restringe ao próprio e
  // aos acessos concedidos. Filtrar aqui também seria uma segunda regra para divergir.
  const { data, error } = await ctx.supabase
    .from('comissao_lancamentos')
    .select('vendedor_id, origem_tipo, descricao, valor, status, criado_em')
    .eq('competencia', competencia)
    .order('valor', { ascending: false })
  if (error) throw new Error(error.message)

  const linhas = data ?? []
  if (linhas.length === 0) {
    return { competencia: mes, total: brl(0), linhas: [], aviso: 'Nenhum lançamento nesta competência.' }
  }

  return {
    competencia: mes,
    total: brl(linhas.reduce((s, l) => s + Number(l.valor), 0)),
    linhas: linhas.map((l) => ({
      origem: ORIGEM_LANCAMENTO_LABELS[l.origem_tipo as OrigemLancamento] ?? l.origem_tipo,
      descricao: l.descricao,
      valor: brl(Number(l.valor)),
      status: STATUS_LANCAMENTO_LABELS[l.status as StatusLancamento] ?? l.status,
    })),
    route: '/comercial/comissoes',
  }
}

async function agendarReuniao(input: MoverLeadInput, ctx: ToolContext) {
  const lead = await moverLeadSdr(ctx.supabase, { ...input, estagio: 'reuniao_agendada' })
  return {
    ok: true,
    lead_id: (lead as { id?: string } | null)?.id,
    resumo: 'Reunião agendada. O card do closer e os dois eventos de calendário foram criados.',
    route: '/comercial/sdr',
  }
}

async function moverEstagioVenda(input: MoverVendaInput, ctx: ToolContext) {
  const venda = (await moverVenda(ctx.supabase, input)) as { id?: string; estagio?: string } | null
  return {
    ok: true,
    venda_id: venda?.id,
    estagio: ESTAGIO_VENDA_LABELS[(venda?.estagio ?? '') as EstagioVenda] ?? venda?.estagio,
    route: venda?.id ? `/comercial/vendas/${venda.id}` : '/comercial/vendas',
  }
}

export const comercialModule: AppModule = {
  id: 'comercial',
  name: 'Comercial',
  icon: 'Handshake',
  route: '/comercial',
  group: 'operacoes',
  tools: [
    {
      id: 'comercial.meu_resumo',
      name: 'Meu painel comercial',
      description:
        'Resumo do painel de QUEM ESTÁ PERGUNTANDO: funil, pendências e comissão do mês. ' +
        'Resolve o vendedor pelo usuário logado — não aceita nem precisa de id de vendedor. ' +
        'Use para "como está meu funil", "o que preciso fazer hoje", "quanto vou receber".',
      inputSchema: z.object({}),
      execute: meuResumo,
      mutates: false,
    },
    {
      id: 'comercial.comissao_vendedor',
      name: 'Comissão do mês',
      description:
        'Lançamentos de comissão de uma competência, com origem e status (apurado/aprovado/pago). ' +
        'Restrita pela RLS ao próprio vendedor e a quem ele tem acesso — gestores veem todos.',
      inputSchema: comissaoSchema,
      execute: (input, ctx) => comissaoVendedor(input as z.infer<typeof comissaoSchema>, ctx),
      mutates: false,
    },
    {
      id: 'comercial.agendar_reuniao',
      name: 'Agendar reunião',
      description:
        'Marca a reunião de um lead do funil de SDR, criando o card no funil do vendedor destino ' +
        'e o evento no calendário dos dois. Exige data (ISO com fuso) e o vendedor destino.',
      inputSchema: moverLeadSchema,
      execute: (input, ctx) => agendarReuniao(input as MoverLeadInput, ctx),
      mutates: true,
    },
    {
      id: 'comercial.mover_estagio_venda',
      name: 'Mover venda de estágio',
      description:
        'Move um card do funil do vendedor. Perder EXIGE motivo (id de motivos_perda, contexto ' +
        'funil_vendedor). Ganhar promove a empresa a cliente e abre a decisão ativo/passivo.',
      inputSchema: moverVendaSchema,
      execute: (input, ctx) => moverEstagioVenda(input as MoverVendaInput, ctx),
      mutates: true,
    },
  ],
}

/** Rótulo do estágio de um lead, para telas que só têm a string crua. */
export function rotuloEstagioSdr(e: string): string {
  return ESTAGIO_SDR_LABELS[e as EstagioSdr] ?? e
}
