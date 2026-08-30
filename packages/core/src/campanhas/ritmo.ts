import { dentroDaJanela, proximaAbertura } from '../comunicacao/janela.js'
import type { JanelaEnvio } from '../comunicacao/schemas.js'

/**
 * O DISTRIBUIDOR DE RITMO (§4).
 *
 * O problema: a campanha quer mandar N por dia; cada conta remetente aguenta um
 * teto próprio (que o warmup encolhe); e o envio individual do time tem
 * prioridade sobre a campanha. A saída é uma lista de horários — não uma
 * intenção — porque um horário pode ser conferido antes de a campanha rodar.
 *
 * ─── POR QUE NÃO UMA RAJADA NO INÍCIO DA JANELA ─────────────────────────────
 * Seria mais simples enfileirar tudo às 9h e deixar a fila drenar. Mas a fila
 * drena com o intervalo aleatório de cada conta, e 300 mensagens a 45s de
 * intervalo médio ocupam quase quatro horas de qualquer jeito — a diferença é
 * que, agendando, o vendedor que precisa mandar uma mensagem às 11h não fica
 * atrás de 200 disparos. O agendamento é o que torna "o individual tem
 * prioridade" verdadeiro sem precisar de duas filas.
 */

export interface ContaDisponivel {
  id: string
  numero: string
  /** Teto de hoje, já com warmup aplicado (`tetoDiarioDaConta` do 05A). */
  tetoHoje: number
  /** Quanto essa conta já mandou hoje, somando TODAS as origens. */
  enviadasHoje: number
}

export interface SlotAgendado {
  /** Índice do destinatário na lista recebida. */
  indice: number
  contaId: string | null
  quando: Date
}

export interface PlanoDeRitmo {
  slots: SlotAgendado[]
  /** Quantos ficaram de fora do dia por falta de teto. */
  adiados: number
  /** Capacidade real de hoje, depois de somar os tetos das contas. */
  capacidadeHoje: number
}

/**
 * A capacidade de HOJE: o mínimo entre o que a campanha pede e o que os números
 * aguentam. É esse mínimo — e não o ritmo configurado — que decide o tamanho da
 * leva, porque o teto do número é físico e o ritmo é uma preferência.
 */
export function capacidadeDoDia(
  ritmoPorDia: number,
  contas: readonly ContaDisponivel[],
): number {
  if (contas.length === 0) {
    // Sem conta declarada, o canal é e-mail (Resend/Gmail não têm teto por
    // número). O ritmo manda sozinho.
    return Math.max(0, ritmoPorDia)
  }
  const folga = contas.reduce((s, c) => s + Math.max(0, c.tetoHoje - c.enviadasHoje), 0)
  return Math.max(0, Math.min(ritmoPorDia, folga))
}

/**
 * Reparte `capacidade` entre as contas PROPORCIONALMENTE à folga de cada uma,
 * pelo método do maior resto.
 *
 * As duas alternativas óbvias são piores, e por motivos opostos:
 *
 *   round-robin cego  daria a mesma quantidade ao número novo em warmup e ao
 *                     maduro, e o novo estouraria o teto primeiro;
 *   guloso pela maior folga  daria TUDO ao maduro enquanto ele tivesse a maior
 *                     folga — e o número novo receberia zero. Um número que não
 *                     envia não aquece, então o guloso desliga o warmup fingindo
 *                     estar protegendo-o.
 *
 * Proporcional resolve os dois: cada número trabalha na medida do que aguenta, e
 * o novo aquece um pouco todo dia.
 */
export function repartirPorFolga(
  capacidade: number,
  contas: readonly ContaDisponivel[],
): Map<string, number> {
  const folgas = contas.map((c) => ({ id: c.id, folga: Math.max(0, c.tetoHoje - c.enviadasHoje) }))
  const total = folgas.reduce((s, f) => s + f.folga, 0)
  const cotas = new Map<string, number>()
  if (total <= 0 || capacidade <= 0) {
    for (const f of folgas) cotas.set(f.id, 0)
    return cotas
  }

  const exatos = folgas.map((f) => ({ ...f, exato: (f.folga / total) * capacidade }))
  let distribuido = 0
  for (const e of exatos) {
    const piso = Math.min(e.folga, Math.floor(e.exato))
    cotas.set(e.id, piso)
    distribuido += piso
  }

  // Os restos, em ordem decrescente de fração — e o `localeCompare` no desempate
  // faz duas execuções idênticas produzirem o mesmo plano.
  const restos = exatos
    .map((e) => ({ id: e.id, resto: e.exato - Math.floor(e.exato), folga: e.folga }))
    .sort((a, b) => b.resto - a.resto || a.id.localeCompare(b.id))

  let i = 0
  while (distribuido < capacidade && restos.length > 0) {
    const alvo = restos[i % restos.length]!
    const atual = cotas.get(alvo.id) ?? 0
    if (atual < alvo.folga) {
      cotas.set(alvo.id, atual + 1)
      distribuido += 1
    } else if (restos.every((r) => (cotas.get(r.id) ?? 0) >= r.folga)) {
      break
    }
    i += 1
  }

  return cotas
}

/**
 * Espalha `quantidade` envios pela janela do dia, alternando entre as contas.
 *
 * A alternância é o segundo motivo de o plano existir: mandar as 20 do número
 * novo em sequência, uma atrás da outra, é a rajada que a detecção do provedor
 * procura — mesmo respeitando o teto do dia.
 */
export function planejarDia(args: {
  quantidade: number
  contas: readonly ContaDisponivel[]
  janela: JanelaEnvio
  respeitarJanela: boolean
  agora: Date
}): PlanoDeRitmo {
  const { quantidade, contas, janela, respeitarJanela, agora } = args
  const capacidade = capacidadeDoDia(quantidade, contas)
  const slots: SlotAgendado[] = []

  if (capacidade <= 0) {
    return { slots, adiados: quantidade, capacidadeHoje: 0 }
  }

  const inicio =
    !respeitarJanela || dentroDaJanela(agora, janela) ? agora : proximaAbertura(agora, janela)

  // O fim da janela no dia do início. Fora da janela o espalhamento não faz
  // sentido: tudo cairia depois do expediente e o portão reagendaria de qualquer
  // forma — o que funcionaria, mas encheria o log de reagendamentos.
  const fim = respeitarJanela ? fimDaJanelaNoDia(inicio, janela) : new Date(inicio.getTime() + 8 * 3_600_000)
  const duracaoMs = Math.max(60_000, fim.getTime() - inicio.getTime())
  const passo = capacidade > 1 ? duracaoMs / capacidade : 0

  const cotas = repartirPorFolga(capacidade, contas)
  const restante = new Map(cotas)

  for (let i = 0; i < capacidade; i += 1) {
    let contaId: string | null = null
    if (contas.length > 0) {
      // A cada slot, a conta com mais cota RESTANTE. Isso intercala os números em
      // vez de esgotar um antes de começar o outro.
      const escolhida = [...restante.entries()]
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
      if (!escolhida) break
      contaId = escolhida[0]
      restante.set(contaId, escolhida[1] - 1)
    }
    slots.push({ indice: i, contaId, quando: new Date(inicio.getTime() + Math.round(passo * i)) })
  }

  return {
    slots,
    adiados: Math.max(0, quantidade - slots.length),
    capacidadeHoje: capacidade,
  }
}

function fimDaJanelaNoDia(inicio: Date, janela: JanelaEnvio): Date {
  const fim = new Date(inicio)
  // `hora_fim` é hora cheia no fuso da janela; aproximar pelo horário local do
  // início é suficiente porque `proximaAbertura` já pôs `inicio` dentro do dia
  // certo, e um erro de minutos aqui só muda o espaçamento, nunca a data.
  const horas = Math.max(1, janela.hora_fim - janela.hora_inicio)
  fim.setTime(inicio.getTime() + horas * 3_600_000)
  return fim
}

/**
 * "1.240 mensagens · 80/dia · ~16 dias úteis" (§3).
 *
 * Conta só os dias em que a campanha realmente envia. Estimar em dias corridos
 * daria um número menor e errado, e a diferença aparece exatamente quando a
 * pessoa está decidindo se aprova.
 */
export function duracaoEstimada(args: {
  total: number
  ritmoPorDia: number
  diasDaSemana: readonly number[]
}): { dias: number; texto: string } {
  const { total, ritmoPorDia, diasDaSemana } = args
  if (total <= 0 || ritmoPorDia <= 0) return { dias: 0, texto: 'nada a enviar' }

  const dias = Math.ceil(total / ritmoPorDia)
  const uteisPorSemana = Math.max(1, diasDaSemana.length)
  // Dias de envio → dias de calendário, para a frase falar do relógio de quem lê.
  const corridos = Math.ceil((dias / uteisPorSemana) * 7)

  const rotulo = dias === 1 ? '1 dia de envio' : `~${dias} dias de envio`
  const extra = corridos > dias ? ` (~${corridos} dias de calendário)` : ''
  return { dias, texto: `${total.toLocaleString('pt-BR')} mensagens · ${ritmoPorDia}/dia · ${rotulo}${extra}` }
}
