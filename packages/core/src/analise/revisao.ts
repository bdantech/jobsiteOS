import { z } from 'zod'
import type { DecisaoItem, ItemRubrica } from './rubrica.js'

/**
 * O QUE VAI PARA O CLAUDE (05C §4.2) — só a minoria cara: itens reprovados e banda
 * cinzenta, a citação e a orientação de cada falta, o resumo quando o Fireflies não
 * entregou um, e os contatos novos que apareceram na conversa. Uma chamada por análise.
 *
 * A citação é o que torna o feedback DISCUTÍVEL em vez de sentencioso: o vendedor vê o
 * trecho e pode dizer "não, olha a frase seguinte". Por isso ela tem de ser literal —
 * paráfrase não se contesta.
 */

export const FERRAMENTA_REVISAR = 'registrar_revisao'

export interface PedidoRevisao {
  estado: string
  itens: ReadonlyArray<{ item: ItemRubrica; decisao: DecisaoItem }>
  pedirResumo: boolean
  pedirContatos: boolean
  pedirCompromissos: boolean
  /** Para o modelo converter "sexta que vem" em data. */
  dataReferencia: string
  /** Contatos que já conhecemos — para o modelo não "descobrir" quem já está cadastrado. */
  contatosConhecidos: ReadonlyArray<{ nome: string | null; email: string | null }>
}

export function montarRevisaoClaude(p: PedidoRevisao) {
  const itens = p.itens.map(({ item, decisao }) => {
    const leitura = decisao.atendido ? 'atendido' : 'NÃO atendido'
    const duvida = decisao.banda_cinzenta ? ' (o primeiro avaliador ficou em dúvida)' : ''
    return [
      `- chave: ${item.chave}`,
      `  pergunta: ${item.pergunta}`,
      item.atende ? `  conta como atendido quando a resposta é: ${item.atende.join(' ou ')}` : null,
      `  o que se espera do vendedor: ${item.orientacao}`,
      `  primeiro avaliador: ${leitura}${duvida}`,
    ]
      .filter(Boolean)
      .join('\n')
  })

  const tarefas = [
    'Para CADA item listado, decida se foi atendido, lendo a conversa inteira. Você é o segundo avaliador: ' +
      'discorde do primeiro sempre que a conversa mostrar outra coisa.',
    'Quando o item NÃO foi atendido: "citacao" é um trecho LITERAL da conversa (até 300 caracteres) que mostra a falta ' +
      'ou o momento em que ela aconteceu; "orientacao" é uma ou duas frases, dirigidas ao vendedor ("você"), dizendo o ' +
      'que era esperado NAQUELE momento. Concreto, sem sermão, sem repetir a pergunta.',
    'Quando o item foi atendido, deixe citacao e orientacao vazias.',
  ]
  if (p.pedirResumo) tarefas.push('Escreva "resumo": 3 a 6 linhas sobre o que foi conversado e o que ficou combinado.')
  if (p.pedirCompromissos) {
    tarefas.push(
      'Liste em "compromissos" o que o NOSSO lado (vendedor/OnePay) prometeu fazer pelo cliente — enviar proposta, ' +
        'mandar documento, retornar com resposta, ligar de novo. "prazo" em AAAA-MM-DD quando foi dito um prazo ' +
        `(a conversa aconteceu em ${p.dataReferencia}); vazio quando não. "citacao" é o trecho literal da promessa. ` +
        'Não liste o que o cliente prometeu.',
    )
  }
  if (p.pedirContatos) {
    tarefas.push(
      'Liste em "contatos" as pessoas DO LADO DO CLIENTE que aparecem na conversa com nome e pelo menos cargo, e-mail ou ' +
        'telefone ditos explicitamente. Não liste ninguém da OnePay. Não invente: só o que foi dito.',
    )
  }

  const conhecidos = p.contatosConhecidos
    .map((c) => [c.nome, c.email].filter(Boolean).join(' · '))
    .filter(Boolean)

  return {
    system:
      'Você revisa a avaliação de conversas comerciais da OnePay (antecipação de recebíveis para construtoras e ' +
      'fornecedores). Seu julgamento é usado como feedback ao vendedor e pode ser contestado por ele. Seja justo: na ' +
      'dúvida real, o item foi atendido.',
    usuario: [
      `<conversa>\n${p.estado}\n</conversa>`,
      conhecidos.length ? `Contatos já cadastrados: ${conhecidos.join('; ')}` : null,
      `Itens a revisar:\n${itens.join('\n')}`,
      `Tarefas:\n${tarefas.map((t, i) => `${i + 1}. ${t}`).join('\n')}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    ferramenta: {
      name: FERRAMENTA_REVISAR,
      description: 'Registra a revisão dos itens e o que mais foi pedido.',
      input_schema: {
        type: 'object',
        properties: {
          itens: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                chave: { type: 'string' },
                atendido: { type: 'boolean' },
                citacao: { type: 'string' },
                orientacao: { type: 'string' },
              },
              required: ['chave', 'atendido'],
            },
          },
          resumo: { type: 'string' },
          compromissos: {
            type: 'array',
            items: {
              type: 'object',
              properties: { descricao: { type: 'string' }, prazo: { type: 'string' }, citacao: { type: 'string' } },
              required: ['descricao'],
            },
          },
          contatos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                nome: { type: 'string' },
                cargo: { type: 'string' },
                email: { type: 'string' },
                telefone: { type: 'string' },
              },
              required: ['nome'],
            },
          },
        },
        required: ['itens'],
      },
    },
  }
}

const vazioParaNulo = z
  .string()
  .nullish()
  .transform((s) => (s && s.trim() ? s.trim() : null))

export const revisaoClaudeSchema = z.object({
  itens: z.array(
    z.object({
      chave: z.string(),
      atendido: z.boolean(),
      citacao: vazioParaNulo,
      orientacao: vazioParaNulo,
    }),
  ),
  resumo: vazioParaNulo,
  compromissos: z
    .array(z.object({ descricao: z.string(), prazo: vazioParaNulo, citacao: vazioParaNulo }))
    .nullish()
    .transform((c) => c ?? []),
  contatos: z
    .array(z.object({ nome: z.string(), cargo: vazioParaNulo, email: vazioParaNulo, telefone: vazioParaNulo }))
    .nullish()
    .transform((c) => c ?? []),
})
export type RevisaoClaude = z.infer<typeof revisaoClaudeSchema>

export function lerRevisaoClaude(entrada: unknown, chavesPedidas: readonly string[]): RevisaoClaude {
  const r = revisaoClaudeSchema.parse(entrada)
  const pedidas = new Set(chavesPedidas)
  return {
    ...r,
    itens: r.itens.filter((i) => pedidas.has(i.chave)).map((i) => ({ ...i, citacao: cortar(i.citacao, 400) })),
    compromissos: r.compromissos
      .filter((c) => c.descricao.trim().length >= 4)
      .map((c) => ({ ...c, prazo: c.prazo && /^\d{4}-\d{2}-\d{2}$/.test(c.prazo) ? c.prazo : null, citacao: cortar(c.citacao, 400) })),
    contatos: r.contatos
      .map((c) => ({ ...c, email: c.email && /.+@.+\..+/.test(c.email) ? c.email.toLowerCase() : null }))
      .filter((c) => c.nome.trim().length >= 2),
  }
}

function cortar(s: string | null, n: number): string | null {
  if (!s) return null
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** O estado que vai aos modelos: corta pelo MEIO, que é onde a conversa menos decide. */
export function limitarEstado(texto: string, max: number): string {
  if (texto.length <= max) return texto
  const metade = Math.floor((max - 40) / 2)
  return `${texto.slice(0, metade)}\n\n[… trecho do meio omitido …]\n\n${texto.slice(-metade)}`
}
