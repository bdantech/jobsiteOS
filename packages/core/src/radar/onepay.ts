/**
 * O vocabulário do temperature report da Onepay.
 *
 * `operationStatus` chega em inglês e em snake_case, e é o veredito da plataforma
 * sobre a conta — não uma etiqueta nossa. Traduzir na tela, e não no sync, mantém
 * `clientes_onepay.operation_status` igual ao que a Onepay respondeu: se um dia
 * aparecer um status novo, ele passa pelo banco intacto e a tela mostra o código cru
 * em vez de esconder o que não conhece.
 */

export const OPERATION_STATUS_LABELS: Record<string, string> = {
  operating_normally: 'Operando',
  low_operation: 'Baixa operação',
  requires_attention: 'Requer atenção',
  inoperative: 'Inoperante',
}

/** Rótulo em português, ou o código cru quando a Onepay inventar um status novo. */
export function rotuloOperationStatus(status: string | null | undefined): string | null {
  if (!status) return null
  return OPERATION_STATUS_LABELS[status] ?? status
}

/**
 * Só `operating_normally` é silêncio. Todo o resto é motivo para o comercial olhar
 * antes de prometer operação — inclusive um status desconhecido, que é justamente o
 * caso em que ninguém sabe o que significa.
 */
export function operationStatusPreocupa(status: string | null | undefined): boolean {
  return !!status && status !== 'operating_normally'
}

/**
 * A gravidade do status, em palavras que qualquer camada entende. É severidade, não
 * cor: quem desenha decide o pigmento. `inoperative` é o único crítico porque é o
 * único em que a conta simplesmente não opera — o limite dela é ficção.
 */
export type GravidadeOperacao = 'success' | 'warning' | 'critical' | 'neutral'

export function operationStatusGravidade(status: string | null | undefined): GravidadeOperacao {
  switch (status) {
    case 'operating_normally':
      return 'success'
    case 'low_operation':
    case 'requires_attention':
      return 'warning'
    case 'inoperative':
      return 'critical'
    default:
      return 'neutral'
  }
}
