import {
  PROMPT_AGENTE,
  aplicarGuardrails,
  decisaoAgenteSchema,
  proximoPassoDaCadencia,
  validarDecisao,
  type AcaoAgente,
  type ConfigComunicacao,
  type DecisaoAgente,
  type Playbook,
  type Triagem,
} from '../../../../../packages/core/src/comunicacao/index.js'
import { AI_MODEL, EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { notify } from '../../../../../packages/core/src/server/notify.js'
import { lerConfigComunicacao } from '../../comunicacao/config.js'
import { supabaseAdmin } from '../../db.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { requisitarJson } from '../../net/http.js'
import { emitirEvento } from '../../radar/eventos.js'

/**
 * O AGENTE DE PRÓXIMO PASSO (§7). Um decisor, não um chatbot.
 *
 * Acorda por EVENTO — resposta recebida, silêncio de N dias, no-show, NF nova em
 * faixa, certificado vencendo, lead distribuído — e responde a uma pergunta:
 * qual é o próximo passo desta relação?
 *
 * ─── A ORDEM É: GUARDRAIL → MODELO → VALIDAÇÃO → EXECUÇÃO ───────────────────
 * O guardrail roda ANTES do modelo porque não faz sentido gastar token numa
 * conversa que já é de humano. A validação roda DEPOIS porque o modelo pode
 * escolher fora do playbook, e uma ação fora do contrato não é um erro a
 * corrigir: é uma decisão a descartar.
 *
 * ─── NUNCA FICAR SEM PRÓXIMO PASSO ──────────────────────────────────────────
 * Falha do modelo, confiança baixa ou decisão inválida caem na cadência fixa do
 * playbook (§7.6). O ponto não é a cadência ser boa — é que uma conversa sem
 * próximo passo simplesmente some, e a única coisa pior que um follow-up
 * medíocre é nenhum.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

export type Gatilho =
  | 'resposta_recebida'
  | 'silencio'
  | 'no_show'
  | 'nf_em_faixa'
  | 'credito_decidido'
  | 'certificado_vencendo'
  | 'lead_distribuido'
  | 'agendado'

export interface ResultadoAgente {
  conversas: number
  decisoes: number
  executadas: number
  sugeridas: number
  fallback: number
  escalacoes: number
  puladas: number
}

interface ConversaParaDecidir {
  id: string
  canal: string
  empresa_id: string | null
  contato_id: string | null
  objetivo: string | null
  playbook_id: string | null
  responsavel_vendedor_id: string | null
  modo_agente: string
  status: string
  ultima_mensagem_em: string | null
  ultima_direcao: string | null
  proxima_acao_em: string | null
}

const COLUNAS =
  'id, canal, empresa_id, contato_id, objetivo, playbook_id, responsavel_vendedor_id, modo_agente, status, ultima_mensagem_em, ultima_direcao, proxima_acao_em'

/**
 * A varredura por SILÊNCIO e por agendamento. É o que roda de hora em hora.
 *
 * Conversas encerradas e pausadas ficam de fora: encerrada é opt-out ou desfecho,
 * e insistir nelas é exatamente o que a supressão existe para impedir.
 */
export async function decidirProximosPassos(limite = 50): Promise<ResultadoAgente> {
  const cfg = await lerConfigComunicacao(true)
  const agora = new Date()

  const acc: ResultadoAgente = {
    conversas: 0,
    decisoes: 0,
    executadas: 0,
    sugeridas: 0,
    fallback: 0,
    escalacoes: 0,
    puladas: 0,
  }

  const { data, error } = await supabaseAdmin
    .from('conversas')
    .select(COLUNAS)
    .in('status', ['ativa', 'aguardando_resposta'])
    .neq('modo_agente', 'desligado')
    .or(`proxima_acao_em.is.null,proxima_acao_em.lte.${agora.toISOString()}`)
    .order('ultima_mensagem_em', { ascending: true, nullsFirst: true })
    .limit(limite)
  if (error) {
    logger.error({ erro: error.message }, 'Falha ao listar conversas para o agente.')
    return acc
  }

  const conversas = (data ?? []) as ConversaParaDecidir[]
  acc.conversas = conversas.length

  for (const c of conversas) {
    try {
      const gatilho: Gatilho =
        c.ultima_direcao === 'entrada'
          ? 'resposta_recebida'
          : c.proxima_acao_em
            ? 'agendado'
            : 'silencio'
      const r = await decidirParaConversa(c, gatilho, cfg, agora)
      acc.decisoes += r.decidiu ? 1 : 0
      acc.executadas += r.executou ? 1 : 0
      acc.sugeridas += r.sugeriu ? 1 : 0
      acc.fallback += r.fallback ? 1 : 0
      acc.escalacoes += r.escalou ? 1 : 0
      acc.puladas += r.pulou ? 1 : 0
    } catch (erro) {
      logger.error({ conversa: c.id, erro: String(erro) }, 'Falha ao decidir próximo passo.')
      acc.puladas += 1
    }
  }

  logger.info(acc, 'Agente de próximo passo concluído.')
  return acc
}

interface DesfechoDecisao {
  decidiu: boolean
  executou: boolean
  sugeriu: boolean
  fallback: boolean
  escalou: boolean
  pulou: boolean
}

const NADA: DesfechoDecisao = {
  decidiu: false,
  executou: false,
  sugeriu: false,
  fallback: false,
  escalou: false,
  pulou: true,
}

export async function decidirParaConversa(
  conversa: ConversaParaDecidir,
  gatilho: Gatilho,
  cfg: ConfigComunicacao,
  agora: Date,
): Promise<DesfechoDecisao> {
  const playbook = await playbookDa(conversa)
  if (!playbook) return NADA

  const historico = await ultimasMensagens(conversa.id)
  const ultima = historico[0]
  const tentativas = await tentativasFeitas(conversa.id)
  const enviadasHoje = historico.filter(
    (m) => m.direcao === 'saida' && mesmoDia(new Date(m.criado_em), agora),
  ).length

  const guard = aplicarGuardrails(
    {
      modo: conversa.modo_agente as 'sugestao' | 'autonomo' | 'desligado',
      triagemDaUltima: (ultima?.direcao === 'entrada' ? (ultima.triagem as Triagem | null) : null) ?? null,
      corpoDaUltima: ultima?.direcao === 'entrada' ? ultima.corpo : null,
      enviadasNaThreadHoje: enviadasHoje,
      tentativas,
    },
    playbook,
    cfg,
  )

  if (guard.escalar) {
    await registrarDecisao(conversa, playbook, gatilho, {
      acao: 'escalar_humano',
      confianca: 1,
      justificativa: guard.motivo ?? 'Guardrail acionado.',
    })
    await avisarEscalacao(conversa, guard.motivo ?? 'A conversa precisa de uma pessoa.')
    return { ...NADA, pulou: false, decidiu: true, escalou: true }
  }
  if (!guard.podeDecidir) {
    // Sem decisão e sem próximo passo é como uma conversa some. Agenda a
    // reavaliação e segue.
    await adiar(conversa.id, agora, playbook)
    return NADA
  }

  const bruta = await consultarModelo(conversa, playbook, historico, cfg)
  const validacao = bruta ? validarDecisao(bruta, playbook, cfg) : null

  if (!bruta || !validacao?.valida) {
    /*
     * REDE DE SEGURANÇA (§7.6). Modelo indisponível, JSON fora do schema, ação
     * fora do playbook ou confiança abaixo do mínimo caem todos aqui — e caem no
     * mesmo lugar de propósito: do ponto de vista da relação, "o agente não
     * soube" é uma coisa só.
     */
    const primeiro = new Date(historico.at(-1)?.criado_em ?? agora.toISOString())
    const passo = proximoPassoDaCadencia(tentativas, primeiro, agora, cfg)
    if (!passo) {
      await supabaseAdmin
        .from('conversas')
        .update({ status: 'pausada', proxima_acao_em: null })
        .eq('id', conversa.id)
      return { ...NADA, pulou: false, fallback: true }
    }
    await registrarDecisao(
      conversa,
      playbook,
      gatilho,
      {
        acao: 'agendar_toque',
        canal: conversa.canal as 'whatsapp' | 'email',
        quando: passo.quando.toISOString(),
        confianca: 0,
        justificativa: `Cadência fixa do playbook (${validacao?.motivo ?? 'modelo indisponível'}).`,
      },
      { modelo: null },
    )
    await supabaseAdmin
      .from('conversas')
      .update({ proxima_acao_em: passo.quando.toISOString() })
      .eq('id', conversa.id)
    return { ...NADA, pulou: false, decidiu: true, fallback: true }
  }

  const decisaoId = await registrarDecisao(conversa, playbook, gatilho, bruta, { modelo: AI_MODEL })

  // ── Executar ou sugerir ──────────────────────────────────────────────────
  if (conversa.modo_agente !== 'autonomo') {
    await avisarSugestao(conversa, bruta)
    await adiar(conversa.id, agora, playbook)
    return { ...NADA, pulou: false, decidiu: true, sugeriu: true }
  }

  const executou = await executar(conversa, bruta, decisaoId, agora, playbook)
  return { ...NADA, pulou: false, decidiu: true, executou }
}

// ─── O modelo ───────────────────────────────────────────────────────────────

interface MensagemHistorico {
  direcao: string
  corpo: string | null
  preview: string | null
  por_ia: boolean
  triagem: unknown
  criado_em: string
}

async function ultimasMensagens(conversaId: string): Promise<MensagemHistorico[]> {
  const { data } = await supabaseAdmin
    .from('comunicacoes')
    .select('direcao, corpo, preview, por_ia, triagem, criado_em')
    .eq('conversa_id', conversaId)
    .order('criado_em', { ascending: false })
    .limit(20)
  return (data ?? []) as MensagemHistorico[]
}

async function consultarModelo(
  conversa: ConversaParaDecidir,
  playbook: Playbook,
  historico: MensagemHistorico[],
  cfg: ConfigComunicacao,
): Promise<DecisaoAgente | null> {
  if (!env.ANTHROPIC_API_KEY) return null

  const contexto = await montarContexto(conversa, playbook, historico, cfg)

  try {
    const resposta = await requisitarJson<{ content?: Array<{ type: string; text?: string }> }>(
      ANTHROPIC_URL,
      {
        method: 'POST',
        headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: {
          model: AI_MODEL,
          max_tokens: 2048,
          system: `${PROMPT_AGENTE}\n\n── PLAYBOOK: ${playbook.nome} ──\n${playbook.instrucoes}\n\nAções permitidas nesta conversa: ${playbook.acoes_permitidas.join(', ')}.`,
          messages: [{ role: 'user', content: contexto }],
        },
        tentativas: 2,
        timeoutMs: 60_000,
      },
    )

    const texto = (resposta.content ?? []).find((c) => c.type === 'text')?.text ?? ''
    const json = texto.match(/\{[\s\S]*\}/)?.[0]
    if (!json) return null

    const r = decisaoAgenteSchema.safeParse(JSON.parse(json))
    return r.success ? r.data : null
  } catch (erro) {
    logger.error({ conversa: conversa.id, erro: String(erro) }, 'Falha ao consultar o modelo do agente.')
    return null
  }
}

/**
 * O contexto é RESUMIDO, e nunca a thread inteira.
 *
 * Vinte mensagens é o suficiente para o próximo passo de uma negociação; a thread
 * completa de uma conta de dois anos custaria dez vezes mais por decisão sem
 * mudar nenhuma delas. E o que importa está no fim: a última mensagem e a
 * classificação dela.
 *
 * NENHUM valor de operação, taxa ou limite entra aqui — nem como contexto. O que
 * o modelo não sabe, ele não cita.
 */
async function montarContexto(
  conversa: ConversaParaDecidir,
  playbook: Playbook,
  historico: MensagemHistorico[],
  cfg: ConfigComunicacao,
): Promise<string> {
  const { data: empresa } = conversa.empresa_id
    ? await supabaseAdmin
        .from('empresas')
        .select('razao_social, nome_fantasia, uf, municipio, estagio')
        .eq('id', conversa.empresa_id)
        .maybeSingle()
    : { data: null }

  const { data: contato } = conversa.contato_id
    ? await supabaseAdmin
        .from('contatos')
        .select('nome, cargo, base_legal')
        .eq('id', conversa.contato_id)
        .maybeSingle()
    : { data: null }

  const { data: persona } = conversa.responsavel_vendedor_id
    ? await supabaseAdmin
        .from('vendedores')
        .select('nome, is_ia')
        .eq('id', conversa.responsavel_vendedor_id)
        .maybeSingle()
    : { data: null }

  const linhas = [...historico]
    .reverse()
    .map((m) => {
      const quem = m.direcao === 'entrada' ? 'ELES' : m.por_ia ? 'NÓS (IA)' : 'NÓS'
      const t = m.triagem as { intencao?: string; resumo_curto?: string } | null
      const marca = t?.intencao ? ` [${t.intencao}]` : ''
      return `${m.criado_em.slice(0, 16).replace('T', ' ')} ${quem}${marca}: ${(m.corpo ?? m.preview ?? '(sem texto)').slice(0, 500)}`
    })
    .join('\n')

  return [
    `Empresa: ${empresa?.razao_social ?? empresa?.nome_fantasia ?? 'não identificada'}${empresa?.uf ? ` (${empresa.municipio ?? ''}/${empresa.uf})` : ''}`,
    `Relação: ${empresa?.estagio ?? 'desconhecida'}`,
    `Contato: ${contato?.nome ?? 'não identificado'}${contato?.cargo ? ` — ${contato.cargo}` : ''}`,
    `Você é: ${persona?.nome ?? 'a ONE OS'}${persona?.is_ia ? ' (persona de IA — assuma isso se perguntarem)' : ''}`,
    `Canal: ${conversa.canal}`,
    `Objetivo desta conversa: ${conversa.objetivo ?? playbook.objetivo}`,
    `Status: ${conversa.status}`,
    `Janela de envio: ${cfg.janela.hora_inicio}h–${cfg.janela.hora_fim}h, dias úteis (${cfg.janela.timezone}).`,
    '',
    '── Últimas mensagens (mais antiga primeiro) ──',
    linhas || '(nenhuma mensagem ainda)',
    '',
    'Qual é o próximo passo? Responda apenas com o JSON.',
  ].join('\n')
}

// ─── Execução ───────────────────────────────────────────────────────────────

/**
 * O executor do espaço fechado. Cada ação tem UM efeito e ele está escrito aqui —
 * o modelo escolhe, o código faz.
 *
 * `ligar` é a exceção declarada: a ferramenta existe e está desligada, e o
 * executor responde "não disponível" (§7.2). A decisão fica registrada, que é o
 * número que justifica comprar o discador.
 */
async function executar(
  conversa: ConversaParaDecidir,
  d: DecisaoAgente,
  decisaoId: string | null,
  agora: Date,
  playbook: Playbook,
): Promise<boolean> {
  const acao = d.acao as AcaoAgente

  switch (acao) {
    case 'responder_agora':
    case 'enviar_link_agendamento': {
      if (!conversa.contato_id || !d.conteudo_sugerido) return false
      /*
       * O agente NÃO envia: ele enfileira, e a fila passa pelo portão. Um caminho
       * de envio direto "porque o agente decidiu" seria o quarto lugar onde a
       * supressão precisa ser lembrada.
       */
      const { error } = await supabaseAdmin.from('mensagens_outbox').insert({
        canal: (d.canal ?? conversa.canal) as string,
        destinatario_contato_id: conversa.contato_id,
        destinatario: await identificadorDaConversa(conversa.id),
        corpo: d.conteudo_sugerido,
        status: 'aprovada',
        origem: 'agente',
        por_ia: true,
        conversa_id: conversa.id,
        empresa_id: conversa.empresa_id,
        vendedor_id: conversa.responsavel_vendedor_id,
        access_keys: [],
      })
      if (error) {
        logger.error({ erro: error.message }, 'Falha ao enfileirar mensagem do agente.')
        return false
      }
      break
    }

    case 'agendar_toque':
    case 'aguardar': {
      const quando = d.quando ? new Date(d.quando) : proximaJanelaSimples(agora, playbook)
      await supabaseAdmin
        .from('conversas')
        .update({ proxima_acao_em: quando.toISOString() })
        .eq('id', conversa.id)
      break
    }

    case 'escalar_humano':
      await avisarEscalacao(conversa, d.justificativa)
      await supabaseAdmin.from('conversas').update({ modo_agente: 'sugestao' }).eq('id', conversa.id)
      break

    case 'marcar_sem_interesse':
      await supabaseAdmin
        .from('conversas')
        .update({ status: 'encerrada', modo_agente: 'desligado', proxima_acao_em: null })
        .eq('id', conversa.id)
      break

    case 'trocar_contato_da_conversa':
      // A troca cria contato e abre thread nova: é o §7.4, e tem função própria.
      await trocarContato(conversa, d)
      break

    case 'mudar_estagio_funil':
    case 'pedir_enriquecimento_contato':
      // Efeitos de card e de descoberta são pedidos ao módulo dono, e nenhum deles
      // é uma escrita direta daqui. Por enquanto a decisão fica registrada e a
      // conversa é reavaliada — o que o log mostra é quantas vezes isso seria útil.
      await adiar(conversa.id, agora, playbook)
      break

    case 'ligar':
      logger.info(
        { conversa: conversa.id },
        'Agente escolheu ligar; a ferramenta está declarada e DESLIGADA (agente.ligacao_habilitada = false).',
      )
      await adiar(conversa.id, agora, playbook)
      return false
  }

  if (decisaoId) {
    await supabaseAdmin
      .from('agente_decisoes')
      .update({ executada: true, executada_em: agora.toISOString() })
      .eq('id', decisaoId)
  }

  await emitirEvento(conversa.empresa_id, EVENTO_TIPOS.AGENTE_EXECUTOU, {
    titulo: 'Agente executou o próximo passo',
    resumo: `${acao}: ${d.justificativa}`,
    url: `/comunicacao/${conversa.id}`,
    conversa_id: conversa.id,
    acao,
  })
  return true
}

/**
 * §7.4 — indicação de outro contato.
 *
 * Cria o novo contato com `base_legal = 'indicacao'` e a EVIDÊNCIA (o trecho da
 * mensagem), abre a thread dele herdando o objetivo, e marca o anterior como
 * `nao_e_o_decisor` — NUNCA suprimido. "Fala com o Marcelo" diz que esta pessoa
 * não decide, não que ela não possa ser abordada: suprimir queimaria um contato
 * que volta a ser útil no dia em que o Marcelo sair.
 */
async function trocarContato(conversa: ConversaParaDecidir, d: DecisaoAgente): Promise<void> {
  const dados = (d as unknown as { dados_extraidos?: Record<string, string | null> }).dados_extraidos ?? {}
  const nome = dados.nome_de_outra_pessoa
  const telefone = dados.telefone_de_outra_pessoa
  const email = dados.email_de_outra_pessoa
  if (!conversa.empresa_id || !nome || (!telefone && !email)) return

  const { data: novo, error } = await supabaseAdmin
    .from('contatos')
    .insert({
      empresa_id: conversa.empresa_id,
      nome,
      telefone,
      whatsapp: telefone,
      email,
      origem: 'indicacao_na_conversa',
      base_legal: 'indicacao',
      base_legal_em: new Date().toISOString(),
      base_legal_detalhe: d.justificativa.slice(0, 500),
    })
    .select('id')
    .maybeSingle()
  if (error || !novo) {
    logger.error({ erro: error?.message }, 'Falha ao criar o contato indicado.')
    return
  }

  if (conversa.contato_id) {
    await supabaseAdmin
      .from('contatos')
      .update({ nao_e_o_decisor: true })
      .eq('id', conversa.contato_id)
  }

  const canal = telefone ? 'whatsapp' : 'email'
  const { data: conversaNova } = await supabaseAdmin.rpc('app__conversa_para', {
    p_canal: canal,
    p_identificador: (telefone ?? email)!,
    p_empresa: conversa.empresa_id,
    p_contato: novo.id,
    p_vendedor: conversa.responsavel_vendedor_id,
  })

  if (conversaNova) {
    await supabaseAdmin
      .from('conversas')
      .update({
        objetivo: conversa.objetivo,
        playbook_id: conversa.playbook_id,
        modo_agente: conversa.modo_agente,
      })
      .eq('id', conversaNova as string)
  }

  // A thread anterior se encerra com agradecimento — não some no meio da frase.
  await supabaseAdmin
    .from('conversas')
    .update({ status: 'encerrada', modo_agente: 'desligado', proxima_acao_em: null })
    .eq('id', conversa.id)

  await emitirEvento(conversa.empresa_id, EVENTO_TIPOS.CONTATO_INDICADO, {
    titulo: 'Outro contato foi indicado',
    resumo: `${nome} foi indicado como quem decide. A conversa anterior foi encerrada.`,
    url: conversaNova ? `/comunicacao/${conversaNova as string}` : '/comunicacao',
    contato_id: novo.id,
  })
}

// ─── Persistência e avisos ──────────────────────────────────────────────────

async function registrarDecisao(
  conversa: ConversaParaDecidir,
  playbook: Playbook,
  gatilho: Gatilho,
  d: Partial<DecisaoAgente> & { acao: string; confianca: number; justificativa: string },
  extra: { modelo?: string | null } = {},
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('agente_decisoes')
    .insert({
      conversa_id: conversa.id,
      playbook_id: playbook.id,
      gatilho,
      contexto_resumo: {
        objetivo: conversa.objetivo ?? playbook.objetivo,
        status: conversa.status,
        ultima_direcao: conversa.ultima_direcao,
      } as never,
      acao: d.acao,
      canal: d.canal ?? conversa.canal,
      quando: d.quando ?? null,
      conteudo_sugerido: d.conteudo_sugerido ?? null,
      confianca: d.confianca,
      justificativa: d.justificativa,
      modo: conversa.modo_agente === 'autonomo' ? 'autonomo' : 'sugestao',
      modelo: extra.modelo ?? null,
    })
    .select('id')
    .maybeSingle()
  if (error) {
    logger.error({ erro: error.message }, 'Falha ao registrar a decisão do agente.')
    return null
  }

  await emitirEvento(conversa.empresa_id, EVENTO_TIPOS.AGENTE_DECIDIU, {
    titulo: 'Próximo passo sugerido',
    resumo: `${d.acao}: ${d.justificativa}`,
    url: `/comunicacao/${conversa.id}`,
    conversa_id: conversa.id,
  })
  return data?.id ?? null
}

async function avisarSugestao(conversa: ConversaParaDecidir, d: DecisaoAgente): Promise<void> {
  await avisarVendedor(conversa.responsavel_vendedor_id, {
    titulo: 'Próximo passo sugerido',
    corpo: d.conteudo_sugerido?.slice(0, 140) ?? d.justificativa.slice(0, 140),
    url: `/comunicacao/${conversa.id}`,
  })
}

async function avisarEscalacao(conversa: ConversaParaDecidir, motivo: string): Promise<void> {
  await emitirEvento(conversa.empresa_id, EVENTO_TIPOS.AGENTE_ESCALOU, {
    titulo: 'Conversa escalada para humano',
    resumo: motivo,
    url: `/comunicacao/${conversa.id}`,
    conversa_id: conversa.id,
  })
  await avisarVendedor(conversa.responsavel_vendedor_id, {
    titulo: 'Uma conversa precisa de você',
    corpo: motivo,
    url: `/comunicacao/${conversa.id}`,
  })
}

async function avisarVendedor(
  vendedorId: string | null,
  payload: { titulo: string; corpo: string; url: string },
): Promise<void> {
  if (!vendedorId) return
  const { data } = await supabaseAdmin
    .from('vendedores')
    .select('usuario_id')
    .eq('id', vendedorId)
    .maybeSingle()
  if (!data?.usuario_id) return
  try {
    await notify(supabaseAdmin, [data.usuario_id], payload)
  } catch (erro) {
    logger.error({ erro: String(erro) }, 'Falha ao notificar o vendedor.')
  }
}

// ─── Utilitários ────────────────────────────────────────────────────────────

async function playbookDa(conversa: ConversaParaDecidir): Promise<Playbook | null> {
  if (conversa.playbook_id) {
    const { data } = await supabaseAdmin
      .from('agente_playbooks')
      .select('id, nome, funil, objetivo, instrucoes, acoes_permitidas, prazos')
      .eq('id', conversa.playbook_id)
      .maybeSingle()
    if (data) return data as unknown as Playbook
  }
  if (!conversa.objetivo) return null

  const { data } = await supabaseAdmin
    .from('agente_playbooks')
    .select('id, nome, funil, objetivo, instrucoes, acoes_permitidas, prazos')
    .eq('objetivo', conversa.objetivo)
    .eq('ativo', true)
    .order('versao', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as unknown as Playbook | null) ?? null
}

/** Quantas vezes já tentamos nesta conversa. Alimenta o `max_tentativas`. */
async function tentativasFeitas(conversaId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('comunicacoes')
    .select('id', { count: 'exact', head: true })
    .eq('conversa_id', conversaId)
    .eq('direcao', 'saida')
  return count ?? 0
}

async function identificadorDaConversa(conversaId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('conversas')
    .select('identificador_externo')
    .eq('id', conversaId)
    .maybeSingle()
  return data?.identificador_externo ?? null
}

async function adiar(conversaId: string, agora: Date, playbook: Playbook): Promise<void> {
  const dias = playbook.prazos.silencio_dias ?? 3
  const quando = new Date(agora.getTime() + dias * 86_400_000)
  await supabaseAdmin
    .from('conversas')
    .update({ proxima_acao_em: quando.toISOString() })
    .eq('id', conversaId)
}

function proximaJanelaSimples(agora: Date, playbook: Playbook): Date {
  return new Date(agora.getTime() + (playbook.prazos.silencio_dias ?? 3) * 86_400_000)
}

function mesmoDia(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10)
}
