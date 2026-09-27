import { dentroDaJanela, proximaAbertura, proximaAberturaAposVirada } from '../comunicacao/janela.js'
import type { EstadoDisjuntor, JanelaAgentes, MotivoEncerramento, MotivoPausa } from './schemas.js'

/**
 * AS TRANCAS DO CICLO (Prompt 09 §6, passo 2).
 *
 * Qualquer uma PARA o mandato sem chamar o modelo — e chamar o modelo custa token, que
 * custa orçamento. A ordem não é arbitrária: da mais ampla (a casa inteira parou) para a
 * mais estreita (é só cedo demais), e a primeira que bate é a que conta. É ela que vai
 * para o registro, então a pessoa que lê "por que este mandato não andou" lê a razão mais
 * importante, e não a mais recente.
 *
 *    1. kill switch global          a casa mandou parar
 *    2. agente pausado              um gestor parou este agente
 *    3. disjuntor aberto            o agente se parou sozinho            → PAUSA
 *    4. orçamento global esgotado   o mês acabou                          → PAUSA (§8)
 *    5. orçamento do mandato        este mandato gastou o que podia       → ENCERRA
 *    6. cota diária do agente       todos os canais do agente esgotados   → amanhã
 *    7. ações do mandato hoje       este mandato já fez o bastante hoje   → amanhã
 *    8. max_acoes                   o mandato esgotou as ações            → ENCERRA
 *    9. expira_em                   o prazo venceu                        → ENCERRA
 *   10. supressão / cobrança        a empresa não pode ser procurada      → ENCERRA
 *   11. fora da janela de envio     ainda não — REAGENDA para a abertura
 *
 * "Pausa, não encerra" (§2.4, §8): disjuntor e orçamento global são estados da CASA, não
 * do mandato. Quando o disjuntor é reaberto ou o mês vira, o mandato continua de onde
 * estava. Já o orçamento do PRÓPRIO mandato, o prazo e o máximo de ações são o contrato
 * dele — esgotados, ele termina.
 */

export interface FatosDaTranca {
  agora: Date
  killSwitch: boolean
  agentePausado: boolean
  disjuntor: EstadoDisjuntor
  saldoGlobalCentavos: number
  mandato: {
    gastoCentavos: number
    orcamentoCentavos: number
    acoesExecutadas: number
    maxAcoes: number
    expiraEm: Date
    acoesHoje: number
  }
  acoesPorMandatoPorDia: number
  /** Soma das cotas diárias restantes do agente (ligações + mensagens + e-mails). */
  cotaDiariaRestante: number
  empresaSuprimida: boolean
  empresaEmCobranca: boolean
  janela: JanelaAgentes
  /** Custo mínimo de um passo do modelo, em centavos (um ciclo sem saldo para isso não roda). */
  custoMinimoCicloCentavos: number
}

export type NomeTranca =
  | 'kill_switch'
  | 'agente_pausado'
  | 'disjuntor_aberto'
  | 'orcamento_global'
  | 'orcamento_mandato'
  | 'cota_diaria_agente'
  | 'acoes_do_dia'
  | 'max_acoes'
  | 'expirado'
  | 'suprimido'
  | 'em_cobranca'
  | 'fora_da_janela'

export type VeredictoTranca =
  | { passa: true }
  | { passa: false; tranca: NomeTranca; efeito: 'pular' }
  | { passa: false; tranca: NomeTranca; efeito: 'pausar'; motivo: MotivoPausa }
  | { passa: false; tranca: NomeTranca; efeito: 'encerrar'; motivo: MotivoEncerramento }
  | { passa: false; tranca: NomeTranca; efeito: 'reagendar'; quando: Date }

export const TRANCA_LABELS: Record<NomeTranca, string> = {
  kill_switch: 'Kill switch global ligado',
  agente_pausado: 'Agente pausado por um gestor',
  disjuntor_aberto: 'Disjuntor do agente aberto',
  orcamento_global: 'Orçamento mensal dos agentes esgotado',
  orcamento_mandato: 'Orçamento do mandato esgotado',
  cota_diaria_agente: 'Cota diária do agente esgotada',
  acoes_do_dia: 'Limite de ações do mandato hoje',
  max_acoes: 'Máximo de ações do mandato atingido',
  expirado: 'Prazo do mandato venceu',
  suprimido: 'Empresa suprimida',
  em_cobranca: 'Empresa em cobrança',
  fora_da_janela: 'Fora da janela de envio',
}

export function aplicarTrancas(f: FatosDaTranca): VeredictoTranca {
  if (f.killSwitch) return { passa: false, tranca: 'kill_switch', efeito: 'pular' }
  if (f.agentePausado) return { passa: false, tranca: 'agente_pausado', efeito: 'pular' }
  if (f.disjuntor === 'aberto') {
    return { passa: false, tranca: 'disjuntor_aberto', efeito: 'pausar', motivo: 'disjuntor_aberto' }
  }
  if (f.saldoGlobalCentavos < f.custoMinimoCicloCentavos) {
    return { passa: false, tranca: 'orcamento_global', efeito: 'pausar', motivo: 'orcamento_esgotado' }
  }
  const m = f.mandato
  if (m.orcamentoCentavos - m.gastoCentavos < f.custoMinimoCicloCentavos) {
    return { passa: false, tranca: 'orcamento_mandato', efeito: 'encerrar', motivo: 'orcamento_esgotado' }
  }
  if (f.cotaDiariaRestante <= 0) {
    return { passa: false, tranca: 'cota_diaria_agente', efeito: 'reagendar', quando: proximaAberturaAposVirada(f.agora, f.janela) }
  }
  if (f.acoesPorMandatoPorDia > 0 && m.acoesHoje >= f.acoesPorMandatoPorDia) {
    return { passa: false, tranca: 'acoes_do_dia', efeito: 'reagendar', quando: proximaAberturaAposVirada(f.agora, f.janela) }
  }
  if (m.acoesExecutadas >= m.maxAcoes) {
    return { passa: false, tranca: 'max_acoes', efeito: 'encerrar', motivo: 'max_acoes' }
  }
  if (m.expiraEm.getTime() <= f.agora.getTime()) {
    return { passa: false, tranca: 'expirado', efeito: 'encerrar', motivo: 'expirado' }
  }
  if (f.empresaSuprimida) return { passa: false, tranca: 'suprimido', efeito: 'encerrar', motivo: 'suprimido' }
  if (f.empresaEmCobranca) return { passa: false, tranca: 'em_cobranca', efeito: 'encerrar', motivo: 'em_cobranca' }
  if (!dentroDaJanela(f.agora, f.janela)) {
    return { passa: false, tranca: 'fora_da_janela', efeito: 'reagendar', quando: proximaAbertura(f.agora, f.janela) }
  }
  return { passa: true }
}
