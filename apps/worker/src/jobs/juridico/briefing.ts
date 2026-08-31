import { AI_MODEL } from '../../../../../packages/core/src/constants.js'
import {
  AVISO_PARECER,
  FASE_LABELS,
  SITUACAO_INTERNA_LABELS,
  type Fase,
  type SituacaoInterna,
} from '../../../../../packages/core/src/juridico/index.js'
import { supabaseAdmin } from '../../db.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { requisitarJson } from '../../net/http.js'

/**
 * O BRIEFING: as três frases que alguém precisa ao ABRIR o processo.
 *
 * ── POR QUE NÃO É O PARECER ────────────────────────────────────────────────
 * O parecer (§7) tem seis seções, lê 80 movimentações e avalia risco. É um
 * documento: você o gera, lê uma vez e guarda. O briefing responde outra coisa —
 * "abri este processo agora, me situe" — e um documento de seis seções não situa
 * ninguém, ele exige ser lido.
 *
 * Os dois convivem porque as perguntas são diferentes. Fundir seria transformar o
 * briefing num parecer curto, que é pior nas duas funções.
 *
 * ── O CACHE TEM VALIDADE POR MOVIMENTAÇÃO, NÃO POR DATA ────────────────────
 * `ate_movimentacao_em` guarda até onde o briefing leu. Um briefing de três meses
 * atrás sobre um processo parado há um ano está perfeitamente atual; um de ontem
 * sobre um processo que teve penhora hoje de manhã está velho. Expirar por tempo
 * erraria os dois casos e gastaria token nos processos parados, que são a maioria.
 *
 * ── O MODELO NÃO CONTA PRAZO ───────────────────────────────────────────────
 * Mesma restrição do parecer, e pelo mesmo motivo: ele não tem calendário
 * forense. "Contestar até sexta" é o tipo de frase que soa útil e perde prazo.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

/** O briefing lê MENOS que o parecer: ele resume o recente, não a história. */
const LIMITE_MOVIMENTACOES = 25

interface RespostaAnthropic {
  content?: Array<{ type: string; text?: string; name?: string; input?: unknown }>
  model?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

interface SaidaBriefing {
  resumo_fase?: string
  resumo_movimentacoes?: string
  proxima_acao?: string
  urgencia?: 'baixa' | 'media' | 'alta'
}

export interface ResultadoBriefing {
  numero_cnj: string
  gerado: boolean
  motivo?: string
  tokens?: number
}

interface LinhaProcesso {
  numero_cnj: string
  classe: string | null
  assunto: string | null
  polo_nosso: string | null
  situacao_interna: string | null
  fase_atual: string | null
  fase_desde: string | null
  valor_causa: number | null
  data_distribuicao: string | null
  tribunal_sigla: string | null
  comarca: string | null
  orgao_julgador: string | null
  arquivado: boolean | null
  data_ultima_movimentacao: string | null
  qtd_movimentacoes: number | null
}

/**
 * Gera o briefing de um processo. `forcar` ignora o cache — é o botão
 * "regenerar", para quando alguém não confia no texto e quer outro.
 */
export async function gerarBriefing(
  numeroCnj: string,
  forcar = false,
): Promise<ResultadoBriefing> {
  if (!env.ANTHROPIC_API_KEY) {
    return { numero_cnj: numeroCnj, gerado: false, motivo: 'ANTHROPIC_API_KEY não configurada.' }
  }

  const { data: p } = await supabaseAdmin
    .from('processos')
    .select(
      'numero_cnj, classe, assunto, polo_nosso, situacao_interna, fase_atual, fase_desde, ' +
        'valor_causa, data_distribuicao, tribunal_sigla, comarca, orgao_julgador, arquivado, ' +
        'data_ultima_movimentacao, qtd_movimentacoes',
    )
    .eq('numero_cnj', numeroCnj)
    .maybeSingle()

  if (!p) return { numero_cnj: numeroCnj, gerado: false, motivo: 'Processo não encontrado.' }
  const proc = p as unknown as LinhaProcesso

  const { data: movs } = await supabaseAdmin
    .from('processo_movimentacoes')
    .select('data, conteudo, tipo, relevante')
    .eq('numero_cnj', numeroCnj)
    .order('data', { ascending: false })
    .limit(LIMITE_MOVIMENTACOES)

  const movimentacoes = movs ?? []
  if (movimentacoes.length === 0) {
    // Sem movimentação não há o que resumir, e um briefing dizendo "não há
    // informação" custaria token para repetir o que a tela já mostra.
    return {
      numero_cnj: numeroCnj,
      gerado: false,
      motivo: 'Sem movimentações — rode a sincronização antes.',
    }
  }

  if (!forcar) {
    const { data: atual } = await supabaseAdmin
      .from('processo_briefings')
      .select('ate_movimentacao_em')
      .eq('numero_cnj', numeroCnj)
      .maybeSingle()

    const ultima = proc.data_ultima_movimentacao
    if (atual?.ate_movimentacao_em && ultima && atual.ate_movimentacao_em >= ultima) {
      return { numero_cnj: numeroCnj, gerado: false, motivo: 'Já atualizado.' }
    }
  }

  const dossie = {
    processo: {
      numero: proc.numero_cnj,
      classe: proc.classe,
      assunto: proc.assunto,
      // Quem é quem, em português: "polo ativo" sozinho não diz ao modelo (nem a
      // quem lê a saída) que somos NÓS que cobramos.
      nosso_papel:
        proc.polo_nosso === 'ativo'
          ? 'Somos a parte que cobra (polo ativo).'
          : proc.polo_nosso === 'passivo'
            ? 'Somos a parte cobrada (polo passivo).'
            : 'Nosso polo não foi identificado.',
      situacao: SITUACAO_INTERNA_LABELS[proc.situacao_interna as SituacaoInterna] ?? proc.situacao_interna,
      fase_atual: proc.fase_atual ? (FASE_LABELS[proc.fase_atual as Fase] ?? proc.fase_atual) : null,
      fase_desde: proc.fase_desde,
      valor_causa: proc.valor_causa,
      distribuido_em: proc.data_distribuicao,
      tribunal: proc.tribunal_sigla,
      comarca: proc.comarca,
      orgao_julgador: proc.orgao_julgador,
      arquivado: proc.arquivado,
      total_de_movimentacoes: proc.qtd_movimentacoes,
    },
    movimentacoes_recentes: movimentacoes.map((m) => ({
      data: m.data,
      relevante: m.relevante,
      tipo: m.tipo,
      texto: (m.conteudo ?? '').slice(0, 600),
    })),
  }

  const prompt =
    `Você assessora o time jurídico de um FIDC que antecipa recebíveis da construção ` +
    `civil e move ações de cobrança contra devedores.\n\n` +
    `Alguém acabou de ABRIR este processo na tela e precisa se situar em dez segundos. ` +
    `Escreva três coisas curtas, não um parecer.\n\n` +
    `RESTRIÇÕES — todas obrigatórias:\n` +
    `- Use APENAS os dados abaixo. Não invente número, data, nome ou dispositivo legal.\n` +
    `- NUNCA afirme prazo processual (quantos dias faltam, se precluiu, se cabe recurso). ` +
    `Você não tem calendário forense nem contagem de prazos. Se uma movimentação citar um ` +
    `prazo literalmente, você pode repetir o que ela diz, atribuindo a ela.\n` +
    `- Se os dados não bastarem para dizer qual é o próximo passo, diga isso em vez de ` +
    `inventar um passo plausível.\n` +
    `- Linguagem simples: quem lê pode não ser advogado.\n` +
    `- Português do Brasil, tom sóbrio, sem adjetivos e sem jargão desnecessário.\n` +
    `- Não escreva nada que se pareça com uma petição.\n\n` +
    `DADOS (JSON):\n${JSON.stringify(dossie, null, 2)}`

  const resp = await requisitarJson<RespostaAnthropic>(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: {
      model: AI_MODEL,
      max_tokens: 1500,
      tools: [
        {
          name: 'registrar_briefing',
          description: 'Registra o resumo da fase, o das movimentações e a próxima ação.',
          input_schema: {
            type: 'object',
            properties: {
              resumo_fase: {
                type: 'string',
                description:
                  'Em que ponto o processo está e o que isso significa na prática, em 1 a 2 ' +
                  'frases. Máximo 300 caracteres.',
              },
              resumo_movimentacoes: {
                type: 'string',
                description:
                  'O que aconteceu de relevante recentemente, em 2 a 4 frases, em ordem ' +
                  'cronológica e citando as datas. Máximo 600 caracteres. Se nada relevante ' +
                  'aconteceu, diga que o processo está parado e desde quando.',
              },
              proxima_acao: {
                type: 'string',
                description:
                  'UMA ação concreta, começando com verbo, em no máximo 200 caracteres. Ex.: ' +
                  '"Peticionar pedido de penhora online sobre as contas do executado." Se os ' +
                  'dados não bastarem, escreva o que falta descobrir.',
              },
              urgencia: {
                type: 'string',
                enum: ['baixa', 'media', 'alta'],
                description:
                  'alta = há decisão, intimação ou audiência recente pedindo resposta nossa. ' +
                  'media = o processo anda e há trabalho a fazer sem pressa aparente. ' +
                  'baixa = parado, arquivado ou aguardando terceiro.',
              },
            },
            required: ['resumo_fase', 'resumo_movimentacoes', 'proxima_acao', 'urgencia'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'registrar_briefing' },
      messages: [{ role: 'user', content: prompt }],
    },
    timeoutMs: 120_000,
    tentativas: 2,
  })

  const uso = resp.content?.find((c) => c.type === 'tool_use' && c.name === 'registrar_briefing')
  const saida = (uso?.input ?? {}) as SaidaBriefing

  if (!saida.resumo_fase || !saida.proxima_acao) {
    logger.error({ numero_cnj: numeroCnj }, 'Briefing veio sem os campos obrigatórios.')
    return { numero_cnj: numeroCnj, gerado: false, motivo: 'O modelo não devolveu o briefing.' }
  }

  const tokens = (resp.usage?.input_tokens ?? 0) + (resp.usage?.output_tokens ?? 0)

  const { error } = await supabaseAdmin.from('processo_briefings').upsert(
    {
      numero_cnj: numeroCnj,
      resumo_fase: saida.resumo_fase,
      resumo_movimentacoes: saida.resumo_movimentacoes ?? '',
      proxima_acao: saida.proxima_acao,
      urgencia: saida.urgencia ?? null,
      // Até onde ele leu: é a validade do cache, e vem da movimentação mais
      // recente que ENTROU no dossiê, não de `now()`.
      ate_movimentacao_em: movimentacoes[0]?.data ?? proc.data_ultima_movimentacao,
      qtd_movimentacoes_lidas: movimentacoes.length,
      modelo: resp.model ?? AI_MODEL,
      tokens,
      criado_em: new Date().toISOString(),
    },
    { onConflict: 'numero_cnj' },
  )

  if (error) {
    logger.error({ numero_cnj: numeroCnj, erro: error.message }, 'Falha ao gravar o briefing.')
    return { numero_cnj: numeroCnj, gerado: false, motivo: error.message }
  }

  return { numero_cnj: numeroCnj, gerado: true, tokens }
}

export interface ResultadoBriefingsEmLote {
  avaliados: number
  gerados: number
  pulados: number
  tokens: number
}

/**
 * Os briefings que ficaram velhos. Roda depois do sync, que é quando eles ficam
 * velhos — um relógio próprio acordaria para descobrir que nada mudou.
 *
 * `limite` existe porque o primeiro dia é diferente de todos os outros: uma
 * carteira que acabou de ser descoberta tem TODOS os briefings faltando, e gerar
 * duzentos de uma vez é uma conta que ninguém aprovou.
 */
export async function gerarBriefingsPendentes(limite = 25): Promise<ResultadoBriefingsEmLote> {
  const acc: ResultadoBriefingsEmLote = { avaliados: 0, gerados: 0, pulados: 0, tokens: 0 }

  /*
   * Quem precisa: processo ATIVO, com movimentação, cujo briefing não existe ou
   * é anterior à última movimentação. Arquivado fica de fora — pagar token para
   * resumir um processo encerrado é pagar para descrever o passado.
   */
  const { data, error } = await supabaseAdmin
    .from('processos')
    .select('numero_cnj, data_ultima_movimentacao, processo_briefings(ate_movimentacao_em)')
    .not('data_ultima_movimentacao', 'is', null)
    .eq('arquivado', false)
    .order('data_ultima_movimentacao', { ascending: false })
    .limit(200)

  if (error) {
    logger.error({ erro: error.message }, 'Falha ao listar processos para briefing.')
    return acc
  }

  const pendentes = (data ?? []).filter((p) => {
    // O embed vem como OBJETO, não array: a relação é um-para-um pela PK. Tratar
    // como array faria `ate` ser sempre indefinido, e todo processo pareceria
    // pendente para sempre — um briefing regerado a cada sync, para sempre.
    const b = p.processo_briefings as { ate_movimentacao_em: string | null } | null
    const ate = b?.ate_movimentacao_em
    return !ate || (p.data_ultima_movimentacao !== null && ate < p.data_ultima_movimentacao)
  })

  acc.avaliados = pendentes.length

  for (const p of pendentes.slice(0, limite)) {
    const r = await gerarBriefing(p.numero_cnj)
    if (r.gerado) {
      acc.gerados += 1
      acc.tokens += r.tokens ?? 0
    } else {
      acc.pulados += 1
    }
  }

  logger.info({ ...acc, aviso: AVISO_PARECER }, 'Briefings de processo atualizados.')
  return acc
}
