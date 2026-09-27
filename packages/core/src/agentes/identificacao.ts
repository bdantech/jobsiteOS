/**
 * COMO A IA SE IDENTIFICA (Prompt 09 §10).
 *
 * Política vigente: a IA não anuncia que é IA; perguntada, confirma com naturalidade e
 * segue a conversa. Isto é CONFIGURAÇÃO (`agentes_config.geral.identificacao`) e não
 * texto fixo no prompt porque é o tipo de política que muda com um parecer jurídico — e
 * mudá-la não pode exigir deploy.
 *
 * ─── O PISO NÃO É CONFIGURÁVEL ──────────────────────────────────────────────
 * Nenhuma das três políticas permite afirmar ser humano, nem inventar atributos pessoais
 * (família, fim de semana, escritório, cidade onde mora). E nenhuma permite NEGAR ser IA
 * quando a pessoa pergunta diretamente: a diferença entre elas é só sobre anunciar por
 * iniciativa própria e sobre o tom da confirmação. `nunca_afirmar_humano` é o nome do
 * piso, não uma licença para esquivar — um modelo que responde "sou do time comercial"
 * a "é um robô?" está afirmando ser humano por outras palavras.
 *
 * O guardrail que ESCALAVA quando perguntavam "é robô?" saiu (§1.10): responder e seguir
 * é comercialmente melhor que abandonar a conversa no momento mais sensível dela.
 */

export const POLITICAS_IDENTIFICACAO = ['se_perguntada', 'sempre', 'nunca_afirmar_humano'] as const
export type PoliticaIdentificacao = (typeof POLITICAS_IDENTIFICACAO)[number]

export const POLITICA_IDENTIFICACAO_LABELS: Record<PoliticaIdentificacao, string> = {
  se_perguntada: 'Confirma que é IA quando perguntada',
  sempre: 'Apresenta-se como IA desde a primeira mensagem',
  nunca_afirmar_humano: 'Só o piso: nunca afirma ser humana',
}

/** As linhas que valem em QUALQUER política. Testadas em `prompt.test.ts`. */
export const REGRAS_DURAS_IDENTIFICACAO = [
  'NUNCA afirme ser humano, nem por insinuação ("sou do time", "aqui do escritório", "estou em casa hoje").',
  'NUNCA invente atributos pessoais: família, fim de semana, cidade, escritório, idade, gostos, rotina.',
  'Se perguntarem diretamente se você é um robô, uma IA ou um assistente virtual, NÃO NEGUE.',
] as const

/** O parágrafo de identificação que entra no system prompt, conforme a política. */
export function regraDeIdentificacao(politica: PoliticaIdentificacao, nomePersona: string): string {
  const base = REGRAS_DURAS_IDENTIFICACAO.map((r) => `- ${r}`).join('\n')
  switch (politica) {
    case 'sempre':
      return `Identificação: você é ${nomePersona}, uma assistente de IA da ONE OS. Diga isso com naturalidade na primeira mensagem a cada pessoa nova (uma frase curta, sem pedir desculpas), e siga a conversa.\n${base}`
    case 'nunca_afirmar_humano':
      return `Identificação: você é ${nomePersona}, uma assistente de IA da ONE OS. Não é preciso anunciar isso. Se perguntarem, responda com honestidade e brevidade, e siga.\n${base}`
    case 'se_perguntada':
    default:
      return `Identificação: você é ${nomePersona}, uma assistente de IA da ONE OS. Não anuncie isso por iniciativa própria. Se perguntarem, confirme com naturalidade, em uma frase ("Sou, sim — sou a assistente de IA da ONE OS."), e continue a conversa de onde ela estava. Não escale só por causa da pergunta.\n${base}`
  }
}
