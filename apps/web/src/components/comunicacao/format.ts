import {
  ACAO_LABELS,
  CANAL_COMUNICACAO_LABELS,
  INTENCAO_TRIAGEM_LABELS,
  type AcaoAgente,
  type CanalComunicacao,
  type IntencaoTriagem,
} from '@jobsiteos/core'

/** Formatação da Comunicação. Um arquivo, como no Jurídico. */

export function canalLabel(c: string | null | undefined): string {
  return c ? (CANAL_COMUNICACAO_LABELS[c as CanalComunicacao] ?? c) : '—'
}

export function acaoLabel(a: string | null | undefined): string {
  return a ? (ACAO_LABELS[a as AcaoAgente] ?? a) : '—'
}

export function intencaoLabel(triagem: unknown): string | null {
  const t = triagem as { intencao?: string } | null
  if (!t?.intencao) return null
  return INTENCAO_TRIAGEM_LABELS[t.intencao as IntencaoTriagem] ?? t.intencao
}

export function resumoDaTriagem(triagem: unknown): string | null {
  const t = triagem as { resumo_curto?: string } | null
  return t?.resumo_curto ?? null
}

export function dataHora(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * "há 3 min", "há 2 h", "ontem", "12/08". É o relógio de uma lista de conversas:
 * o que importa é a distância, não a data absoluta — e a data absoluta volta a
 * importar quando a distância deixa de ser legível.
 */
export function desde(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'ontem'
  if (d < 7) return `há ${d} dias`
  return new Date(iso).toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
  })
}

/**
 * O telefone como se escreve no Brasil: `(11) 99999-8888`.
 *
 * O DDI 55 sai só quando o que sobra é um número brasileiro plausível (10 ou 11
 * dígitos). Cortar "55" de qualquer coisa que comece com 55 transformaria um
 * celular de Cingapura num DDD inexistente.
 *
 * Número estrangeiro sai como `+<dígitos>`, e não cru: `+19876543210` pelo menos
 * se lê como telefone.
 */
export function telefoneLegivel(valor: string): string {
  const d = valor.replace(/\D/g, '')
  const semDdi = d.startsWith('55') && (d.length === 12 || d.length === 13) ? d.slice(2) : d
  if (semDdi.length === 11) return `(${semDdi.slice(0, 2)}) ${semDdi.slice(2, 7)}-${semDdi.slice(7)}`
  if (semDdi.length === 10) return `(${semDdi.slice(0, 2)}) ${semDdi.slice(2, 6)}-${semDdi.slice(6)}`
  if (d.length >= 11 && d.length <= 13) return `+${d}`
  return valor
}

/**
 * O identificador é um telefone de verdade?
 *
 * Desde que o WhatsApp passou a endereçar por LID, o que chega no lugar do número
 * pode ser um identificador de privacidade — quatorze ou quinze dígitos que não
 * são telefone de ninguém. Formatá-lo como telefone seria pior que não formatar:
 * a tela mostraria `(43) 95041-7129679` e alguém tentaria ligar.
 */
export function ehTelefone(valor: string): boolean {
  const d = valor.replace(/\D/g, '')
  const semDdi = d.startsWith('55') && (d.length === 12 || d.length === 13) ? d.slice(2) : d
  return semDdi.length === 10 || semDdi.length === 11 || (d.length >= 11 && d.length <= 13)
}

/**
 * O identificador como se mostra na tela.
 *
 * Quando o WhatsApp não mandou o número, dizer isso é mais útil que exibir quinze
 * dígitos: quem lê precisa saber que não há para onde ligar, e não decorar um
 * código. O identificador continua acessível pelo `title` da linha, para o dia em
 * que alguém precisar dele num suporte.
 */
export function identificadorLegivel(canal: string, valor: string): string {
  if (canal === 'email') return valor
  return ehTelefone(valor) ? telefoneLegivel(valor) : 'sem número (ID do WhatsApp)'
}
