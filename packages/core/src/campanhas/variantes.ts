import { MAX_PASSOS, type Variante } from './schemas.js'

/**
 * A escolha de variante (teste A/B) e a sequência leve (§5).
 *
 * ─── POR QUE DETERMINÍSTICO E NÃO SORTEADO ──────────────────────────────────
 * A variante de um destinatário é derivada do id dele, não de `Math.random()`.
 * Três consequências, e as três importam:
 *
 *   • a prévia da simulação mostra o texto que a pessoa VAI receber, e não um
 *     texto plausível;
 *   • reexecutar a materialização depois de uma pausa não troca a mensagem de
 *     ninguém no meio da sequência;
 *   • o teste A/B fica reproduzível — dois relatórios do mesmo dia batem.
 *
 * O preço é que a distribuição não é perfeitamente aleatória; ela é uniforme
 * sobre os ids, o que é indistinguível na prática e verificável no teste.
 */

/** FNV-1a de 32 bits. Pequena, estável entre execuções e sem dependência. */
export function hash32(texto: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export function variantesDoPasso(variantes: readonly Variante[], passo: number): Variante[] {
  return variantes.filter((v) => v.passo === passo)
}

/**
 * Qual variante deste passo vai para este destinatário. `null` quando o passo não
 * tem variante — o que é o sinal de que a sequência acabou, não um erro.
 */
export function escolherVariante(
  variantes: readonly Variante[],
  passo: number,
  destinatarioId: string,
): Variante | null {
  const doPasso = variantesDoPasso(variantes, passo)
  if (doPasso.length === 0) return null
  if (doPasso.length === 1) return doPasso[0]!

  const total = doPasso.reduce((s, v) => s + Math.max(1, v.peso), 0)
  // O passo entra no hash: sem isso, quem pegou a variante A no toque 1 pegaria
  // a A de novo no toque 2, e o segundo toque seria uma repetição do primeiro
  // para metade da base.
  let ponto = hash32(`${destinatarioId}:${passo}`) % total

  // Ordem estável por id: a ordem em que as variantes chegam no array não pode
  // mudar quem recebe o quê, senão editar o rótulo de uma variante embaralharia
  // um teste em andamento.
  const ordenadas = [...doPasso].sort((a, b) => a.id.localeCompare(b.id))
  for (const v of ordenadas) {
    const peso = Math.max(1, v.peso)
    if (ponto < peso) return v
    ponto -= peso
  }
  return ordenadas[ordenadas.length - 1]!
}

/**
 * O próximo toque, ou `null` quando a sequência acabou.
 *
 * A regra dura do §5 — **para no primeiro sinal** — não está aqui de propósito:
 * ela é uma verificação de FATOS (respondeu? descadastrou? o Agente assumiu?), e
 * misturá-la com aritmética de calendário faria a função precisar saber de coisas
 * que ela não deveria. Quem chama pergunta primeiro `sequenciaCessouPara()`.
 */
export function proximoPasso(
  variantes: readonly Variante[],
  passoAtual: number,
  enviadaEm: Date,
): { passo: number; quando: Date; variante: Variante } | null {
  const proximo = passoAtual + 1
  if (proximo > MAX_PASSOS) return null

  const candidatas = variantesDoPasso(variantes, proximo)
  if (candidatas.length === 0) return null

  // `dias_apos` é medido do toque ANTERIOR, não do início da campanha: uma
  // campanha que atrasou dois dias não pode entregar o toque 2 no dia seguinte
  // ao toque 1 só porque o calendário original dizia isso.
  const dias = Math.max(1, Math.min(...candidatas.map((v) => v.dias_apos)))
  return {
    passo: proximo,
    quando: new Date(enviadaEm.getTime() + dias * 86_400_000),
    // A variante definitiva é escolhida por destinatário; esta é só a referência
    // de calendário do passo.
    variante: candidatas[0]!,
  }
}

export interface SinaisDoDestinatario {
  respondeu: boolean
  optout: boolean
  suprimido: boolean
  /** O Agente criou uma ação para esta conversa: a campanha cede o lugar. */
  agenteAssumiu: boolean
}

/**
 * "Para no primeiro sinal" (§5), como uma pergunta só.
 *
 * Os quatro sinais são diferentes entre si mas produzem a mesma decisão, e é
 * exatamente por isso que eles moram juntos: quem chama não deve poder lembrar
 * de três e esquecer do quarto.
 */
export function sequenciaCessouPara(s: SinaisDoDestinatario): boolean {
  return s.respondeu || s.optout || s.suprimido || s.agenteAssumiu
}
