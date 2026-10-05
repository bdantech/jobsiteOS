import type { ConfigGeralAgentes, PlanoMandato } from './schemas.js'

/**
 * O RITMO DO AGENTE: quando o mandato acorda de novo.
 *
 * ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
 * Nos primeiros mandatos, o ciclo acordava no horário que o modelo escrevia no plano, e o
 * modelo escrevia por hábito humano: "amanhã às 10h", "às 14h", "aguardar o resultado".
 * Um agente que trabalha a cada 5 minutos andava um passo por dia, e um mandato de três
 * dias expirou sem a Ana voltar a agir.
 *
 * A regra agora é do CÓDIGO, não só do prompt, para o modelo não conseguir escapar dela:
 *
 *   1. Por padrão a próxima ação nasce em até `espera_maxima_min` (10) — mesmo que o plano
 *      diga "amanhã".
 *   2. Só o CLIENTE autoriza esperar mais: o item do plano traz `pedido_do_cliente` com o
 *      trecho da conversa ("me liga amanhã às 10h"), e aí o horário dele vale.
 *   3. Nunca depois da validade do mandato.
 *
 * Esperar resposta ou ligação continua sendo possível sem gastar modelo: o mandato acorda
 * no ritmo da regra 1, e `deveDormirSemNovidade` decide se há algo novo para o modelo
 * olhar. A novidade de verdade (resposta, resultado de ligação) acorda o mandato na hora
 * pelos triggers do banco, independente daqui.
 */

export interface EntradaProximaAcao {
  agora: Date
  plano: PlanoMandato | null
  /** `proxima_acao_em` já marcado por uma ferramenta durante o ciclo (`agendar_ligacao`). */
  marcado: Date | null
  expiraEm: Date
  geral: Pick<ConfigGeralAgentes, 'espera_maxima_min' | 'intervalo_ciclo_min'>
}

export interface ProximaAcao {
  em: Date
  /** O porquê, para o registro do ciclo e para quem lê o mandato. */
  motivo: 'pedido_do_cliente' | 'plano' | 'teto_de_espera' | 'validade'
}

const MIN = 60_000

export function proximaAcaoDoMandato(e: EntradaProximaAcao): ProximaAcao {
  const agora = e.agora.getTime()
  const minimo = agora + e.geral.intervalo_ciclo_min * MIN
  const teto = agora + e.geral.espera_maxima_min * MIN
  // A validade é o limite de tudo: acorda antes dela para ainda poder agir (ou encerrar).
  const limite = Math.max(minimo, e.expiraEm.getTime() - e.geral.intervalo_ciclo_min * MIN)

  const item = e.plano?.proximas_acoes?.[0]
  const doPlano = item?.quando ? Date.parse(item.quando) : Number.NaN
  const marcado = e.marcado ? e.marcado.getTime() : Number.NaN
  const pedido = typeof item?.pedido_do_cliente === 'string' && item.pedido_do_cliente.trim().length > 0

  let alvo: number
  let motivo: ProximaAcao['motivo']
  if (pedido && Number.isFinite(doPlano) && doPlano > agora) {
    alvo = doPlano
    motivo = 'pedido_do_cliente'
  } else {
    // Sem pedido do cliente: o horário do plano (ou o marcado por ferramenta) só vale se
    // cair antes do teto; o que passar dele é cortado.
    const candidatos = [doPlano, marcado].filter((t) => Number.isFinite(t) && t > agora)
    const desejado = candidatos.length ? Math.min(...candidatos) : teto
    alvo = Math.min(desejado, teto)
    motivo = desejado <= teto && candidatos.length ? 'plano' : 'teto_de_espera'
  }

  if (alvo > limite) return { em: new Date(limite), motivo: 'validade' }
  return { em: new Date(Math.max(alvo, minimo)), motivo }
}

export interface EntradaDormir {
  agora: Date
  plano: PlanoMandato | null
  /** O último ciclo em que o MODELO rodou. */
  ultimoCicloEm: Date | null
  /** Houve resposta do cliente, resultado de ligação ou desfecho desde o último ciclo? */
  houveNovidade: boolean
  geral: Pick<ConfigGeralAgentes, 'espera_sem_novidade_max_min'>
}

/**
 * Esperando (o primeiro item do plano é uma espera por resposta ou ligação), sem novidade e
 * dentro da janela de paciência: não chama o modelo, só reagenda. Cada ciclo custa ~R$ 1 de
 * modelo; acordar de 10 em 10 minutos para descobrir que nada mudou queimaria o orçamento
 * do mandato numa manhã.
 */
export function deveDormirSemNovidade(e: EntradaDormir): boolean {
  if (e.houveNovidade) return false
  const item = e.plano?.proximas_acoes?.[0]
  if (!item?.aguarda) return false
  if (!e.ultimoCicloEm) return false
  return e.agora.getTime() - e.ultimoCicloEm.getTime() < e.geral.espera_sem_novidade_max_min * MIN
}
