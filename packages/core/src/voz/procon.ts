/**
 * Quem está na lista do Procon não recebe ligação.
 *
 * ── POR QUE ISTO É UMA FUNÇÃO, E NÃO UMA COLUNA ────────────────────────────
 * A marca do Procon não é campo do nosso cadastro: ela chega do enriquecimento
 * (Nova Vida TI) dentro de `contatos_descobertos.evidencia`, na mesma frase que
 * diz se o número é fixo ou celular e qual é a operadora — "Nova Vida TI ·
 * telefone da empresa (celular, VIVO, no Procon, com WhatsApp)".
 *
 * O portão da voz tem o campo `no_procon` desde o primeiro dia, e até um teste
 * verde. Só que ninguém nunca o preencheu: o promovido vira linha em `contatos`,
 * que não tem essa coluna, e a evidência fica para trás. O resultado era um
 * portão que parecia fechado e estava aberto — ligar para quem está no Procon é
 * risco jurídico, e a prova seria a gravação da própria ligação.
 *
 * Enquanto a marca não for coluna, é aqui que ela é lida. Uma consulta por lote
 * de telefones, do lado de quem já tem os números na mão.
 */

/** O que o provedor escreve na evidência quando o número está na lista. */
const MARCA = 'no procon'

export interface EvidenciaDeContato {
  /** O E.164, como `contatos_descobertos.valor` guarda. */
  valor: string
  evidencia: string | null
}

/**
 * Os telefones que a evidência marca como Procon, em E.164.
 *
 * Devolve um `Set` porque quem chama tem dezenas de notas e pergunta uma vez por
 * telefone — e porque a resposta certa para "não sei" é "não está na lista", que
 * é o que um Set vazio diz.
 */
export function telefonesNoProcon(linhas: readonly EvidenciaDeContato[]): Set<string> {
  const fora = new Set<string>()
  for (const l of linhas) {
    if ((l.evidencia ?? '').toLowerCase().includes(MARCA)) fora.add(l.valor)
  }
  return fora
}
