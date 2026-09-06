import { AI_MODEL } from '../../../../../packages/core/src/constants.js'
import { briefingParaIa, type ReportSemanal } from '../../../../../packages/core/src/reports/semanal.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { requisitarJson } from '../../net/http.js'

/**
 * Os três parágrafos que abrem o report (04q §2).
 *
 * ─── A GARANTIA DE QUE ELE NÃO INVENTA ──────────────────────────────────────
 * O modelo recebe SÓ o briefing numérico de `briefingParaIa()`, que é montado a partir dos
 * indicadores já calculados. Ele não tem ferramenta, não tem acesso a tabela e não pode
 * buscar mais nada: se um número não está no briefing, ele não existe para o resumo.
 *
 * Isso é estrutural, e é diferente de pedir no prompt "não invente". Pedir também é feito —
 * mas quem garante é o que não está na mesa.
 *
 * ─── POR QUE FALHAR AQUI NÃO DERRUBA O REPORT ───────────────────────────────
 * `null` em vez de exceção. O resumo é a melhor parte do report e não é o report: um PDF
 * com onze blocos de números e sem os três parágrafos continua respondendo tudo o que
 * alguém precisa saber. Um domingo sem report porque a API da Anthropic estava fora seria
 * trocar o essencial pelo desejável.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

interface RespostaAnthropic {
  content?: Array<{ type: string; text?: string; name?: string; input?: unknown }>
}

interface SaidaResumo {
  foi_bem?: string
  preocupa?: string
  onde_agir?: string
}

export async function gerarResumoSemanal(r: ReportSemanal): Promise<string | null> {
  if (!env.ANTHROPIC_API_KEY) {
    logger.warn('ANTHROPIC_API_KEY ausente — o report sai sem o resumo.')
    return null
  }

  const briefing = briefingParaIa(r)

  const prompt =
    `Você escreve o resumo executivo do report semanal de uma empresa que antecipa ` +
    `recebíveis da construção civil. Quem lê é a diretoria, na segunda de manhã.\n\n` +
    `TRÊS PARÁGRAFOS, nesta ordem: (1) o que foi bem, (2) o que preocupa, (3) onde agir.\n\n` +
    `RESTRIÇÕES — todas obrigatórias:\n` +
    `- Use APENAS os números do JSON abaixo. Não calcule nada novo, não some, não projete e ` +
    `não invente nome, valor ou percentual que não esteja ali.\n` +
    `- NUNCA afirme a CAUSA de um movimento. Você não tem como saber por que algo subiu ou ` +
    `caiu; diga o que aconteceu e, se couber, que a causa não está no dado.\n` +
    `- Cada afirmação vem acompanhada do número que a sustenta.\n` +
    `- O campo "regua" de cada indicador diz sobre quantos meses a média foi calculada. ` +
    `Quando forem poucos, DIGA isso — "acima da média de 3 meses" é honesto, "acima da ` +
    `média" sozinho sugere uma base que não existe.\n` +
    `- O campo "direcao" já traduz se a variação é boa ou ruim: em várias métricas subir é ` +
    `PIOR (valor expirado, limite ocioso, antecipações travadas). Respeite-o e nunca ` +
    `comemore uma alta marcada como "pior".\n` +
    `- O mês corrente é PARCIAL (veja "mes_parcial"). Não compare o parcial com um mês ` +
    `fechado como se fossem a mesma coisa.\n` +
    `- O parágrafo 3 cita NOMES e VALORES concretos e propõe a ação. É o único que manda ` +
    `alguém fazer algo.\n` +
    `- Português do Brasil, direto, sem jargão e sem adjetivo de entusiasmo. Não abra com ` +
    `"Nesta semana". Máximo de 4 frases por parágrafo.\n\n` +
    `DADOS (JSON):\n${JSON.stringify(briefing)}`

  try {
    const resp = await requisitarJson<RespostaAnthropic>(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: {
        model: AI_MODEL,
        max_tokens: 1600,
        /*
         * Saída por TOOL CALL, e não markdown para alguém depois separar por regex. Os três
         * parágrafos vão para lugares diferentes — o PDF, o corpo do e-mail e a aba — e
         * "encontrar o segundo parágrafo" num texto corrido é o tipo de parse que quebra em
         * silêncio quando o modelo resolve usar um título.
         */
        tools: [
          {
            name: 'registrar_resumo',
            description: 'Registra os três parágrafos do resumo executivo da semana.',
            input_schema: {
              type: 'object',
              properties: {
                foi_bem: { type: 'string', description: 'Parágrafo 1: o que foi bem.' },
                preocupa: { type: 'string', description: 'Parágrafo 2: o que preocupa.' },
                onde_agir: {
                  type: 'string',
                  description: 'Parágrafo 3: onde agir, com nomes e valores concretos.',
                },
              },
              required: ['foi_bem', 'preocupa', 'onde_agir'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'registrar_resumo' },
        messages: [{ role: 'user', content: prompt }],
      },
      tentativas: 2,
    })

    const bloco = (resp.content ?? []).find((c) => c.type === 'tool_use' && c.name === 'registrar_resumo')
    const saida = (bloco?.input ?? {}) as SaidaResumo
    const paragrafos = [saida.foi_bem, saida.preocupa, saida.onde_agir]
      .map((p) => p?.trim())
      .filter((p): p is string => Boolean(p))

    if (paragrafos.length < 3) {
      logger.warn({ recebidos: paragrafos.length }, 'Resumo da IA veio incompleto — o report sai sem ele.')
      return null
    }
    return paragrafos.join('\n\n')
  } catch (erro) {
    // O resumo é a melhor parte do report e não é o report.
    logger.error({ erro: String(erro) }, 'Falha ao gerar o resumo da semana — o report sai sem ele.')
    return null
  }
}
