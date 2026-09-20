import { formatCnpj } from '../../schemas/cnpj.js'
import {
  ESTAGIO_PROSPECCAO_LABELS,
  detalheSacadoProspeccaoSchema,
  enriquecerSacadoSchema,
  meusSacadosSchema,
  solicitarAnaliseProspeccaoSchema,
  type DetalheSacadoProspeccaoInput,
  type EnriquecerSacadoInput,
  type EstagioProspeccao,
  type MeusSacadosInput,
  type SolicitarAnaliseProspeccaoInput,
} from '../../prospeccao/schemas.js'
import { solicitarAnaliseProspeccao } from '../../prospeccao/mutations.js'
import type { Json } from '../../types/database.js'
import type { ModuleTool, ToolContext } from '../types.js'

/**
 * As tools do funil de Sacados por NF (04r §9).
 *
 * Elas vivem no módulo Antecipação porque a aba vive lá — e porque a régua de acesso é a
 * mesma: quem não tem `antecipacao` não vê card nenhum, e a RLS é quem decide, não esta
 * lista.
 *
 * As duas de leitura veem só o que a RLS deixa. `solicitar_analise` e `enriquecer`
 * mudam o mundo (uma abre pedido na esteira do Crédito, a outra GASTA DINHEIRO) e por
 * isso pedem confirmação explícita.
 */

// ─── prospeccao.meus_sacados ────────────────────────────────────────────────

const COLUNAS_SACADO =
  'cnpj_sacado, sacado_nome, uf, municipio, estagio, originador_nome, volume_30d, valor_operavel, media_mensal_6m, meses_com_emissao_6m, qtd_fornecedores, qtd_nfs_30d, score_credito, score_completude, chance_concessao, limite_potencial, valor_esperado_mensal, prazo_minimo_operavel_dias, prazo_minimo_origem, ultima_nf_em, analise_estagio'

async function meusSacados(input: MeusSacadosInput, ctx: ToolContext) {
  let q = ctx.supabase
    .from('sacados_prospeccao_view')
    .select(COLUNAS_SACADO)
    .order('valor_esperado_mensal', { ascending: false, nullsFirst: false })
    .limit(input.limite)

  if (input.estagio) q = q.eq('estagio', input.estagio)
  else {
    // Sem filtro, o padrão é o funil ATIVO: perguntar "quais são meus sacados?" quer
    // dizer "no que eu trabalho", não "o que já morreu".
    q = q.in('estagio', [
      'identificado',
      'fornecedor_consultado',
      'apresentacao_solicitada',
      'analise_solicitada',
      'em_analise',
    ])
  }
  if (input.originador_id) q = q.eq('originador_id', input.originador_id)

  const { data, error } = await q
  if (error) throw new Error(`Falha ao listar os sacados: ${error.message}`)

  const { data: painel } = await ctx.supabase.rpc('prospeccao_painel', {
    p_originador_id: input.originador_id ?? null,
  })
  const p = painel as { tem_acesso?: boolean; travados_na_esteira?: number } | null
  if (!p?.tem_acesso) {
    return { tem_acesso: false, mensagem: 'Você não tem acesso ao módulo Antecipação.' }
  }

  return {
    tem_acesso: true,
    painel: p,
    sacados: (data ?? []).map((s) => ({
      ...s,
      cnpj_formatado: s.cnpj_sacado ? formatCnpj(s.cnpj_sacado) : null,
      estagio_label:
        ESTAGIO_PROSPECCAO_LABELS[s.estagio as EstagioProspeccao] ?? s.estagio,
      // A régua junto do número: "R$ 80 mil operável" não quer dizer nada sem "acima de
      // quantos dias de vida", e é justamente essa a distinção que a feature existe para
      // fazer.
      operavel_acima_de_dias: s.prazo_minimo_operavel_dias,
    })),
    route: '/antecipacao/sacados-por-nf',
  }
}

// ─── prospeccao.detalhe_sacado ──────────────────────────────────────────────

async function detalheSacado(input: DetalheSacadoProspeccaoInput, ctx: ToolContext) {
  const { data, error } = await ctx.supabase
    .from('sacados_prospeccao_view')
    .select(COLUNAS_SACADO)
    .eq('cnpj_sacado', input.cnpj_sacado)
    .maybeSingle()
  if (error) throw new Error(`Falha ao ler o sacado: ${error.message}`)
  if (!data) {
    return {
      encontrado: false,
      mensagem: 'Este CNPJ não está no funil de Sacados por NF, ou não está na sua carteira.',
    }
  }

  // A quebra por fornecedor é o CORAÇÃO do card, e por isso vem sempre — a pergunta
  // "quanto vale este sacado?" só é acionável com "e de quem vem esse volume".
  const { data: id } = await ctx.supabase
    .from('sacados_prospeccao_view')
    .select('id')
    .eq('cnpj_sacado', input.cnpj_sacado)
    .maybeSingle()

  const { data: quebra } = id?.id
    ? await ctx.supabase
        .from('sacados_prospeccao_fornecedores')
        .select(
          'fornecedor_cnpj, fornecedor_nome, na_carteira_do_originador, valor_30d, valor_operavel, qtd_nfs_30d, media_mensal_6m, meses_com_emissao_6m, ultima_nf_em',
        )
        .eq('sacado_prospeccao_id', id.id)
        .order('valor_30d', { ascending: false, nullsFirst: false })
    : { data: [] }

  const notas = input.incluir_notas
    ? await ctx.supabase.rpc('prospeccao_notas', {
        p: { cnpj_sacado: input.cnpj_sacado } as unknown as Json,
      })
    : null

  return {
    encontrado: true,
    sacado: {
      ...data,
      cnpj_formatado: formatCnpj(input.cnpj_sacado),
      estagio_label: ESTAGIO_PROSPECCAO_LABELS[data.estagio as EstagioProspeccao] ?? data.estagio,
    },
    fornecedores: (quebra ?? []).map((f) => ({
      ...f,
      cnpj_formatado: formatCnpj(f.fornecedor_cnpj),
    })),
    notas: notas?.data ?? null,
    /*
     * §6 — O GUARDRAIL, dito para o modelo e não só para o humano.
     *
     * Estes números são do FORNECEDOR: são as notas dele, cedidas para antecipar. A
     * abordagem sai por ele, nunca direto na construtora — e nenhum texto voltado ao
     * sacado pode citar volume, nome de cedente ou detalhe de nota.
     */
    guardrail:
      'A abordagem sai pelo fornecedor, nunca direto na construtora. Não exiba volume, ' +
      'nome de fornecedor nem detalhe de nota em nada voltado ao sacado.',
    route: '/antecipacao/sacados-por-nf',
  }
}

// ─── prospeccao.enriquecer (o PLANEJADOR do clique pago) ────────────────────

/**
 * ─── A MUTAÇÃO QUE GASTA DINHEIRO NÃO EXISTE COMO TOOL ──────────────────────
 *
 * O §9 pede `prospeccao.enriquecer` como `mutates`. Ela existe, e é o botão do card —
 * mas roda no WORKER, que é quem tem a credencial da DirectD e não tem sessão de
 * usuário. Uma segunda porta daqui seria um segundo lugar onde o teto pode ser
 * esquecido.
 *
 * A razão de fundo, porém, não é técnica, e é a mesma do 04l: um modelo que decide
 * sozinho consumir o teto mensal de alguém é exatamente o agente autônomo gastando que
 * o §10 põe fora de escopo — e é a mesma razão de o custo aparecer ANTES da confirmação
 * na tela. A tool PLANEJA o clique: quanto custa, quanto sobra, se cabe. Executar
 * continua exigindo uma pessoa olhando o preço.
 */
async function planejarEnriquecimento(input: EnriquecerSacadoInput, ctx: ToolContext) {
  const { data: sacado, error } = await ctx.supabase
    .from('sacados_prospeccao_view')
    .select('cnpj_sacado, sacado_nome, originador_id, volume_30d, meses_com_emissao_6m, score_credito')
    .eq('cnpj_sacado', input.cnpj_sacado)
    .maybeSingle()
  if (error) throw new Error(`Falha ao ler o sacado: ${error.message}`)
  if (!sacado) {
    return {
      encontrado: false,
      mensagem: 'Este CNPJ não está no funil de Sacados por NF, ou não está na sua carteira.',
    }
  }

  const { data: custoBruto } = await ctx.supabase.rpc('antecipacao_custo_protesto')
  const custo = Number((custoBruto as { nacional?: number } | null)?.nacional ?? 0)

  const { data: cfg } = await ctx.supabase
    .from('prospeccao_config')
    .select('valor')
    .eq('chave', 'enriquecimento')
    .maybeSingle()
  const teto = Number(
    (cfg?.valor as { teto_mensal_por_originador?: number } | null)?.teto_mensal_por_originador ?? 150,
  )

  // A verdade do gasto é a SOMA do ledger no mês, não um contador — mesma decisão do
  // Radar e do 04l: um contador em paralelo diverge na primeira vez que um job morre
  // no meio, e a divergência é invisível porque continua parecendo um número.
  const inicioDoMes = new Date()
  inicioDoMes.setUTCDate(1)
  inicioDoMes.setUTCHours(0, 0, 0, 0)
  let q = ctx.supabase
    .from('prospeccao_enriquecimentos')
    .select('custo')
    .gte('executado_em', inicioDoMes.toISOString())
  q = sacado.originador_id
    ? q.eq('originador_id', sacado.originador_id)
    : q.is('originador_id', null)
  const { data: gastos } = await q
  const gasto = (gastos ?? []).reduce((soma, g) => soma + (Number(g.custo) || 0), 0)

  return {
    encontrado: true,
    executa: false,
    sacado,
    custo_estimado: custo,
    teto_mensal: teto,
    gasto_no_mes: gasto,
    saldo: Math.max(0, teto - gasto),
    cabe: gasto + custo <= teto,
    mensagem:
      gasto + custo <= teto
        ? 'Cabe no teto do mês. A consulta é paga e sai por clique: abra o card e use "Enriquecer".'
        : 'O teto do mês já foi consumido. Um gestor pode liberar o clique; a tool não gasta por ninguém.',
    route: '/antecipacao/sacados-por-nf',
  }
}

// ─── As tools ───────────────────────────────────────────────────────────────

export const prospeccaoTools: ModuleTool[] = [
  {
    id: 'prospeccao.meus_sacados',
    name: 'Meus sacados por NF',
    description:
      'As construtoras que ainda NÃO são clientes e que estão recebendo notas dos cedentes que ' +
      'você segue, ordenadas pelo valor esperado mensal (média de 6 meses × chance de concessão × ' +
      'margem). Traz o painel junto: volume observado, valor operável e quantos cards estão ' +
      'travados esperando a esteira de crédito decidir.',
    inputSchema: meusSacadosSchema,
    mutates: false,
    execute: (input, ctx) => meusSacados(input as MeusSacadosInput, ctx),
  },
  {
    id: 'prospeccao.detalhe_sacado',
    name: 'Detalhe do sacado por NF',
    description:
      'Um sacado do funil com a QUEBRA POR FORNECEDOR: quem emitiu contra ele, quanto, quantas ' +
      'notas, média mensal, última emissão e se o cedente já é da carteira de quem trabalha o ' +
      'card. Com `incluir_notas`, traz também as notas uma a uma, marcando quais sobrevivem ao ' +
      'tempo da esteira de crédito.',
    inputSchema: detalheSacadoProspeccaoSchema,
    mutates: false,
    execute: (input, ctx) => detalheSacado(input as DetalheSacadoProspeccaoInput, ctx),
  },
  {
    id: 'prospeccao.solicitar_analise',
    name: 'Solicitar análise para sacado por NF',
    description:
      'Abre a análise de crédito na esteira para um sacado deste funil, pré-preenchida com o ' +
      'limite potencial calculado, e move o card para "análise solicitada". A decisão da esteira ' +
      'move o card sozinha depois: aprovada entrega o sacado à carteira de quem o descobriu. ' +
      'Como grava na esteira do Crédito e cria vínculo de carteira, exige confirmação explícita.',
    inputSchema: solicitarAnaliseProspeccaoSchema,
    mutates: true,
    execute: async (input, ctx) => {
      const a = (await solicitarAnaliseProspeccao(
        ctx.supabase,
        input as SolicitarAnaliseProspeccaoInput,
      )) as { id: string; cnpj: string; estagio: string; limite_solicitado: number | null }
      return {
        analise_id: a.id,
        cnpj: formatCnpj(a.cnpj),
        estagio: a.estagio,
        limite_solicitado: a.limite_solicitado,
        route: `/credito/analises/${a.id}`,
      }
    },
  },
  {
    id: 'prospeccao.enriquecer',
    name: 'Planejar o enriquecimento de um sacado',
    description:
      'Diz quanto CUSTA enriquecer um sacado deste funil (consulta de protesto na base nacional), ' +
      'quanto já foi gasto do teto mensal do originador e quanto sobra — e se o clique cabe. NÃO ' +
      'executa a consulta: ela é paga e sai por botão, com o número na frente de quem autoriza.',
    inputSchema: enriquecerSacadoSchema,
    mutates: false,
    execute: (input, ctx) => planejarEnriquecimento(input as EnriquecerSacadoInput, ctx),
  },
]
