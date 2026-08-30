import { dentroDaJanela, proximaAbertura } from './janela.js'
import type {
  BaseLegal,
  CanalComunicacao,
  ConfigComunicacao,
  TipoContaWhatsapp,
} from './schemas.js'

/**
 * O PORTÃO (§1.4). Nada sai sem passar por aqui — humano ou IA, compositor,
 * outbox ou agente.
 *
 * ─── POR QUE É UMA FUNÇÃO PURA ──────────────────────────────────────────────
 * Ela não consulta banco, não chama rede e não tem relógio próprio: recebe os
 * FATOS já reunidos e devolve um veredito. Isso é o que a torna testável célula a
 * célula — e o portão é exatamente o código que não pode ter um caminho não
 * testado, porque cada caminho é uma mensagem que sai ou não sai.
 *
 * Quem junta os fatos é o worker (`comunicacao/enviar-fila`) e o RPC de
 * enfileiramento; as duas metades da checagem estão descritas na migração 0144.
 *
 * ─── A ORDEM DAS RECUSAS NÃO É ARBITRÁRIA ───────────────────────────────────
 * Da mais permanente para a mais temporária:
 *
 *   kill switch    a casa mandou parar. Nada mais importa.
 *   supressão      a PESSOA pediu para não receber. É o único motivo que nem uma
 *                  confirmação explícita de humano fura.
 *   base legal     não sabemos por que podemos falar com ela.
 *   teto da thread já mandamos demais para esta pessoa hoje.
 *   teto da conta  o número já mandou o que aguenta hoje (warmup).
 *   cooldown       falamos com ela ontem.
 *   janela         é tarde. Não é "não" — é "ainda não", e vira agendamento.
 *
 * Devolver a PRIMEIRA recusa nessa ordem é o que faz a mensagem de erro na tela
 * dizer a coisa mais importante em vez da mais recente.
 */

export type MotivoRecusaEnvio =
  | 'kill_switch'
  | 'suprimido'
  | 'sem_base_legal'
  | 'teto_thread'
  | 'teto_conta'
  | 'cooldown'
  | 'fora_da_janela'

export const MOTIVO_RECUSA_ENVIO_LABELS: Record<MotivoRecusaEnvio, string> = {
  kill_switch: 'Envios automáticos estão desligados no kill switch.',
  suprimido: 'Este destinatário está na lista de supressão.',
  sem_base_legal: 'Contato sem base legal registrada.',
  teto_thread: 'Já falamos o suficiente com esta pessoa hoje.',
  teto_conta: 'Este número já atingiu o limite diário.',
  cooldown: 'Falamos com este contato há pouco tempo.',
  fora_da_janela: 'Fora da janela de envio.',
}

export interface FatosDoEnvio {
  canal: CanalComunicacao
  /** `plantao` não passa pelo portão de mercado — ver `ehTransporteInterno`. */
  tipoConta: TipoContaWhatsapp
  /** Mensagem do agente em modo autônomo. O kill switch só alcança estas. */
  automatica: boolean
  suprimido: boolean
  baseLegal: BaseLegal | null
  /** Saídas para esta thread hoje. */
  enviadasNaThreadHoje: number
  /** Saídas por esta conta hoje, e o teto que ela aguenta (já com warmup aplicado). */
  enviadasPelaContaHoje: number
  tetoDaConta: number
  /** Quando falamos com este contato pela última vez. Null = nunca. */
  ultimoToqueEm: Date | null
  agora: Date
  /**
   * Confirmação explícita de um humano para furar a JANELA (§5). Nunca fura
   * supressão, base legal ou kill switch — e é por isso que o nome diz janela.
   */
  forcarJanela?: boolean
}

export interface VeredictoEnvio {
  pode: boolean
  motivo?: MotivoRecusaEnvio
  /**
   * Preenchido só em `fora_da_janela`: quando a mensagem deve ser tentada de
   * novo. É a diferença entre recusar e adiar, e a razão de `pode: false` aqui
   * não significar "descarte".
   */
  reagendarPara?: Date
}

/**
 * O plantão interno é transporte SEPARADO (§1.5): alerta de orçamento estourado
 * às 23h de um sábado é exatamente o alerta que precisa sair às 23h de um sábado.
 * Ele não passa por warmup, supressão, janela nem teto — e a checagem está aqui,
 * numa função nomeada, para que ninguém precise lembrar disso ao chamar.
 */
export function ehTransporteInterno(fatos: Pick<FatosDoEnvio, 'canal' | 'tipoConta'>): boolean {
  return fatos.canal === 'interno' || fatos.tipoConta === 'plantao'
}

export function podeEnviar(fatos: FatosDoEnvio, cfg: ConfigComunicacao): VeredictoEnvio {
  if (ehTransporteInterno(fatos)) return { pode: true }

  if (fatos.automatica && cfg.agente.kill_switch) {
    return { pode: false, motivo: 'kill_switch' }
  }
  if (fatos.suprimido) {
    return { pode: false, motivo: 'suprimido' }
  }
  if (fatos.baseLegal === null) {
    return { pode: false, motivo: 'sem_base_legal' }
  }
  if (cfg.teto_diario_por_thread > 0 && fatos.enviadasNaThreadHoje >= cfg.teto_diario_por_thread) {
    return { pode: false, motivo: 'teto_thread' }
  }
  if (fatos.tetoDaConta > 0 && fatos.enviadasPelaContaHoje >= fatos.tetoDaConta) {
    return { pode: false, motivo: 'teto_conta' }
  }
  if (cfg.cooldown_dias > 0 && fatos.ultimoToqueEm) {
    const limite = fatos.agora.getTime() - cfg.cooldown_dias * 86_400_000
    if (fatos.ultimoToqueEm.getTime() > limite) {
      return { pode: false, motivo: 'cooldown' }
    }
  }
  if (!fatos.forcarJanela && !dentroDaJanela(fatos.agora, cfg.janela)) {
    return {
      pode: false,
      motivo: 'fora_da_janela',
      reagendarPara: proximaAbertura(fatos.agora, cfg.janela),
    }
  }
  return { pode: true }
}

/**
 * O teto de HOJE de uma conta, com a rampa de warmup aplicada.
 *
 * Um número novo que dispara 200 mensagens no primeiro dia é banido no segundo, e
 * o número banido leva junto a conversa de todo mundo que já falava por ele. A
 * rampa é linear e semanal porque é o que o WhatsApp tolera na prática, e porque
 * uma curva mais esperta seria impossível de explicar a quem vê a conta parar.
 *
 * `warmup_iniciado_em` nulo = conta já aquecida (as que existiam antes do módulo).
 */
export function tetoDiarioDaConta(
  conta: { mensagens_por_dia: number; warmup_iniciado_em: string | null },
  cfg: ConfigComunicacao,
  hoje: Date,
): number {
  if (!conta.warmup_iniciado_em) return conta.mensagens_por_dia

  const inicio = new Date(`${conta.warmup_iniciado_em}T00:00:00Z`)
  if (Number.isNaN(inicio.getTime())) return conta.mensagens_por_dia

  const dias = Math.floor((hoje.getTime() - inicio.getTime()) / 86_400_000)
  const semanas = Math.max(0, Math.floor(dias / 7))
  const rampa = cfg.warmup.inicial_por_dia + semanas * cfg.warmup.incremento_semanal
  return Math.max(0, Math.min(conta.mensagens_por_dia, rampa))
}

/**
 * O intervalo aleatório entre dois envios da mesma conta, em milissegundos.
 *
 * Aleatório e não fixo: uma cadência perfeitamente regular é a assinatura mais
 * óbvia de robô que existe, e é o que a detecção do provedor procura primeiro.
 */
export function intervaloEntreEnvios(
  conta: { intervalo_min_seg: number; intervalo_max_seg: number },
  aleatorio: () => number = Math.random,
): number {
  const min = Math.max(0, conta.intervalo_min_seg)
  const max = Math.max(min, conta.intervalo_max_seg)
  return Math.round((min + aleatorio() * (max - min)) * 1000)
}
