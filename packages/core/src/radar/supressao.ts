import type { Supabase } from '../registry/types.js'
import { normalizeCnpj } from '../schemas/cnpj.js'
import type { EscopoSupressao } from './schemas.js'

/**
 * Lista de supressão (§8): consultada ANTES de qualquer toque em qualquer canal.
 *
 * O valor é normalizado por escopo — e-mail em minúsculas, telefone/whatsapp só
 * dígitos, empresa como CNPJ de 14 dígitos — para que a supressão case
 * independentemente de como o número/endereço foi digitado. A gravação
 * (radar/mutations.suprimir) normaliza com esta MESMA função, então o que está no
 * banco e o que se consulta batem sempre.
 */
export function normalizarValorSupressao(escopo: EscopoSupressao, valor: string): string {
  const v = valor.trim()
  switch (escopo) {
    case 'email':
      return v.toLowerCase()
    case 'telefone':
    case 'whatsapp':
      return v.replace(/\D/g, '')
    case 'empresa':
      return normalizeCnpj(v)
    default:
      return v
  }
}

/**
 * O guard obrigatório. Qualquer módulo de comunicação futuro DEVE chamar isto
 * antes de enviar e-mail, ligar, mandar whatsapp ou abordar um CNPJ.
 */
export async function estaSuprimido(
  supabase: Supabase,
  alvo: { escopo: EscopoSupressao; valor: string },
): Promise<boolean> {
  const valor = normalizarValorSupressao(alvo.escopo, alvo.valor)
  const { data, error } = await supabase
    .from('supressao')
    .select('id')
    .eq('escopo', alvo.escopo)
    .eq('valor', valor)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Falha ao consultar a lista de supressão: ${error.message}`)
  return data !== null
}
