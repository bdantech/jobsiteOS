import { AI_MODEL, EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import {
  AVISO_PARECER,
  FASE_LABELS,
  SITUACAO_INTERNA_LABELS,
  montarCronograma,
  type Fase,
  type Risco,
  type SituacaoInterna,
} from '../../../../../packages/core/src/juridico/index.js'
import { supabaseAdmin } from '../../db.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { requisitarJson } from '../../net/http.js'
import { emitirEvento } from '../../radar/eventos.js'
import { lerBenchmarkFases } from '../../juridico/config.js'

/**
 * Parecer jurídico com IA (08 §7).
 *
 * ── O QUE ELE É, E O QUE ELE NÃO É ─────────────────────────────────────────
 * É um resumo em português do que os autos dizem, com um próximo passo sugerido.
 * NÃO é peça, não é opinião legal e não consulta prazo processual — o modelo lê
 * movimentações e escreve texto. `AVISO_PARECER` acompanha o resultado em toda
 * tela e em toda resposta de tool, e o prompt abaixo repete a restrição ao próprio
 * modelo em vez de confiar que ele deduza.
 *
 * ── O DOSSIÊ É FECHADO ─────────────────────────────────────────────────────
 * Tudo o que o modelo vê é montado aqui, campo a campo. "Use apenas os dados
 * fornecidos" é uma instrução fraca sozinha; ela só vale porque o que não está no
 * dossiê não chega nele. E o que está DIZ de onde veio — cálculo determinístico,
 * movimentação do tribunal, cadastro nosso —, para o texto poder citar a fonte.
 *
 * ── `proximo_passo` É ESTRUTURADO, E POR ISSO É UMA TOOL ───────────────────
 * A saída vem por tool call, e não por markdown que alguém depois faz parse. Um
 * "próximo passo" extraído por regex do meio de um texto é o campo que quebra em
 * silêncio quando o modelo muda o formato de uma seção — e é justamente o campo
 * que a lista mostra e que orienta a ação.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

const SECOES = [
  '1. Situação atual',
  '2. O que aconteceu até aqui',
  '3. Riscos e pontos de atenção',
  '4. Próximo passo recomendado',
  '5. Avaliação de risco',
  '6. Perguntas para o advogado responsável',
]

/** Últimas N movimentações + TODAS as relevantes. As relevantes nunca são cortadas. */
const LIMITE_MOVIMENTACOES = 80

interface RespostaAnthropic {
  content?: Array<{ type: string; text?: string; name?: string; input?: unknown }>
  model?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

interface SaidaParecer {
  parecer_markdown?: string
  proximo_passo?: string
  risco?: Risco
}

export interface ResultadoParecer {
  numero_cnj: string
  parecer_id: string
  risco: Risco | null
  proximo_passo: string
  modelo: string
  tokens: number
}

export async function gerarParecer(
  numeroCnj: string,
  geradoPor: string | null = null,
): Promise<ResultadoParecer> {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada no worker.')

  const dossie = await montarDossie(numeroCnj)

  const prompt =
    `Você assessora o time jurídico de um FIDC que antecipa recebíveis da construção ` +
    `civil e move ações de cobrança contra sacados devedores. Escreva, em markdown, um ` +
    `RESUMO EXECUTIVO do processo abaixo para o advogado responsável.\n\n` +
    `SEÇÕES FIXAS, nesta ordem, como títulos de nível 2:\n${SECOES.map((s) => `## ${s}`).join('\n')}\n\n` +
    `RESTRIÇÕES — todas obrigatórias:\n` +
    `- Use APENAS os dados do dossiê. Não invente número, data, nome ou dispositivo legal.\n` +
    `- NUNCA afirme prazo processual (quantos dias faltam, se precluiu, se cabe recurso) ` +
    `sem que uma movimentação do dossiê diga isso literalmente. Você não tem acesso ao ` +
    `calendário forense nem à contagem de prazos.\n` +
    `- Quando a informação for insuficiente para opinar sobre algo, DIGA ISSO ` +
    `explicitamente na seção 3 em vez de opinar mesmo assim.\n` +
    `- A seção 1 é em linguagem simples: alguém que não é advogado tem de entender ` +
    `onde o processo está e o que está em jogo.\n` +
    `- A seção 2 é cronológica e cita as datas das movimentações que importam.\n` +
    `- Este texto NÃO é peça jurídica, não substitui a análise do advogado e não deve ` +
    `ser juntado aos autos. Não escreva nada que se pareça com uma petição.\n` +
    `- Português do Brasil, tom sóbrio, sem adjetivos.\n\n` +
    `DOSSIÊ (JSON):\n${JSON.stringify(dossie, null, 2)}`

  const resp = await requisitarJson<RespostaAnthropic>(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: {
      model: AI_MODEL,
      max_tokens: 8192,
      tools: [
        {
          name: 'registrar_parecer',
          description: 'Registra o parecer completo, o próximo passo e a avaliação de risco.',
          input_schema: {
            type: 'object',
            properties: {
              parecer_markdown: {
                type: 'string',
                description: 'O parecer inteiro em markdown, com as seis seções fixas.',
              },
              proximo_passo: {
                type: 'string',
                description:
                  'UMA ação concreta e acionável, em no máximo 200 caracteres. Comece com um ' +
                  'verbo. Ex.: "Peticionar pedido de penhora online sobre as contas do executado."',
              },
              risco: {
                type: 'string',
                enum: ['baixo', 'medio', 'alto'],
                description:
                  'Risco de NÃO recuperar o crédito. alto = executado sem patrimônio ' +
                  'localizado, ação parada há muito tempo ou decisão desfavorável.',
              },
            },
            required: ['parecer_markdown', 'proximo_passo', 'risco'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'registrar_parecer' },
      messages: [{ role: 'user', content: prompt }],
    },
    timeoutMs: 300_000,
    tentativas: 2,
  })

  const bloco = (resp.content ?? []).find((c) => c.type === 'tool_use' && c.name === 'registrar_parecer')
  const saida = (bloco?.input ?? {}) as SaidaParecer
  if (!saida.parecer_markdown || !saida.proximo_passo) {
    throw new Error('O modelo não devolveu o parecer no formato esperado.')
  }

  const tokens = (resp.usage?.input_tokens ?? 0) + (resp.usage?.output_tokens ?? 0)

  const { data, error } = await supabaseAdmin
    .from('processo_pareceres')
    .insert({
      numero_cnj: numeroCnj,
      parecer_markdown: saida.parecer_markdown,
      proximo_passo: saida.proximo_passo.slice(0, 500),
      risco: saida.risco ?? null,
      modelo: resp.model ?? AI_MODEL,
      tokens,
      editado: false,
      gerado_por: geradoPor,
    })
    .select('id')
    .single()
  if (error) throw new Error(`Falha ao gravar parecer: ${error.message}`)

  await emitirEvento(dossie.processo.empresa_devedora_id, EVENTO_TIPOS.PARECER_GERADO, {
    titulo: 'Parecer jurídico gerado',
    resumo: `${numeroCnj} · risco ${saida.risco ?? 'não avaliado'}. ${AVISO_PARECER}`,
    url: `/juridico/${numeroCnj}`,
    numero_cnj: numeroCnj,
    risco: saida.risco ?? null,
  })

  logger.info({ cnj: numeroCnj, tokens, risco: saida.risco }, 'Parecer jurídico gerado.')

  return {
    numero_cnj: numeroCnj,
    parecer_id: data.id,
    risco: saida.risco ?? null,
    proximo_passo: saida.proximo_passo,
    modelo: resp.model ?? AI_MODEL,
    tokens,
  }
}

// ─── O dossiê ───────────────────────────────────────────────────────────────

interface Dossie {
  processo: {
    numero_cnj: string
    empresa_devedora_id: string | null
    [k: string]: unknown
  }
  [k: string]: unknown
}

async function montarDossie(numeroCnj: string): Promise<Dossie> {
  const benchmark = await lerBenchmarkFases()

  const [
    { data: processo },
    { data: movimentacoesRecentes },
    { data: relevantes },
    { data: envolvidos },
    { data: operacoes },
    { data: calculo },
    { data: custos },
    { data: recuperacoes },
    { data: prazos },
  ] = await Promise.all([
    supabaseAdmin.from('juridico_carteira').select('*').eq('numero_cnj', numeroCnj).maybeSingle(),
    supabaseAdmin
      .from('processo_movimentacoes')
      .select('data, tipo, conteudo, fase_detectada, relevante')
      .eq('numero_cnj', numeroCnj)
      .order('data', { ascending: false })
      .limit(LIMITE_MOVIMENTACOES),
    supabaseAdmin
      .from('processo_movimentacoes')
      .select('data, tipo, conteudo, fase_detectada')
      .eq('numero_cnj', numeroCnj)
      .eq('relevante', true)
      .order('data', { ascending: false }),
    supabaseAdmin
      .from('processo_envolvidos')
      .select('nome, tipo, polo, cpf_cnpj, advogados')
      .eq('numero_cnj', numeroCnj),
    supabaseAdmin
      .from('processo_operacoes')
      .select('valor_original, vencimento, descricao')
      .eq('numero_cnj', numeroCnj),
    supabaseAdmin
      .from('processo_calculos')
      .select('data_base, total, principal, correcao, juros, multa, honorarios, custas, parametros, criado_em')
      .eq('numero_cnj', numeroCnj)
      .order('criado_em', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin.from('processo_custos').select('tipo, valor, data, descricao').eq('numero_cnj', numeroCnj),
    supabaseAdmin.from('processo_recuperacoes').select('valor, data, origem').eq('numero_cnj', numeroCnj),
    supabaseAdmin
      .from('processo_prazos')
      .select('tipo, descricao, data, concluido')
      .eq('numero_cnj', numeroCnj)
      .eq('concluido', false)
      .order('data'),
  ])

  if (!processo) throw new Error(`Processo ${numeroCnj} não encontrado.`)

  // TODAS as classificadas para o cronograma, não só as 80 do recorte: o tempo por
  // fase é uma conta sobre a série inteira, e cortá-la moveria a distribuição para
  // dentro da janela recente.
  const { data: paraCronograma } = await supabaseAdmin
    .from('processo_movimentacoes')
    .select('data, fase_detectada')
    .eq('numero_cnj', numeroCnj)
    .not('fase_detectada', 'is', null)
    .order('data')

  const cronograma = montarCronograma(paraCronograma ?? [], benchmark)

  // A empresa devedora: score, protestos, situação cadastral e OUTROS processos
  // nossos contra ela. O último é o que muda a leitura de risco — três execuções
  // contra o mesmo sacado não são três casos independentes.
  let devedora: Record<string, unknown> | null = null
  if (processo.empresa_devedora_id) {
    const { data: e } = await supabaseAdmin
      .from('empresas')
      .select('id, cnpj, razao_social, estagio, score_credito, score_faixa, situacao_cadastral:cnpj, ex_cliente_desde, faturamento_anual')
      .eq('id', processo.empresa_devedora_id)
      .maybeSingle()

    const [{ data: protesto }, { data: outros }, { data: universo }] = await Promise.all([
      supabaseAdmin.from('protestos_atual').select('tem_protesto, valor_total, consultado_em').eq('cnpj', e?.cnpj ?? '').maybeSingle(),
      supabaseAdmin
        .from('juridico_carteira')
        .select('numero_cnj, classe, situacao_interna, valor_causa, fase_atual')
        .eq('empresa_devedora_id', processo.empresa_devedora_id)
        .neq('numero_cnj', numeroCnj),
      supabaseAdmin.from('mercado_universo').select('situacao_cadastral, data_inicio_atividade, capital_social').eq('cnpj', e?.cnpj ?? '').maybeSingle(),
    ])

    devedora = {
      razao_social: e?.razao_social ?? null,
      cnpj: e?.cnpj ?? null,
      estagio: e?.estagio ?? null,
      ex_cliente_desde: e?.ex_cliente_desde ?? null,
      faturamento_estimado: e?.faturamento_anual ?? null,
      score_credito: e?.score_credito ?? null,
      faixa_score: e?.score_faixa ?? null,
      situacao_cadastral: universo?.situacao_cadastral ?? null,
      capital_social: universo?.capital_social ?? null,
      protestos: protesto ?? null,
      outros_processos_nossos: outros ?? [],
    }
  }

  // Relevantes primeiro e sem corte; depois as recentes que ainda não entraram. É a
  // ordem que sobrevive ao teto de tokens: se algo tiver de cair, cai a juntada de
  // rotina, nunca a citação.
  const chaves = new Set((relevantes ?? []).map((m) => `${m.data}|${m.conteudo}`))
  const recentesFiltradas = (movimentacoesRecentes ?? []).filter(
    (m) => !chaves.has(`${m.data}|${m.conteudo}`),
  )

  return {
    processo: {
      numero_cnj: numeroCnj,
      empresa_devedora_id: processo.empresa_devedora_id,
      classe: processo.classe,
      assunto: processo.assunto,
      foro: [processo.comarca, processo.uf, processo.tribunal_sigla].filter(Boolean).join(' · '),
      orgao_julgador: processo.orgao_julgador,
      valor_causa: processo.valor_causa,
      data_distribuicao: processo.data_distribuicao,
      situacao_interna: SITUACAO_INTERNA_LABELS[processo.situacao_interna as SituacaoInterna] ?? processo.situacao_interna,
      status_no_tribunal: processo.status_predito,
      advogado_responsavel: processo.advogado_nome,
      dias_sem_movimentacao: processo.dias_sem_movimentacao,
    },
    cronograma: {
      fase_atual: cronograma.fase_atual ? (FASE_LABELS[cronograma.fase_atual as Fase] ?? cronograma.fase_atual) : null,
      dias_na_fase_atual: cronograma.dias_na_fase_atual,
      dias_desde_a_distribuicao: cronograma.dias_total,
      fase_estourou_o_benchmark: cronograma.lenta,
      etapas: cronograma.etapas.map((e) => ({
        fase: FASE_LABELS[e.fase] ?? e.fase,
        de: e.desde,
        ate: e.ate,
        dias: e.dias,
        benchmark_dias: e.benchmark,
        estourou: e.estourou,
      })),
    },
    partes: envolvidos ?? [],
    empresa_devedora: devedora,
    operacoes_cobradas: operacoes ?? [],
    calculo_mais_recente: calculo
      ? {
          ...calculo,
          fonte: 'Cálculo determinístico da plataforma, com os parâmetros gravados na própria linha.',
        }
      : null,
    custos_incorridos: custos ?? [],
    recuperacoes_recebidas: recuperacoes ?? [],
    saldo_liquido: processo.saldo_liquido,
    prazos_em_aberto: prazos ?? [],
    movimentacoes_relevantes: relevantes ?? [],
    movimentacoes_recentes: recentesFiltradas,
    nota_sobre_as_movimentacoes:
      `As relevantes vêm INTEIRAS; as demais são as ${LIMITE_MOVIMENTACOES} mais recentes. ` +
      'Não conclua nada a partir da ausência de uma movimentação antiga.',
  }
}
