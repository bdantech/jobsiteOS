/**
 * O texto da abordagem, renderizado A PARTIR DO CARD (§5 e §6).
 *
 * ─── POR QUE NÃO PELO CATÁLOGO DE `templates_mensagem` ──────────────────────
 *
 * O compositor (05A) resolve `{empresa_nome}`, `{sacado_principal}` e companhia contra a
 * EMPRESA DESTINATÁRIA. Aqui o destinatário é o cedente, e a construtora de que a
 * mensagem fala é a do card — um CNPJ que o catálogo não tem como conhecer, porque ele
 * não é cliente e não tem nota "viva" no funil. Renderizado por lá, o texto sairia com
 * `{sacado_principal}` apontando para outra construtora, ou literal.
 *
 * A substituição acontece ANTES de o texto chegar ao compositor, e o que sobra dela são
 * as chaves que o compositor sabe resolver sozinho (`{remetente_nome}`, `{contato_nome}`).
 *
 * ─── O GUARDRAIL (§6) ───────────────────────────────────────────────────────
 *
 * Toda mensagem daqui vai para o FORNECEDOR, que é o dono do dado: são as notas dele, e
 * é o certificado dele que nos deixa vê-las. Nenhuma sai para a construtora.
 *
 * Se algum dia sair, ela NÃO pode citar volume, nome de fornecedor nem detalhe de nota.
 * Devolver ao sacado o que o fornecedor nos cedeu para antecipar soa como vigilância — e
 * queima o relacionamento que sustenta a operação inteira. É a mesma regra já aplicada
 * no pedido de apresentação do 04l.
 */

export interface DadosAbordagem {
  /** Razão social da construtora. Nunca vai numa mensagem PARA ela. */
  sacado_nome: string
  /** Já formatado em R$ pela tela — a formatação é da plataforma, não deste módulo. */
  valor_total: string
  fornecedor_nome?: string | null
}

export const TEMPLATE_ABORDAGEM_PADRAO =
  'Olá! Aqui é {remetente_nome}, da ONE OS. Vi que vocês têm {valor_total} a receber ' +
  'da {sacado_nome}. Conseguimos antecipar esse valor — quer que eu te mande a simulação?'

export const TEMPLATE_PONTE_PADRAO =
  'Olá! Aqui é {remetente_nome}, da ONE OS. Estamos começando a atender a {sacado_nome}, ' +
  'para quem vocês faturam. Você conseguiria nos apresentar a quem cuida do financeiro lá? ' +
  'Com o cadastro deles aprovado, passamos a antecipar essas notas para vocês.'

/**
 * Substitui só as chaves DESTE módulo, e deixa as demais intactas.
 *
 * Deixar intactas é o ponto: `{remetente_nome}` é resolvido pelo compositor com quem
 * está mandando, e trocá-lo aqui por um valor adivinhado faria a mensagem sair assinada
 * pela pessoa errada — que foi exatamente o que aconteceu uma vez ("Aqui é
 * {remetente_nome}, da ONE OS" saiu literal para um fornecedor, 05A).
 */
export function renderizarAbordagem(template: string, dados: DadosAbordagem): string {
  const valores: Record<string, string> = {
    sacado_nome: dados.sacado_nome,
    valor_total: dados.valor_total,
    ...(dados.fornecedor_nome ? { fornecedor_nome: dados.fornecedor_nome } : {}),
  }
  return template.replace(/\{(\w+)\}/g, (inteiro, chave: string) => valores[chave] ?? inteiro)
}
