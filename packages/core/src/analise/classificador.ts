import { z } from 'zod'
import type { ProvedorAnalise, TipoResposta } from './tipos.js'

/**
 * O ADAPTER DE CLASSIFICAÇÃO (05C §4.1).
 *
 * Duas implementações com a mesma interface: o Jev (TypeSafe), que devolve probabilidade
 * calibrada e nenhum texto, e o Claude, que cobre quando o Jev falha. Este arquivo só
 * monta pedidos e lê respostas — o HTTP é do worker, que é quem tem chave e relógio.
 *
 * ─── NENHUMA ANÁLISE FICA SEM RODAR POR CAUSA DE FORNECEDOR ─────────────────
 * Erro, timeout ou resposta incompleta do primário cai no reserva DENTRO da mesma análise,
 * e só para as perguntas que ficaram sem resposta. O provedor vai item a item para o banco
 * (`analise_itens.provedor`): é por ele que o painel de custo sabe quanto correu em cada
 * braço, e que a calibração sabe de quem é cada probabilidade.
 */

export interface PerguntaTipada {
  /** Chave estável dentro do pedido (ex.: `item:explorou_dor`, `apl:conectou_a_dor`). */
  id: string
  tipo: TipoResposta
  pergunta: string
  /** `escolha`: as opções, na ordem em que a rubrica as declara. */
  opcoes?: readonly string[]
  /** `score`: os níveis, do pior para o melhor (2 a 10). */
  niveis?: readonly string[]
}

export interface RespostaCalibrada {
  id: string
  /** `sim_nao`: 'sim' | 'nao'. `escolha`: a opção. `score`: o valor normalizado em [0,1], como texto. */
  resultado: string
  /**
   * `sim_nao`: P(sim) — SEMPRE do "sim", independente do que a rubrica considera bom; quem
   * converte em P(atendido) é a rubrica. `escolha`/`score`: a confiança na resposta.
   */
  probabilidade: number
  probabilidades?: Record<string, number>
  provedor: ProvedorAnalise
}

export interface Classificador {
  readonly provedor: ProvedorAnalise
  perguntar(estado: string, perguntas: readonly PerguntaTipada[]): Promise<RespostaCalibrada[]>
}

export interface ResultadoComQueda {
  respostas: RespostaCalibrada[]
  /** O primário falhou (inteiro ou em parte) e o reserva foi chamado. */
  caiu: boolean
  erroPrimario?: string
  /** Perguntas que nenhum dos dois respondeu. */
  semResposta: string[]
}

/**
 * Pergunta ao primário; o que ele não responder (por erro ou por omissão) vai ao reserva.
 * Só lança quando NENHUMA pergunta teve resposta — meia análise é melhor que nenhuma, e
 * quem decide o que fazer com o buraco é a rubrica (item sem resposta sai da conta).
 */
export async function perguntarComQueda(args: {
  primario: Classificador
  reserva?: Classificador | null
  estado: string
  perguntas: readonly PerguntaTipada[]
}): Promise<ResultadoComQueda> {
  const { primario, reserva, estado, perguntas } = args
  if (perguntas.length === 0) return { respostas: [], caiu: false, semResposta: [] }

  let respostas: RespostaCalibrada[] = []
  let erroPrimario: string | undefined
  try {
    respostas = filtrarValidas(await primario.perguntar(estado, perguntas), perguntas)
  } catch (erro) {
    erroPrimario = erro instanceof Error ? erro.message : String(erro)
  }

  const respondidas = new Set(respostas.map((r) => r.id))
  const faltando = perguntas.filter((p) => !respondidas.has(p.id))
  if (faltando.length === 0) return { respostas, caiu: false, semResposta: [] }

  if (!reserva || reserva.provedor === primario.provedor) {
    if (respostas.length === 0) throw new Error(erroPrimario ?? 'O classificador não respondeu nenhuma pergunta.')
    return { respostas, caiu: false, erroPrimario, semResposta: faltando.map((p) => p.id) }
  }

  let doReserva: RespostaCalibrada[] = []
  let erroReserva: string | undefined
  try {
    doReserva = filtrarValidas(await reserva.perguntar(estado, faltando), faltando)
  } catch (erro) {
    erroReserva = erro instanceof Error ? erro.message : String(erro)
  }
  const todas = [...respostas, ...doReserva]
  if (todas.length === 0) {
    throw new Error(`Os dois classificadores falharam: ${erroPrimario ?? 'sem resposta'} / ${erroReserva ?? 'sem resposta'}`)
  }
  const ok = new Set(todas.map((r) => r.id))
  return {
    respostas: todas,
    caiu: true,
    erroPrimario: erroPrimario ?? 'resposta incompleta',
    semResposta: perguntas.filter((p) => !ok.has(p.id)).map((p) => p.id),
  }
}

/** Descarta resposta para pergunta que não foi feita, duplicada ou com probabilidade fora de [0,1]. */
function filtrarValidas(rs: readonly RespostaCalibrada[], perguntas: readonly PerguntaTipada[]): RespostaCalibrada[] {
  const ids = new Set(perguntas.map((p) => p.id))
  const vistas = new Set<string>()
  const out: RespostaCalibrada[] = []
  for (const r of rs) {
    if (!ids.has(r.id) || vistas.has(r.id)) continue
    if (!Number.isFinite(r.probabilidade) || r.probabilidade < 0 || r.probabilidade > 1) continue
    vistas.add(r.id)
    out.push(r)
  }
  return out
}

// ─── Jev (TypeSafe) ─────────────────────────────────────────────────────────
//
// POST https://api.typesafe.ai/v1/systemone — `{ state, model, questions: { id: Question } }`.
// Três primitivas: `noul` (sim/não → probabilidade do verdadeiro), `choice` (critérios por
// opção → escolha + probabilidades) e `score` (níveis ordenados → valor ponderado).

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
export const JEV_MODELO = 'jev-latest'

export interface PedidoJev {
  state: string
  model: string
  questions: Record<string, { type: 'noul' | 'choice' | 'score'; instructions: string; criteria?: unknown }>
}

/**
 * O id da pergunta vira chave de um mapa JSON do outro lado; `:` é aceito, mas não há por
 * que arriscar caractere especial num contrato que não controlamos.
 */
const paraChaveJev = (id: string) => id.replace(/[^a-zA-Z0-9_]/g, '_')

export function montarPedidoJev(estado: string, perguntas: readonly PerguntaTipada[]): PedidoJev {
  const questions: PedidoJev['questions'] = {}
  for (const p of perguntas) {
    const chave = paraChaveJev(p.id)
    if (p.tipo === 'sim_nao') {
      questions[chave] = { type: 'noul', instructions: p.pergunta }
    } else if (p.tipo === 'escolha') {
      const criteria: Record<string, string> = {}
      for (const o of p.opcoes ?? []) criteria[o] = o
      questions[chave] = { type: 'choice', instructions: p.pergunta, criteria }
    } else {
      questions[chave] = { type: 'score', instructions: p.pergunta, criteria: [...(p.niveis ?? ['baixo', 'alto'])] }
    }
  }
  return { state: estado, model: JEV_MODELO, questions }
}

const respostaJevSchema = z.object({
  answers: z.record(
    z.string(),
    z
      .object({
        type: z.string(),
        noul: z.number().optional(),
        choice: z.string().optional(),
        score: z.number().optional(),
        confidence: z.number().optional(),
        probabilities: z.record(z.string(), z.number()).optional(),
      })
      .passthrough(),
  ),
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).partial().optional(),
})

export interface LeituraJev {
  respostas: RespostaCalibrada[]
  tokensEntrada: number
}

export function lerRespostaJev(perguntas: readonly PerguntaTipada[], corpo: unknown): LeituraJev {
  const r = respostaJevSchema.parse(corpo)
  const respostas: RespostaCalibrada[] = []
  for (const p of perguntas) {
    const a = r.answers[paraChaveJev(p.id)]
    if (!a) continue
    if (p.tipo === 'sim_nao' && typeof a.noul === 'number') {
      respostas.push({ id: p.id, resultado: a.noul >= 0.5 ? 'sim' : 'nao', probabilidade: limitar(a.noul), provedor: 'jev' })
    } else if (p.tipo === 'escolha' && typeof a.choice === 'string') {
      respostas.push({
        id: p.id,
        resultado: a.choice,
        probabilidade: limitar(a.confidence ?? a.probabilities?.[a.choice] ?? 0),
        probabilidades: a.probabilities,
        provedor: 'jev',
      })
    } else if (p.tipo === 'score' && typeof a.score === 'number') {
      // O `score` volta ponderado na escala dos índices dos níveis (0 … n−1).
      const n = Math.max(2, p.niveis?.length ?? 2)
      respostas.push({
        id: p.id,
        resultado: String(limitar(a.score / (n - 1))),
        probabilidade: limitar(a.confidence ?? 0),
        probabilidades: a.probabilities,
        provedor: 'jev',
      })
    }
  }
  return { respostas, tokensEntrada: r.usage?.input_tokens ?? 0 }
}

// ─── Claude como classificador ──────────────────────────────────────────────
//
// Mesma interface: a resposta vem por tool_use forçado, com a probabilidade declarada
// pelo próprio modelo. Não é calibrada como a do Jev — e por isso a calibração separa as
// amostras por provedor e o reserva nunca vira o braço padrão sem alguém escolher.

export const FERRAMENTA_CLASSIFICAR = 'responder_perguntas'

export function montarClassificacaoClaude(estado: string, perguntas: readonly PerguntaTipada[]) {
  const linhas = perguntas.map((p) => {
    if (p.tipo === 'sim_nao') return `- ${p.id} (sim/não): ${p.pergunta}`
    if (p.tipo === 'escolha') return `- ${p.id} (escolha entre: ${(p.opcoes ?? []).join(' | ')}): ${p.pergunta}`
    return `- ${p.id} (nota de 0 a 1, onde 0 = "${p.niveis?.[0] ?? 'baixo'}" e 1 = "${p.niveis?.at(-1) ?? 'alto'}"): ${p.pergunta}`
  })
  return {
    system:
      'Você avalia conversas comerciais da OnePay (antecipação de recebíveis para construtoras e fornecedores). ' +
      'Responda cada pergunta só com base no texto. Para sim/não, "probabilidade" é a chance de a resposta ser SIM. ' +
      'Para escolha e nota, é a sua confiança na resposta. Não invente o que não está no texto.',
    usuario: `<conversa>\n${estado}\n</conversa>\n\nPerguntas:\n${linhas.join('\n')}`,
    ferramenta: {
      name: FERRAMENTA_CLASSIFICAR,
      description: 'Devolve a resposta de cada pergunta.',
      input_schema: {
        type: 'object',
        properties: {
          respostas: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                resposta: { type: 'string', description: 'sim | nao | a opção escolhida | a nota entre 0 e 1' },
                probabilidade: { type: 'number', minimum: 0, maximum: 1 },
              },
              required: ['id', 'resposta', 'probabilidade'],
            },
          },
        },
        required: ['respostas'],
      },
    },
  }
}

const respostaClaudeSchema = z.object({
  respostas: z.array(z.object({ id: z.string(), resposta: z.union([z.string(), z.number()]), probabilidade: z.number() })),
})

export function lerClassificacaoClaude(perguntas: readonly PerguntaTipada[], entrada: unknown): RespostaCalibrada[] {
  const r = respostaClaudeSchema.parse(entrada)
  const porId = new Map(perguntas.map((p) => [p.id, p]))
  const out: RespostaCalibrada[] = []
  for (const x of r.respostas) {
    const p = porId.get(x.id)
    if (!p) continue
    const prob = limitar(x.probabilidade)
    const texto = String(x.resposta).trim().toLowerCase()
    if (p.tipo === 'sim_nao') {
      const sim = texto.startsWith('s') || texto === 'true' || texto === 'yes'
      // O modelo às vezes devolve a confiança NA RESPOSTA em vez de P(sim): "não" com 0,9.
      // A resposta textual manda no lado; a probabilidade, só na distância de 0,5.
      const pSim = sim ? (prob >= 0.5 ? prob : 1 - prob) : prob <= 0.5 ? prob : 1 - prob
      out.push({ id: p.id, resultado: sim ? 'sim' : 'nao', probabilidade: pSim, provedor: 'claude' })
    } else if (p.tipo === 'escolha') {
      const opcao = (p.opcoes ?? []).find((o) => o.toLowerCase() === texto) ?? null
      if (opcao) out.push({ id: p.id, resultado: opcao, probabilidade: prob, provedor: 'claude' })
    } else {
      const v = Number(texto.replace(',', '.'))
      if (Number.isFinite(v)) out.push({ id: p.id, resultado: String(limitar(v)), probabilidade: prob, provedor: 'claude' })
    }
  }
  return out
}

function limitar(x: number): number {
  if (!Number.isFinite(x)) return 0
  return Math.min(1, Math.max(0, x))
}
