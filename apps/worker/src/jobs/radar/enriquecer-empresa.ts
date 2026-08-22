import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { dominioEmpresa } from './dominios.js'
import { estimarFaturamentoJob } from './estimador.js'
import { funcionariosEmpresa } from './funcionarios.js'
import { recalcularScoresDeCnpjs } from '../credito/potencial.js'
import { lookupCadastral } from '../antecipacao/lookup-cadastral.js'

/**
 * Enriquecer UMA empresa, de ponta a ponta, num clique.
 *
 * ─── POR QUE UM BOTÃO NO LUGAR DE QUATRO ────────────────────────────────────
 * Na ficha havia um botão para domínio, outro para funcionários, o faturamento só saía na
 * recalibração mensal e o scorecard era um terceiro botão. Quatro cliques em ordens
 * diferentes, e a ordem IMPORTA — quem clicasse funcionários antes de domínio pagaria uma
 * consulta ao Apollo sem chave de busca, e quem pontuasse antes de estimar teria o score
 * de uma base mais pobre. A tela cobrava do usuário um conhecimento que é do código.
 *
 *   cadastral → domínio → funcionários → faturamento → score
 *
 * ─── A JANELA DE FRESCOR ────────────────────────────────────────────────────
 * Dado obtido há menos de `frescorDias` é reaproveitado, e a etapa é PULADA — não
 * refeita. Domínio e funcionários são consultas pagas por CNPJ; um botão que reconsulta
 * tudo a cada clique é um botão que ninguém pode apertar duas vezes sem culpa.
 *
 * Cada etapa devolve o que fez ou por que não fez. Um botão "enriquecer tudo" que termina
 * em silêncio deixa a pessoa sem saber se funcionou, e ela clica de novo — que é
 * exatamente o comportamento caro que a janela existe para evitar.
 */

export type EtapaEmpresa = 'cadastral' | 'dominio' | 'funcionarios' | 'faturamento' | 'score'

export interface PassoEnriquecimento {
  etapa: EtapaEmpresa
  status: 'ok' | 'pulado' | 'falhou'
  detalhe: string
}

export interface ResultadoEnriquecerEmpresa {
  empresa_id: string
  cnpj: string
  passos: PassoEnriquecimento[]
}

/** Dias em que um dado já obtido continua valendo. O clique não paga o que já se sabe. */
const FRESCOR_DIAS_PADRAO = 30

function recente(quando: string | null | undefined, dias: number): boolean {
  if (!quando) return false
  const t = new Date(quando).getTime()
  if (Number.isNaN(t)) return false
  return (Date.now() - t) / 86_400_000 < dias
}

const dataBr = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('pt-BR') : '—'

export async function enriquecerEmpresa(opts: {
  empresaId: string
  /**
   * Ligado, o botão pode gastar: Apollo (funcionários) e a busca de domínio via Claude.
   *
   * Contatos NÃO entram aqui, e a ausência é deliberada: é a consulta mais cara do Radar
   * e a única que a pessoa costuma querer decidir olhando a empresa. Ela continua no seu
   * próprio botão.
   */
  incluirPagos?: boolean
  frescorDias?: number
}): Promise<ResultadoEnriquecerEmpresa> {
  const frescor = opts.frescorDias ?? FRESCOR_DIAS_PADRAO
  const pagos = opts.incluirPagos ?? true
  const passos: PassoEnriquecimento[] = []

  const anotar = (etapa: EtapaEmpresa, status: PassoEnriquecimento['status'], detalhe: string) => {
    passos.push({ etapa, status, detalhe })
  }

  const tentar = async <T>(etapa: EtapaEmpresa, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn()
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e)
      anotar(etapa, 'falhou', erro)
      logger.warn({ empresa: opts.empresaId, etapa, erro }, 'Etapa do enriquecimento falhou.')
      return null
    }
  }

  const { data: empresa } = await supabaseAdmin
    .from('empresas')
    .select(
      'id, cnpj, dominio, dominio_validado_em, funcionarios, funcionarios_atualizado_em, faturamento_anual, faturamento_atualizado_em, score_calculado_em',
    )
    .eq('id', opts.empresaId)
    .maybeSingle()
  if (!empresa?.cnpj) throw new Error('Empresa não encontrada ou sem CNPJ.')

  // ── Cadastral ────────────────────────────────────────────────────────────
  const { data: universo } = await supabaseAdmin
    .from('mercado_universo')
    .select('cnpj')
    .eq('cnpj', empresa.cnpj)
    .maybeSingle()

  if (universo) {
    anotar('cadastral', 'pulado', 'Já está no universo da Receita.')
  } else {
    await supabaseAdmin
      .from('cnpj_lookup_fila')
      .upsert({ cnpj: empresa.cnpj, motivo: 'manual' } as never, {
        onConflict: 'cnpj',
        ignoreDuplicates: true,
      })
    const r = await tentar('cadastral', () => lookupCadastral({ orcamentoMs: 20_000 }))
    if (r) anotar('cadastral', 'ok', 'Cadastro da Receita resolvido.')
  }

  // ── Domínio ──────────────────────────────────────────────────────────────
  // Primeiro porque é a chave de busca do Apollo: sem ele, funcionários e contatos saem
  // pagos e vazios.
  if (empresa.dominio && recente(empresa.dominio_validado_em, frescor)) {
    anotar('dominio', 'pulado', `${empresa.dominio}, de ${dataBr(empresa.dominio_validado_em)}.`)
  } else {
    const d = await tentar('dominio', () =>
      dominioEmpresa(empresa.id, { incluirClaude: pagos }),
    )
    if (d) {
      anotar(
        'dominio',
        d.dominio ? 'ok' : 'falhou',
        d.dominio ? `${d.dominio} (via ${d.origem})` : (d.motivo ?? 'não encontrado'),
      )
    }
  }

  // ── Funcionários ─────────────────────────────────────────────────────────
  // O sinal principal do estimador: por isso vem ANTES do faturamento.
  if (!pagos) {
    anotar('funcionarios', 'pulado', 'Consulta paga desligada neste clique.')
  } else if (empresa.funcionarios !== null && recente(empresa.funcionarios_atualizado_em, frescor)) {
    anotar(
      'funcionarios',
      'pulado',
      `${empresa.funcionarios}, de ${dataBr(empresa.funcionarios_atualizado_em)}.`,
    )
  } else {
    const f = await tentar('funcionarios', () => funcionariosEmpresa(empresa.id))
    if (f) {
      anotar(
        'funcionarios',
        f.valor !== null ? 'ok' : 'falhou',
        f.valor !== null ? String(f.valor) : (f.motivo ?? 'sem dados'),
      )
    }
  }

  // ── Faturamento ──────────────────────────────────────────────────────────
  // Sem janela de frescor própria: o estimador já pula quem tem valor DECLARADO do ano, e
  // recalcular uma estimativa não custa nada além de CPU.
  const est = await tentar('faturamento', () => estimarFaturamentoJob({ cnpjs: [empresa.cnpj] }))
  if (est) {
    anotar(
      'faturamento',
      est.gravadas > 0 ? 'ok' : 'pulado',
      est.gravadas > 0
        ? 'Estimativa gravada.'
        : est.ja_sabidas > 0
          ? 'Faturamento já declarado — estimativa não se aplica.'
          : est.avaliadas === 0
            ? 'Sem sinal para estimar (funcionários, ERP ou Simples).'
            : 'Nada a gravar (variação abaixo do mínimo).',
    )
  }

  // ── Score ────────────────────────────────────────────────────────────────
  // Por último: ele lê tudo que veio antes, inclusive o faturamento recém-gravado.
  const sc = await tentar('score', () => recalcularScoresDeCnpjs([empresa.cnpj]))
  if (sc) {
    anotar(
      'score',
      sc.com_score > 0 ? 'ok' : 'pulado',
      sc.com_score > 0
        ? 'Score recalculado.'
        : 'Completude abaixo do mínimo — o score não sai, e isso é uma resposta.',
    )
  }

  logger.info({ empresa: empresa.id, passos }, 'Enriquecimento da empresa concluído.')
  return { empresa_id: empresa.id, cnpj: empresa.cnpj, passos }
}
