import { z } from 'zod'
import { saldoGlobal } from '../../agentes/orcamento.js'
import {
  ESTADO_MANDATO_LABELS,
  MOTIVO_ENCERRAMENTO_LABELS,
  TIPO_MANDATO_LABELS,
  type EstadoMandato,
  type MotivoEncerramento,
  type TipoMandato,
} from '../../agentes/schemas.js'
import type { AppModule, ToolContext } from '../types.js'

/**
 * Módulo Agentes (Prompt 09): mandatos, personas e o loop autônomo.
 *
 * TODAS as tools são de LEITURA (§13): "a barra de IA não comanda os agentes". Criar,
 * pausar, encerrar e reatribuir mandato são atos com consequência (o agente fala com
 * clientes em nome da casa) e ficam na interface — as descrições dizem isso ao modelo, e
 * devolvem a rota da tela onde a pessoa aperta o botão.
 */

const brl = (c: number | null | undefined): string =>
  c === null || c === undefined ? '—' : (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const estadoLabel = (e: string) => ESTADO_MANDATO_LABELS[e as EstadoMandato] ?? e
const tipoLabel = (t: string) => TIPO_MANDATO_LABELS[t as TipoMandato] ?? t

const listarSchema = z.object({
  estado: z.enum(['ativos', 'aberto', 'em_andamento', 'aguardando_externo', 'pausado', 'concluido', 'encerrado_sem_sucesso', 'escalado']).default('ativos'),
  agente: z.string().max(80).nullable().optional().describe('Nome (ou parte) do agente.'),
  limite: z.number().int().min(1).max(100).default(30),
})

const detalheSchema = z.object({ codigo: z.string().min(3).max(40).describe('MDT-2026-00001 ou o id do mandato.') })
const desempenhoSchema = z.object({ dias: z.number().int().min(1).max(365).default(30) })

async function estado(ctx: ToolContext) {
  const [{ data: agentes }, { data: disj }, { data: cfg }, { data: ativos }] = await Promise.all([
    ctx.supabase.from('vendedores').select('id, nome, tipo, autonomo, ativo, pausado_em, modo_rodagem, whatsapp_conta_id').eq('is_ia', true),
    ctx.supabase.from('agentes_disjuntor').select('agente_id, estado, aberto_motivo'),
    ctx.supabase.from('agentes_config').select('chave, valor').in('chave', ['geral', 'voz_status']),
    ctx.supabase.from('mandatos').select('agente_id, estado').in('estado', ['aberto', 'em_andamento', 'aguardando_externo', 'pausado']),
  ])
  const porAgente = new Map<string, number>()
  for (const m of ativos ?? []) porAgente.set(m.agente_id, (porAgente.get(m.agente_id) ?? 0) + 1)
  const d = new Map((disj ?? []).map((x) => [x.agente_id, x]))
  const geral = (cfg ?? []).find((c) => c.chave === 'geral')?.valor as { kill_switch?: boolean } | undefined
  const voz = (cfg ?? []).find((c) => c.chave === 'voz_status')?.valor as { versao?: string } | undefined
  return {
    kill_switch: !!geral?.kill_switch,
    versao_da_ana: voz?.versao ?? 'desconhecida',
    agentes: (agentes ?? []).map((a) => ({
      nome: a.nome,
      tipo: a.tipo,
      situacao: !a.ativo
        ? 'inativo'
        : d.get(a.id)?.estado === 'aberto'
          ? `disjuntor aberto (${d.get(a.id)?.aberto_motivo ?? ''})`
          : a.pausado_em
            ? 'pausado'
            : !a.autonomo
              ? 'autonomia desligada'
              : !a.whatsapp_conta_id
                ? 'sem linha de WhatsApp'
                : 'operando',
      modo: a.modo_rodagem,
      mandatos_ativos: porAgente.get(a.id) ?? 0,
    })),
    route: '/agentes',
  }
}

async function mandatos(input: z.infer<typeof listarSchema>, ctx: ToolContext) {
  let q = ctx.supabase
    .from('mandatos')
    .select('id, codigo, tipo, objetivo, estado, prioridade, gasto_centavos, orcamento_centavos, acoes_executadas, max_acoes, expira_em, proxima_acao_em, agente_id, empresa_id')
    .order('proxima_acao_em', { ascending: true, nullsFirst: false })
    .limit(input.limite)
  q = input.estado === 'ativos' ? q.in('estado', ['aberto', 'em_andamento', 'aguardando_externo', 'pausado']) : q.eq('estado', input.estado)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const agentesIds = [...new Set((data ?? []).map((m) => m.agente_id))]
  const empresasIds = [...new Set((data ?? []).map((m) => m.empresa_id))]
  const [{ data: ags }, { data: emps }] = await Promise.all([
    ctx.supabase.from('vendedores').select('id, nome').in('id', agentesIds.length ? agentesIds : ['00000000-0000-0000-0000-000000000000']),
    ctx.supabase.from('empresas').select('id, razao_social').in('id', empresasIds.length ? empresasIds : ['00000000-0000-0000-0000-000000000000']),
  ])
  const nomeAgente = new Map((ags ?? []).map((a) => [a.id, a.nome]))
  const nomeEmpresa = new Map((emps ?? []).map((e) => [e.id, e.razao_social]))
  const filtro = input.agente?.toLowerCase()
  return (data ?? [])
    .filter((m) => !filtro || (nomeAgente.get(m.agente_id) ?? '').toLowerCase().includes(filtro))
    .map((m) => ({
      codigo: m.codigo,
      tipo: tipoLabel(m.tipo),
      estado: estadoLabel(m.estado),
      empresa: nomeEmpresa.get(m.empresa_id) ?? '—',
      agente: nomeAgente.get(m.agente_id) ?? '—',
      objetivo: m.objetivo,
      gasto: `${brl(m.gasto_centavos)} de ${brl(m.orcamento_centavos)}`,
      acoes: `${m.acoes_executadas}/${m.max_acoes}`,
      proxima_acao_em: m.proxima_acao_em,
      route: `/agentes/mandatos?m=${m.id}`,
    }))
}

async function detalhe(input: z.infer<typeof detalheSchema>, ctx: ToolContext) {
  const uuid = /^[0-9a-f-]{36}$/i.test(input.codigo)
  const q = ctx.supabase.from('mandatos').select('*')
  const { data: m, error } = uuid ? await q.eq('id', input.codigo).maybeSingle() : await q.ilike('codigo', input.codigo.trim()).maybeSingle()
  if (error) throw new Error(error.message)
  if (!m) return { encontrado: false }
  const [{ data: acoes }, { data: agente }, { data: empresa }] = await Promise.all([
    ctx.supabase.from('mandato_acoes').select('ferramenta, intencao, sucesso, erro, executada_em').eq('mandato_id', m.id).neq('ferramenta', 'ciclo').order('executada_em', { ascending: false }).limit(15),
    ctx.supabase.from('vendedores').select('nome').eq('id', m.agente_id).maybeSingle(),
    ctx.supabase.from('empresas').select('razao_social').eq('id', m.empresa_id).maybeSingle(),
  ])
  return {
    encontrado: true,
    codigo: m.codigo,
    tipo: tipoLabel(m.tipo),
    estado: estadoLabel(m.estado),
    objetivo: m.objetivo,
    empresa: empresa?.razao_social ?? '—',
    agente: agente?.nome ?? '—',
    plano: m.plano,
    resultado: m.resultado,
    motivo_encerramento: m.motivo_encerramento ? (MOTIVO_ENCERRAMENTO_LABELS[m.motivo_encerramento as MotivoEncerramento] ?? m.motivo_encerramento) : null,
    orcamento: `${brl(m.gasto_centavos)} de ${brl(m.orcamento_centavos)}`,
    acoes_recentes: (acoes ?? []).map((a) => ({ em: a.executada_em, ferramenta: a.ferramenta, intencao: a.intencao, ok: a.sucesso, erro: a.erro })),
    route: `/agentes/mandatos?m=${m.id}`,
  }
}

async function desempenho(input: z.infer<typeof desempenhoSchema>, ctx: ToolContext) {
  const desde = new Date(Date.now() - input.dias * 86_400_000).toISOString()
  const { data, error } = await ctx.supabase.rpc('app_agentes_desempenho', { p: { desde } })
  if (error) throw new Error(error.message)
  return { ...(data as object), route: '/agentes/desempenho' }
}

async function orcamento(ctx: ToolContext) {
  const [{ data: mes }, { data: cfg }] = await Promise.all([
    ctx.supabase.from('agentes_orcamento').select('mes, teto_centavos, consumido_centavos, reservado_centavos, alertas_enviados').order('mes', { ascending: false }).limit(1).maybeSingle(),
    ctx.supabase.from('agentes_config').select('valor').eq('chave', 'orcamento').maybeSingle(),
  ])
  const teto = mes?.teto_centavos ?? Number((cfg?.valor as { teto_mensal_centavos?: number } | null)?.teto_mensal_centavos ?? 0)
  const consumido = mes?.consumido_centavos ?? 0
  const reservado = mes?.reservado_centavos ?? 0
  return {
    mes: mes?.mes ?? null,
    teto: brl(teto),
    consumido: brl(consumido),
    reservado: brl(reservado),
    saldo: brl(saldoGlobal({ teto_centavos: teto, consumido_centavos: consumido, reservado_centavos: reservado })),
    percentual: teto > 0 ? Math.round((consumido * 100) / teto) : null,
    route: '/agentes/config',
  }
}

export const agentesModule: AppModule = {
  id: 'agentes',
  name: 'Agentes',
  icon: 'bot',
  route: '/agentes',
  group: 'vendas',
  tools: [
    {
      id: 'agentes.estado',
      name: 'Estado dos agentes',
      description:
        'Situação de cada agente comercial de IA (operando, pausado, disjuntor aberto, sem linha), mandatos ativos, kill switch e a versão da Ana (voz). Somente leitura — pausar ou reabrir é na tela.',
      inputSchema: z.object({}),
      mutates: false,
      execute: (_input, ctx) => estado(ctx),
    },
    {
      id: 'agentes.mandatos',
      name: 'Mandatos dos agentes',
      description:
        'Lista mandatos (objetivos comerciais delegados a agentes de IA) por estado e agente, com empresa, gasto e próxima ação. Somente leitura — criar, pausar ou encerrar é na tela de Agentes.',
      inputSchema: listarSchema,
      mutates: false,
      execute: (input, ctx) => mandatos(input as z.infer<typeof listarSchema>, ctx),
    },
    {
      id: 'agentes.detalhe_mandato',
      name: 'Detalhe do mandato',
      description:
        'Um mandato pelo código (MDT-2026-00001): objetivo, plano atual do agente, últimas ações com a intenção de cada uma, gasto e resultado. Somente leitura.',
      inputSchema: detalheSchema,
      mutates: false,
      execute: (input, ctx) => detalhe(input as z.infer<typeof detalheSchema>, ctx),
    },
    {
      id: 'agentes.desempenho',
      name: 'Desempenho dos agentes',
      description:
        'Por agente e por playbook: mandatos concluídos, taxa de sucesso, custo por mandato concluído, por reunião marcada e por conversão, motivos de encerramento, eficácia por material e canal, e a média dos humanos no período. Só gestores. Somente leitura.',
      inputSchema: desempenhoSchema,
      mutates: false,
      execute: (input, ctx) => desempenho(input as z.infer<typeof desempenhoSchema>, ctx),
    },
    {
      id: 'agentes.orcamento',
      name: 'Orçamento dos agentes',
      description: 'Teto do mês, consumido, reservado e saldo do orçamento dos agentes de IA. Somente leitura — o teto se ajusta nas configurações.',
      inputSchema: z.object({}),
      mutates: false,
      execute: (_input, ctx) => orcamento(ctx),
    },
  ],
}
