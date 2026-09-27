import { randomUUID } from 'node:crypto'
import { ferramentasDisponiveis, type IdFerramenta } from '../../../../../packages/core/src/agentes/ferramentas.js'
import { executarCiclo, type AcaoDoCiclo } from '../../../../../packages/core/src/agentes/loop.js'
import { custoTokensCentavos } from '../../../../../packages/core/src/agentes/orcamento.js'
import { montarSystemPrompt } from '../../../../../packages/core/src/agentes/prompt.js'
import type { ConfigAgentes, VersaoVoz } from '../../../../../packages/core/src/agentes/schemas.js'
import { aplicarTrancas, TRANCA_LABELS } from '../../../../../packages/core/src/agentes/trancas.js'
import { precisaEscalar, type Triagem } from '../../../../../packages/core/src/comunicacao/triagem.js'
import { lerConfigAgentes } from '../../agentes/config.js'
import {
  acoesDoMandatoHoje,
  carregarAgente,
  carregarEmpresa,
  carregarMandato,
  carregarPlaybook,
  cotasUsadasHoje,
  montarContexto,
  type MandatoCarregado,
} from '../../agentes/contexto.js'
import { avaliarDisjuntorDoAgente } from '../../agentes/disjuntor.js'
import { modeloAnthropic } from '../../agentes/modelo.js'
import { portaOrcamento, saldosDoCiclo } from '../../agentes/orcamento.js'
import { pool, supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { configDaVoz, versaoDaAna } from '../../voz/api.js'
import { executarFerramenta, type ContextoExecucao } from './executor.js'

/**
 * O CICLO DOS AGENTES (Prompt 09 §6) — a cada 5 minutos.
 *
 * Granularidade de hora não serve: um agente que combinou ligar às 15h30 precisa ligar às
 * 15h30. Por ciclo:
 *
 *   1. SELECIONA os mandatos vencidos (`proxima_acao_em <= now`), por prioridade e depois
 *      pela hora marcada, até o teto de mandatos por ciclo;
 *   2. aplica as TRANCAS, na ordem, sem chamar o modelo (core/agentes/trancas.ts);
 *   3. monta o CONTEXTO;
 *   4. roda o LOOP de ferramentas com orçamento de passos e de tempo;
 *   5. exige o PLANO atualizado — ciclo sem plano é erro registrado;
 *   6. PERSISTE cada ação com intenção, custo e tokens (sempre);
 *   7. AGENDA `proxima_acao_em` a partir do plano.
 *
 * Mandatos são processados um por vez. Paralelizar multiplicaria as chamadas simultâneas
 * ao modelo e às linhas de WhatsApp — e o que o ciclo economiza em minutos a operação
 * perde em rajada, que é a assinatura que o provedor de WhatsApp procura primeiro.
 */

export interface ResultadoCicloAgentes {
  selecionados: number
  processados: number
  trancados: Record<string, number>
  erros: number
  acoes: number
  custo_centavos: number
  retomados_por_orcamento: number
}

const ESTADOS_DO_CICLO = ['aberto', 'em_andamento', 'aguardando_externo']
/** Estimativa de um passo do modelo (contexto grande + decisão curta), para a tranca de saldo. */
const TOKENS_MINIMOS = { entrada: 8_000, saida: 400 }

export async function cicloDeAgentes(): Promise<ResultadoCicloAgentes> {
  const acc: ResultadoCicloAgentes = {
    selecionados: 0,
    processados: 0,
    trancados: {},
    erros: 0,
    acoes: 0,
    custo_centavos: 0,
    retomados_por_orcamento: 0,
  }
  const cfg = await lerConfigAgentes()
  const modelo = modeloAnthropic()
  if (!modelo) {
    logger.warn('ANTHROPIC_API_KEY ausente: o ciclo dos agentes não roda.')
    return acc
  }

  acc.retomados_por_orcamento = await retomarPausadosPorOrcamento(cfg)

  const { data, error } = await supabaseAdmin
    .from('mandatos')
    .select('id')
    .in('estado', ESTADOS_DO_CICLO)
    .lte('proxima_acao_em', new Date().toISOString())
    .order('prioridade', { ascending: false })
    .order('proxima_acao_em', { ascending: true })
    .limit(cfg.geral.mandatos_por_ciclo)
  if (error) {
    logger.error({ erro: error.message }, 'Falha ao selecionar mandatos para o ciclo.')
    return acc
  }
  acc.selecionados = data?.length ?? 0
  if (!acc.selecionados) {
    await avisarOrcamento()
    return acc
  }

  const versaoVoz = await versaoAtualDaVoz()

  for (const { id } of data ?? []) {
    try {
      const r = await processarMandato(id, cfg, modelo, versaoVoz)
      if (r.tranca) acc.trancados[r.tranca] = (acc.trancados[r.tranca] ?? 0) + 1
      else acc.processados++
      acc.acoes += r.acoes
      acc.custo_centavos += r.custo
    } catch (erro) {
      acc.erros++
      logger.error({ mandato: id, erro: String(erro) }, 'Falha ao processar mandato.')
      await supabaseAdmin
        .from('mandatos')
        .update({
          ultimo_ciclo_erro: String(erro).slice(0, 500),
          ultimo_ciclo_em: new Date().toISOString(),
          // Recua 30 minutos: um erro que se repete a cada ciclo não pode ocupar a fila.
          proxima_acao_em: new Date(Date.now() + 30 * 60_000).toISOString(),
        })
        .eq('id', id)
    }
  }

  await avisarOrcamento()
  logger.info(acc, 'Ciclo dos agentes concluído.')
  return acc
}

async function processarMandato(
  mandatoId: string,
  cfg: ConfigAgentes,
  modelo: NonNullable<ReturnType<typeof modeloAnthropic>>,
  versaoVoz: VersaoVoz,
): Promise<{ tranca: string | null; acoes: number; custo: number }> {
  const agora = new Date()
  const m = await carregarMandato(mandatoId)
  if (!m || !ESTADOS_DO_CICLO.includes(m.estado)) return { tranca: 'estado', acoes: 0, custo: 0 }
  const agente = await carregarAgente(m.agente_id)
  if (!agente) return { tranca: 'sem_agente', acoes: 0, custo: 0 }
  const empresa = await carregarEmpresa(m.empresa_id)

  const [disjuntor, saldos, usadas, acoesHoje, alvo] = await Promise.all([
    supabaseAdmin.from('agentes_disjuntor').select('estado').eq('agente_id', agente.id).maybeSingle(),
    saldosDoCiclo({
      mandatoId: m.id,
      agenteId: agente.id,
      orcamentoMandato: m.orcamento_centavos,
      gastoMandato: m.gasto_centavos,
      tetoDiarioAgente: agente.limites.gasto_diario_centavos,
      tetoMensalPadrao: cfg.orcamento.teto_mensal_centavos,
    }),
    cotasUsadasHoje(agente.id),
    acoesDoMandatoHoje(m.id),
    supabaseAdmin.from('agentes_empresas_alvo').select('em_cobranca, suprimida').eq('empresa_id', m.empresa_id).maybeSingle(),
  ])

  const restantes = {
    ligacoes: Math.max(0, agente.limites.ligacoes_por_dia - usadas.ligacoes),
    mensagens: Math.max(0, agente.limites.mensagens_por_dia - usadas.mensagens),
    emails: Math.max(0, agente.limites.emails_por_dia - usadas.emails),
  }

  const veredito = aplicarTrancas({
    agora,
    killSwitch: cfg.geral.kill_switch,
    // Autonomia desligada, inativo ou pausado: o agente existe mas não age.
    agentePausado: !!agente.pausado_em || !agente.autonomo || !agente.ativo,
    disjuntor: (disjuntor.data?.estado as 'ok' | 'alerta' | 'aberto' | undefined) ?? 'ok',
    saldoGlobalCentavos: saldos.global,
    mandato: {
      gastoCentavos: m.gasto_centavos,
      orcamentoCentavos: m.orcamento_centavos,
      acoesExecutadas: m.acoes_executadas,
      maxAcoes: m.max_acoes,
      expiraEm: new Date(m.expira_em),
      acoesHoje,
    },
    acoesPorMandatoPorDia: agente.limites.acoes_por_mandato_por_dia,
    cotaDiariaRestante: restantes.ligacoes + restantes.mensagens + restantes.emails,
    empresaSuprimida: !!alvo.data?.suprimida,
    empresaEmCobranca: !!alvo.data?.em_cobranca || !!empresa?.bloqueio_cobranca,
    janela: cfg.janela,
    custoMinimoCicloCentavos: custoTokensCentavos(TOKENS_MINIMOS, cfg.precos),
  })

  if (!veredito.passa) {
    await aplicarVeredito(m, veredito)
    if (veredito.tranca === 'cota_diaria_agente') await avisarCota(agente.id, agente.nome)
    return { tranca: veredito.tranca, acoes: 0, custo: 0 }
  }

  /*
   * ── A ESCALAÇÃO QUE NÃO DEPENDE DO MODELO (§6, guardrails) ──────────────────
   * Reclamação, negociação de taxa, advogado, cobrança ou pedido EXPRESSO de uma pessoa na
   * última mensagem do cliente: escala sem chamar o modelo. É a mesma régua do agente de
   * conversa (`precisaEscalar`, sobre a triagem), aplicada ANTES do loop — não se gasta
   * token para descobrir que a conversa já é de gente, e não se arrisca o modelo decidir
   * responder mesmo assim.
   */
  const escalar = await escalacaoPendente(m)
  if (escalar) {
    const ctxEscala: ContextoExecucao = { mandato: m, agente, empresa, cfg, versaoVoz, agora }
    await executarFerramenta('escalar_humano', { motivo: escalar }, ctxEscala)
    await persistirAcao(
      m,
      agente.id,
      { passo: 0, ferramenta: 'escalar_humano', intencao: `Escalado antes do modelo: ${escalar}`, argumentos: { motivo: escalar }, ok: true, custoCentavos: 0, duracaoMs: 0, sinal: 'escalacao' },
      await proximaSequencia(m.id),
      randomUUID(),
    )
    await avaliarDisjuntorDoAgente(agente.id)
    return { tranca: 'escalacao_guardrail', acoes: 1, custo: 0 }
  }

  if (m.estado === 'aberto') {
    await supabaseAdmin.from('mandatos').update({ estado: 'em_andamento' }).eq('id', m.id)
    await evento(m, 'mandato.iniciado', `${agente.nome} começou a trabalhar: ${m.objetivo}`)
  }

  const playbook = await carregarPlaybook(m)
  const { disponiveis, ocultas } = ferramentasDisponiveis({
    permitidas: playbook?.acoes_permitidas ?? [],
    saldoCentavos: saldos.efetivo,
    precos: cfg.precos,
    cotas: restantes,
    versaoVoz,
    temCloser: !!(agente.closer_id || agente.closer_substituto_id),
    acoesDoDiaEsgotadas: acoesHoje >= agente.limites.acoes_por_mandato_por_dia,
  })

  const contexto = await montarContexto({
    mandato: m,
    agente,
    empresa,
    cfg,
    saldoCentavos: saldos.efetivo,
    cotasRestantes: restantes,
    ocultas,
    versaoVoz,
    agora,
    gatilho: await gatilhoDoCiclo(m),
  })

  const ctxExec: ContextoExecucao = { mandato: m, agente, empresa, cfg, versaoVoz, agora }
  const cicloId = randomUUID()
  let acaoAtual: string | null = null
  let disjuntorAbriu = false
  let sequencia = await proximaSequencia(m.id)

  const resultado = await executarCiclo({
    system: montarSystemPrompt({ persona: agente.persona, identificacao: cfg.geral.identificacao, tipo: m.tipo, playbook }),
    contexto,
    disponiveis,
    modelo,
    orcamento: portaOrcamento({ mandatoId: m.id, agenteId: agente.id, acaoAtual: () => acaoAtual }),
    precos: cfg.precos,
    saldoInicialCentavos: saldos.efetivo,
    maxPassos: cfg.geral.max_passos_por_ciclo,
    prazoMs: cfg.geral.tempo_limite_ciclo_s * 1000,
    executar: async (id: IdFerramenta, input: unknown) => {
      if (disjuntorAbriu) return { ok: false, erro: 'O disjuntor do agente abriu neste ciclo: nenhuma ação a mais.' }
      acaoAtual = null
      return executarFerramenta(id, input, ctxExec)
    },
    aoExecutar: async (a: AcaoDoCiclo) => {
      acaoAtual = await persistirAcao(m, agente.id, a, sequencia++, cicloId)
      if (a.sinal !== 'neutro') {
        const estado = await avaliarDisjuntorDoAgente(agente.id)
        if (estado === 'aberto') disjuntorAbriu = true
      }
    },
  })

  // O custo do MODELO deste ciclo vira uma linha própria: é a auditoria de quanto custou
  // decidir, separada de quanto custou agir. Tokens gravados SEMPRE (§6, passo 6).
  await supabaseAdmin.from('mandato_acoes').insert({
    mandato_id: m.id,
    agente_id: agente.id,
    empresa_id: m.empresa_id,
    sequencia: sequencia++,
    ferramenta: 'ciclo',
    intencao: resultado.erro ? `Ciclo terminou com erro: ${resultado.erro}` : `Ciclo de decisão (${resultado.passos} passos)`,
    resultado: { passos: resultado.passos, texto: resultado.textoFinal.slice(0, 1000), terminal: resultado.terminal } as never,
    sucesso: !resultado.erro,
    erro: resultado.erro ? `${resultado.erro}${resultado.erroDetalhe ? `: ${resultado.erroDetalhe}` : ''}`.slice(0, 500) : null,
    sinal: resultado.erro === 'modelo_falhou' ? 'falha_tecnica' : 'neutro',
    custo_centavos: resultado.custoTokensCentavos,
    tokens_entrada: resultado.tokens.entrada,
    tokens_saida: resultado.tokens.saida,
    ciclo_id: cicloId,
  })

  const externas = resultado.acoes.filter((a) => a.ok && !a.ferramenta.startsWith('consultar_') && a.ferramenta !== 'listar_materiais' && a.ferramenta !== 'atualizar_plano').length
  const atual = await carregarMandato(m.id)
  if (atual && ESTADOS_DO_CICLO.includes(atual.estado)) {
    const proxima = proximaAcao(atual, resultado.erro, cfg)
    await supabaseAdmin
      .from('mandatos')
      .update({
        acoes_executadas: atual.acoes_executadas + externas,
        ultima_acao_em: resultado.acoes.length ? new Date().toISOString() : atual.proxima_acao_em,
        ultimo_ciclo_em: new Date().toISOString(),
        ultimo_ciclo_erro: resultado.erro ? `${resultado.erro}${resultado.erroDetalhe ? `: ${resultado.erroDetalhe}` : ''}`.slice(0, 500) : null,
        proxima_acao_em: proxima.toISOString(),
      })
      .eq('id', m.id)
  } else if (atual) {
    await supabaseAdmin
      .from('mandatos')
      .update({ acoes_executadas: atual.acoes_executadas + externas, ultimo_ciclo_em: new Date().toISOString() })
      .eq('id', m.id)
  }
  if (resultado.planoAtualizado) await evento(m, 'mandato.plano_atualizado', atual?.plano?.objetivo_atual ?? 'Plano atualizado.')

  return {
    tranca: null,
    acoes: resultado.acoes.length,
    custo: resultado.custoTokensCentavos + resultado.custoFerramentasCentavos,
  }
}

/**
 * Quando o mandato acorda de novo: a primeira próxima ação do plano; nunca no passado e
 * nunca antes do próximo ciclo. Sem plano (erro), recua 30 minutos — um ciclo que falha não
 * pode ocupar a fila a cada 5 minutos.
 */
function proximaAcao(m: MandatoCarregado, erro: string | null, cfg: ConfigAgentes): Date {
  const minimo = Date.now() + cfg.geral.intervalo_ciclo_min * 60_000
  if (erro && erro !== 'tempo_esgotado') return new Date(Date.now() + 30 * 60_000)
  // `agendar_ligacao` pode ter marcado um horário: ele vale se vier antes do plano.
  const marcado = m.proxima_acao_em ? new Date(m.proxima_acao_em).getTime() : Number.NaN
  const doPlano = m.plano?.proximas_acoes?.[0]?.quando ? Date.parse(m.plano.proximas_acoes[0].quando) : Number.NaN
  const candidatos = [marcado, doPlano].filter((t) => Number.isFinite(t) && t > Date.now())
  const alvo = candidatos.length ? Math.min(...candidatos) : Date.now() + 24 * 3_600_000
  return new Date(Math.max(alvo, minimo))
}

async function aplicarVeredito(
  m: MandatoCarregado,
  v: Exclude<ReturnType<typeof aplicarTrancas>, { passa: true }>,
): Promise<void> {
  const rotulo = TRANCA_LABELS[v.tranca]
  switch (v.efeito) {
    case 'pular':
      return
    case 'reagendar':
      await supabaseAdmin.from('mandatos').update({ proxima_acao_em: v.quando.toISOString() }).eq('id', m.id)
      return
    case 'pausar':
      await supabaseAdmin.from('mandatos').update({ estado: 'pausado', pausado_motivo: v.motivo }).eq('id', m.id)
      await evento(m, 'mandato.pausado', rotulo)
      return
    case 'encerrar':
      await supabaseAdmin
        .from('mandatos')
        .update({
          estado: 'encerrado_sem_sucesso',
          motivo_encerramento: v.motivo,
          resultado: rotulo,
          encerrado_em: new Date().toISOString(),
          proxima_acao_em: null,
        })
        .eq('id', m.id)
      await evento(m, 'mandato.encerrado', rotulo)
  }
}

async function persistirAcao(m: MandatoCarregado, agenteId: string, a: AcaoDoCiclo, sequencia: number, cicloId: string): Promise<string | null> {
  const args = (a.argumentos ?? {}) as Record<string, unknown>
  const res = (a.resultado ?? {}) as Record<string, unknown>
  const { data, error } = await supabaseAdmin
    .from('mandato_acoes')
    .insert({
      mandato_id: m.id,
      agente_id: agenteId,
      empresa_id: m.empresa_id,
      sequencia,
      ferramenta: a.ferramenta,
      intencao: a.intencao,
      argumentos: a.argumentos as never,
      resultado: (a.resultado ?? null) as never,
      sucesso: a.ok,
      erro: a.erro?.slice(0, 500) ?? null,
      sinal: a.sinal,
      contato_id: typeof args.contato_id === 'string' ? args.contato_id : null,
      outbox_id: typeof res.outbox_id === 'string' ? res.outbox_id : null,
      voz_ligacao_id: typeof res.voz_ligacao_id === 'string' ? res.voz_ligacao_id : null,
      custo_centavos: a.custoCentavos,
      duracao_ms: a.duracaoMs,
      ciclo_id: cicloId,
    })
    .select('id')
    .maybeSingle()
  if (error) {
    logger.error({ erro: error.message, mandato: m.id, ferramenta: a.ferramenta }, 'Falha ao gravar a ação do agente.')
    return null
  }
  if (data && typeof res.outbox_id === 'string') {
    await supabaseAdmin.from('mensagens_outbox').update({ mandato_acao_id: data.id }).eq('id', res.outbox_id)
  }
  return data?.id ?? null
}

async function proximaSequencia(mandatoId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    'select coalesce(max(sequencia), 0) + 1 as n from mandato_acoes where mandato_id = $1',
    [mandatoId],
  )
  return rows[0]?.n ?? 1
}

/** A mensagem recebida DEPOIS do último ciclo que exige uma pessoa, e o motivo. */
async function escalacaoPendente(m: MandatoCarregado): Promise<string | null> {
  const { data: ultimo } = await supabaseAdmin.from('mandatos').select('ultimo_ciclo_em').eq('id', m.id).maybeSingle()
  const { data: conversas } = await supabaseAdmin.from('mandato_conversas').select('conversa_id').eq('mandato_id', m.id)
  const ids = (conversas ?? []).map((c) => c.conversa_id)
  if (!ids.length) return null
  let q = supabaseAdmin
    .from('comunicacoes')
    .select('corpo, triagem, criado_em')
    .in('conversa_id', ids)
    .eq('direcao', 'entrada')
    .order('criado_em', { ascending: false })
    .limit(3)
  if (ultimo?.ultimo_ciclo_em) q = q.gt('criado_em', ultimo.ultimo_ciclo_em)
  const { data } = await q
  for (const msg of data ?? []) {
    // Sem triagem ainda (a triagem roda de 5 em 5 min): a palavra-chave no corpo já basta.
    const triagem = (msg.triagem as Triagem | null) ?? ({ intencao: 'outro', sentimento: 'neutro', urgencia: 'baixa', pedido_de_humano: false } as unknown as Triagem)
    const r = precisaEscalar(triagem, msg.corpo)
    if (r.escalar) return r.motivo ?? 'A conversa precisa de uma pessoa.'
  }
  return null
}

/** O que acordou este ciclo — o modelo precisa saber o que mudou desde a última vez. */
async function gatilhoDoCiclo(m: MandatoCarregado): Promise<string> {
  const { data: ultimo } = await supabaseAdmin.from('mandatos').select('ultimo_ciclo_em').eq('id', m.id).maybeSingle()
  const desde = ultimo?.ultimo_ciclo_em
  if (!desde) return 'mandato novo — primeiro ciclo'
  const { data: conversas } = await supabaseAdmin.from('mandato_conversas').select('conversa_id').eq('mandato_id', m.id)
  const ids = (conversas ?? []).map((c) => c.conversa_id)
  if (ids.length) {
    const { count } = await supabaseAdmin
      .from('comunicacoes')
      .select('id', { count: 'exact', head: true })
      .in('conversa_id', ids)
      .eq('direcao', 'entrada')
      .gt('criado_em', desde)
    if (count) return `${count} mensagem(ns) nova(s) do cliente desde o último ciclo`
  }
  const { count: ligacoes } = await supabaseAdmin
    .from('voz_ligacoes')
    .select('id', { count: 'exact', head: true })
    .eq('mandato_id', m.id)
    .gt('encerrada_em', desde)
  if (ligacoes) return 'uma ligação terminou (ou foi recusada) desde o último ciclo'
  return 'horário planejado no plano'
}

async function evento(m: MandatoCarregado, tipo: string, resumo: string): Promise<void> {
  await supabaseAdmin.from('empresa_eventos').insert({
    empresa_id: m.empresa_id,
    tipo,
    payload: { resumo, mandato_id: m.id, codigo: m.codigo, url: `/agentes/mandatos?m=${m.id}` } as never,
  })
}

async function avisarCota(agenteId: string, nome: string): Promise<void> {
  await supabaseAdmin.from('empresa_eventos').insert({
    empresa_id: null,
    tipo: 'agente.cota_atingida',
    payload: { titulo: `${nome} atingiu a cota do dia`, resumo: 'Os mandatos dele voltam amanhã, na abertura da janela.', agente_id: agenteId, url: '/agentes' } as never,
  })
}

/** §8: orçamento novo no mês seguinte (ou teto que subiu) retoma o que o global pausou. */
async function retomarPausadosPorOrcamento(cfg: ConfigAgentes): Promise<number> {
  const { rows } = await pool.query<{ saldo: number }>(
    `select coalesce(o.teto_centavos, $1) - coalesce(o.consumido_centavos, 0) - coalesce(o.reservado_centavos, 0) as saldo
       from (select 1) um left join agentes_orcamento o on o.mes = app__agentes_mes_atual()`,
    [cfg.orcamento.teto_mensal_centavos],
  )
  if ((rows[0]?.saldo ?? 0) < custoTokensCentavos(TOKENS_MINIMOS, cfg.precos)) return 0
  const { rowCount } = await pool.query(
    `update mandatos set estado = 'em_andamento', pausado_motivo = null, proxima_acao_em = now()
      where estado = 'pausado' and pausado_motivo = 'orcamento_esgotado' and gasto_centavos < orcamento_centavos`,
  )
  return rowCount ?? 0
}

/** Alertas de 50/80/95% e o aviso de esgotado (§8), uma vez cada por mês. */
async function avisarOrcamento(): Promise<void> {
  const { data } = await supabaseAdmin.rpc('app__agentes_alertas_orcamento')
  for (const pct of (data as number[] | null) ?? []) {
    await supabaseAdmin.from('empresa_eventos').insert({
      empresa_id: null,
      tipo: pct >= 100 ? 'agentes.orcamento_esgotado' : 'agentes.orcamento_alerta',
      payload: {
        titulo: pct >= 100 ? 'Orçamento dos agentes esgotado' : `Agentes consumiram ${pct}% do orçamento do mês`,
        resumo:
          pct >= 100
            ? 'Ferramentas pagas pararam. Os mandatos seguem pausados até o mês seguinte ou até o teto subir.'
            : 'Acompanhe em Agentes › Ao vivo.',
        url: '/agentes',
        pct,
      } as never,
    })
  }
}

/** A versão da Ana vista na última hora; mais velha que isso, pergunta de novo. */
async function versaoAtualDaVoz(): Promise<VersaoVoz> {
  const { data } = await supabaseAdmin.from('agentes_config').select('valor').eq('chave', 'voz_status').maybeSingle()
  const v = data?.valor as { versao?: VersaoVoz; detectada_em?: string } | null
  if (v?.versao && v.detectada_em && Date.now() - Date.parse(v.detectada_em) < 3_600_000) return v.versao
  const conexao = configDaVoz()
  if (!conexao) return 'desconhecida'
  const versao = await versaoDaAna(conexao)
  await supabaseAdmin.from('agentes_config').upsert({ chave: 'voz_status', valor: { versao, detectada_em: new Date().toISOString() } as never })
  return versao
}
