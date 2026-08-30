import { z } from 'zod'

/**
 * TRIAGEM da resposta (§6).
 *
 * ─── QUALIDADE ACIMA DE CUSTO, E A REGRA QUE ISSO VIRA ──────────────────────
 * O classificador barato roda só nos casos INEQUÍVOCOS: opt-out por palavra-chave,
 * auto-resposta de férias, mensagem sem texto. Todo o resto vai para o modelo.
 *
 * A tentação é a inversa — regex para tudo, modelo só no que sobrar — e ela custa
 * caro do jeito errado: "não tenho interesse agora, me chama em março" vira
 * opt-out por conter "não tenho interesse", e um lead que pediu para ser chamado
 * em março entra na lista de supressão. Um falso opt-out é irreversível na
 * prática; um token gasto não é.
 *
 * Por isso as heurísticas abaixo são todas de ALTA PRECISÃO e baixa cobertura: só
 * disparam quando a mensagem é praticamente só a palavra-chave.
 */

export const INTENCOES_TRIAGEM = [
  'interesse',
  'recusa',
  'adiar',
  'duvida',
  'negociacao',
  'reclamacao',
  'indicacao_de_contato',
  'operacional',
  'outro',
] as const
export type IntencaoTriagem = (typeof INTENCOES_TRIAGEM)[number]

export const INTENCAO_TRIAGEM_LABELS: Record<IntencaoTriagem, string> = {
  interesse: 'Interesse',
  recusa: 'Recusa',
  adiar: 'Pediu para adiar',
  duvida: 'Dúvida',
  negociacao: 'Negociação',
  reclamacao: 'Reclamação',
  indicacao_de_contato: 'Indicou outro contato',
  operacional: 'Operacional',
  outro: 'Outro',
}

export const SENTIMENTOS = ['positivo', 'neutro', 'negativo'] as const
export type Sentimento = (typeof SENTIMENTOS)[number]

export const URGENCIAS_TRIAGEM = ['baixa', 'media', 'alta'] as const
export type UrgenciaTriagem = (typeof URGENCIAS_TRIAGEM)[number]

export const triagemSchema = z.object({
  intencao: z.enum(INTENCOES_TRIAGEM),
  sentimento: z.enum(SENTIMENTOS),
  urgencia: z.enum(URGENCIAS_TRIAGEM),
  pedido_de_humano: z.boolean(),
  dados_extraidos: z
    .object({
      data_mencionada: z.string().nullable().optional(),
      nome_de_outra_pessoa: z.string().nullable().optional(),
      telefone_de_outra_pessoa: z.string().nullable().optional(),
      email_de_outra_pessoa: z.string().nullable().optional(),
      valores: z.array(z.string()).optional(),
    })
    .default({}),
  resumo_curto: z.string().max(280),
  /** `regra` quando o classificador barato bastou; `modelo` no resto. */
  fonte: z.enum(['regra', 'modelo']).default('modelo'),
})
export type Triagem = z.infer<typeof triagemSchema>

/**
 * Opt-out explícito. A mensagem precisa ser QUASE SÓ a palavra-chave — até 40
 * caracteres depois de normalizar. "PARE" é opt-out; "não pare de me mandar, só
 * espera até março" não é, e a diferença entre as duas é uma lista de supressão
 * que ninguém pediu.
 */
const OPT_OUT = [
  'sair',
  'pare',
  'parar',
  'remover',
  'descadastrar',
  'descadastre',
  'nao quero receber',
  'nao me mande mais',
  'nao envie mais',
  'me tira dessa lista',
  'stop',
  'unsubscribe',
]

const AUSENCIA = [
  'estou de ferias',
  'estarei de ferias',
  'ausencia temporaria',
  'out of office',
  'automatic reply',
  'resposta automatica',
  'estou fora do escritorio',
  'retorno em',
  'nao estarei disponivel ate',
]

/** Sem acento, sem pontuação nas pontas, minúsculo. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    // Faixa dos diacríticos combinantes, escrita com escape: um bloco de
    // combining marks colado no fonte é invisível no diff e some num copiar-colar.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s@.+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface EntradaTriagem {
  corpo: string | null
  /** Mídia sem legenda: áudio, figurinha, foto. Não há o que classificar. */
  temMidia?: boolean
}

/**
 * O classificador barato. Devolve `null` quando não tem certeza — e "não tem
 * certeza" é o caso comum de propósito.
 */
export function triarPorRegra(entrada: EntradaTriagem): Triagem | null {
  const bruto = (entrada.corpo ?? '').trim()

  if (bruto === '') {
    return {
      intencao: 'operacional',
      sentimento: 'neutro',
      urgencia: 'baixa',
      pedido_de_humano: false,
      dados_extraidos: {},
      resumo_curto: entrada.temMidia ? 'Enviou mídia sem texto.' : 'Mensagem vazia.',
      fonte: 'regra',
    }
  }

  const t = normalizar(bruto)

  if (t.length <= 40 && OPT_OUT.some((k) => t === k || t.startsWith(`${k} `) || t.endsWith(` ${k}`))) {
    return {
      intencao: 'recusa',
      sentimento: 'negativo',
      urgencia: 'alta',
      pedido_de_humano: false,
      dados_extraidos: {},
      resumo_curto: 'Pediu para não receber mais mensagens.',
      fonte: 'regra',
    }
  }

  if (AUSENCIA.some((k) => t.includes(k))) {
    return {
      intencao: 'operacional',
      sentimento: 'neutro',
      urgencia: 'baixa',
      pedido_de_humano: false,
      dados_extraidos: {},
      resumo_curto: 'Resposta automática de ausência.',
      fonte: 'regra',
    }
  }

  return null
}

/**
 * Uma triagem vira opt-out no ledger quando a intenção é recusa E o texto é a
 * recusa inequívoca — não quando o modelo achou o tom negativo. Um "recusa" com
 * "me chama em março" é `adiar` disfarçado, e suprimir ali perde o lead.
 */
export function ehOptOut(triagem: Triagem, corpo: string | null): boolean {
  if (triagem.intencao !== 'recusa') return false
  if (triagem.fonte === 'regra') return true
  const t = normalizar(corpo ?? '')
  return OPT_OUT.some((k) => t.includes(k))
}

/**
 * As três situações que NÃO admitem agente (§7.5). Escalação imediata: quem
 * responde é gente.
 *
 * "Você é um robô?" está aqui, e a resposta é escalar sem negar. Um agente que
 * responde "sou humano sim" é uma decisão de produto que ninguém tomou, tomada
 * por um modelo no meio de uma conversa comercial.
 */
const GATILHOS_ESCALACAO = [
  'taxa',
  'juros',
  'desconto',
  'preco',
  'valor da operacao',
  'quanto custa',
  'prazo do contrato',
  'limite',
  'advogado',
  'juridico',
  'processar',
  'procon',
  'reclame aqui',
  'e um robo',
  'e um bot',
  'e uma ia',
  'falando com uma maquina',
  'quero falar com uma pessoa',
  'quero falar com alguem',
  'me passa um humano',
  'atendente',
]

export interface MotivoEscalacao {
  escalar: boolean
  motivo?: string
}

export function precisaEscalar(triagem: Triagem, corpo: string | null): MotivoEscalacao {
  if (triagem.pedido_de_humano) return { escalar: true, motivo: 'Pediu para falar com uma pessoa.' }
  if (triagem.intencao === 'reclamacao') return { escalar: true, motivo: 'Reclamação.' }
  if (triagem.intencao === 'negociacao') return { escalar: true, motivo: 'Entrou em negociação comercial.' }

  const t = normalizar(corpo ?? '')
  const gatilho = GATILHOS_ESCALACAO.find((g) => t.includes(g))
  if (gatilho) return { escalar: true, motivo: `Mencionou "${gatilho}".` }

  if (triagem.sentimento === 'negativo' && triagem.urgencia === 'alta') {
    return { escalar: true, motivo: 'Resposta negativa e urgente.' }
  }
  return { escalar: false }
}

/**
 * O contrato que o modelo recebe. Fica aqui, ao lado do zod que valida a
 * resposta, porque as duas metades divergem em silêncio quando moram em arquivos
 * diferentes — e a divergência aparece como um campo que some da triagem sem
 * ninguém notar.
 */
export const PROMPT_TRIAGEM = `Você classifica UMA mensagem recebida por uma empresa de antecipação de recebíveis da construção civil (ONE OS), em português do Brasil.

Responda SOMENTE com um objeto JSON, sem cercas de código e sem texto em volta, com exatamente estes campos:

{
  "intencao": "interesse" | "recusa" | "adiar" | "duvida" | "negociacao" | "reclamacao" | "indicacao_de_contato" | "operacional" | "outro",
  "sentimento": "positivo" | "neutro" | "negativo",
  "urgencia": "baixa" | "media" | "alta",
  "pedido_de_humano": true | false,
  "dados_extraidos": {
    "data_mencionada": string | null,
    "nome_de_outra_pessoa": string | null,
    "telefone_de_outra_pessoa": string | null,
    "email_de_outra_pessoa": string | null,
    "valores": string[]
  },
  "resumo_curto": string
}

Regras:
- "recusa" é NÃO DEFINITIVO. "me chama em março", "agora não dá" e "depois eu vejo" são "adiar".
- "indicacao_de_contato" quando a pessoa aponta OUTRA pessoa ("fala com o Marcelo do financeiro"). Extraia nome e telefone/e-mail quando houver.
- "negociacao" quando a mensagem discute taxa, preço, prazo ou condição comercial.
- "pedido_de_humano" é true quando a pessoa pede para falar com alguém, ou pergunta se está falando com um robô.
- "resumo_curto" tem no máximo 280 caracteres e é escrito para um vendedor ler de relance.`
