import { z } from 'zod'
import {
  ESTAGIO_SDR_LABELS,
  ESTAGIO_VENDA_LABELS,
  ORIGEM_LANCAMENTO_V2_LABELS,
  PAPEL_COMISSAO_LABELS,
  STATUS_LANCAMENTO_V2_LABELS,
  TIPO_VENDEDOR_LABELS,
  explicarCalculo,
  moverLeadSchema,
  moverVendaSchema,
  type EstagioSdr,
  type EstagioVenda,
  type MoverLeadInput,
  type MoverVendaInput,
  type OrigemLancamentoV2,
  type PapelComissao,
  type StatusLancamentoV2,
  type TipoVendedorId,
} from '../../comercial/index.js'
import { moverLeadSdr, moverVenda } from '../../comercial/mutations.js'
import type { AppModule, ToolContext } from '../types.js'
import { fornecedoresTools } from './fornecedores-tools.js'

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
  comissao_mes?: {
    competencia: string
    total: number
    cessoes?: number
    por_status: Record<string, number>
    por_papel?: Record<string, number>
  }
  aceites_pendentes?: number
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
      cessoes_convertidas: r.comissao_mes?.cessoes,
      por_status: rotularContagem(r.comissao_mes?.por_status, STATUS_LANCAMENTO_V2_LABELS),
      por_papel: rotularContagem(r.comissao_mes?.por_papel, PAPEL_COMISSAO_LABELS),
      ressalva:
        'Provisionado ainda não é fechado, fechado ainda não é aprovado, e aprovado ainda '
        + 'não é pago. O lançamento nasce na conversão da NF, não na liquidação.',
    },
    // A única pendência do módulo com PRAZO, e ela decide a comissão de OUTRA pessoa:
    // passado o SLA, a reunião conta como aceita sozinha.
    reunioes_aguardando_seu_aceite: r.aceites_pendentes,
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

  // Sem filtro por vendedor: a RLS de `comissao_lancamentos_v2` já restringe ao próprio e
  // aos acessos concedidos. Filtrar aqui também seria uma segunda regra para divergir.
  const { data, error } = await ctx.supabase
    .from('comissao_lancamentos_v2')
    // Literal, não concatenação: o supabase-js infere o tipo da linha a partir do TEXTO
    // do select, e uma soma de strings volta como `GenericStringError` — o erro aparece
    // vinte linhas abaixo, no acesso a `l.valor`.
    .select('vendedor_id, papel, origem_tipo, descricao, valor, status, evento_em, valor_cedido, anticipation_days, vop, taxa_brl_por_mm, share_pct, params_snapshot')
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
      papel: PAPEL_COMISSAO_LABELS[l.papel as PapelComissao] ?? l.papel,
      origem: ORIGEM_LANCAMENTO_V2_LABELS[l.origem_tipo as OrigemLancamentoV2] ?? l.origem_tipo,
      descricao: l.descricao,
      valor: brl(Number(l.valor)),
      status: STATUS_LANCAMENTO_V2_LABELS[l.status as StatusLancamentoV2] ?? l.status,
      // A conta por extenso vai JUNTO com a linha, e não sob demanda: "por que 450?" é a
      // pergunta seguinte em toda conversa sobre comissão, e obrigar uma segunda chamada
      // para respondê-la é como o modelo acaba inventando a explicação.
      como_foi_calculado: explicarCalculo({
        valor_cedido: l.valor_cedido === null ? null : Number(l.valor_cedido),
        anticipation_days: l.anticipation_days,
        vop: l.vop === null ? null : Number(l.vop),
        taxa_brl_por_mm: l.taxa_brl_por_mm === null ? null : Number(l.taxa_brl_por_mm),
        share_pct: Number(l.share_pct ?? 100),
        valor: Number(l.valor),
        params_snapshot: (l.params_snapshot ?? {}) as Record<string, unknown>,
        origem_tipo: l.origem_tipo,
      }),
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
        'Lançamentos de comissão de uma competência (motor v2: VOP), com papel, origem, status ' +
        '(provisionado/fechado/aprovado/pago/estornado) e o CÁLCULO POR EXTENSO de cada linha. ' +
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
    // Funil de cadastro de fornecedores (04l). Em arquivo próprio: é um domínio
    // inteiro que só divide o módulo com a comissão por conveniência de menu.
    ...fornecedoresTools,
  ],
}

/** Rótulo do estágio de um lead, para telas que só têm a string crua. */
export function rotuloEstagioSdr(e: string): string {
  return ESTAGIO_SDR_LABELS[e as EstagioSdr] ?? e
}
