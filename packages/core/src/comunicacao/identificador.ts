import type { CanalThread } from './schemas.js'

/**
 * A forma CANÔNICA de um identificador de conversa.
 *
 * É o gêmeo em TypeScript de `app__identificador_canonico` (migração 0144), e as
 * duas precisam concordar em toda entrada. O mesmo celular chega como
 * "+55 (11) 99999-8888" pelo formulário, "5511999998888" pelo webhook e
 * "011999998888" pelo XML da NF-e; o mesmo e-mail chega com maiúsculas. Se o
 * webhook normalizasse de um jeito e o compositor de outro, a mesma pessoa teria
 * duas threads e o cooldown não veria nenhuma das duas.
 */
export function identificadorCanonico(canal: CanalThread, valor: string | null | undefined): string | null {
  if (!valor) return null
  const v = valor.trim()
  if (v === '') return null
  if (canal === 'email') return v.toLowerCase()
  const digitos = v.replace(/\D/g, '')
  return digitos === '' ? null : digitos
}

/**
 * O número como o Wasender espera: E.164 sem "+", com o 55 do Brasil quando o
 * número veio sem DDI.
 *
 * O acréscimo do DDI é feito por TAMANHO, e não por adivinhação: 10 ou 11 dígitos
 * é um número brasileiro sem DDI (DDD + 8 ou 9 dígitos), 12 ou 13 já vem com ele.
 * Qualquer outra coisa volta como está — inventar um DDI em cima de um número que
 * não entendemos manda mensagem para um estranho.
 */
export function paraE164Brasil(valor: string | null | undefined): string | null {
  const d = identificadorCanonico('whatsapp', valor)
  if (!d) return null
  if (d.length === 10 || d.length === 11) return `55${d}`
  return d
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function ehEmailPlausivel(valor: string | null | undefined): boolean {
  return typeof valor === 'string' && EMAIL_RE.test(valor.trim())
}

/**
 * O domínio de um e-mail, minúsculo. É a chave do filtro de ingestão do Gmail
 * (§3.2): só entra no ledger quem casa com contato conhecido OU com domínio de
 * empresa da base.
 */
export function dominioDoEmail(valor: string | null | undefined): string | null {
  if (!ehEmailPlausivel(valor)) return null
  return valor!.trim().toLowerCase().split('@')[1] ?? null
}

/**
 * Domínios de e-mail que NÃO identificam empresa nenhuma.
 *
 * Sem esta lista, o filtro de ingestão casaria a caixa pessoal inteira do vendedor
 * com qualquer empresa cujo contato use Gmail — e "só ingerimos o que é da base"
 * viraria "ingerimos tudo". A lista é curta de propósito: ela só precisa cobrir os
 * provedores genéricos, porque um domínio corporativo desconhecido já não casa com
 * nada.
 */
export const DOMINIOS_GENERICOS = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.com.br',
  'outlook.com',
  'outlook.com.br',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.com.br',
  'icloud.com',
  'me.com',
  'bol.com.br',
  'uol.com.br',
  'terra.com.br',
  'ig.com.br',
  'globo.com',
  'protonmail.com',
])

export function dominioIdentificaEmpresa(dominio: string | null): boolean {
  return dominio !== null && !DOMINIOS_GENERICOS.has(dominio)
}

/**
 * O resumo que aparece na lista do inbox. Uma linha, sem quebras, cortada onde
 * ainda dá para entender do que se trata.
 */
export function previewDe(corpo: string | null | undefined, limite = 160): string | null {
  if (!corpo) return null
  const limpo = corpo.replace(/\s+/g, ' ').trim()
  if (limpo === '') return null
  return limpo.length <= limite ? limpo : `${limpo.slice(0, limite - 1)}…`
}
