import type { LimitesCampanhas } from './schemas.js'

/**
 * SAÚDE DE CANAL (§6).
 *
 * Campanha ruim não queima só a campanha: queima o domínio e o número, e com
 * eles a conversa de todo mundo que já falava por ali. Por isso o alerta existe
 * antes de o dano ser visível no resultado da campanha.
 *
 * ─── A AMOSTRA MÍNIMA NÃO É DETALHE ─────────────────────────────────────────
 * 1 opt-out em 3 enviadas é 33%, muito acima de qualquer limiar, e não significa
 * absolutamente nada. Sem um piso de amostra, o primeiro alerta chega antes da
 * primeira campanha de verdade e ensina o time a ignorar alertas — que é o pior
 * resultado possível para um sistema de alerta.
 */

export type TipoAlertaSaude = 'optout' | 'bounce'

export interface SaudeDoCanal {
  enviadas: number
  optouts: number
  bounces: number
  optoutPct: number | null
  bouncePct: number | null
  amostraSuficiente: boolean
  alertas: TipoAlertaSaude[]
}

function pct(parte: number, total: number): number | null {
  if (total <= 0) return null
  return Math.round((parte / total) * 10000) / 100
}

export function avaliarSaude(
  args: { enviadas: number; optouts: number; bounces: number },
  limites: LimitesCampanhas,
): SaudeDoCanal {
  const { enviadas, optouts, bounces } = args
  const optoutPct = pct(optouts, enviadas)
  const bouncePct = pct(bounces, enviadas)
  const amostraSuficiente = enviadas >= limites.minimo_para_alertar

  const alertas: TipoAlertaSaude[] = []
  if (amostraSuficiente) {
    if (optoutPct !== null && optoutPct >= limites.alerta_optout_pct) alertas.push('optout')
    if (bouncePct !== null && bouncePct >= limites.alerta_bounce_pct) alertas.push('bounce')
  }

  return { enviadas, optouts, bounces, optoutPct, bouncePct, amostraSuficiente, alertas }
}

export const ALERTA_SAUDE_TEXTOS: Record<TipoAlertaSaude, string> = {
  optout:
    'Opt-out acima do limiar. Quando muita gente pede para sair, o problema quase nunca é o ' +
    'canal — é a lista ou o texto.',
  bounce:
    'Bounce acima do limiar. E-mail inválido em volume derruba a reputação do domínio, e o ' +
    'domínio é compartilhado com a conversa de todo mundo.',
}

/**
 * A conta com problema de entrega, dentro de uma campanha só.
 *
 * Comparar contas ENTRE SI dentro da mesma campanha é o que isola a variável:
 * mesmo texto, mesmo público, mesma janela. Uma conta entregando muito abaixo da
 * mediana das outras é a conta, não a mensagem.
 */
export interface DesempenhoDaConta {
  conta: string
  enviadas: number
  entregues: number
}

export function contasSuspeitas(
  contas: readonly DesempenhoDaConta[],
  minimoPorConta = 20,
): DesempenhoDaConta[] {
  const avaliaveis = contas.filter((c) => c.enviadas >= minimoPorConta)
  if (avaliaveis.length < 2) return []

  const taxas = avaliaveis.map((c) => c.entregues / c.enviadas).sort((a, b) => a - b)
  const meio = Math.floor(taxas.length / 2)
  const mediana =
    taxas.length % 2 === 0 ? (taxas[meio - 1]! + taxas[meio]!) / 2 : taxas[meio]!

  // Metade da mediana: é grosseiro de propósito. Um teste estatístico decente
  // exigiria volume que uma campanha nossa raramente tem, e um limiar explicável
  // vale mais que um limiar defensável no papel.
  return avaliaveis.filter((c) => c.entregues / c.enviadas < mediana * 0.5)
}
