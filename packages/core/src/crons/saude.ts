import { execucaoAnterior } from './expressao.js'

/**
 * Se as rotinas agendadas RODARAM — o complemento de `catalogo.ts`, que diz quando
 * elas deveriam rodar.
 *
 * Nasceu de 28/09/2026: o worker estava fora do ar às 07:00 de segunda, a distribuição
 * semanal de SDR recebeu 502 e ninguém soube até o SDR dizer que não tinha recebido as
 * 50 empresas. Um job que não roda não gera erro em lugar nenhum; só um número que não
 * muda. Por isso a falta é detectada pela AGENDA (`faltasNaAgenda`) e não por um erro
 * que alguém precise lançar.
 *
 * Puro de propósito: a rota, o monitor e a tela decidem com as mesmas regras.
 */

/** Os cabeçalhos que ligam o disparo na Vercel ao job no worker. */
export const CABECALHO_CRON_EXECUCAO = 'x-cron-execucao'
/** O worker responde com ele quando assumiu o job e vai fechar a execução sozinho. */
export const CABECALHO_CRON_ACOMPANHADO = 'x-cron-acompanhado'
export const CABECALHO_CRON_JOB = 'x-cron-job'

/** Job sem retorno por mais que isto foi perdido (worker reiniciou no meio, p. ex.). */
export const LIMITE_SEM_RETORNO_HORAS = 6

/** Folga depois do horário da agenda antes de o monitor chamar de "não rodou". */
export const FOLGA_FALTA_MINUTOS = 10

/** A mesma rotina falhando de novo não repete o aviso dentro desta janela. */
export const JANELA_AVISO_HORAS = 6

export type StatusExecucaoCron = 'executando' | 'concluida' | 'falhou' | 'nao_executou' | 'pulada'

export interface ExecucaoCron {
  path: string
  status: StatusExecucaoCron
  iniciado_em: string
  terminado_em: string | null
  esperado_em: string | null
  acompanhado: boolean
  erro: string | null
}

export type CorSaude = 'verde' | 'amarela' | 'vermelha'

export interface SaudeRotina {
  cor: CorSaude
  rotulo: string
}

/**
 * A cor de UMA rotina pela última execução dela.
 *
 * Amarelo é "não dá para afirmar que está bem", não "está mal": rotina sem registro
 * ainda (acabou de ser monitorada, ou é mensal e não chegou o dia) e disparo pulado
 * porque o anterior ainda rodava.
 */
export function saudeDaRotina(
  ultima: ExecucaoCron | null,
  agora: Date,
  limiteSemRetornoHoras: number = LIMITE_SEM_RETORNO_HORAS,
): SaudeRotina {
  if (!ultima) return { cor: 'amarela', rotulo: 'Sem registro' }

  switch (ultima.status) {
    case 'falhou':
      return { cor: 'vermelha', rotulo: 'Falhou' }
    case 'nao_executou':
      return { cor: 'vermelha', rotulo: 'Não rodou' }
    case 'pulada':
      return { cor: 'amarela', rotulo: 'Pulada' }
    case 'executando': {
      const horas = (agora.getTime() - new Date(ultima.iniciado_em).getTime()) / 3_600_000
      // O monitor fecha como falha na próxima passada; a tela não espera por ele.
      return horas > limiteSemRetornoHoras
        ? { cor: 'vermelha', rotulo: 'Sem retorno' }
        : { cor: 'verde', rotulo: 'Rodando' }
    }
    case 'concluida':
      // Sem acompanhamento, o que se sabe é que o disparo foi aceito — não que o job
      // terminou bem. A tela diz isso em vez de prometer mais.
      return { cor: 'verde', rotulo: ultima.acompanhado ? 'Rodou' : 'Disparada' }
  }
}

/** A pior cor de todas: é a da linha embaixo do botão. */
export function saudeGeral(cores: readonly CorSaude[]): CorSaude {
  if (cores.includes('vermelha')) return 'vermelha'
  if (cores.includes('amarela')) return 'amarela'
  return 'verde'
}

export interface FaltaNaAgenda {
  path: string
  esperado_em: Date
}

/**
 * Os horários da agenda que passaram sem disparo nenhum.
 *
 * Para cada rotina, o último horário previsto há pelo menos `folgaMinutos`; se não há
 * disparo registrado desde então, é falta. `monitoradoDesde` é o primeiro disparo que
 * a tabela já viu: antes dele não havia registro, e acusar a rotina mensal de não ter
 * rodado no mês passado seria acusar o sistema de não existir ainda.
 */
export function faltasNaAgenda(
  agendados: readonly { path: string; schedule: string }[],
  ultimoDisparoPorPath: ReadonlyMap<string, Date>,
  agora: Date,
  monitoradoDesde: Date,
  folgaMinutos: number = FOLGA_FALTA_MINUTOS,
): FaltaNaAgenda[] {
  const corte = new Date(agora.getTime() - folgaMinutos * 60_000)
  const faltas: FaltaNaAgenda[] = []

  for (const a of agendados) {
    let esperado: Date | null
    try {
      esperado = execucaoAnterior(a.schedule, corte)
    } catch {
      // Expressão que não entendemos: a tela de Crons já a mostra como divergência.
      continue
    }
    if (!esperado || esperado < monitoradoDesde) continue

    const ultimo = ultimoDisparoPorPath.get(a.path)
    // Um minuto de tolerância para relógio adiantado de um lado ou de outro.
    if (ultimo && ultimo.getTime() >= esperado.getTime() - 60_000) continue

    faltas.push({ path: a.path, esperado_em: esperado })
  }

  return faltas
}
