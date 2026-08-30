import type { BaseLegal, CanalThread } from '../comunicacao/schemas.js'
import type { MotivoExclusao, TipoCampanha } from './schemas.js'

/**
 * O MOTOR DE EXCLUSÃO (§7).
 *
 * Função pura, e é isso que a torna testável motivo a motivo. Quem busca os
 * fatos é o worker; quem decide é aqui. A separação importa porque a mesma
 * decisão roda em dois momentos — na simulação (dry-run) e na materialização — e
 * duas implementações da mesma regra produziriam um dry-run que mente.
 *
 * ─── A ORDEM É A MENSAGEM ───────────────────────────────────────────────────
 * Como no portão do 05A, o primeiro motivo é o que a tela mostra. A ordem vai do
 * mais grave e mais permanente para o mais circunstancial:
 *
 *   suprimido        pediu para não ser abordado. É a única que nunca se fura.
 *   processo         estamos processando essa empresa. Nada de marketing.
 *   passivo          decisão comercial explícita de não prospectar.
 *   sem_contato      não há como falar com ela. É enriquecimento faltando.
 *   sem_base_legal   há canal, mas não há permissão de usá-lo.
 *   duplicado        outra pessoa da mesma empresa já entrou nesta campanha.
 *   outra_campanha   já está em outra campanha viva.
 *   frequencia_90d   recebeu campanhas demais no trimestre.
 *   conversa_aberta  tem thread viva; disparo por cima é o pior erro possível.
 *   contatado_recente falamos com ela há pouco.
 *
 * Dizer "sem base legal" para quem está suprimido seria tecnicamente verdadeiro
 * e praticamente inútil: a pessoa iria corrigir a base legal e continuar sem
 * receber.
 */

export interface FatosDoDestinatario {
  canal: CanalThread
  tipoCampanha: TipoCampanha
  /** O identificador do canal (e-mail ou telefone). Vazio = não há como falar. */
  identificador: string | null
  suprimido: boolean
  baseLegal: BaseLegal | null
  /** A empresa tem processo jurídico NOSSO ativo (04j). */
  temProcessoAtivo: boolean
  /** `empresas.gestao_operacao`. `passivo` não recebe prospecção. */
  gestaoOperacao: string | null
  /** Outra pessoa da MESMA empresa já foi escolhida nesta campanha. */
  empresaJaEscolhida: boolean
  /** Já é destinatário de outra campanha ativa. */
  emOutraCampanha: boolean
  /** Quantas campanhas este contato recebeu nos últimos 90 dias. */
  campanhasNoTrimestre: number
  maxCampanhas90d: number
  /** Conversa viva com esta pessoa. */
  temConversaAberta: boolean
  excluirConversaAberta: boolean
  /** Último toque nesta pessoa; null = nunca. */
  ultimoToqueEm: Date | null
  excluirContatadosDias: number
  agora: Date
}

export interface VeredictoExclusao {
  incluir: boolean
  motivo?: MotivoExclusao
}

const INCLUIR: VeredictoExclusao = { incluir: true }

export function avaliarDestinatario(f: FatosDoDestinatario): VeredictoExclusao {
  if (f.suprimido) return { incluir: false, motivo: 'suprimido' }

  // Cobrar por campanha quem estamos processando é o tipo de erro que vira print.
  if (f.temProcessoAtivo) return { incluir: false, motivo: 'processo_juridico' }

  /*
   * Passivo barra PROSPECÇÃO, não tudo. Uma conta passiva continua precisando
   * saber que o certificado dela vence semana que vem — e tratar as duas coisas
   * como a mesma seria transformar uma decisão comercial em silêncio operacional.
   */
  if (f.gestaoOperacao === 'passivo' && f.tipoCampanha === 'prospeccao') {
    return { incluir: false, motivo: 'passivo' }
  }

  if (!f.identificador || f.identificador.trim() === '') {
    return { incluir: false, motivo: 'sem_contato' }
  }
  if (f.baseLegal === null) return { incluir: false, motivo: 'sem_base_legal' }

  if (f.empresaJaEscolhida) return { incluir: false, motivo: 'duplicado' }
  if (f.emOutraCampanha) return { incluir: false, motivo: 'outra_campanha' }

  if (f.maxCampanhas90d > 0 && f.campanhasNoTrimestre >= f.maxCampanhas90d) {
    return { incluir: false, motivo: 'frequencia_90d' }
  }

  if (f.excluirConversaAberta && f.temConversaAberta) {
    return { incluir: false, motivo: 'conversa_aberta' }
  }

  if (f.excluirContatadosDias > 0 && f.ultimoToqueEm) {
    const limite = f.agora.getTime() - f.excluirContatadosDias * 86_400_000
    if (f.ultimoToqueEm.getTime() > limite) {
      return { incluir: false, motivo: 'contatado_recente' }
    }
  }

  return INCLUIR
}

/**
 * O placar do dry-run: quantos por motivo.
 *
 * Devolve TODOS os motivos, inclusive os zerados. Um painel que só mostra o que
 * aconteceu esconde a pergunta mais útil da simulação — "por que nenhuma foi
 * excluída por supressão?" costuma ser a pergunta certa quando alguém montou o
 * público errado.
 */
export function contarExclusoes(
  veredictos: readonly VeredictoExclusao[],
  motivos: readonly MotivoExclusao[],
): Record<MotivoExclusao, number> {
  const out = Object.fromEntries(motivos.map((m) => [m, 0])) as Record<MotivoExclusao, number>
  for (const v of veredictos) {
    if (!v.incluir && v.motivo) out[v.motivo] += 1
  }
  return out
}
