import { formatCnpj, normalizeCnpj } from '../../schemas/cnpj.js'
import {
  CAP_LIMITE_LABELS,
  ESTAGIO_ANALISE_LABELS,
  FAIXA_SCORE_LABELS,
  KNOCKOUT_LABELS,
  MOTIVO_SEM_POTENCIAL_LABELS,
  potencialEmpresaSchema,
  scoreEmpresaSchema,
  solicitarAnaliseSchema,
  statusEsteiraSchema,
  type EstagioAnalise,
  type FaixaScore,
  type Knockout,
  type PotencialEmpresaInput,
  type ScoreEmpresaInput,
  type ScoreEmpresaInput as _ScoreEmpresaInput,
  type SolicitarAnaliseInput,
  type StatusEsteiraInput,
} from '../../credito/index.js'
import { solicitarAnalise } from '../../credito/mutations.js'
import type { AppModule, ToolContext } from '../types.js'

/**
 * Módulo Crédito (04d): quanto de limite esta empresa sustentaria, qual a chance de a
 * seguradora conceder, e onde o pedido está.
 *
 * As três tools de leitura devolvem SEMPRE a procedência junto do número. Uma estimativa
 * de limite sem "de onde saiu" chega ao vendedor com a autoridade de um dado, e o modelo
 * é justamente quem mais precisa repetir a ressalva — ele é lido em voz alta.
 */

const brl = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '—'
    : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

async function potencialEmpresa(input: PotencialEmpresaInput, ctx: ToolContext) {
  const cnpj = normalizeCnpj(input.cnpj)
  const { data, error } = await ctx.supabase
    .from('empresas')
    // UMA string literal, nunca concatenação: supabase-js infere o tipo do retorno a
    // partir do TEXTO do select, e um `'a,' + 'b'` faz a inferência desabar em
    // GenericStringError — que só aparece no typecheck, longe daqui.
    .select('id, cnpj, razao_social, tipo, faturamento_anual, faturamento_origem, faturamento_confianca, limite_potencial, limite_confianca, receita_mensal_prevista, valor_esperado_mensal, chance_concessao, score_faixa, credito_calculado_em, credito_versao')
    .eq('cnpj', cnpj)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return { encontrado: false, cnpj: formatCnpj(cnpj) }

  // Sem limite, o motivo é a resposta — e é mais útil que o número que não existe.
  if (data.limite_potencial === null) {
    return {
      encontrado: true,
      cnpj: formatCnpj(cnpj),
      razao_social: data.razao_social,
      limite_potencial: null,
      motivo:
        data.faturamento_anual === null
          ? MOTIVO_SEM_POTENCIAL_LABELS.sem_faturamento
          : MOTIVO_SEM_POTENCIAL_LABELS.sem_calibracao,
      route: `/empresas/${data.id}`,
    }
  }

  return {
    encontrado: true,
    cnpj: formatCnpj(cnpj),
    razao_social: data.razao_social,
    limite_potencial: brl(data.limite_potencial),
    receita_mensal_prevista: brl(data.receita_mensal_prevista),
    valor_esperado_mensal: brl(data.valor_esperado_mensal),
    chance_concessao: data.chance_concessao,
    faixa_score: data.score_faixa,
    como_foi_calculado:
      `Faturamento ${data.faturamento_origem === 'declarado_cliente' ? 'DECLARADO' : 'estimado'} de ` +
      `${brl(data.faturamento_anual)} × proporção calibrada na carteira → limite; limite × giro médio → ` +
      `volume; volume × taxa + TAC → receita; receita × chance de concessão → valor esperado.`,
    confianca: data.limite_confianca,
    ressalva:
      data.limite_confianca === 'baixa'
        ? 'Confiança BAIXA: o limite herda a confiança do faturamento, e este veio de estimativa fraca.'
        : undefined,
    calculado_em: data.credito_calculado_em,
    versao: data.credito_versao,
    route: `/empresas/${data.id}`,
  }
}

async function scoreEmpresa(input: ScoreEmpresaInput, ctx: ToolContext) {
  const cnpj = normalizeCnpj(input.cnpj)
  const { data, error } = await ctx.supabase
    .from('empresa_scores')
    .select('score, completude, faixa, knockout, breakdown, scorecard_versao, calculado_em')
    .eq('cnpj', cnpj)
    .order('calculado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) {
    return { encontrado: false, cnpj: formatCnpj(cnpj), aviso: 'Esta empresa ainda não foi pontuada.' }
  }

  type LinhaBreakdown = { label?: string; pontos?: number | null; peso?: number; observado?: string; ressalva?: string }
  const linhas = Array.isArray(data.breakdown) ? (data.breakdown as LinhaBreakdown[]) : []

  return {
    encontrado: true,
    cnpj: formatCnpj(cnpj),
    score: data.score,
    faixa: FAIXA_SCORE_LABELS[data.faixa as FaixaScore] ?? data.faixa,
    completude: `${Math.round(Number(data.completude) * 100)}%`,
    knockout: data.knockout ? (KNOCKOUT_LABELS[data.knockout as Knockout] ?? data.knockout) : null,
    // Fator não avaliável aparece na lista COM a marca, em vez de sumir: o que falta é
    // metade da resposta, e é a metade acionável (dá para ir buscar).
    breakdown: linhas.map((b) => ({
      fator: b.label,
      pontos: b.pontos === null || b.pontos === undefined ? 'não avaliável' : `${b.pontos} de ${b.peso}`,
      observado: b.observado,
      ressalva: b.ressalva,
    })),
    aviso:
      data.score === null
        ? 'Score NÃO exibido: a completude dos dados não alcança o mínimo. Um número calculado sobre poucos fatores parece um score e não é.'
        : undefined,
    scorecard_versao: data.scorecard_versao,
    calculado_em: data.calculado_em,
  }
}

async function statusEsteira(input: StatusEsteiraInput, ctx: ToolContext) {
  let q = ctx.supabase.from('analises_credito').select('estagio, limite_solicitado, limite_aprovado')
  if (input.estagio) q = q.eq('estagio', input.estagio)
  const { data, error } = await q
  if (error) throw new Error(error.message)

  const porEstagio = new Map<string, { qtd: number; solicitado: number; aprovado: number }>()
  for (const a of data ?? []) {
    const atual = porEstagio.get(a.estagio) ?? { qtd: 0, solicitado: 0, aprovado: 0 }
    atual.qtd++
    atual.solicitado += Number(a.limite_solicitado ?? 0)
    atual.aprovado += Number(a.limite_aprovado ?? 0)
    porEstagio.set(a.estagio, atual)
  }

  return {
    total: (data ?? []).length,
    por_estagio: [...porEstagio.entries()].map(([estagio, v]) => ({
      estagio: ESTAGIO_ANALISE_LABELS[estagio as EstagioAnalise] ?? estagio,
      quantidade: v.qtd,
      limite_solicitado: brl(v.solicitado),
      limite_aprovado: brl(v.aprovado),
    })),
    route: '/credito',
  }
}

export const creditoModule: AppModule = {
  id: 'credito',
  name: 'Crédito',
  icon: 'landmark',
  route: '/credito',
  tools: [
    {
      id: 'credito.potencial_empresa',
      name: 'Potencial de crédito da empresa',
      description:
        'Limite potencial, receita mensal prevista e valor esperado de um CNPJ, COM a explicação ' +
        'de como cada número saiu do anterior. Quando não há limite, devolve o motivo (falta ' +
        'faturamento estimado, ou falta calibração) — que é a resposta útil. Sempre repita a ' +
        'confiança: ela é herdada do faturamento e não sobe pelo caminho.',
      inputSchema: potencialEmpresaSchema,
      mutates: false,
      execute: (input, ctx) => potencialEmpresa(input as PotencialEmpresaInput, ctx),
    },
    {
      id: 'credito.score_empresa',
      name: 'Score de crédito da empresa',
      description:
        'Score 0–100 de chance de concessão, com completude e breakdown fator a fator (valor ' +
        'observado, pontos e peso). Fator sem dado aparece como "não avaliável" e sai da conta: ' +
        'nunca o trate como zero ao explicar. Score nulo significa dados insuficientes, não score baixo.',
      inputSchema: scoreEmpresaSchema,
      mutates: false,
      execute: (input, ctx) => scoreEmpresa(input as ScoreEmpresaInput, ctx),
    },
    {
      id: 'credito.status_esteira',
      name: 'Status da esteira de crédito',
      description:
        'Contagem e valores (limite solicitado e aprovado) por estágio da esteira de análise. ' +
        'Filtro opcional de estágio. Use para responder "quantas análises estão em análise?".',
      inputSchema: statusEsteiraSchema,
      mutates: false,
      execute: (input, ctx) => statusEsteira(input as StatusEsteiraInput, ctx),
    },
    {
      id: 'credito.solicitar_analise',
      name: 'Solicitar análise de crédito',
      description:
        'Cria a solicitação na esteira. NUNCA envia à seguradora — o envio é um clique humano ' +
        'separado, porque resolver o buyer na Atradius pode ser cobrado. Como grava dados, exige ' +
        'confirmação explícita do usuário.',
      inputSchema: solicitarAnaliseSchema,
      mutates: true,
      execute: async (input, ctx) => {
        const a = await solicitarAnalise(ctx.supabase, input as SolicitarAnaliseInput)
        return {
          id: a.id,
          cnpj: formatCnpj(a.cnpj),
          estagio: ESTAGIO_ANALISE_LABELS[a.estagio as EstagioAnalise] ?? a.estagio,
          limite_solicitado: brl(a.limite_solicitado),
          aviso: 'Criada na esteira. O envio à seguradora é uma ação separada, feita por alguém do time de Crédito.',
          route: `/credito/analises/${a.id}`,
        }
      },
    },
  ],
}

// Reexport para o editor do scorecard não precisar importar de dois lugares.
export { CAP_LIMITE_LABELS }
