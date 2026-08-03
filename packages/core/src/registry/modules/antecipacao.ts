import { formatCnpj, normalizeCnpj } from '../../schemas/cnpj.js'
import {
  casarAntecipacaoManual,
  marcarSemInteresse,
  moverEstagio,
} from '../../antecipacao/mutations.js'
import { MATCH_STATUS_LABELS, MOTIVO_MATCH_LABELS } from '../../antecipacao/matching.js'
import {
  ESTAGIO_FUNIL_LABELS,
  ESTAGIOS_ABERTOS,
  FAIXA_LABELS,
  capacidadeSacadoSchema,
  casarAntecipacaoSchema,
  marcarSemInteresseSchema,
  moverEstagioSchema,
  notasFornecedorSchema,
  resumoFunilSchema,
  statusConversoesSchema,
  type CapacidadeSacadoInput,
  type CasarAntecipacaoInput,
  type MarcarSemInteresseInput,
  type MoverEstagioInput,
  type NotasFornecedorInput,
  type ResumoFunilInput,
  type StatusConversoesInput,
} from '../../antecipacao/schemas.js'
import type { Json } from '../../types/database.js'
import type { AppModule, ToolContext } from '../types.js'

/**
 * Antecipação: o funil de notas fiscais.
 *
 * As tools de leitura veem só o que a RLS deixa. As de escrita (mover_estagio,
 * marcar_sem_interesse) mudam o funil de verdade e por isso pedem confirmação —
 * "marcar sem interesse" chega a apagar a faixa de todas as notas vivas do
 * fornecedor, que é exatamente o tipo de coisa que não se faz por engano.
 *
 * NÃO é webOnly: o funil é experiência de primeira classe no mobile (§9), e o
 * registry é o que projeta isso na tab bar.
 */

// ─── antecipacao.resumo_funil ───────────────────────────────────────────────

async function resumoFunil(input: ResumoFunilInput, ctx: ToolContext) {
  const { data: resumo, error } = await ctx.supabase.rpc('antecipacao_resumo_funil')
  if (error) throw new Error(`Falha ao ler o resumo do funil: ${error.message}`)

  const bruto = resumo as { tem_acesso?: boolean; celulas?: unknown[] } | null
  if (!bruto?.tem_acesso) {
    return { tem_acesso: false, mensagem: 'Você não tem acesso ao módulo Antecipação.' }
  }

  type Celula = {
    estagio_funil: string
    faixa: string | null
    notas: number
    valor: number
    receita_esperada: number
  }
  const celulas = ((bruto.celulas ?? []) as Celula[]).filter(
    (c) => !input.faixa || c.faixa === input.faixa,
  )

  const porFaixa = new Map<string, { notas: number; valor: number; receita_esperada: number }>()
  const porEstagio = new Map<string, { notas: number; valor: number; receita_esperada: number }>()
  for (const c of celulas) {
    const f = c.faixa ?? 'sem_faixa'
    const acF = porFaixa.get(f) ?? { notas: 0, valor: 0, receita_esperada: 0 }
    porFaixa.set(f, {
      notas: acF.notas + c.notas,
      valor: acF.valor + Number(c.valor),
      receita_esperada: acF.receita_esperada + Number(c.receita_esperada),
    })
    const acE = porEstagio.get(c.estagio_funil) ?? { notas: 0, valor: 0, receita_esperada: 0 }
    porEstagio.set(c.estagio_funil, {
      notas: acE.notas + c.notas,
      valor: acE.valor + Number(c.valor),
      receita_esperada: acE.receita_esperada + Number(c.receita_esperada),
    })
  }

  // As melhores oportunidades vivas, que é o que alguém realmente quer saber ao
  // perguntar "como está o funil?".
  let topQuery = ctx.supabase
    .from('notas_funil')
    .select(
      'access_key, numero, valor, receita_esperada, dias_para_vencimento, faixa, estagio_funil, ' +
        'fornecedor_nome, fornecedor_cnpj, sacado_nome, sacado_credito_status',
    )
    .not('faixa', 'is', null)
    .in('estagio_funil', [...ESTAGIOS_ABERTOS])
    .order('receita_esperada', { ascending: false, nullsFirst: false })
    .limit(input.top)
  if (input.faixa) topQuery = topQuery.eq('faixa', input.faixa)

  const { data: top, error: erroTop } = await topQuery
  if (erroTop) throw new Error(`Falha ao listar oportunidades: ${erroTop.message}`)

  return {
    tem_acesso: true,
    faixa: input.faixa ?? 'todas',
    por_faixa: [...porFaixa.entries()].map(([faixa, v]) => ({
      faixa,
      label: FAIXA_LABELS[faixa as keyof typeof FAIXA_LABELS] ?? 'Sem faixa',
      ...v,
    })),
    por_estagio: [...porEstagio.entries()].map(([estagio, v]) => ({
      estagio,
      label: ESTAGIO_FUNIL_LABELS[estagio as keyof typeof ESTAGIO_FUNIL_LABELS] ?? estagio,
      ...v,
    })),
    top_oportunidades: top ?? [],
    route: '/antecipacao',
  }
}

// ─── antecipacao.notas_fornecedor ───────────────────────────────────────────

/**
 * Em UMA string literal, e não concatenada em várias linhas: supabase-js parseia
 * o select no NÍVEL DE TIPO, e a concatenação de quatro literais estoura o
 * parser — o resultado degrada silenciosamente para `GenericStringError` e todo
 * acesso a coluna vira erro de compilação.
 */
const COLUNAS_NOTA_FORNECEDOR =
  'access_key, numero, serie, valor, vencimento, vencimento_origem, dias_para_vencimento, receita_esperada, faixa, faixa_motivo, estagio_funil, fornecedor_nome, fornecedor_tipagem, fornecedor_suprimido, sacado_cnpj, sacado_nome, sacado_credito_status, sacado_limite_disponivel, sacado_limite_cobre_nota'

async function notasFornecedor(input: NotasFornecedorInput, ctx: ToolContext) {
  const cnpj = normalizeCnpj(input.cnpj)

  let query = ctx.supabase
    .from('notas_funil')
    .select(COLUNAS_NOTA_FORNECEDOR)
    .eq('fornecedor_cnpj', cnpj)
    .order('receita_esperada', { ascending: false, nullsFirst: false })
    .limit(100)
  if (!input.incluir_encerradas) query = query.in('estagio_funil', [...ESTAGIOS_ABERTOS])

  const { data, error } = await query
  if (error) throw new Error(`Falha ao buscar notas do fornecedor: ${error.message}`)

  const notas = data ?? []
  const valorTotal = notas.reduce((s, n) => s + Number(n.valor ?? 0), 0)
  const receitaTotal = notas.reduce((s, n) => s + Number(n.receita_esperada ?? 0), 0)

  return {
    cnpj: formatCnpj(cnpj),
    fornecedor_nome: notas[0]?.fornecedor_nome ?? null,
    tipagem: notas[0]?.fornecedor_tipagem ?? null,
    suprimido: notas[0]?.fornecedor_suprimido ?? false,
    qtd_notas: notas.length,
    valor_total: valorTotal,
    receita_esperada_total: receitaTotal,
    notas,
    route: '/antecipacao',
  }
}

// ─── antecipacao.capacidade_sacado ──────────────────────────────────────────

async function capacidadeSacado(input: CapacidadeSacadoInput, ctx: ToolContext) {
  const cnpj = normalizeCnpj(input.cnpj)
  const { data, error } = await ctx.supabase
    .from('antecipacao_sacados')
    .select('*')
    .eq('sacado_cnpj', cnpj)
    .maybeSingle()
  if (error) throw new Error(`Falha ao ler a capacidade do sacado: ${error.message}`)

  if (!data) {
    return {
      encontrado: false,
      cnpj: formatCnpj(cnpj),
      mensagem: 'Nenhuma nota em faixa contra este sacado — não há demanda de pipeline para comparar.',
    }
  }

  const disponivel = Number(data.available_limit ?? 0)
  const demanda = Number(data.demanda_pipeline ?? 0)

  return {
    encontrado: true,
    cnpj: formatCnpj(cnpj),
    sacado_nome: data.sacado_nome,
    credito_status: data.credito_status,
    limite_total: data.credit_limit,
    limite_disponivel: disponivel,
    demanda_pipeline: demanda,
    // O número que importa: quanto do pipeline NÃO cabe no limite de hoje.
    excedente: Math.max(0, demanda - disponivel),
    cobre_pipeline: disponivel >= demanda,
    notas_em_faixa: data.notas_em_faixa,
    fornecedores: data.fornecedores,
    route: '/antecipacao/sacados',
  }
}

// ─── antecipacao.status_conversoes ──────────────────────────────────────────

/**
 * Em UMA string literal, pelo mesmo motivo de `COLUNAS_NOTA_FORNECEDOR`: o
 * select é parseado no NÍVEL DE TIPO e a concatenação estoura o parser.
 */
const COLUNAS_PENDENCIA =
  'id_externo, status, document_number, gross_value, original_due_date, created_at_plataforma, fornecedor_cnpj, fornecedor_nome, sacado_cnpj, sacado_nome, match_status, match_motivo, match_candidatas'

async function statusConversoes(input: StatusConversoesInput, ctx: ToolContext) {
  const { data, error } = await ctx.supabase.rpc('antecipacao_status_conversoes', {
    p: { dias: input.dias } as unknown as Json,
  })
  if (error) throw new Error(`Falha ao ler o status das conversões: ${error.message}`)

  const r = data as {
    tem_acesso?: boolean
    total?: number
    casadas?: number
    pendentes_revisao?: number
    sem_nf_definitivo?: number
    em_disputa?: number
    convertidas?: number
    valor_convertido?: number
    taxa_media?: number | null
    por_status?: Record<string, number>
  } | null

  if (!r?.tem_acesso) {
    return { tem_acesso: false, mensagem: 'Você não tem acesso ao módulo Antecipação.' }
  }

  const total = r.total ?? 0
  const casadas = r.casadas ?? 0

  // As pendências vêm junto, e não em outra chamada: quem pergunta "como está a
  // conversão?" está a um passo de perguntar "o que falta resolver?".
  const { data: pendencias } = await ctx.supabase
    .from('antecipacoes')
    .select(COLUNAS_PENDENCIA)
    .in('match_status', ['revisao', 'sem_nf'])
    .order('created_at_plataforma', { ascending: false, nullsFirst: false })
    .limit(20)

  return {
    tem_acesso: true,
    dias: input.dias,
    antecipacoes_no_periodo: total,
    casadas,
    // A taxa de casamento AUTOMÁTICO — o número que diz se o motor está fazendo
    // o trabalho ou se alguém está fazendo por ele.
    taxa_casamento: total > 0 ? Number(((casadas / total) * 100).toFixed(1)) : null,
    convertidas: r.convertidas ?? 0,
    valor_convertido: Number(r.valor_convertido ?? 0),
    taxa_media_am: r.taxa_media ?? null,
    pendentes_revisao: r.pendentes_revisao ?? 0,
    sem_nf_definitivo: r.sem_nf_definitivo ?? 0,
    conversoes_em_disputa: r.em_disputa ?? 0,
    por_match_status: Object.entries(r.por_status ?? {}).map(([status, n]) => ({
      status,
      label: MATCH_STATUS_LABELS[status as keyof typeof MATCH_STATUS_LABELS] ?? status,
      antecipacoes: n,
    })),
    pendencias: (pendencias ?? []).map((p) => ({
      ...p,
      motivo_legivel:
        MOTIVO_MATCH_LABELS[p.match_motivo as keyof typeof MOTIVO_MATCH_LABELS] ?? p.match_motivo,
    })),
    route: '/antecipacao/antecipacoes',
  }
}

// ─── Módulo ─────────────────────────────────────────────────────────────────

export const antecipacaoModule: AppModule = {
  id: 'antecipacao',
  name: 'Antecipação',
  icon: 'banknote',
  route: '/antecipacao',
  group: 'operacoes',
  tools: [
    {
      id: 'antecipacao.resumo_funil',
      name: 'Resumo do funil',
      description:
        'Contagens e valores do funil de antecipação por faixa (alta/boa/media) e por estágio, ' +
        'mais as melhores oportunidades vivas ordenadas por receita esperada. Filtro opcional de ' +
        'faixa. Use para responder "como está o funil?" e "onde está o dinheiro hoje?".',
      inputSchema: resumoFunilSchema,
      mutates: false,
      execute: (input, ctx) => resumoFunil(input as ResumoFunilInput, ctx),
    },
    {
      id: 'antecipacao.notas_fornecedor',
      name: 'Notas do fornecedor',
      description:
        'Todas as notas fiscais vivas de um fornecedor (por CNPJ), com o contexto de crédito do ' +
        'sacado de cada uma: status, limite disponível e se o limite cobre a nota. Traz também o ' +
        'total agrupado — que é a unidade real de abordagem, já que ninguém é abordado por nota.',
      inputSchema: notasFornecedorSchema,
      mutates: false,
      execute: (input, ctx) => notasFornecedor(input as NotasFornecedorInput, ctx),
    },
    {
      id: 'antecipacao.capacidade_sacado',
      name: 'Capacidade do sacado',
      description:
        'Limite de crédito disponível de uma construtora versus a demanda do pipeline (soma das ' +
        'NFs em faixa contra ela). Responde "cabe?" — e, quando não cabe, quanto excede.',
      inputSchema: capacidadeSacadoSchema,
      mutates: false,
      execute: (input, ctx) => capacidadeSacado(input as CapacidadeSacadoInput, ctx),
    },
    {
      id: 'antecipacao.status_conversoes',
      name: 'Status das conversões',
      description:
        'Taxa de casamento automático entre antecipações da plataforma e NFs do funil, conversões ' +
        'do período (quantas, quanto e a que taxa real) e as pendências que esperam decisão humana: ' +
        'revisão, sem NF correspondente e conversões em disputa. Responde "o funil está fechando o ' +
        'loop?" e "o que falta resolver?".',
      inputSchema: statusConversoesSchema,
      mutates: false,
      execute: (input, ctx) => statusConversoes(input as StatusConversoesInput, ctx),
    },
    {
      id: 'antecipacao.casar_manual',
      name: 'Casar antecipação com nota',
      description:
        'Resolve um caso da fila de revisão: vincula a antecipação a uma NF (que precisa ser do MESMO ' +
        'fornecedor e sacado) ou a ignora com motivo. Casar com status conversor marca a nota como ' +
        'convertida e registra evento na timeline, então exige confirmação explícita.',
      inputSchema: casarAntecipacaoSchema,
      mutates: true,
      execute: async (input, ctx) => {
        const a = await casarAntecipacaoManual(ctx.supabase, input as CasarAntecipacaoInput)
        return {
          id_externo: a.id_externo,
          match_status: a.match_status,
          access_key: a.access_key_casada,
          convertida: a.convertida_em !== null,
          fornecedor: a.fornecedor_nome ?? formatCnpj(a.fornecedor_cnpj),
          sacado: a.sacado_nome ?? formatCnpj(a.sacado_cnpj),
          route: '/antecipacao/antecipacoes',
        }
      },
    },
    {
      id: 'antecipacao.mover_estagio',
      name: 'Mover nota de estágio',
      description:
        'Move uma NF no funil (a_prospectar → em_prospeccao → em_negociacao → ' +
        'antecipacao_andamento → convertida | perdida). O motivo é OBRIGATÓRIO ao marcar como ' +
        'perdida. Como grava dados e registra evento na timeline, exige confirmação explícita.',
      inputSchema: moverEstagioSchema,
      mutates: true,
      execute: async (input, ctx) => {
        const nf = await moverEstagio(ctx.supabase, input as MoverEstagioInput)
        return {
          access_key: nf.access_key,
          estagio_funil: nf.estagio_funil,
          faixa: nf.faixa,
          fornecedor_nome: nf.fornecedor_nome,
          valor: nf.valor,
          route: `/antecipacao?nota=${nf.access_key}`,
        }
      },
    },
    {
      id: 'antecipacao.marcar_sem_interesse',
      name: 'Marcar fornecedor sem interesse',
      description:
        'Suprime um fornecedor: soft (expira em N dias, default 90 — depois ele volta a ser ' +
        'elegível) ou ETERNA (LGPD). Motivo obrigatório. Tira da faixa TODAS as notas vivas dele ' +
        'na hora, e nenhum canal poderá tocá-lo enquanto valer. Exige confirmação explícita.',
      inputSchema: marcarSemInteresseSchema,
      mutates: true,
      execute: async (input, ctx) => {
        const sup = await marcarSemInteresse(ctx.supabase, input as MarcarSemInteresseInput)
        return {
          cnpj: formatCnpj(sup.valor),
          motivo: sup.observacao ?? sup.motivo,
          expira_em: sup.expira_em,
          eterna: sup.expira_em === null,
          route: '/radar/supressao',
        }
      },
    },
  ],
}
