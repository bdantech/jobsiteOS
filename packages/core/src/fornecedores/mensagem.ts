import { formatCnpj } from '../schemas/cnpj.js'

/**
 * O pedido de apresentação ao sacado (§4.3) — a camada 3 da cascata, e a única que
 * não é uma consulta a provedor.
 *
 * É a de maior conversão do conjunto porque muda a natureza da ligação: o originador
 * deixa de ser alguém que descobriu o telefone e passa a ser alguém que chega pela
 * construtora com quem o fornecedor já trabalha. Um provedor entrega um número; o
 * sacado entrega uma introdução.
 *
 * Por isso ela é um BOTÃO SEPARADO, e não uma etapa do clique de busca: pedir um
 * favor a um cliente é uma decisão de relacionamento, e ela não pode acontecer como
 * efeito colateral de alguém tentando achar um telefone.
 *
 * Nesta fase o texto é COPIÁVEL, não enviável — não existe canal (o envio é 05). Um
 * botão "Enviar" que na verdade copia é a forma mais rápida de alguém acreditar que
 * mandou uma mensagem que nunca saiu.
 */

export interface VariaveisApresentacao {
  fornecedor_nome: string | null
  fornecedor_cnpj: string
  sacado_nome: string | null
  contato_sacado_nome: string | null
  originador_nome: string | null
  volume_90d: number | null
  qtd_nfs_90d: number | null
  potencial_mensal: number | null
}

export const VARIAVEIS_APRESENTACAO: readonly (keyof VariaveisApresentacao)[] = [
  'fornecedor_nome',
  'fornecedor_cnpj',
  'sacado_nome',
  'contato_sacado_nome',
  'originador_nome',
  'volume_90d',
  'qtd_nfs_90d',
  'potencial_mensal',
]

export const ROTULOS_VARIAVEIS: Record<keyof VariaveisApresentacao, string> = {
  fornecedor_nome: 'Razão social do fornecedor',
  fornecedor_cnpj: 'CNPJ do fornecedor (formatado)',
  sacado_nome: 'Razão social do sacado',
  contato_sacado_nome: 'Primeiro nome do contato no sacado',
  originador_nome: 'Quem está pedindo',
  volume_90d: 'Volume faturado em 90 dias (R$)',
  qtd_nfs_90d: 'Notas emitidas em 90 dias',
  potencial_mensal: 'Potencial mensal estimado (R$)',
}

/**
 * O template padrão.
 *
 * Ele NÃO cita o volume que o fornecedor fatura contra o sacado, e isso é deliberado:
 * o número vem das notas que o sacado nos enviou para antecipar, e devolvê-lo na
 * mensagem — "vi que vocês compram R$ 340 mil por trimestre da Fulana" — soa como
 * vigilância mesmo sendo um dado que ele próprio nos deu. As variáveis de volume
 * ficam disponíveis para quem quiser adaptar; o padrão pede sem exibir.
 */
export const TEMPLATE_PADRAO = `Oi {{contato_sacado_nome}}, tudo bem?

Somos parceiros da {{sacado_nome}} na antecipação de recebíveis, e vimos que a {{fornecedor_nome}} é fornecedora de vocês.

Faz sentido você nos apresentar a eles? A ideia é oferecer antecipação das notas que eles emitem contra vocês — o que costuma ajudar o fornecedor a manter prazo e preço.

Se puder passar o contato de quem cuida do financeiro lá, ou fazer a ponte num e-mail, já ajuda muito.

Obrigado!
{{originador_nome}}`

const brl = (n: number | null): string =>
  n === null || !Number.isFinite(n)
    ? '—'
    : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Só o primeiro nome: "Prezado Antônio Carlos de Almeida Filho" não é uma mensagem. */
function primeiroNome(nome: string | null): string {
  const n = (nome ?? '').trim().split(/\s+/)[0] ?? ''
  return n || 'tudo bem'
}

/**
 * Renderiza o template. Variável desconhecida fica COMO ESTÁ, com as chaves.
 *
 * Apagá-la seria pior: `{{nome_do_contao}}` (com o erro de digitação do gestor)
 * viraria um buraco silencioso no meio da frase, e alguém copiaria "Oi , tudo bem?"
 * para o WhatsApp de um cliente. Com as chaves visíveis, o erro aparece antes do
 * envio e é do template, não da mensagem.
 */
export function renderizarApresentacao(
  template: string,
  vars: VariaveisApresentacao,
): string {
  const valores: Record<string, string> = {
    fornecedor_nome: vars.fornecedor_nome ?? 'o fornecedor',
    fornecedor_cnpj: formatCnpj(vars.fornecedor_cnpj),
    sacado_nome: vars.sacado_nome ?? 'a construtora',
    contato_sacado_nome: primeiroNome(vars.contato_sacado_nome),
    originador_nome: vars.originador_nome ?? '',
    volume_90d: brl(vars.volume_90d),
    qtd_nfs_90d: vars.qtd_nfs_90d === null ? '—' : String(vars.qtd_nfs_90d),
    potencial_mensal: brl(vars.potencial_mensal),
  }

  // `[a-z0-9_]`, com os DÍGITOS: `volume_90d` e `qtd_nfs_90d` têm número no nome, e
  // um padrão só de letras os deixaria passar intactos — a mensagem sairia com
  // `{{volume_90d}}` escrito no meio, exatamente como uma variável inexistente.
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/g, (inteiro, chave: string) =>
    Object.prototype.hasOwnProperty.call(valores, chave) ? (valores[chave] as string) : inteiro,
  )
}

/**
 * A ordem em que os sacados aparecem no seletor: quem tem ponto focal primeiro (§4.3).
 *
 * O maior volume é o palpite óbvio e é o palpite errado. O pedido é um favor pessoal,
 * e ele funciona com quem atende — não com quem compra mais. Um sacado de R$ 2 milhões
 * sem ninguém conhecido é uma mensagem para o `contato@`; um de R$ 300 mil com ponto
 * focal é uma mensagem para alguém que responde.
 */
export interface SacadoParaPedido {
  cnpj: string
  nome: string | null
  valor: number
  tem_ponto_focal: boolean
}

// Genérica para PRESERVAR os campos extras de quem chama. A tela passa o contato do
// ponto focal junto (id e nome) e precisa deles de volta para montar a mensagem;
// uma assinatura fixa em `SacadoParaPedido` os apagaria do tipo de retorno.
export function ordenarSacadosParaPedido<T extends SacadoParaPedido>(
  sacados: readonly T[],
): T[] {
  return [...sacados].sort(
    (a, b) =>
      Number(b.tem_ponto_focal) - Number(a.tem_ponto_focal) ||
      b.valor - a.valor ||
      a.cnpj.localeCompare(b.cnpj),
  )
}
