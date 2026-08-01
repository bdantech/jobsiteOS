/**
 * O número da nota, normalizado — a chave de junção entre uma antecipação da
 * plataforma e a NF que o sync trouxe (04e §4.1).
 *
 * UMA função para os dois lados. `documentNumber` é digitado por gente
 * (`0084`, `84/1`, `NF 8821 SÉRIE 1`) e `notas_fiscais.numero` vem do XML
 * (hoje: 15.870 notas, todas dígitos puros, nenhuma com zero à esquerda). Duas
 * implementações "equivalentes" divergiriam no primeiro caso torto — e o efeito
 * de divergir aqui não é um erro na tela, é uma nota marcada como convertida
 * quando não foi.
 *
 * A regra que define o resto:
 *
 *   ZEROS À ESQUERDA SAEM. `0084` e `84` são a mesma nota, escrita por dois
 *   sistemas diferentes.
 *
 *   ZEROS À DIREITA FICAM. `84` e `840` são notas DIFERENTES. Essa assimetria é
 *   o coração da precisão: quando as duas fontes parecem divergir só por um zero
 *   ao final, quem decide é o valor (§4.2.3), nunca a normalização.
 *
 *   SÉRIE NÃO PARTICIPA. Ela já existe em `notas_fiscais.serie`; embutida no
 *   número ela só serve para impedir o casamento.
 */

/**
 * Série como sufixo separado por `/` ou `-`: `8821/1`, `8821-001`.
 *
 * Até 3 dígitos porque é o tamanho de uma série de NFe. O limite não é
 * decorativo: sem ele, `2024-1234` (um número com ano na frente) perderia os
 * quatro últimos dígitos e casaria com a nota errada.
 */
const SERIE_POR_SEPARADOR = /\s*[/-]\s*\d{1,3}\s*$/

/** Série escrita por extenso no fim: `8821 S1`, `8821 S. 1`, `8821 SERIE 1`. */
const SERIE_POR_EXTENSO = /\s+(?:SERIE|SER|S)\.?\s*\d{1,3}\s*$/

/**
 * `84/1` → `84`; `0084` → `84`; `NF 8821 SÉRIE 1` → `8821`.
 *
 * Devolve `null` quando não sobra dígito nenhum — o chamador trata isso como
 * "sem número para casar", que é diferente de "casou com string vazia".
 */
export function normalizarNumeroNf(valor: string | number | null | undefined): string | null {
  if (valor === null || valor === undefined) return null

  // O acento some antes da comparação: a mesma nota chega como `SÉRIE` do
  // formulário e `SERIE` do XML.
  let s = String(valor).trim().toUpperCase().replace(/É/g, 'E')
  if (s === '') return null

  s = s.replace(SERIE_POR_SEPARADOR, '')
  s = s.replace(SERIE_POR_EXTENSO, '')

  // Só agora os separadores restantes (`.`, `,`, espaço, prefixos como `NF`).
  // Nesta ordem de propósito: fazer isto antes transformaria `8821 S1` em
  // `88211`, um número que não existe.
  s = s.replace(/\D/g, '')
  if (s === '') return null

  s = s.replace(/^0+/, '')
  return s === '' ? null : s
}
