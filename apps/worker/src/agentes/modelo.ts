import type { BlocoModelo, ChamadaModelo, RespostaModelo } from '../../../../packages/core/src/agentes/loop.js'
import { AI_MODEL } from '../../../../packages/core/src/constants.js'
import { env } from '../env.js'
import { requisitarJson } from '../net/http.js'

/**
 * O MODELO DO AGENTE: a Messages API da Anthropic com `tools`, por HTTP direto — o mesmo
 * cano do decisor de conversa e da triagem, sem SDK a mais no worker.
 *
 * `max_tokens` modesto de propósito: cada passo do loop é UMA decisão (uma ou duas
 * ferramentas e uma frase), não um texto longo. Um modelo com 4k tokens de folga escreve
 * e-mails de três parágrafos para um fornecedor que responde por WhatsApp.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

interface RespostaApi {
  content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>
  stop_reason?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

export function modeloAnthropic(): ChamadaModelo | null {
  const chave = env.ANTHROPIC_API_KEY
  if (!chave) return null

  return async ({ system, mensagens, ferramentas }): Promise<RespostaModelo> => {
    const resposta = await requisitarJson<RespostaApi>(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      body: {
        model: AI_MODEL,
        max_tokens: 1500,
        system,
        tools: ferramentas,
        messages: mensagens,
      },
      tentativas: 2,
      timeoutMs: 60_000,
    })

    const conteudo: BlocoModelo[] = []
    for (const b of resposta.content ?? []) {
      if (b.type === 'text' && typeof b.text === 'string') conteudo.push({ type: 'text', text: b.text })
      else if (b.type === 'tool_use' && b.id && b.name) conteudo.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input ?? {} })
    }
    return {
      conteudo,
      parada: resposta.stop_reason ?? 'end_turn',
      tokens: { entrada: resposta.usage?.input_tokens ?? 0, saida: resposta.usage?.output_tokens ?? 0 },
    }
  }
}
