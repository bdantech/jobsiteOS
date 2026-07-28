import type { ContatoPayload } from './nf-payload.js'

/**
 * O contato que vem dentro da NF, promovido a linha de `contatos`.
 *
 * Por que isto existe: o payload de NF traz `supplier.contact` e
 * `recipient.contact`, e até aqui esse dado só era gravado como jsonb DENTRO da
 * nota, servindo de último recurso para a Outbox. Na prática, o CRM ficava vazio
 * enquanto o dado chegava seis vezes por dia — e ninguém conseguia ligar para o
 * fornecedor a partir da ficha dele, que é onde a pessoa está olhando.
 *
 * A regra difícil não é normalizar; é DECIDIR O QUE FAZER quando já existe um
 * contato. As três decisões abaixo saem de uma única premissa: o dado da NF é o
 * mais fraco de todos. Ele não foi curado por ninguém, vem de um cadastro que o
 * fornecedor preencheu para emitir nota, e chega repetido a cada sync. Então:
 *
 *   não existe             → INSERE, com origem 'nf'
 *   existe e veio da NF    → COMPLETA só os campos vazios (nunca sobrescreve)
 *   existe de outra origem → NÃO TOCA. Apollo custou dinheiro; o que uma pessoa
 *                            digitou custou atenção. Os dois ganham do automático.
 *
 * "Completa só o que está vazio" é o que torna o job seguro de rodar seis vezes
 * por dia para sempre: a segunda passagem não desfaz nada da primeira, e uma
 * correção manual sobrevive a todas elas.
 */

export interface ContatoNormalizado {
  nome: string | null
  email: string | null
  telefone: string | null
  whatsapp: string | null
}

/** O que já existe em `contatos` para a empresa — só o necessário para decidir. */
export interface ContatoExistente {
  id: string
  nome: string | null
  email: string | null
  telefone: string | null
  whatsapp: string | null
  origem: string | null
}

export type DecisaoContato =
  | { acao: 'inserir'; contato: ContatoNormalizado }
  | { acao: 'completar'; id: string; campos: Partial<ContatoNormalizado> }
  | { acao: 'nada'; motivo: string }

/** A origem que marca um contato como vindo da nota fiscal. */
export const ORIGEM_NF = 'nf'

function texto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null
  const s = String(valor).trim()
  return s === '' ? null : s
}

function email(valor: unknown): string | null {
  const s = texto(valor)?.toLowerCase()
  // Validação deliberadamente frouxa: "tem arroba, tem ponto depois, não tem
  // espaço". Um regex de RFC rejeitaria endereços válidos e a única consequência
  // de aceitar um inválido aqui é um bounce visível na Outbox.
  if (!s || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null
  return s
}

/**
 * Só dígitos, como a Outbox e a supressão já guardam. O prefixo 55 sai: o mesmo
 * telefone chega às vezes com e às vezes sem, e as duas formas na base
 * significariam supressão furada — a pessoa pede para não ser contatada, o
 * número entra numa forma, e a outra continua passando.
 */
export function normalizarTelefone(valor: unknown): string | null {
  let d = texto(valor)?.replace(/\D/g, '') ?? null
  if (!d) return null
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
  // 10 = fixo com DDD, 11 = celular com DDD. Fora disso não é telefone brasileiro
  // utilizável, e guardar meio número é pior do que não guardar.
  return d.length === 10 || d.length === 11 ? d : null
}

/** Celular brasileiro: 11 dígitos e o nono na frente do assinante. */
export function ehCelular(telefone: string | null): boolean {
  return telefone !== null && telefone.length === 11 && telefone[2] === '9'
}

/**
 * O payload vira contato — ou não vira nada. Sem e-mail e sem telefone não há
 * contato: um nome solto não permite abordar ninguém e só inflaria a lista.
 */
export function normalizarContatoNf(payload: ContatoPayload | null | undefined): ContatoNormalizado | null {
  if (!payload) return null
  const tel = normalizarTelefone(payload.phone)
  const mail = email(payload.email)
  if (!tel && !mail) return null
  return {
    nome: texto(payload.name),
    email: mail,
    telefone: tel,
    // WhatsApp só quando é celular. Preencher com fixo faria a Outbox escolher
    // esse número para o canal WhatsApp e a mensagem morreria sem erro visível.
    whatsapp: ehCelular(tel) ? tel : null,
  }
}

/** Mesmo e-mail, ou mesmo número em qualquer um dos dois campos de telefone. */
function ehAMesmaPessoa(novo: ContatoNormalizado, atual: ContatoExistente): boolean {
  if (novo.email && email(atual.email) === novo.email) return true
  if (!novo.telefone) return false
  return (
    normalizarTelefone(atual.telefone) === novo.telefone ||
    normalizarTelefone(atual.whatsapp) === novo.telefone
  )
}

export function decidirContato(
  novo: ContatoNormalizado,
  existentes: readonly ContatoExistente[],
): DecisaoContato {
  const atual = existentes.find((c) => ehAMesmaPessoa(novo, c))
  if (!atual) return { acao: 'inserir', contato: novo }

  if (atual.origem !== ORIGEM_NF) {
    return {
      acao: 'nada',
      motivo: `contato já existe com origem "${atual.origem ?? 'manual'}" — curadoria ganha do sync`,
    }
  }

  // Só o que está VAZIO hoje. O sync de amanhã não pode desfazer a edição de
  // ontem, mesmo entre linhas que ele próprio criou.
  const campos: Partial<ContatoNormalizado> = {}
  if (!atual.nome && novo.nome) campos.nome = novo.nome
  if (!atual.email && novo.email) campos.email = novo.email
  if (!atual.telefone && novo.telefone) campos.telefone = novo.telefone
  if (!atual.whatsapp && novo.whatsapp) campos.whatsapp = novo.whatsapp

  if (Object.keys(campos).length === 0) {
    return { acao: 'nada', motivo: 'nada a completar' }
  }
  return { acao: 'completar', id: atual.id, campos }
}
