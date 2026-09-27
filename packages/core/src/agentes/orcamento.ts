import type { PrecosAgentes } from './schemas.js'

/**
 * O ORÇAMENTO DOS AGENTES (Prompt 09 §8).
 *
 * Teto global MENSAL (a trava dura) + teto por MANDATO (impede que um mandato em laço drene
 * a pool no dia 4 e deixe todos os outros parados em silêncio) + teto DIÁRIO do agente
 * (opcional, em `limites.gasto_diario_centavos`).
 *
 * ─── RESERVA → CONSUMO → ESTORNO ────────────────────────────────────────────
 * Antes da ferramenta paga, o custo ESTIMADO é reservado numa transação que confere os três
 * tetos ao mesmo tempo. Depois, o custo REAL é consumido e a diferença estornada; se a
 * chamada falhou, a reserva inteira volta. Sem isso, dois agentes simultâneos gastam o
 * mesmo saldo.
 *
 * Quem garante a atomicidade em produção é o banco (`app__agentes_reservar`/`_consumir`/
 * `_estornar`, 0270d), sob a trava da linha do mês. `LivroOrcamento`, abaixo, é o MESMO
 * contrato em memória: é o que os testes exercitam e o que documenta as regras sem SQL.
 * As duas implementações precisam concordar; se uma mudar, a outra muda no mesmo commit.
 */

/** Tokens → centavos de real, pela tabela da config (USD por milhão de tokens). */
export function custoTokensCentavos(tokens: { entrada: number; saida: number }, precos: PrecosAgentes): number {
  const usd =
    (Math.max(0, tokens.entrada) * precos.modelo_entrada_usd_mtok +
      Math.max(0, tokens.saida) * precos.modelo_saida_usd_mtok) /
    1_000_000
  return Math.ceil(usd * precos.cambio_usd_brl * 100)
}

/** O que sobra do mês, descontadas as reservas em aberto. */
export function saldoGlobal(o: { teto_centavos: number; consumido_centavos: number; reservado_centavos: number }): number {
  return Math.max(0, o.teto_centavos - o.consumido_centavos - o.reservado_centavos)
}

/** Percentual consumido do mês, para os alertas de 50/80/95/100. */
export function percentualConsumido(o: { teto_centavos: number; consumido_centavos: number }): number {
  if (o.teto_centavos <= 0) return o.consumido_centavos > 0 ? 100 : 0
  return (o.consumido_centavos * 100) / o.teto_centavos
}

/** Os limiares ainda não avisados que o consumo atual cruzou (100 é sempre um deles). */
export function alertasCruzados(pct: number, limiares: readonly number[], jaEnviados: readonly number[]): number[] {
  return [...new Set([...limiares, 100])]
    .sort((a, b) => a - b)
    .filter((l) => pct >= l && !jaEnviados.includes(l))
}

export type MotivoRecusaReserva = 'orcamento_global' | 'orcamento_mandato' | 'teto_diario_agente'

export type ResultadoReserva =
  | { ok: true; reservaId: string }
  | { ok: false; motivo: MotivoRecusaReserva; saldoCentavos: number }

interface Reserva {
  id: string
  mandatoId: string
  agenteId: string
  valor: number
  dia: string
  liquidada: boolean
}

/**
 * O contrato das RPCs de orçamento, em memória. Síncrono de propósito: em JavaScript, um
 * método síncrono é uma seção crítica — o que o `for update` do banco garante lá, o laço
 * de eventos garante aqui, e os testes de concorrência exercitam a mesma sequência.
 */
export class LivroOrcamento {
  private teto: number
  private consumido = 0
  private reservado = 0
  private readonly mandatos = new Map<string, { orcamento: number; gasto: number }>()
  private readonly tetoDiario = new Map<string, number>()
  private readonly consumoDiario = new Map<string, number>()
  private readonly reservas = new Map<string, Reserva>()
  private seq = 0

  constructor(tetoMensalCentavos: number) {
    this.teto = tetoMensalCentavos
  }

  definirMandato(id: string, orcamentoCentavos: number): void {
    this.mandatos.set(id, { orcamento: orcamentoCentavos, gasto: this.mandatos.get(id)?.gasto ?? 0 })
  }

  definirTetoDiario(agenteId: string, centavos: number): void {
    this.tetoDiario.set(agenteId, centavos)
  }

  reservar(args: { mandatoId: string; agenteId: string; valor: number; dia?: string }): ResultadoReserva {
    const dia = args.dia ?? 'hoje'
    const saldo = this.teto - this.consumido - this.reservado
    if (args.valor > saldo) return { ok: false, motivo: 'orcamento_global', saldoCentavos: Math.max(0, saldo) }

    const m = this.mandatos.get(args.mandatoId)
    if (!m) throw new Error(`Mandato ${args.mandatoId} desconhecido.`)
    const abertasDoMandato = [...this.reservas.values()]
      .filter((r) => r.mandatoId === args.mandatoId && !r.liquidada)
      .reduce((s, r) => s + r.valor, 0)
    const saldoMandato = m.orcamento - m.gasto - abertasDoMandato
    if (args.valor > saldoMandato) {
      return { ok: false, motivo: 'orcamento_mandato', saldoCentavos: Math.max(0, saldoMandato) }
    }

    const tetoDia = this.tetoDiario.get(args.agenteId) ?? 0
    if (tetoDia > 0) {
      const chave = `${args.agenteId}:${dia}`
      const abertasDoDia = [...this.reservas.values()]
        .filter((r) => r.agenteId === args.agenteId && r.dia === dia && !r.liquidada)
        .reduce((s, r) => s + r.valor, 0)
      const gastoDia = (this.consumoDiario.get(chave) ?? 0) + abertasDoDia
      if (gastoDia + args.valor > tetoDia) {
        return { ok: false, motivo: 'teto_diario_agente', saldoCentavos: Math.max(0, tetoDia - gastoDia) }
      }
    }

    const id = `r${++this.seq}`
    this.reservas.set(id, { id, mandatoId: args.mandatoId, agenteId: args.agenteId, valor: args.valor, dia, liquidada: false })
    this.reservado += args.valor
    return { ok: true, reservaId: id }
  }

  /** Custo real: acima do estimado é aceito (a chamada já aconteceu); abaixo, a diferença volta. */
  consumir(reservaId: string, valorReal: number): void {
    const r = this.reservas.get(reservaId)
    if (!r) throw new Error(`Reserva ${reservaId} desconhecida.`)
    if (r.liquidada) return
    r.liquidada = true
    const real = Math.max(0, valorReal)
    this.reservado = Math.max(0, this.reservado - r.valor)
    this.consumido += real
    const m = this.mandatos.get(r.mandatoId)!
    m.gasto += real
    const chave = `${r.agenteId}:${r.dia}`
    this.consumoDiario.set(chave, (this.consumoDiario.get(chave) ?? 0) + real)
  }

  /** A ferramenta falhou: a reserva volta inteira. */
  estornar(reservaId: string): void {
    const r = this.reservas.get(reservaId)
    if (!r || r.liquidada) return
    r.liquidada = true
    this.reservado = Math.max(0, this.reservado - r.valor)
  }

  /** Tokens: consumo direto, sem reserva (só se sabe o valor depois da chamada). */
  consumirDireto(mandatoId: string, valor: number): void {
    this.consumido += Math.max(0, valor)
    const m = this.mandatos.get(mandatoId)
    if (m) m.gasto += Math.max(0, valor)
  }

  get estado(): { teto: number; consumido: number; reservado: number; saldo: number } {
    return {
      teto: this.teto,
      consumido: this.consumido,
      reservado: this.reservado,
      saldo: Math.max(0, this.teto - this.consumido - this.reservado),
    }
  }

  gastoDoMandato(id: string): number {
    return this.mandatos.get(id)?.gasto ?? 0
  }
}
