import {
  perguntarComQueda,
  type Classificador,
  type ResultadoComQueda,
} from '../../../../packages/core/src/analise/classificador.js'
import { estadoDaJanela, estadoDaLigacao } from '../../../../packages/core/src/analise/estado.js'
import { limitarEstado, type RevisaoClaude } from '../../../../packages/core/src/analise/revisao.js'
import {
  aplicarRevisao,
  decidirItens,
  perguntasDaRubrica,
  type DecisaoItem,
  type ItemRubrica,
} from '../../../../packages/core/src/analise/rubrica.js'
import {
  TIPO_PENDENCIA_LABELS,
  custoClaudeCentavos,
  custoJevCentavos,
  tipoInteracaoDoEscopo,
  type ConfigQualidade,
  type EscopoAnalise,
  type StatusCalibracao,
  type TipoInteracao,
  type TipoPendencia,
  type TipoResposta,
} from '../../../../packages/core/src/analise/tipos.js'
import { supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'
import { carregarConfigQualidade, segredoQualidade } from './config.js'
import {
  claudeDisponivel,
  classificadorClaude,
  classificadorJev,
  contadorVazio,
  revisarComClaude,
  type Contador,
} from './modelos.js'

/**
 * O MOTOR DE ANÁLISE (05C §4) — uma interação por vez, da fila.
 *
 *   texto da interação → Jev (aplicabilidade + itens, UM pedido) → decisão por item
 *   → Claude só nos reprovados e na banda cinzenta → nota (aritmética, no banco)
 *   → pendências (só publicada) → write-back cadastral (só reunião)
 *
 * A interação sem texto (reunião sem transcrição, ligação sem turnos, janela vazia) é
 * PULADA com motivo, não analisada com zero: "sem avaliação" nunca vira nota baixa.
 */

export interface AlvoInteracao {
  escopo: EscopoAnalise
  reuniao_id?: string | null
  voz_ligacao_id?: string | null
  conversa_id?: string | null
  janela_inicio?: string | null
  janela_fim?: string | null
  janela_mensagens?: number | null
}

export interface Interacao extends AlvoInteracao {
  estado: string
  empresa_id: string | null
  contato_id: string | null
  vendedor_id: string | null
  agente_id: string | null
  /** AAAA-MM-DD de quando a conversa aconteceu, para o Claude datar compromissos. */
  data_referencia: string
  /** Reunião: o que o Fireflies deu, para o resumo e o write-back. */
  reuniao?: {
    resumo: string | null
    participantes: Array<{ nome: string | null; email: string | null; falou: boolean }>
  }
}

type Montagem = { ok: true; interacao: Interacao } | { ok: false; motivo: string }

const dia = (s: string | null | undefined) => (s ? new Date(s) : new Date()).toISOString().slice(0, 10)

/** O texto e as pontas de uma interação. Usado pela análise e pela recalibração. */
export async function montarInteracao(alvo: AlvoInteracao): Promise<Montagem> {
  if (alvo.escopo === 'reuniao') {
    const { data: r } = await supabaseAdmin
      .from('reunioes')
      .select('id, empresa_id, contato_id, vendedor_id, agente_id, transcricao, resumo, participantes_detectados, transcricao_recebida_em, captura_status')
      .eq('id', alvo.reuniao_id!)
      .maybeSingle()
    if (!r) return { ok: false, motivo: 'reunião não encontrada' }
    if (r.captura_status === 'dispensada') return { ok: false, motivo: 'reunião marcada para não gravar' }
    if (!r.transcricao?.trim()) return { ok: false, motivo: 'reunião sem transcrição' }
    return {
      ok: true,
      interacao: {
        ...alvo,
        estado: r.transcricao,
        empresa_id: r.empresa_id,
        contato_id: r.contato_id,
        vendedor_id: r.vendedor_id,
        agente_id: r.agente_id,
        data_referencia: dia(r.transcricao_recebida_em),
        reuniao: {
          resumo: r.resumo,
          participantes: Array.isArray(r.participantes_detectados)
            ? (r.participantes_detectados as Array<{ nome: string | null; email: string | null; falou: boolean }>)
            : [],
        },
      },
    }
  }

  if (alvo.escopo === 'ligacao') {
    const { data: l } = await supabaseAdmin
      .from('voz_ligacoes')
      .select('id, empresa_id, contato_id, mandato_id, transcricao, iniciada_em, enviada_em')
      .eq('id', alvo.voz_ligacao_id!)
      .maybeSingle()
    if (!l) return { ok: false, motivo: 'ligação não encontrada' }
    const estado = estadoDaLigacao(l.transcricao)
    if (!estado.trim()) return { ok: false, motivo: 'ligação sem transcrição' }
    let agente: string | null = null
    if (l.mandato_id) {
      const { data: m } = await supabaseAdmin.from('mandatos').select('agente_id').eq('id', l.mandato_id).maybeSingle()
      agente = m?.agente_id ?? null
    }
    return {
      ok: true,
      interacao: {
        ...alvo,
        estado,
        empresa_id: l.empresa_id,
        contato_id: l.contato_id,
        // Quem fala na ligação é a Ana. Com mandato, ela fala pelo agente — é ele o julgado;
        // sem mandato, a análise é só da gestão.
        vendedor_id: agente,
        agente_id: agente,
        data_referencia: dia(l.iniciada_em ?? l.enviada_em),
      },
    }
  }

  const { data: c } = await supabaseAdmin
    .from('conversas')
    .select('id, empresa_id, contato_id, responsavel_vendedor_id, contatos(nome)')
    .eq('id', alvo.conversa_id!)
    .maybeSingle()
  if (!c) return { ok: false, motivo: 'conversa não encontrada' }
  let q = supabaseAdmin
    .from('comunicacoes')
    .select('direcao, canal, corpo, assunto, criado_em, por_ia, vendedor_id')
    .eq('conversa_id', c.id)
    .in('canal', ['whatsapp', 'email'])
    .lte('criado_em', alvo.janela_fim!)
    .order('criado_em')
    .limit(400)
  if (alvo.janela_inicio) q = q.gt('criado_em', alvo.janela_inicio)
  const { data: msgs } = await q
  const vendedores = new Map<string, string>()
  const ids = [...new Set((msgs ?? []).map((m) => m.vendedor_id).filter((x): x is string => !!x))]
  if (ids.length) {
    const { data: vs } = await supabaseAdmin.from('vendedores').select('id, nome').in('id', ids)
    for (const v of vs ?? []) vendedores.set(v.id, v.nome)
  }
  const estado = estadoDaJanela(
    (msgs ?? []).map((m) => ({
      direcao: m.direcao as 'entrada' | 'saida',
      canal: m.canal,
      corpo: m.corpo,
      assunto: m.assunto,
      criado_em: m.criado_em,
      por_ia: m.por_ia,
      autor: m.vendedor_id ? (vendedores.get(m.vendedor_id) ?? null) : null,
    })),
    (c.contatos as unknown as { nome: string | null } | null)?.nome ?? null,
  )
  if (!estado.trim()) return { ok: false, motivo: 'janela sem mensagens com texto' }

  let agente: string | null = null
  if (c.responsavel_vendedor_id) {
    const { data: v } = await supabaseAdmin.from('vendedores').select('is_ia').eq('id', c.responsavel_vendedor_id).maybeSingle()
    if (v?.is_ia) agente = c.responsavel_vendedor_id
  }
  return {
    ok: true,
    interacao: {
      ...alvo,
      estado,
      empresa_id: c.empresa_id,
      contato_id: c.contato_id,
      vendedor_id: c.responsavel_vendedor_id,
      agente_id: agente,
      data_referencia: dia(alvo.janela_fim),
    },
  }
}

// ─── A rubrica ativa ────────────────────────────────────────────────────────

export interface RubricaCarregada {
  id: string
  versao: number
  tipo_interacao: TipoInteracao
  calibrada_em: string | null
  recalibrar_pedido_em: string | null
  itens: ItemRubrica[]
}

interface LinhaItem {
  id: string
  chave: string
  etapa: string | null
  ordem: number
  rotulo: string
  pergunta: string
  tipo_resposta: string
  opcoes: unknown
  peso: number
  condicao_aplicabilidade: string | null
  limiar: number | null
  orientacao: string
  atende: string[] | null
  status_calibracao: string
  gera_pendencia: string | null
}

export function paraItemRubrica(l: LinhaItem): ItemRubrica {
  return {
    id: l.id,
    chave: l.chave,
    etapa: l.etapa,
    ordem: l.ordem,
    rotulo: l.rotulo,
    pergunta: l.pergunta,
    tipo_resposta: l.tipo_resposta as TipoResposta,
    opcoes: Array.isArray(l.opcoes) ? (l.opcoes as string[]) : null,
    peso: Number(l.peso),
    condicao_aplicabilidade: l.condicao_aplicabilidade,
    limiar: l.limiar === null ? null : Number(l.limiar),
    orientacao: l.orientacao,
    atende: l.atende,
    status_calibracao: l.status_calibracao as StatusCalibracao,
    gera_pendencia: (l.gera_pendencia as TipoPendencia | null) ?? null,
  }
}

export async function carregarRubrica(filtro: { tipo?: TipoInteracao; id?: string }): Promise<RubricaCarregada | null> {
  let q = supabaseAdmin.from('rubricas').select('id, versao, tipo_interacao, calibrada_em, recalibrar_pedido_em')
  q = filtro.id ? q.eq('id', filtro.id) : q.eq('tipo_interacao', filtro.tipo!).eq('ativa', true)
  const { data: r } = await q.maybeSingle()
  if (!r) return null
  const { data: itens } = await supabaseAdmin
    .from('rubrica_itens')
    .select('id, chave, etapa, ordem, rotulo, pergunta, tipo_resposta, opcoes, peso, condicao_aplicabilidade, limiar, orientacao, atende, status_calibracao, gera_pendencia')
    .eq('rubrica_id', r.id)
    .eq('ativo', true)
    .order('ordem')
  return {
    id: r.id,
    versao: r.versao,
    tipo_interacao: r.tipo_interacao as TipoInteracao,
    calibrada_em: r.calibrada_em,
    recalibrar_pedido_em: r.recalibrar_pedido_em,
    itens: (itens ?? []).map((i) => paraItemRubrica(i as LinhaItem)),
  }
}

// ─── Os classificadores ─────────────────────────────────────────────────────

export interface Bracos {
  primario: Classificador
  reserva: Classificador | null
  jev: Contador
  claude: Contador
}

/**
 * O braço padrão é o das settings. Sem chave do Jev, o Claude assume como primário —
 * e sem nenhum dos dois não há análise (a fila espera alguém configurar).
 */
export async function montarBracos(cfg: ConfigQualidade): Promise<Bracos> {
  const jev = contadorVazio()
  const claude = contadorVazio()
  const chaveJev = await segredoQualidade('jev_api_key')
  const cJev = chaveJev ? classificadorJev(chaveJev, jev) : null
  const cClaude = claudeDisponivel() ? classificadorClaude(claude) : null
  const ordem = cfg.classificacao.provedor === 'claude' ? [cClaude, cJev] : [cJev, cClaude]
  const [primario, reserva] = ordem.filter((c): c is Classificador => !!c)
  if (!primario) throw new Error('Nenhum classificador configurado: cadastre a chave do Jev ou a ANTHROPIC_API_KEY.')
  return { primario, reserva: reserva ?? null, jev, claude }
}

/** As perguntas da rubrica a um classificador, já decididas item a item. */
export async function classificar(
  estado: string,
  itens: readonly ItemRubrica[],
  cfg: ConfigQualidade,
  bracos: Bracos,
): Promise<{ decisoes: DecisaoItem[]; queda: ResultadoComQueda }> {
  const queda = await perguntarComQueda({
    primario: bracos.primario,
    reserva: bracos.reserva,
    estado: limitarEstado(estado, cfg.classificacao.max_caracteres_estado),
    perguntas: perguntasDaRubrica(itens),
  })
  const decisoes = decidirItens(itens, queda.respostas, {
    delta: cfg.classificacao.delta,
    limiarAplicabilidade: cfg.classificacao.limiar_aplicabilidade,
    limiarPadrao: cfg.classificacao.limiar_padrao,
  })
  return { decisoes, queda }
}

// ─── A análise de uma interação ─────────────────────────────────────────────

export interface LinhaFila extends AlvoInteracao {
  id: string
  tentativas: number
}

export type ResultadoAnalise =
  | { status: 'concluida'; analise_id: string | null; modo: string }
  | { status: 'pulada'; motivo: string }

const PRAZO_FIM_DO_DIA = 'T23:59:00-03:00'

export async function analisarInteracao(fila: LinhaFila, cfg: ConfigQualidade): Promise<ResultadoAnalise> {
  const m = await montarInteracao(fila)
  if (!m.ok) return { status: 'pulada', motivo: m.motivo }
  const it = m.interacao

  if (it.vendedor_id) {
    const { data: pessoa } = await supabaseAdmin
      .from('qualidade_pessoas')
      .select('analise_ativa, captura_ativa')
      .eq('vendedor_id', it.vendedor_id)
      .maybeSingle()
    if (pessoa && !pessoa.analise_ativa) return { status: 'pulada', motivo: 'análise desligada para esta pessoa' }
  }

  const rubrica = await carregarRubrica({ tipo: tipoInteracaoDoEscopo(fila.escopo) })
  if (!rubrica || rubrica.itens.length === 0) return { status: 'pulada', motivo: 'sem rubrica ativa com itens' }

  const bracos = await montarBracos(cfg)
  const { decisoes, queda } = await classificar(it.estado, rubrica.itens, cfg, bracos)

  // A probabilidade do CLASSIFICADOR, antes do Claude: é ela que a calibração ajusta.
  const doClassificador = new Map(decisoes.map((d) => [d.chave, d]))

  // ─── A revisão: só a minoria que precisa ────────────────────────────────
  const porChave = new Map(rubrica.itens.map((i) => [i.chave, i]))
  const aRevisar = decisoes.filter((d) => d.precisa_revisao && d.aplicavel && d.atendido !== null)
  const pedirResumo = fila.escopo === 'reuniao' && !it.reuniao?.resumo
  let revisao: RevisaoClaude | null = null
  if ((aRevisar.length > 0 || pedirResumo) && claudeDisponivel()) {
    try {
      revisao = await revisarComClaude(
        {
          estado: limitarEstado(it.estado, cfg.classificacao.max_caracteres_estado),
          itens: aRevisar.map((d) => ({ item: porChave.get(d.chave)!, decisao: d })),
          pedirResumo,
          pedirContatos: fila.escopo === 'reuniao',
          pedirCompromissos: true,
          dataReferencia: it.data_referencia,
          contatosConhecidos: (it.reuniao?.participantes ?? []).map((p) => ({ nome: p.nome, email: p.email })),
        },
        bracos.claude,
      )
    } catch (erro) {
      // A revisão é o segundo juiz: sem ela, item reprovado não reprova. Tenta de novo
      // antes de aceitar a análise com itens pendentes de revisão.
      if (fila.tentativas < 2) throw erro
      logger.warn({ fila: fila.id, erro: String(erro) }, 'Revisão do Claude falhou de novo; itens ficam pendentes.')
    }
  }
  const finais = aplicarRevisao(decisoes, aRevisar.length ? (revisao?.itens ?? null) : [])

  const modo = rubrica.calibrada_em ? 'publicado' : 'sombra'
  const pendencias = [
    ...finais
      .filter((d) => d.atendido === false && !d.em_sombra && porChave.get(d.chave)?.gera_pendencia)
      .map((d) => {
        const tipo = porChave.get(d.chave)!.gera_pendencia!
        return {
          chave: d.chave,
          tipo,
          descricao: d.citacao
            ? `${TIPO_PENDENCIA_LABELS[tipo]}: ${d.citacao}`
            : (d.orientacao ?? porChave.get(d.chave)!.orientacao),
          citacao: d.citacao,
        }
      }),
    ...(revisao?.compromissos ?? []).map((c) => ({
      chave: null,
      tipo: 'proximo_passo' as const,
      descricao: c.descricao,
      citacao: c.citacao,
      prazo_em: c.prazo ? `${c.prazo}${PRAZO_FIM_DO_DIA}` : null,
    })),
  ]

  const custoJev = custoJevCentavos(bracos.jev.entrada, cfg.precos)
  const custoClaude = custoClaudeCentavos(bracos.claude, cfg.precos)
  const soClaude = queda.respostas.length > 0 && queda.respostas.every((r) => r.provedor === 'claude')

  const { data: analiseId, error } = await supabaseAdmin.rpc('app__qualidade_gravar_analise', {
    p: {
      fila_id: fila.id,
      escopo: fila.escopo,
      reuniao_id: fila.reuniao_id ?? null,
      voz_ligacao_id: fila.voz_ligacao_id ?? null,
      conversa_id: fila.conversa_id ?? null,
      janela_inicio: fila.janela_inicio ?? null,
      janela_fim: fila.janela_fim ?? null,
      janela_mensagens: fila.janela_mensagens ?? null,
      empresa_id: it.empresa_id,
      contato_id: it.contato_id,
      vendedor_id: it.vendedor_id,
      agente_id: it.agente_id,
      rubrica_id: rubrica.id,
      rubrica_versao: rubrica.versao,
      modo,
      provedor: soClaude ? 'claude' : bracos.primario.provedor,
      custo_jev_centavos: custoJev,
      custo_claude_centavos: custoClaude,
      tokens_entrada: bracos.jev.entrada + bracos.claude.entrada,
      tokens_saida: bracos.claude.saida,
      caiu_para_claude: queda.caiu,
      itens: finais.map((d) => {
        const item = porChave.get(d.chave)!
        const crua = doClassificador.get(d.chave)
        return {
          chave: d.chave,
          peso: item.peso,
          aplicavel: d.aplicavel,
          aplicabilidade_prob: d.aplicabilidade_prob,
          resultado: d.resultado,
          probabilidade: d.probabilidade,
          prob_atendido: d.prob_atendido,
          limiar_usado: d.limiar_usado,
          atendido: d.atendido,
          banda_cinzenta: d.banda_cinzenta,
          em_sombra: d.em_sombra,
          divergente: d.divergente,
          atendido_original: d.atendido_original,
          revisao_pendente: d.revisao_pendente,
          citacao: d.citacao,
          orientacao: d.orientacao,
          provedor: d.provedor,
          prob_atendido_classificador: crua?.prob_atendido ?? null,
          provedor_classificador: crua?.provedor ?? null,
        }
      }),
      pendencias,
    } as never,
  })
  if (error) throw new Error(error.message)

  if (fila.escopo === 'reuniao' && fila.reuniao_id) {
    await depoisDaReuniao(fila.reuniao_id, (analiseId as string | null) ?? null, it, revisao)
  }
  return { status: 'concluida', analise_id: (analiseId as string | null) ?? null, modo }
}

/**
 * O que a reunião devolve ao cadastro (§11): o resumo, quando o Fireflies não deu um, e os
 * contatos. Os participantes vêm do Fireflies com e-mail (de graça); o Claude completa
 * cargo e telefone quando a revisão já ia acontecer. O banco decide o que é aditivo e o
 * que vira sugestão.
 */
async function depoisDaReuniao(reuniaoId: string, analiseId: string | null, it: Interacao, revisao: RevisaoClaude | null) {
  if (revisao?.resumo && !it.reuniao?.resumo) {
    await supabaseAdmin.from('reunioes').update({ resumo: revisao.resumo, resumo_origem: 'claude' }).eq('id', reuniaoId).is('resumo', null)
  }
  if (!it.empresa_id) return

  const contatos = new Map<string, { nome: string; email: string | null; cargo: string | null; telefone: string | null }>()
  for (const p of it.reuniao?.participantes ?? []) {
    if (!p.nome || !p.email) continue
    contatos.set(p.email, { nome: p.nome, email: p.email, cargo: null, telefone: null })
  }
  for (const c of revisao?.contatos ?? []) {
    const chave = c.email ?? [...contatos.values()].find((x) => x.nome.toLowerCase() === c.nome.toLowerCase())?.email ?? c.nome
    const atual = contatos.get(chave)
    contatos.set(chave, {
      nome: atual?.nome ?? c.nome,
      email: atual?.email ?? c.email,
      cargo: c.cargo ?? atual?.cargo ?? null,
      telefone: c.telefone ?? atual?.telefone ?? null,
    })
  }
  if (contatos.size === 0) return
  const { data, error } = await supabaseAdmin.rpc('app__qualidade_writeback', {
    p: { empresa_id: it.empresa_id, analise_id: analiseId, reuniao_id: reuniaoId, escopo: 'reuniao', contatos: [...contatos.values()] } as never,
  })
  if (error) logger.error({ reuniaoId, erro: error.message }, 'Write-back cadastral falhou.')
  else logger.info({ reuniaoId, ...(data as object) }, 'Write-back cadastral da reunião.')
}

// ─── A fila ─────────────────────────────────────────────────────────────────

export interface ResultadoProcessar {
  concluidas: number
  publicadas: number
  puladas: number
  falhas: number
}

/** Quanto esperar antes da próxima tentativa: 5, 10, 20, 40 min. */
const espera = (tentativas: number) => 5 * 60_000 * 2 ** Math.max(0, tentativas - 1)

export async function processarFila(limite = 15): Promise<ResultadoProcessar> {
  const res: ResultadoProcessar = { concluidas: 0, publicadas: 0, puladas: 0, falhas: 0 }
  const agora = new Date()

  // Linha presa em `processando` (worker reiniciou no meio) volta para a fila.
  await supabaseAdmin.from('analise_fila').update({ status: 'pendente' }).eq('status', 'processando').lt('tentar_apos', agora.toISOString())

  const { data: pendentes } = await supabaseAdmin
    .from('analise_fila')
    .select('id, escopo, reuniao_id, voz_ligacao_id, conversa_id, janela_inicio, janela_fim, janela_mensagens, tentativas')
    .eq('status', 'pendente')
    .lte('tentar_apos', agora.toISOString())
    .order('criada_em')
    .limit(limite)
  if (!pendentes?.length) return res

  const cfg = await carregarConfigQualidade()
  for (const p of pendentes) {
    // Reserva otimista: só processa quem conseguiu virar a linha para `processando`.
    const { data: reservada } = await supabaseAdmin
      .from('analise_fila')
      .update({ status: 'processando', tentar_apos: new Date(Date.now() + 30 * 60_000).toISOString() })
      .eq('id', p.id)
      .eq('status', 'pendente')
      .select('id')
    if (!reservada?.length) continue

    const linha = { ...p, escopo: p.escopo as EscopoAnalise } as LinhaFila
    try {
      const r = await analisarInteracao(linha, cfg)
      if (r.status === 'pulada') {
        await supabaseAdmin.from('analise_fila').update({ status: 'pulada', erro: r.motivo, processada_em: new Date().toISOString() }).eq('id', p.id)
        res.puladas++
      } else {
        res.concluidas++
        if (r.modo === 'publicado') res.publicadas++
      }
    } catch (erro) {
      const msg = erro instanceof Error ? erro.message : String(erro)
      const tentativas = p.tentativas + 1
      await supabaseAdmin
        .from('analise_fila')
        .update({
          status: tentativas >= 5 ? 'falhou' : 'pendente',
          tentativas,
          erro: msg.slice(0, 1000),
          tentar_apos: new Date(Date.now() + espera(tentativas)).toISOString(),
        })
        .eq('id', p.id)
      logger.warn({ fila: p.id, escopo: p.escopo, tentativas, erro: msg }, 'Análise falhou.')
      res.falhas++
    }
  }
  logger.info(res, 'Fila de análise processada.')
  return res
}
