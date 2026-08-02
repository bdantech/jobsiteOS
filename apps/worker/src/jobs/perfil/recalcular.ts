import type pg from 'pg'
import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { descrever, type Grupo } from '../../../../../packages/core/src/mercado/filters.js'
import {
  calcularContraste,
  type AchadoContraste,
} from '../../../../../packages/core/src/perfil/contraste.js'
import { fraseResumo, tracosDoResumo } from '../../../../../packages/core/src/perfil/frases.js'
import {
  gerarSugestoes,
  type AlvoSugestao,
  type ParametrosSugestao,
  type Sugestao,
} from '../../../../../packages/core/src/perfil/sugestoes.js'
import {
  categorizarLinha,
  variaveisDaTrilha,
  variavelPerfil,
  type VariavelPerfil,
} from '../../../../../packages/core/src/perfil/variaveis.js'
import {
  CONFIG_ANALISE_PADRAO,
  CONFIG_COORTES_PADRAO,
  type ConfigAnalise,
  type ConfigCoortes,
} from '../../../../../packages/core/src/perfil/schemas.js'
import { supabaseAdmin } from '../../db.js'
import { regrasAtivas } from '../../derivadas/regras.js'
import { logger } from '../../logger.js'
import { emitirEvento } from '../../radar/eventos.js'
import { auditarCamadas, auditarFaixas } from './auditoria.js'
import {
  coorteClientes,
  coorteSomNaoCliente,
  coortesFornecedores,
  coortesSacados,
  type Coorte,
} from './coortes.js'

/**
 * O job do Perfil de Quem Opera (04f §4).
 *
 * Coortes → contrastes → auditoria das regras → sugestões → snapshot. Nada é
 * aplicado: o job escreve UM snapshot por comparação e para. Quem muda régua é
 * gente, pelo editor, com preview.
 *
 * Sobre o silêncio: com 34 sacados pesados e 8 dormentes, quase todo achado vai
 * nascer `indicativo`, e a tela vai dizer isso. Não é uma falha do job — é o job
 * funcionando. A alternativa (mostrar lift de células de três linhas como se
 * fosse evidência) produziria regras baseadas em ruído, que é o problema que
 * este módulo existe para não criar.
 */

export interface ResultadoPerfil {
  snapshots: number
  comparacoes: Array<{
    trilha: string
    comparacao: string
    coorte_a: number
    coorte_b: number
    achados: number
    solidos: number
    sugestoes: number
  }>
  eventos: number
}

async function lerConfig<T extends object>(chave: string, padrao: T): Promise<T> {
  const { data } = await supabaseAdmin
    .from('perfil_config')
    .select('valor')
    .eq('chave', chave)
    .maybeSingle()
  const valor = data?.valor
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return padrao
  return { ...padrao, ...(valor as Partial<T>) }
}

function rotuloVariavel(id: string): string {
  return variavelPerfil(id)?.label ?? id
}

interface ContexoComparacao {
  trilha: 'sacados' | 'fornecedores'
  comparacao: string
  a: Coorte
  b: Coorte
  variaveis: readonly VariavelPerfil[]
}

function contrastar(ctx: ContexoComparacao, cfg: ConfigAnalise): AchadoContraste[] {
  const categorizar = (c: Coorte) => c.linhas.map((l) => categorizarLinha(l, ctx.variaveis))
  return calcularContraste(
    ctx.variaveis.map((v) => ({ id: v.id, chaves: v.chaves })),
    categorizar(ctx.a),
    categorizar(ctx.b),
    cfg,
  )
}

export async function recalcularPerfil(client: pg.Client): Promise<ResultadoPerfil> {
  const [cfgCoortes, cfgAnalise] = await Promise.all([
    lerConfig<ConfigCoortes>('coortes', CONFIG_COORTES_PADRAO),
    lerConfig<ConfigAnalise>('analise', CONFIG_ANALISE_PADRAO),
  ])

  const params: ParametrosSugestao = {
    n_minimo: cfgAnalise.n_minimo,
    cobertura_minima: cfgAnalise.cobertura_minima,
    lift_minimo: cfgAnalise.lift_minimo,
    fracao_barrada_minima: cfgAnalise.fracao_barrada_minima,
    cobertura_alvo: cfgAnalise.cobertura_alvo,
  }

  const regras = await regrasAtivas(client)
  const versaoRegras: Record<string, number> = {}
  for (const r of regras) versaoRegras[`camada_${r.camada}`] = r.versao

  const { rows: faixasAtivas } = await client.query<{ faixa: string; versao: number }>(
    'select faixa, versao from faixa_regras where ativa',
  )
  for (const f of faixasAtivas) versaoRegras[`faixa_${f.faixa}`] = f.versao

  const resultado: ResultadoPerfil = { snapshots: 0, comparacoes: [], eventos: 0 }

  // ── Trilha SACADOS ───────────────────────────────────────────────────────
  const sacados = await coortesSacados(client, cfgCoortes)
  const clientes = await coorteClientes(client)
  const somNaoCliente = await coorteSomNaoCliente(client, cfgAnalise.max_linhas_controle)
  const variaveisSacados = variaveisDaTrilha('sacados')

  const regraSom = regras.find((r) => r.camada === 'som')
  const alvoSom: AlvoSugestao | null = regraSom
    ? { tipo: 'camada', chave: 'som', versao: regraSom.versao }
    : null

  for (const ctx of [
    {
      trilha: 'sacados' as const,
      comparacao: 'pesados_x_dormentes',
      a: sacados.pesados,
      b: sacados.dormentes,
      variaveis: variaveisSacados,
    },
    {
      trilha: 'sacados' as const,
      comparacao: 'clientes_x_som',
      a: clientes,
      b: somNaoCliente,
      variaveis: variaveisSacados,
    },
  ]) {
    const achados = contrastar(ctx, cfgAnalise)
    // A auditoria roda sobre a coorte OPERADORA da comparação — é dela que sai a
    // frase "X% dos que operam não passariam na régua".
    const auditorias = await auditarCamadas(
      client,
      ctx.a.linhas.map((l) => String(l.cnpj)),
      ctx.a.rotulo,
    )
    const sugestoes = gerarSugestoes(
      {
        trilha: 'sacados',
        auditorias,
        achados,
        linhas: ctx.a.linhas,
        variaveis: variaveisSacados,
        alvoSinal: alvoSom,
        definicaoSinal: (regraSom?.definicao as Grupo | undefined) ?? null,
        rotuloCoorte: ctx.a.rotulo,
        comparacao: ctx.comparacao,
        descrever,
        rotuloVariavel,
      },
      params,
    )

    resultado.snapshots += await gravarSnapshot({
      trilha: 'sacados',
      comparacao: ctx.comparacao,
      achados,
      auditoria: { camadas: auditorias, faixas: null },
      sugestoes,
      versaoRegras,
      coorteA: ctx.a,
      coorteB: ctx.b,
    })
    resultado.comparacoes.push(resumoDaCorrida(ctx.comparacao, 'sacados', ctx.a, ctx.b, achados, sugestoes))
  }

  // ── Trilha FORNECEDORES ──────────────────────────────────────────────────
  const fornecedores = await coortesFornecedores(
    client,
    cfgCoortes.conversor_janela_dias,
    cfgAnalise.max_linhas_controle,
  )
  const variaveisFornecedores = variaveisDaTrilha('fornecedores')
  const auditoriaFaixas = await auditarFaixas(client, cfgCoortes.conversor_janela_dias)

  const ctxForn = {
    trilha: 'fornecedores' as const,
    comparacao: 'conversores_x_expostos',
    a: fornecedores.conversores,
    b: fornecedores.expostos,
    variaveis: variaveisFornecedores,
  }
  const achadosForn = contrastar(ctxForn, cfgAnalise)

  const faixaAlta = faixasAtivas.find((f) => f.faixa === 'alta')
  const { rows: defAlta } = await client.query<{ definicao: unknown }>(
    "select definicao from faixa_regras where ativa and faixa = 'alta' limit 1",
  )

  const sugestoesForn = gerarSugestoes(
    {
      trilha: 'fornecedores',
      // Sem auditoria de camada aqui: a régua que importa a um fornecedor é a de
      // FAIXA, e afrouxar faixa a partir de barreira exigiria rodar 2.253
      // fornecedores por uma regra que fala de NOTAS. O caminho honesto para
      // afrouxar faixa é a auditoria de conversão fora de faixa, que a tela mostra.
      auditorias: [],
      achados: achadosForn,
      linhas: ctxForn.a.linhas,
      variaveis: variaveisFornecedores,
      alvoSinal: faixaAlta ? { tipo: 'faixa', chave: 'alta', versao: faixaAlta.versao } : null,
      definicaoSinal: (defAlta[0]?.definicao as Grupo | undefined) ?? null,
      rotuloCoorte: ctxForn.a.rotulo,
      comparacao: ctxForn.comparacao,
      descrever,
      rotuloVariavel,
    },
    params,
  )

  resultado.snapshots += await gravarSnapshot({
    trilha: 'fornecedores',
    comparacao: ctxForn.comparacao,
    achados: achadosForn,
    auditoria: { camadas: [], faixas: auditoriaFaixas },
    sugestoes: sugestoesForn,
    versaoRegras,
    coorteA: ctxForn.a,
    coorteB: ctxForn.b,
  })
  resultado.comparacoes.push(
    resumoDaCorrida(ctxForn.comparacao, 'fornecedores', ctxForn.a, ctxForn.b, achadosForn, sugestoesForn),
  )

  // Evento de sistema (empresa_id null): o fan-out usa titulo/url do payload.
  const totalSugestoes = resultado.comparacoes.reduce((s, c) => s + c.sugestoes, 0)
  await emitirEvento(null, EVENTO_TIPOS.PERFIL_RECALCULADO, {
    titulo: 'Perfil de quem opera recalculado',
    resumo:
      `${resultado.snapshots} comparações atualizadas. ` +
      (totalSugestoes > 0
        ? `${totalSugestoes} sugestão${totalSugestoes > 1 ? 'ões' : ''} de ajuste de régua aguardando decisão.`
        : 'Nenhuma sugestão de ajuste desta vez.'),
    url: '/mercado/perfil',
    comparacoes: resultado.comparacoes,
  })
  resultado.eventos++

  logger.info(resultado, 'Perfil de quem opera recalculado.')
  return resultado
}

function resumoDaCorrida(
  comparacao: string,
  trilha: string,
  a: Coorte,
  b: Coorte,
  achados: readonly AchadoContraste[],
  sugestoes: readonly Sugestao[],
) {
  return {
    trilha,
    comparacao,
    coorte_a: a.linhas.length,
    coorte_b: b.linhas.length,
    achados: achados.length,
    solidos: achados.filter((x) => x.confianca === 'solida' && !x.suprimido).length,
    sugestoes: sugestoes.length,
  }
}

interface EntradaSnapshot {
  trilha: 'sacados' | 'fornecedores'
  comparacao: string
  achados: readonly AchadoContraste[]
  auditoria: unknown
  sugestoes: readonly Sugestao[]
  versaoRegras: Record<string, number>
  coorteA: Coorte
  coorteB: Coorte
}

/**
 * Um snapshot NOVO a cada corrida, nunca um update.
 *
 * A série é o produto (§4): "esta característica ganhou lift em três meses
 * seguidos" é uma afirmação de outra ordem que "hoje o lift é 2,1". Sobrescrever
 * jogaria fora exatamente o sinal que só o tempo produz.
 */
async function gravarSnapshot(e: EntradaSnapshot): Promise<number> {
  const rotulo = (id: string) => variavelPerfil(id)?.label ?? id
  const tracos = tracosDoResumo(e.achados, rotulo)

  const { error } = await supabaseAdmin.from('perfil_snapshots').insert({
    trilha: e.trilha,
    comparacao: e.comparacao,
    resultados: {
      achados: e.achados,
      rotulos: Object.fromEntries(e.achados.map((a) => [a.variavel, rotulo(a.variavel)])),
      resumo: fraseResumo(e.coorteA.rotulo, tracos, e.coorteA.linhas.length),
      tracos,
      rotulo_a: e.coorteA.rotulo,
      rotulo_b: e.coorteB.rotulo,
    } as never,
    auditoria: e.auditoria as never,
    sugestoes: e.sugestoes as never,
    versao_regras: e.versaoRegras as never,
    coorte_a: e.coorteA.linhas.length,
    coorte_b: e.coorteB.linhas.length,
  })

  if (error) {
    logger.error({ comparacao: e.comparacao, erro: error.message }, 'Falha ao gravar snapshot do perfil.')
    return 0
  }
  return 1
}
