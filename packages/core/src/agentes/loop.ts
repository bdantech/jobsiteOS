import {
  FERRAMENTAS,
  custoEstimado,
  ferramenta,
  ferramentasParaAnthropic,
  type Ferramenta,
  type IdFerramenta,
} from './ferramentas.js'
import type { SinalAcao } from './disjuntor.js'
import { custoTokensCentavos, type TokensChamada } from './orcamento.js'
import type { PrecosAgentes } from './schemas.js'

/**
 * O LOOP DO AGENTE (Prompt 09 §6) — puro: modelo, executor e orçamento entram de fora.
 *
 * ─── UM LOOP REAL, COM ORÇAMENTO DE PASSOS ──────────────────────────────────
 * O modelo chama ferramentas; cada chamada é executada, o resultado volta, e ele decide o
 * próximo passo — até terminar o turno, até o limite de passos (`max_passos_por_ciclo`),
 * ou até o limite de tempo. É o que permite "buscar contato no Apollo → registrar →
 * ligar" num mesmo ciclo, que a escolha de uma ação por vez nunca permitiria.
 *
 * ─── O DINHEIRO ANDA JUNTO COM A FERRAMENTA ─────────────────────────────────
 * Ferramenta paga: reserva o custo estimado ANTES, consome o real DEPOIS, estorna se
 * falhou. Reserva recusada volta ao modelo como erro ("orçamento insuficiente") e a
 * ferramenta some da lista nos passos seguintes. Os tokens de cada chamada ao modelo são
 * consumidos direto (só se sabe o valor depois) — e gravados SEMPRE, porque sem isso não
 * há como saber se o agente se paga.
 *
 * ─── `atualizar_plano` É OBRIGATÓRIA ────────────────────────────────────────
 * Se o modelo terminar o turno sem ter atualizado o plano, o loop cobra uma vez. Se mesmo
 * assim não vier, o ciclo termina com erro `sem_plano` — registrado, não engolido. A exceção
 * é a ferramenta terminal (escalar, encerrar): o mandato saiu das mãos do agente, e não há
 * próximo passo a planejar.
 *
 * ─── A INTENÇÃO É PARTE DA CHAMADA ──────────────────────────────────────────
 * Toda ferramenta recebe um campo `intencao` obrigatório, injetado no schema que o modelo
 * vê: POR QUE ele está fazendo isso, em português. É a linha do feed Ao vivo e a auditoria
 * de cada ação — e, como é argumento da chamada, não existe ação sem ela.
 */

export type BlocoModelo =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }

export interface RespostaModelo {
  conteudo: BlocoModelo[]
  parada: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | string
  tokens: TokensChamada
}

/**
 * Blocos de contexto além do texto: a imagem e o PDF que o cliente mandou (§4.1) vão para o
 * modelo como são, para ele poder reagir a um documento enviado — "segue o contrato" sem o
 * contrato é uma conversa às cegas.
 */
export type BlocoContexto =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string }; title?: string }

export type MensagemLoop =
  | {
      role: 'user'
      content:
        | string
        | Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean } | BlocoContexto>
    }
  | { role: 'assistant'; content: BlocoModelo[] }

export type ChamadaModelo = (req: {
  system: string
  mensagens: MensagemLoop[]
  ferramentas: ReturnType<typeof ferramentasParaAnthropic>
}) => Promise<RespostaModelo>

export interface ResultadoFerramenta {
  ok: boolean
  /** O que volta ao modelo. Curto e útil — ele lê isto para decidir. */
  resultado?: unknown
  erro?: string
  /** Custo REAL, quando difere do estimado (Apollo cobra por pessoa revelada, por exemplo). */
  custoRealCentavos?: number
  /** A leitura desta ação para o disjuntor (§9.2). Ausente = `neutro`. */
  sinal?: SinalAcao
}

export interface AcaoDoCiclo {
  passo: number
  ferramenta: IdFerramenta
  intencao: string
  argumentos: unknown
  ok: boolean
  resultado?: unknown
  erro?: string
  custoCentavos: number
  duracaoMs: number
  sinal: SinalAcao
}

export interface PortaOrcamento {
  reservar(ferramenta: IdFerramenta, valorCentavos: number): Promise<{ ok: true; reservaId: string } | { ok: false; motivo: string; saldoCentavos: number }>
  consumir(reservaId: string, valorRealCentavos: number): Promise<void>
  estornar(reservaId: string): Promise<void>
  /** Tokens do modelo. Devolve o saldo que restou (o menor dos tetos). */
  consumirTokens(valorCentavos: number): Promise<void>
}

export interface EntradaCiclo {
  system: string
  contexto: string | BlocoContexto[]
  disponiveis: readonly IdFerramenta[]
  modelo: ChamadaModelo
  executar: (id: IdFerramenta, input: unknown, passo: number) => Promise<ResultadoFerramenta>
  orcamento: PortaOrcamento
  precos: PrecosAgentes
  /** Saldo no começo do ciclo (o menor de mandato, mês e dia do agente). */
  saldoInicialCentavos: number
  maxPassos: number
  prazoMs: number
  /** Relógio injetável (testes). */
  agora?: () => number
  /** Chamado a cada ação executada — é o que alimenta o Ao vivo em tempo real. */
  aoExecutar?: (a: AcaoDoCiclo) => Promise<void> | void
}

export type ErroCiclo = 'sem_plano' | 'passos_esgotados' | 'tempo_esgotado' | 'modelo_falhou'

export interface ResultadoCiclo {
  passos: number
  acoes: AcaoDoCiclo[]
  tokens: { entrada: number; saida: number }
  custoTokensCentavos: number
  custoFerramentasCentavos: number
  planoAtualizado: boolean
  terminal: IdFerramenta | null
  erro: ErroCiclo | null
  erroDetalhe?: string
  textoFinal: string
}

const COBRANCA_DO_PLANO =
  'Antes de encerrar o ciclo, chame "atualizar_plano" com o objetivo atual, a hipótese, as próximas ações (com quando e por quê) e os bloqueios.'

/** O schema que o modelo vê: o da ferramenta + `intencao` obrigatória. */
export function ferramentasComIntencao(ids: readonly IdFerramenta[]): ReturnType<typeof ferramentasParaAnthropic> {
  return ferramentasParaAnthropic(ids).map((t) => {
    const schema = { ...t.input_schema } as { properties?: Record<string, unknown>; required?: string[] }
    schema.properties = {
      intencao: { type: 'string', description: 'POR QUE você está fazendo isto agora, em uma frase em português.' },
      ...(schema.properties ?? {}),
    }
    schema.required = ['intencao', ...(schema.required ?? []).filter((r) => r !== 'intencao')]
    return { ...t, input_schema: schema as Record<string, unknown> }
  })
}

export async function executarCiclo(e: EntradaCiclo): Promise<ResultadoCiclo> {
  const agora = e.agora ?? (() => Date.now())
  const inicio = agora()
  const r: ResultadoCiclo = {
    passos: 0,
    acoes: [],
    tokens: { entrada: 0, saida: 0 },
    custoTokensCentavos: 0,
    custoFerramentasCentavos: 0,
    planoAtualizado: false,
    terminal: null,
    erro: null,
    textoFinal: '',
  }

  let saldo = e.saldoInicialCentavos
  const recusadas = new Set<IdFerramenta>()
  const mensagens: MensagemLoop[] = [{ role: 'user', content: e.contexto }]
  let cobrouPlano = false

  const visiveis = (): IdFerramenta[] =>
    e.disponiveis.filter((id) => {
      if (recusadas.has(id)) return false
      const f = FERRAMENTAS[id] as Ferramenta
      return !f.requerOrcamento || custoEstimado(id, e.precos) <= saldo
    })

  while (true) {
    if (agora() - inicio > e.prazoMs) {
      r.erro = r.planoAtualizado ? null : 'tempo_esgotado'
      break
    }
    if (r.passos >= e.maxPassos) {
      r.erro = r.planoAtualizado || r.terminal ? null : 'passos_esgotados'
      break
    }

    let resp: RespostaModelo
    try {
      resp = await e.modelo({ system: e.system, mensagens, ferramentas: ferramentasComIntencao(visiveis()) })
    } catch (erro) {
      r.erro = 'modelo_falhou'
      r.erroDetalhe = String(erro)
      break
    }
    r.passos++
    r.tokens.entrada += resp.tokens.entrada
    r.tokens.saida += resp.tokens.saida
    const custoTokens = custoTokensCentavos(resp.tokens, e.precos)
    r.custoTokensCentavos += custoTokens
    saldo -= custoTokens
    if (custoTokens > 0) await e.orcamento.consumirTokens(custoTokens)

    mensagens.push({ role: 'assistant', content: resp.conteudo })
    const texto = resp.conteudo.filter((b): b is { type: 'text'; text: string } => b.type === 'text').map((b) => b.text).join('\n').trim()
    if (texto) r.textoFinal = texto

    const usos = resp.conteudo.filter((b): b is Extract<BlocoModelo, { type: 'tool_use' }> => b.type === 'tool_use')
    if (usos.length === 0) {
      if (r.planoAtualizado || r.terminal) break
      if (!cobrouPlano && r.passos < e.maxPassos) {
        cobrouPlano = true
        mensagens.push({ role: 'user', content: COBRANCA_DO_PLANO })
        continue
      }
      r.erro = 'sem_plano'
      break
    }

    const resultados: Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }> = []
    for (const uso of usos) {
      const res = await executarUma(uso, r.passos)
      resultados.push({
        type: 'tool_result',
        tool_use_id: uso.id,
        content: JSON.stringify(res.ok ? (res.resultado ?? { ok: true }) : { erro: res.erro }).slice(0, 8000),
        ...(res.ok ? {} : { is_error: true }),
      })
      if (r.terminal) break
    }
    // Toda tool_use precisa de um tool_result, mesmo as que não rodaram depois da terminal.
    for (const uso of usos) {
      if (!resultados.some((x) => x.tool_use_id === uso.id)) {
        resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: '{"erro":"não executada: o mandato foi encerrado nesta rodada"}', is_error: true })
      }
    }
    mensagens.push({ role: 'user', content: resultados })
    if (r.terminal) break
  }

  return r

  async function executarUma(uso: Extract<BlocoModelo, { type: 'tool_use' }>, passo: number): Promise<ResultadoFerramenta> {
    const t0 = agora()
    const f = ferramenta(uso.name)
    const bruto = (uso.input && typeof uso.input === 'object' ? { ...(uso.input as Record<string, unknown>) } : {}) as Record<string, unknown>
    const intencao = typeof bruto.intencao === 'string' && bruto.intencao.trim() ? bruto.intencao.trim().slice(0, 400) : ''
    delete bruto.intencao

    const registrar = async (res: ResultadoFerramenta, custo: number): Promise<ResultadoFerramenta> => {
      if (!f) return res
      const acao: AcaoDoCiclo = {
        passo,
        ferramenta: f.id,
        intencao: intencao || f.rotulo,
        argumentos: bruto,
        ok: res.ok,
        resultado: res.resultado,
        erro: res.erro,
        custoCentavos: custo,
        duracaoMs: agora() - t0,
        sinal: res.sinal ?? 'neutro',
      }
      r.acoes.push(acao)
      await e.aoExecutar?.(acao)
      return res
    }

    if (!f || !e.disponiveis.includes(f.id)) {
      return { ok: false, erro: `A ferramenta "${uso.name}" não está disponível neste ciclo.` }
    }
    const lido = f.inputSchema.safeParse(bruto)
    if (!lido.success) {
      return registrar({ ok: false, erro: `Argumentos inválidos: ${lido.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` }, 0)
    }

    let reservaId: string | null = null
    const estimado = custoEstimado(f.id, e.precos)
    if (f.requerOrcamento && estimado > 0) {
      const reserva = await e.orcamento.reservar(f.id, estimado)
      if (!reserva.ok) {
        recusadas.add(f.id)
        saldo = Math.min(saldo, reserva.saldoCentavos)
        return registrar({ ok: false, erro: `Orçamento insuficiente para "${f.id}" (${reserva.motivo}). Use ferramentas grátis ou replaneje.` }, 0)
      }
      reservaId = reserva.reservaId
      saldo -= estimado
    }

    let res: ResultadoFerramenta
    try {
      res = await e.executar(f.id, lido.data, passo)
    } catch (erro) {
      res = { ok: false, erro: String(erro instanceof Error ? erro.message : erro) }
    }

    let custo = 0
    if (reservaId) {
      if (res.ok) {
        custo = res.custoRealCentavos ?? estimado
        await e.orcamento.consumir(reservaId, custo)
        saldo += estimado - custo
      } else {
        await e.orcamento.estornar(reservaId)
        saldo += estimado
      }
    }
    r.custoFerramentasCentavos += custo

    if (res.ok && f.id === 'atualizar_plano') r.planoAtualizado = true
    if (res.ok && f.terminal) r.terminal = f.id
    return registrar(res, custo)
  }
}
