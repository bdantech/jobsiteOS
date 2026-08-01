import { forcaDoLift, type AchadoContraste } from './contraste.js'
import { formatarLift } from './sugestoes.js'
import type { VariavelPerfil } from './variaveis.js'

/**
 * As frases do painel (04f §7.1 e §7.2), por TEMPLATE — nunca por IA.
 *
 * A regra de UX do prompt é inegociável: legível por não-analista. Mas o motivo
 * de não usar IA aqui não é custo, é responsabilidade. Um resumo gerado por
 * modelo pode suavizar, extrapolar ou inventar uma causa ("empresas maiores
 * operam mais porque têm mais fôlego") — e a frase que aparece no topo do painel
 * é a que vai ser repetida numa reunião como se fosse um fato medido.
 *
 * Template garante que a frase diga EXATAMENTE o que o número diz, e nada além.
 */

/** Quantos traços cabem no resumo antes de ele virar um parágrafo que ninguém lê. */
const MAX_TRACOS = 5

export interface TracoResumo {
  variavel: string
  label: string
  categoria: string
  lift: number | null
}

/**
 * Os traços que sustentam o resumo: achados sólidos, não suprimidos, ordenados
 * por força do lift e com lift ACIMA de 1.
 *
 * O corte em 1 é o que faz a frase descrever quem opera, e não quem não opera:
 * "tipicamente não têm certificado digital" é verdadeiro e inútil como retrato.
 */
export function tracosDoResumo(
  achados: readonly AchadoContraste[],
  rotulo: (id: string) => string,
  liftMinimo = 1.3,
): TracoResumo[] {
  return achados
    .filter((a) => !a.suprimido && a.confianca === 'solida' && a.destaque)
    .filter((a) => (a.destaque?.lift ?? 0) > liftMinimo)
    .sort((x, y) => forcaDoLift(y.destaque) - forcaDoLift(x.destaque))
    .slice(0, MAX_TRACOS)
    .map((a) => ({
      variavel: a.variavel,
      label: rotulo(a.variavel),
      categoria: a.destaque?.chave ?? '',
      lift: a.destaque?.lift ?? null,
    }))
}

/**
 * "Seus sacados pesados típicos: incorporadora LTDA de SP, 5 a 15 anos, 3 ou
 * mais SPEs no grupo."
 *
 * Sem traço nenhum, a frase diz isso — e diz por quê. Um resumo em branco é lido
 * como "o sistema não achou nada"; a verdade quase sempre é "a coorte é pequena
 * demais para afirmar qualquer coisa", que é uma informação diferente e
 * acionável (esperar mais dados).
 */
export function fraseResumo(
  rotuloCoorte: string,
  tracos: readonly TracoResumo[],
  totalCoorte: number,
): string {
  if (tracos.length === 0) {
    return (
      `Ainda não dá para traçar um retrato de ${rotuloCoorte}: com ${totalCoorte} ` +
      `empresa${totalCoorte === 1 ? '' : 's'} na coorte, nenhuma característica se ` +
      `destacou o bastante para ser afirmada. O perfil fica mais nítido a cada mês de operação.`
    )
  }
  return `${maiuscula(rotuloCoorte)} típicos: ${tracos.map((t) => t.categoria).join(', ')}.`
}

/** A frase de um card de achado. */
export function fraseAchado(
  achado: AchadoContraste,
  variavel: VariavelPerfil | undefined,
  rotuloA: string,
  rotuloB: string,
): string {
  const label = variavel?.label ?? achado.variavel
  const d = achado.destaque

  if (!d) {
    return `${label}: sem célula com amostra suficiente para comparar ${rotuloA} e ${rotuloB}.`
  }

  if (d.lift === null) {
    return `${label} "${d.chave}" só aparece entre ${rotuloA} — não há caso no grupo de comparação.`
  }

  const direcao = d.lift >= 1 ? 'mais' : 'menos'
  const forca = formatarLift(d.lift >= 1 ? d.lift : 1 / d.lift)
  return `${rotuloA} com ${label.toLowerCase()} "${d.chave}" são ${forca} ${direcao} frequentes que ${rotuloB}.`
}

/** A frase de mordida da auditoria de faixas (§5). */
export function fraseConversaoForaDeFaixa(
  convertidasSemFaixa: number,
  convertidasTotal: number,
): string {
  if (convertidasTotal === 0) {
    return 'Nenhuma NF converteu no período — não há taxa de conversão a comparar entre faixas.'
  }
  const pct = Math.round((convertidasSemFaixa / convertidasTotal) * 100)
  if (convertidasSemFaixa === 0) {
    return `Todas as ${convertidasTotal} NFs que converteram estavam em alguma faixa quando converteram.`
  }
  return (
    `${pct}% das NFs que converteram (${convertidasSemFaixa} de ${convertidasTotal}) estavam ` +
    `FORA de qualquer faixa quando converteram — a régua não as teria oferecido a ninguém.`
  )
}

/**
 * O aviso de viés (§7.5), em uma constante.
 *
 * Fica aqui, e não no JSX, porque as três superfícies (web, mobile e a tool de
 * IA) precisam dizer a MESMA coisa. Um aviso que existe na tela e some na
 * resposta do assistente é um aviso que não existe.
 */
export const AVISO_VIES =
  'Este perfil descreve quem já chegou até nós — ele pode refletir onde historicamente ' +
  'prospectamos, não só quem é bom. Use como evidência, não como verdade.'

function maiuscula(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
