import { renderizarTemplate } from '../antecipacao/economia.js'
import { exigeDescadastro, type BaseLegal, type CanalComunicacao } from './schemas.js'

/**
 * O catálogo de variáveis do compositor (§5), em pt-BR.
 *
 * A renderização é a MESMA `renderizarTemplate()` da Antecipação — de propósito.
 * Se o compositor tivesse o próprio substituidor, a mensagem que o vendedor manda
 * à mão e a que a régua manda sozinha divergiriam no primeiro template com uma
 * chave escrita diferente, e a Outbox deixaria de descrever o que a pessoa recebe.
 *
 * Chave desconhecida fica como está (`{inexistente}` sobrevive à renderização):
 * some-la em silêncio esconde o erro de digitação de quem escreveu o template, e
 * o preview existe justamente para que esse erro seja visto antes do envio.
 */

export const VARIAVEIS_MENSAGEM = {
  contato_nome: 'Primeiro nome do contato',
  contato_cargo: 'Cargo do contato',
  empresa_nome: 'Razão social ou nome fantasia da empresa',
  empresa_cnpj: 'CNPJ formatado',
  remetente_nome: 'Quem está falando (vendedor ou persona da IA)',
  qtd_notas: 'Quantidade de notas vivas',
  valor_total: 'Valor somado das notas (R$)',
  sacado_principal: 'Sacado de maior valor agregado',
  fornecedor_nome: 'Razão social do fornecedor',
  data_reuniao: 'Data e hora da reunião',
  hora_reuniao: 'Hora da reunião',
  lista_documentos: 'Documentos pendentes, um por linha',
  dias_para_vencer: 'Dias até o vencimento do certificado',
  data_vencimento: 'Data de vencimento do certificado',
  qtd_spes: 'Quantidade de SPEs com certificado a vencer',
  link_agendamento: 'Link para o calendário do vendedor',
} as const

export type VariavelMensagem = keyof typeof VARIAVEIS_MENSAGEM

export const VARIAVEIS_MENSAGEM_LISTA = Object.keys(VARIAVEIS_MENSAGEM) as VariavelMensagem[]

export type ValoresVariaveis = Partial<Record<VariavelMensagem, string>>

/** As chaves `{assim}` que um corpo realmente usa. Alimenta a coluna `variaveis`. */
export function variaveisDoTemplate(texto: string): string[] {
  const achadas = new Set<string>()
  for (const m of texto.matchAll(/\{(\w+)\}/g)) achadas.add(m[1]!)
  return [...achadas].sort()
}

/**
 * As chaves que SOBREVIVERAM à renderização — o que a pessoa do outro lado leria
 * como `{qtd_notas}`. É a mesma varredura de `variaveisDoTemplate`, com outro
 * nome porque a pergunta é outra: lá é "o que este template usa", aqui é "o que
 * este texto, já renderizado, ainda não sabe".
 *
 * O compositor bloqueia o envio por ela, e o worker recusa a linha da fila por
 * ela. Duas checagens da mesma coisa, de propósito: uma explica antes, a outra
 * segura o que veio por qualquer outro caminho (régua, campanha, agente).
 */
export function variaveisPendentes(texto: string): string[] {
  return variaveisDoTemplate(texto)
}

/** As chaves usadas que não existem no catálogo. A tela avisa antes de salvar. */
export function variaveisDesconhecidasDoTemplate(texto: string): string[] {
  return variaveisDoTemplate(texto).filter((v) => !(v in VARIAVEIS_MENSAGEM))
}

/**
 * O primeiro nome, que é como se fala com alguém no WhatsApp. "Prezado José
 * Ricardo da Silva Neto" numa mensagem de WhatsApp é a marca d'água de disparo
 * em massa.
 */
export function primeiroNome(nome: string | null | undefined): string {
  const limpo = (nome ?? '').trim()
  if (limpo === '') return ''
  return limpo.split(/\s+/)[0] ?? ''
}

export interface OpcoesRender {
  canal: CanalComunicacao
  baseLegal: BaseLegal | null
  /** URL do descadastro, já com o token do destinatário. */
  linkDescadastro?: string | null
}

/**
 * Renderiza e, quando a base legal exige, ANEXA o link de descadastro (§2).
 *
 * O anexo é feito aqui e não no template porque não pode ser esquecido: um
 * template novo escrito por alguém com pressa não pode ser a diferença entre uma
 * mensagem conforme e uma que não é. A regra mora no código; o texto, na config.
 */
export function renderizarMensagem(
  template: string,
  valores: ValoresVariaveis,
  opcoes: OpcoesRender,
): string {
  const corpo = renderizarTemplate(template, valores as Record<string, string>)
  if (!exigeDescadastro(opcoes.canal, opcoes.baseLegal) || !opcoes.linkDescadastro) return corpo
  return `${corpo}\n\n—\nNão quer mais receber e-mails nossos? ${opcoes.linkDescadastro}`
}
