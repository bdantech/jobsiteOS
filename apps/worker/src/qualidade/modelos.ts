import {
  JEV_URL,
  lerClassificacaoClaude,
  lerRespostaJev,
  montarClassificacaoClaude,
  montarPedidoJev,
  type Classificador,
  type PerguntaTipada,
  type RespostaCalibrada,
} from '../../../../packages/core/src/analise/classificador.js'
import {
  lerRevisaoClaude,
  montarRevisaoClaude,
  type PedidoRevisao,
  type RevisaoClaude,
} from '../../../../packages/core/src/analise/revisao.js'
import { AI_MODEL } from '../../../../packages/core/src/constants.js'
import { env } from '../env.js'
import { requisitarJson } from '../net/http.js'

/**
 * Os dois braços da análise (05C §4), por HTTP direto — o mesmo cano da triagem e do
 * agente, sem SDK a mais no worker. Cada braço conta os próprios tokens, porque o
 * painel de custo mostra quanto correu em cada um.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

export interface Contador {
  entrada: number
  saida: number
  chamadas: number
}

export const contadorVazio = (): Contador => ({ entrada: 0, saida: 0, chamadas: 0 })

/**
 * O Jev: probabilidade calibrada, nenhuma saída de texto. Timeout curto e UMA retentativa
 * — quem cobre a queda é o Claude, dentro da mesma análise, e não um retry de 30 s.
 */
export function classificadorJev(apiKey: string, contador: Contador): Classificador {
  return {
    provedor: 'jev',
    async perguntar(estado: string, perguntas: readonly PerguntaTipada[]): Promise<RespostaCalibrada[]> {
      const corpo = await requisitarJson(JEV_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}` },
        body: montarPedidoJev(estado, perguntas),
        tentativas: 2,
        baseMs: 1500,
        timeoutMs: 20_000,
      })
      const lido = lerRespostaJev(perguntas, corpo)
      contador.entrada += lido.tokensEntrada
      contador.chamadas += 1
      return lido.respostas
    },
  }
}

interface RespostaAnthropic {
  content?: Array<{ type: string; name?: string; input?: unknown }>
  usage?: { input_tokens?: number; output_tokens?: number }
}

async function chamarFerramenta(
  sistema: string,
  usuario: string,
  ferramenta: { name: string; description: string; input_schema: unknown },
  contador: Contador,
  maxTokens: number,
): Promise<unknown> {
  const chave = env.ANTHROPIC_API_KEY
  if (!chave) throw new Error('ANTHROPIC_API_KEY não configurada.')
  const r = await requisitarJson<RespostaAnthropic>(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
    body: {
      model: AI_MODEL,
      max_tokens: maxTokens,
      system: sistema,
      tools: [ferramenta],
      tool_choice: { type: 'tool', name: ferramenta.name },
      messages: [{ role: 'user', content: usuario }],
    },
    tentativas: 2,
    timeoutMs: 120_000,
  })
  contador.entrada += r.usage?.input_tokens ?? 0
  contador.saida += r.usage?.output_tokens ?? 0
  contador.chamadas += 1
  const uso = (r.content ?? []).find((b) => b.type === 'tool_use' && b.name === ferramenta.name)
  if (!uso) throw new Error('O modelo não devolveu a ferramenta pedida.')
  return uso.input
}

export function claudeDisponivel(): boolean {
  return !!env.ANTHROPIC_API_KEY
}

/** O Claude com a mesma interface do Jev: o reserva automático, e o primário quando escolhido nas settings. */
export function classificadorClaude(contador: Contador): Classificador {
  return {
    provedor: 'claude',
    async perguntar(estado: string, perguntas: readonly PerguntaTipada[]): Promise<RespostaCalibrada[]> {
      const p = montarClassificacaoClaude(estado, perguntas)
      const entrada = await chamarFerramenta(p.system, p.usuario, p.ferramenta, contador, 2000)
      return lerClassificacaoClaude(perguntas, entrada)
    },
  }
}

/** Itens reprovados e banda cinzenta → citação, orientação e a decisão do segundo juiz. */
export async function revisarComClaude(pedido: PedidoRevisao, contador: Contador): Promise<RevisaoClaude> {
  const p = montarRevisaoClaude(pedido)
  const entrada = await chamarFerramenta(p.system, p.usuario, p.ferramenta, contador, 4000)
  return lerRevisaoClaude(entrada, pedido.itens.map((i) => i.item.chave))
}

/** Desempate da vinculação: uma empresa da lista, ou nenhuma. */
export async function desempatarVinculo(
  conta: { canal: string; identificador: string; nome: string | null },
  candidatas: ReadonlyArray<{ empresa_id: string; razao_social: string | null; nome_fantasia: string | null; dominio: string | null; uf: string | null }>,
  contador: Contador,
): Promise<{ empresa_id: string | null; motivo: string }> {
  const lista = candidatas
    .map((c, i) => `${i + 1}. id=${c.empresa_id} · ${c.razao_social ?? '—'}${c.nome_fantasia ? ` (${c.nome_fantasia})` : ''} · domínio ${c.dominio ?? '—'} · ${c.uf ?? '—'}`)
    .join('\n')
  const entrada = (await chamarFerramenta(
    'Você liga contas de WhatsApp/e-mail a empresas da base de uma fintech de antecipação para construção civil. ' +
      'Só escolha uma empresa quando o nome, o nome fantasia ou o domínio sustentarem a ligação sem dúvida razoável. ' +
      'Nome de pessoa sozinho não basta. Na dúvida, não escolha nenhuma.',
    `Conta: ${conta.canal} ${conta.identificador}, nome "${conta.nome ?? ''}".\n\nCandidatas:\n${lista}`,
    {
      name: 'decidir_vinculo',
      description: 'Escolhe a empresa da conta, ou nenhuma.',
      input_schema: {
        type: 'object',
        properties: {
          empresa_id: { type: 'string', description: 'O id da candidata escolhida, ou vazio para nenhuma.' },
          motivo: { type: 'string' },
        },
        required: ['motivo'],
      },
    },
    contador,
    400,
  )) as { empresa_id?: string; motivo?: string }
  const id = entrada.empresa_id?.trim() || null
  return {
    empresa_id: id && candidatas.some((c) => c.empresa_id === id) ? id : null,
    motivo: entrada.motivo?.trim() || 'Sem motivo.',
  }
}
