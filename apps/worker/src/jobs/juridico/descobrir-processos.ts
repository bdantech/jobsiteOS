import { logger } from '../../logger.js'
import {
  lerBenchmarkFases,
  lerNossosCnpjs,
  lerRegrasFase,
} from '../../juridico/config.js'
import {
  criarMonitoramentoNovosProcessos,
  listarMonitoramentos,
  movimentacoesDoProcesso,
  processosDoEnvolvido,
  resumoEnvolvido,
} from '../../juridico/escavador.js'
import { persistirProcesso } from './persistir.js'

/**
 * Descoberta de processos pelos NOSSOS CNPJs (08 §3.1).
 *
 * ── O RESUMO ANTES DA VARREDURA ────────────────────────────────────────────
 * `GET /envolvido/resumo` é barato e diz quantos processos existem. `GET
 * /envolvido/processos` é paginado e cada página custa. Consultar o resumo primeiro
 * transforma "vamos ver o que tem" em uma decisão informada — e quando o número é
 * zero, a varredura inteira é pulada por uma chamada barata.
 *
 * ── `status=ATIVO` POR PADRÃO ──────────────────────────────────────────────
 * Um CNPJ de FIDC com dez anos de operação acumula centenas de ações encerradas. O
 * corte na origem é o que separa uma importação inicial de dez páginas de uma de
 * duzentas — e o que ficou de fora não some: `incluirInativos` traz tudo quando
 * alguém quiser o histórico completo, sabendo o que está pedindo.
 */

export interface ResultadoDescoberta {
  cnpjs: number
  encontrados: number
  criados: number
  atualizados: number
  sem_cadastro: number
  creditos: number
  truncados: string[]
  erros: { cnpj: string; erro: string }[]
}

export async function descobrirProcessos(
  opcoes: { incluirInativos?: boolean; cnpj?: string; comMovimentacoes?: boolean } = {},
): Promise<ResultadoDescoberta> {
  const todos = await lerNossosCnpjs()
  const alvos = opcoes.cnpj ? todos.filter((c) => c.cnpj === opcoes.cnpj) : todos

  const r: ResultadoDescoberta = {
    cnpjs: alvos.length,
    encontrados: 0,
    criados: 0,
    atualizados: 0,
    sem_cadastro: 0,
    creditos: 0,
    truncados: [],
    erros: [],
  }

  if (alvos.length === 0) {
    // NÃO é um erro, e não pode virar um: a instalação nova tem a lista vazia, e a
    // tela de configurações é quem pede o cadastro. Falhar aqui encheria o log de
    // alarme por uma coisa que ninguém configurou ainda.
    logger.warn('Nenhum CNPJ nosso cadastrado em juridico_config.nossos_cnpjs; nada a descobrir.')
    return r
  }

  const [regras, benchmark] = await Promise.all([lerRegrasFase(), lerBenchmarkFases()])
  const nossosCnpjs = todos.map((c) => c.cnpj)

  for (const entidade of alvos) {
    try {
      const resumo = await resumoEnvolvido(entidade.cnpj)
      r.creditos += resumo.creditos
      logger.info({ cnpj: entidade.cnpj, apelido: entidade.apelido, qtd: resumo.quantidade }, 'Resumo do envolvido.')
      if (resumo.quantidade === 0) continue

      const busca = await processosDoEnvolvido(entidade.cnpj, {
        status: opcoes.incluirInativos ? undefined : 'ATIVO',
        limit: 100,
      })
      r.creditos += busca.creditos
      r.encontrados += busca.processos.length
      if (busca.truncado) r.truncados.push(entidade.cnpj)

      for (const bruto of busca.processos) {
        /*
         * As movimentações são OPCIONAIS na descoberta, e desligadas por padrão.
         *
         * Uma importação inicial de 300 processos com movimentações puxa 300
         * varreduras paginadas — a conta de crédito de uma tarde. A capa sozinha já
         * dá a lista, o valor e as partes; a timeline vem na primeira sincronização
         * agendada, que é quando a fase começa a importar de verdade.
         */
        const movimentacoes = opcoes.comMovimentacoes && bruto.numero_cnj
          ? await movimentacoesDoProcesso(bruto.numero_cnj).then((m) => {
              r.creditos += m.creditos
              return m.movimentacoes
            })
          : undefined

        const p = await persistirProcesso(bruto, {
          nossosCnpjs,
          regras,
          benchmark,
          movimentacoes,
          origem: 'descoberta',
        })
        if (!p) continue
        if (p.novo) r.criados++
        else r.atualizados++
        if (p.devedor_sem_cadastro) r.sem_cadastro++
      }
    } catch (e) {
      // Um CNPJ que falha não derruba os outros: são entidades independentes, e a
      // matriz não pode ficar sem importação porque a securitizadora deu 500.
      const erro = e instanceof Error ? e.message : String(e)
      logger.error({ cnpj: entidade.cnpj, erro }, 'Falha na descoberta de processos.')
      r.erros.push({ cnpj: entidade.cnpj, erro })
    }
  }

  logger.info(r, 'Descoberta de processos concluída.')
  return r
}

/**
 * Um monitoramento de novos processos por entidade nossa (§3.5).
 *
 * Idempotente por TERMO: relê a lista do Escavador e só cria o que falta. Rodar de
 * novo depois de acrescentar um CNPJ na tela cria só o novo — e criar duplicado não
 * daria erro, daria dois callbacks por processo novo pelo resto da vida.
 */
export async function sincronizarMonitoramentos(): Promise<{
  existentes: number
  criados: number
  creditos: number
}> {
  const nossos = await lerNossosCnpjs()
  if (nossos.length === 0) return { existentes: 0, criados: 0, creditos: 0 }

  const atuais = await listarMonitoramentos()
  const termos = new Set(atuais.monitoramentos.map((m) => (m.termo ?? '').replace(/\D/g, '')))
  let criados = 0
  let creditos = atuais.creditos

  for (const entidade of nossos) {
    if (termos.has(entidade.cnpj)) continue
    const novo = await criarMonitoramentoNovosProcessos(entidade.cnpj)
    creditos += novo.creditos
    criados++
    logger.info({ cnpj: entidade.cnpj, id: novo.id }, 'Monitoramento de novos processos criado.')
  }

  return { existentes: atuais.monitoramentos.length, criados, creditos }
}
