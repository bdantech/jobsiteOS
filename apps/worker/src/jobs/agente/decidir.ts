import {
  ACOES_AGENTE,
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
import { regraDeIdentificacao } from '../../../../../packages/core/src/agentes/identificacao.js'
import type { ConfigAgentes } from '../../../../../packages/core/src/agentes/schemas.js'
import { AI_MODEL, EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { lerConfigAgentes } from '../../agentes/config.js'
import { lerConfigComunicacao } from '../../comunicacao/config.js'
import { supabaseAdmin } from '../../db.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { requisitarJson } from '../../net/http.js'
import { avisar, emitirEvento } from '../../radar/eventos.js'

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
  conta_remetente: string | null
}

const COLUNAS =
  'id, canal, empresa_id, contato_id, objetivo, playbook_id, responsavel_vendedor_id, modo_agente, status, ultima_mensagem_em, ultima_direcao, proxima_acao_em, conta_remetente'

/**
 * Quanto uma conversa espera depois de uma passagem que FALHOU (exceção, INSERT recusado).
 * Não é zero — voltar na hora seguinte faria a mesma conversa quebrada ocupar um lugar
 * da fila a cada hora — e não é o dia inteiro, porque a falha costuma ser passageira.
 */
const ESPERA_APOS_FALHA_MS = 4 * 3_600_000

/** Quantos lotes a seleção lê, no máximo, pulando conversas de mandato. */
const LOTES_DE_SELECAO = 5

/**
 * A varredura por SILÊNCIO e por agendamento. É o que roda de hora em hora.
 *
 * Conversas encerradas e pausadas ficam de fora: encerrada é opt-out ou desfecho,
 * e insistir nelas é exatamente o que a supressão existe para impedir.
 */
export async function decidirProximosPassos(limite = 50): Promise<ResultadoAgente> {
  const cfg = await lerConfigComunicacao(true)
  const cfgAgentes = await lerConfigAgentes()
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

  /*
   * ── A FILA ANDA PELA PRÓXIMA AVALIAÇÃO, NÃO PELA IDADE (09 §1.1) ─────────
   * Ordenava por `ultima_mensagem_em` e a conversa sem playbook voltava sem reagendar:
   * as mesmas 50 mais antigas ocupavam a fila para sempre, e nenhuma conversa com
   * playbook era alcançada. Agora toda passagem grava `proxima_acao_em` antes de sair
   * (inclusive quando não há nada a fazer, e inclusive quando falha — ver
   * `decidirParaConversa`), e a seleção pega a que venceu há mais tempo.
   * `aguardando_humano` fica de fora pelo filtro de status: é de uma pessoa até alguém
   * tocá-la.
   */
  const conversas = await conversasParaDecidir(limite, agora, cfgAgentes, { soAgendadas: false })
  acc.conversas = conversas.length

  for (const c of conversas) {
    try {
      const gatilho: Gatilho =
        c.ultima_direcao === 'entrada'
          ? 'resposta_recebida'
          : c.proxima_acao_em
            ? 'agendado'
            : 'silencio'
      const r = await decidirParaConversa(c, gatilho, cfg, agora, cfgAgentes)
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

/**
 * ── TODA SAÍDA REAGENDA (09 §1.1) ────────────────────────────────────────────
 * Os `return` sem próximo passo eram o deadlock de volta por outras portas: falta de
 * contato, INSERT recusado na fila e exceção no meio saíam deixando a conversa vencida,
 * e ela voltava à frente da fila a cada passagem. Em vez de confiar que cada caminho
 * lembre, a rede fica aqui: depois da passagem — com ou sem exceção — a conversa que
 * continua na fila e continua vencida ganha um próximo passo com espera de falha.
 *
 * "Vencida" é ANTES do início da passagem (`agora`), de propósito: uma mensagem que chega
 * no meio acorda a conversa com `now()` (trigger de `comunicacoes`), e isso não é uma
 * saída esquecida — é o cliente respondendo, e a rede não pode empurrá-lo para depois.
 */
export async function decidirParaConversa(
  conversa: ConversaParaDecidir,
  gatilho: Gatilho,
  cfg: ConfigComunicacao,
  agora: Date,
  cfgAgentes: ConfigAgentes,
): Promise<DesfechoDecisao> {
  try {
    return await decidirSemRede(conversa, gatilho, cfg, agora, cfgAgentes)
  } catch (erro) {
    logger.error({ conversa: conversa.id, erro: String(erro) }, 'Falha ao decidir próximo passo.')
    return NADA
  } finally {
    await garantirProximaAvaliacao(conversa.id, agora).catch((erro: unknown) =>
      logger.error({ conversa: conversa.id, erro: String(erro) }, 'Falha ao reagendar a conversa.'),
    )
  }
}

async function decidirSemRede(
  conversa: ConversaParaDecidir,
  gatilho: Gatilho,
  cfg: ConfigComunicacao,
  agora: Date,
  cfgAgentes: ConfigAgentes,
): Promise<DesfechoDecisao> {
  const playbook = await playbookDa(conversa)
  if (!playbook) {
    // §1.1(c): sem mandato nem playbook não há o que decidir — mas a conversa precisa
    // sair da frente da fila. Um intervalo longo (config, 24h), e não zero.
    await reagendarEm(conversa.id, agora, cfgAgentes.geral.intervalo_sem_mandato_horas * 3_600_000)
    return NADA
  }

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
    // §1.4: sem isto a mesma conversa escalava — e notificava — a cada hora.
    await aguardarHumano(conversa.id, agora, cfgAgentes)
    return { ...NADA, pulou: false, decidiu: true, escalou: true }
  }
  if (!guard.podeDecidir) {
    // Sem decisão e sem próximo passo é como uma conversa some. Agenda a
    // reavaliação e segue.
    await adiar(conversa.id, agora, playbook)
    return NADA
  }

  const bruta = await consultarModelo(conversa, playbook, historico, cfg, cfgAgentes)
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

  const executou = await executar(conversa, bruta, decisaoId, agora, playbook, cfgAgentes, historico)
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
  cfgAgentes: ConfigAgentes,
): Promise<DecisaoAgente | null> {
  if (!env.ANTHROPIC_API_KEY) return null

  const { contexto, persona } = await montarContexto(conversa, playbook, historico, cfg)
  // A regra de identificação é CONFIG (09 §10) e vale por cima do playbook: entra no
  // system prompt depois das instruções dele, para nenhum playbook poder desdizê-la.
  const identificacao = regraDeIdentificacao(cfgAgentes.geral.identificacao, persona)

  try {
    const resposta = await requisitarJson<{ content?: Array<{ type: string; text?: string }> }>(
      ANTHROPIC_URL,
      {
        method: 'POST',
        headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: {
          model: AI_MODEL,
          max_tokens: 2048,
          system: `${PROMPT_AGENTE}\n\n── PLAYBOOK: ${playbook.nome} ──\n${playbook.instrucoes}\n\nAções permitidas nesta conversa: ${playbook.acoes_permitidas.join(', ')}.\n\n── ${identificacao}`,
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
): Promise<{ contexto: string; persona: string }> {
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

  /*
   * A persona que fala é SEMPRE uma assistente de IA, mesmo quando o responsável da
   * conversa é humano: ali o texto vira sugestão para ele, e só sai sozinho (com
   * `por_ia = true`) pela linha de uma persona — ver `personaPodeEnviar`. Dizer
   * "Você é: Fulano" com o nome de um vendedor humano fazia o modelo assinar como ele
   * (09 §1.10). O nome humano vira CONTEXTO ("o vendedor da conta"), nunca identidade.
   */
  const nomePersona = persona?.is_ia ? persona.nome : 'a assistente da ONE OS'
  const contexto = [
    `Empresa: ${empresa?.razao_social ?? empresa?.nome_fantasia ?? 'não identificada'}${empresa?.uf ? ` (${empresa.municipio ?? ''}/${empresa.uf})` : ''}`,
    `Relação: ${empresa?.estagio ?? 'desconhecida'}`,
    `Contato: ${contato?.nome ?? 'não identificado'}${contato?.cargo ? ` — ${contato.cargo}` : ''}`,
    `Você é: ${nomePersona}`,
    ...(persona && !persona.is_ia ? [`Vendedor responsável pela conta: ${persona.nome} (você NÃO é essa pessoa)`] : []),
    // Sem a hora de agora, o `quando` que o modelo devolve não tem âncora nenhuma.
    `Agora: ${new Date().toLocaleString('pt-BR', { timeZone: cfg.janela.timezone })} (${cfg.janela.timezone})`,
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
  return { contexto, persona: nomePersona }
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
  cfgAgentes: ConfigAgentes,
  historico: MensagemHistorico[],
): Promise<boolean> {
  const acao = d.acao as AcaoAgente

  switch (acao) {
    case 'responder_agora':
    case 'enviar_link_agendamento': {
      if (!conversa.contato_id || !d.conteudo_sugerido) {
        await adiar(conversa.id, agora, playbook)
        return false
      }
      const canal = (d.canal ?? conversa.canal) as string
      /*
       * ── SEM LINHA PRÓPRIA, NÃO SAI (09 §3.1) ───────────────────────────────
       * O autônomo antigo enfileirava `por_ia` com o vendedor HUMANO da conversa, e o
       * envio caía no rodízio anônimo de contas `ia`: a mesma "assistente" aparecia com
       * um número diferente a cada vez, e a resposta ia para uma thread que ninguém
       * acompanhava. O rodízio saiu da spec. Agora só fala sozinho o agente que é uma
       * persona com a sua linha (a fila a resolve por `vendedor_id`); na conversa de
       * uma pessoa, a decisão vira SUGESTÃO para ela — que responde do próprio número.
       */
      if (!(await personaPodeEnviar(conversa.responsavel_vendedor_id, canal))) {
        logger.info({ conversa: conversa.id }, 'Autônomo sem persona com linha própria: vira sugestão.')
        await avisarSugestao(conversa, d)
        await adiar(conversa.id, agora, playbook)
        return false
      }
      /*
       * O agente NÃO envia: ele enfileira, e a fila passa pelo portão. Um caminho
       * de envio direto "porque o agente decidiu" seria o quarto lugar onde a
       * supressão precisa ser lembrada.
       */
      const { error } = await supabaseAdmin.from('mensagens_outbox').insert({
        canal,
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
        await reagendarEm(conversa.id, agora, ESPERA_APOS_FALHA_MS)
        return false
      }
      // Sem reagendar, a conversa continuava vencida e voltava na hora seguinte para
      // "responder" de novo o que já tinha respondido — só o teto diário a segurava.
      await adiar(conversa.id, agora, playbook)
      break
    }

    case 'agendar_toque':
    case 'aguardar': {
      // Data inválida do modelo não pode derrubar a execução DEPOIS de a decisão estar
      // gravada: cai no prazo do playbook, que é o mesmo que ela cairia sem `quando`.
      const pedida = d.quando ? new Date(d.quando) : null
      const quando =
        pedida && !Number.isNaN(pedida.getTime()) ? pedida : proximaJanelaSimples(agora, playbook)
      await supabaseAdmin
        .from('conversas')
        .update({ proxima_acao_em: quando.toISOString() })
        .eq('id', conversa.id)
      break
    }

    case 'escalar_humano':
      await avisarEscalacao(conversa, d.justificativa)
      await supabaseAdmin.from('conversas').update({ modo_agente: 'sugestao' }).eq('id', conversa.id)
      await aguardarHumano(conversa.id, agora, cfgAgentes)
      break

    case 'marcar_sem_interesse':
      await supabaseAdmin
        .from('conversas')
        .update({ status: 'encerrada', modo_agente: 'desligado', proxima_acao_em: null })
        .eq('id', conversa.id)
      break

    case 'trocar_contato_da_conversa': {
      // A troca cria contato e abre thread nova: é o §7.4, e tem função própria. Os dados
      // da indicação vêm da TRIAGEM da última mensagem recebida — o schema da decisão não
      // tem esse campo, e lê-lo de lá (como antes) devolvia sempre vazio: a ação contava
      // como executada sem ter feito nada (09 §6.1).
      const trocou = await trocarContato(conversa, d, historico)
      if (!trocou) {
        await adiar(conversa.id, agora, playbook)
        return false
      }
      break
    }

    case 'ligar':
      /*
       * NÃO EXECUTADA, e sem fingir (09 §6.1). O agente de conversa não tem orçamento
       * para ligar — isso é trabalho de MANDATO, onde a ferramenta existe de verdade.
       * `ligar` fica no espaço de ações como ferramenta declarada e desligada (§7.2);
       * `mudar_estagio_funil` e `pedir_enriquecimento_contato`, que também não faziam
       * nada aqui, saíram da lista (`ACOES_APOSENTADAS`) e dos playbooks (0271b).
       */
      logger.info({ conversa: conversa.id, acao }, 'Ação sem efeito no agente de conversa; só com mandato.')
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
async function trocarContato(
  conversa: ConversaParaDecidir,
  d: DecisaoAgente,
  historico: MensagemHistorico[],
): Promise<boolean> {
  const ultimaEntrada = historico.find((m) => m.direcao === 'entrada')
  const triagem = (ultimaEntrada?.triagem ?? null) as { dados_extraidos?: Record<string, string | null> } | null
  const dados = triagem?.dados_extraidos ?? {}
  const nome = dados.nome_de_outra_pessoa
  const telefone = dados.telefone_de_outra_pessoa
  const email = dados.email_de_outra_pessoa
  if (!conversa.empresa_id || !nome || (!telefone && !email)) return false

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
    return false
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
    // A thread nova herda a NOSSA ponta da que a originou (0196): trocar de
    // interlocutor do lado do cliente não troca o número por onde falamos, e
    // abrir a thread sem conta a deixaria fora da chave do par.
    p_conta: conversa.conta_remetente,
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
  return true
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
  // Ao responsável da conversa, pela regra `responsavel_da_conversa` do tipo (0262).
  await avisar('agente.sugestao', {
    titulo: 'Próximo passo sugerido',
    resumo: d.conteudo_sugerido?.slice(0, 140) ?? d.justificativa.slice(0, 140),
    url: `/comunicacao/${conversa.id}`,
    conversa_id: conversa.id,
  })
}

async function avisarEscalacao(conversa: ConversaParaDecidir, motivo: string): Promise<void> {
  await emitirEvento(conversa.empresa_id, EVENTO_TIPOS.AGENTE_ESCALOU, {
    titulo: 'Conversa escalada para humano',
    resumo: motivo,
    url: `/comunicacao/${conversa.id}`,
    conversa_id: conversa.id,
  })
  // O responsável recebe com push pelo próprio evento (regra `responsavel_da_conversa`).
}

// ─── Utilitários ────────────────────────────────────────────────────────────

/**
 * O playbook, com `acoes_permitidas` reduzida ao que ESTE decisor executa. Uma versão
 * antiga fixada na conversa (ou um playbook anterior à 0271b) ainda pode listar ação
 * aposentada; oferecê-la ao modelo seria pedir uma escolha que o schema descarta.
 */
async function playbookDa(conversa: ConversaParaDecidir): Promise<Playbook | null> {
  const bruto = await playbookBrutoDa(conversa)
  if (!bruto) return null
  const conhecidas: readonly string[] = ACOES_AGENTE
  return { ...bruto, acoes_permitidas: bruto.acoes_permitidas.filter((a) => conhecidas.includes(a)) }
}

async function playbookBrutoDa(conversa: ConversaParaDecidir): Promise<Playbook | null> {
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
    // Os playbooks de MANDATO (0270e) listam ferramentas do loop de agentes, não ações
    // deste decisor — e escolher um deles aqui validaria a decisão contra a lista errada.
    .is('tipo_mandato', null)
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

export async function reagendarEm(conversaId: string, agora: Date, ms: number): Promise<void> {
  await supabaseAdmin
    .from('conversas')
    .update({ proxima_acao_em: new Date(agora.getTime() + ms).toISOString() })
    .eq('id', conversaId)
}

/** A rede de `decidirParaConversa`: a conversa que ficou na fila e vencida ganha espera. */
async function garantirProximaAvaliacao(conversaId: string, agora: Date): Promise<void> {
  const { data } = await supabaseAdmin
    .from('conversas')
    .select('status, modo_agente, proxima_acao_em')
    .eq('id', conversaId)
    .maybeSingle()
  if (!data) return
  const naFila = (data.status === 'ativa' || data.status === 'aguardando_resposta') && data.modo_agente !== 'desligado'
  // Estritamente antes de `agora`: a cadência fixa grava `agora` quando o passo já venceu,
  // e isso é um próximo passo escolhido, não um esquecido.
  const vencida = !data.proxima_acao_em || new Date(data.proxima_acao_em).getTime() < agora.getTime()
  if (naFila && vencida) await reagendarEm(conversaId, agora, ESPERA_APOS_FALHA_MS)
}

/**
 * A seleção das duas varreduras (esta e `executar-agendados`), já SEM as conversas de
 * mandato ativo.
 *
 * ── O FILTRO DO MANDATO ANTES DO LIMITE, NÃO DEPOIS (09 §1.1) ────────────────
 * Filtrava depois do `limit(50)` e nunca mexia nelas: com 50 conversas de mandato
 * vencidas na frente, a varredura lia as mesmas 50, descartava todas e terminava sem
 * decidir nada — o deadlock da fila de volta. O PostgREST não diz "sem linha em
 * `mandato_conversas`" num filtro, então a seleção lê em lotes: a de mandato é empurrada
 * para longe (o ciclo de mandatos não lê `conversas.proxima_acao_em`; se o mandato
 * terminar, ela volta ao decisor em um intervalo, que é o que ela teria sem mandato) e o
 * próximo lote já não a vê. O trigger de `comunicacoes` também deixou de acordá-las
 * (0271b), então elas param de voltar à frente a cada mensagem.
 */
export async function conversasParaDecidir(
  limite: number,
  agora: Date,
  cfgAgentes: ConfigAgentes,
  opcoes: { soAgendadas: boolean },
): Promise<ConversaParaDecidir[]> {
  const escolhidas: ConversaParaDecidir[] = []
  const vistas = new Set<string>()
  for (let lote = 0; lote < LOTES_DE_SELECAO && escolhidas.length < limite; lote++) {
    const base = supabaseAdmin
      .from('conversas')
      .select(COLUNAS)
      .in('status', ['ativa', 'aguardando_resposta'])
      .neq('modo_agente', 'desligado')
    const filtrada = opcoes.soAgendadas
      ? base.not('proxima_acao_em', 'is', null).lte('proxima_acao_em', agora.toISOString())
      : base.or(`proxima_acao_em.is.null,proxima_acao_em.lte.${agora.toISOString()}`)
    const { data, error } = await filtrada
      .order('proxima_acao_em', { ascending: true, nullsFirst: true })
      .limit(limite)
    if (error) {
      logger.error({ erro: error.message }, 'Falha ao listar conversas para o agente.')
      break
    }
    const lidas = (data ?? []) as ConversaParaDecidir[]
    const novas = lidas.filter((c) => !vistas.has(c.id))
    if (novas.length === 0) break
    for (const c of novas) vistas.add(c.id)

    const doMandato = await conversasEmMandatoAtivo(novas.map((c) => c.id))
    if (doMandato.size > 0) {
      await supabaseAdmin
        .from('conversas')
        .update({
          proxima_acao_em: new Date(
            agora.getTime() + cfgAgentes.geral.intervalo_sem_mandato_horas * 3_600_000,
          ).toISOString(),
        })
        .in('id', [...doMandato])
    }
    escolhidas.push(...novas.filter((c) => !doMandato.has(c.id)).slice(0, limite - escolhidas.length))
    // Lote incompleto: não há mais nada vencido para ler.
    if (lidas.length < limite) break
  }
  return escolhidas
}

/**
 * O autônomo antigo só envia como PERSONA com linha própria (09 §3.1). WhatsApp exige a
 * linha do agente (`whatsapp_conta_id`; a fila ainda confere se está ativa); e-mail sai
 * pela caixa ou pelo remetente dele, que a fila resolve pelo `vendedor_id`.
 */
async function personaPodeEnviar(vendedorId: string | null, canal: string): Promise<boolean> {
  if (!vendedorId) return false
  const { data } = await supabaseAdmin
    .from('vendedores')
    .select('is_ia, whatsapp_conta_id')
    .eq('id', vendedorId)
    .maybeSingle()
  if (!data?.is_ia) return false
  return canal === 'whatsapp' ? Boolean(data.whatsapp_conta_id) : true
}

/**
 * §1.4: a conversa passa a ser de uma PESSOA. Sai da varredura pelo status, e o trigger
 * de `comunicacoes` a devolve a `aguardando_resposta` na primeira saída humana. O
 * `proxima_acao_em` é o relógio de segurança: se ninguém tocar, ela não fica invisível
 * para sempre.
 */
async function aguardarHumano(conversaId: string, agora: Date, cfgAgentes: ConfigAgentes): Promise<void> {
  await supabaseAdmin
    .from('conversas')
    .update({
      status: 'aguardando_humano',
      proxima_acao_em: new Date(agora.getTime() + cfgAgentes.geral.intervalo_sem_mandato_horas * 3_600_000).toISOString(),
    })
    .eq('id', conversaId)
}

/** As conversas destas que estão presas a um mandato ativo (do ciclo de agentes). */
export async function conversasEmMandatoAtivo(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const { data, error } = await supabaseAdmin
    .from('mandato_conversas')
    .select('conversa_id, mandatos!inner(estado)')
    .in('conversa_id', ids)
    .in('mandatos.estado', ['aberto', 'em_andamento', 'aguardando_externo'])
  // Sem a tabela (migração não aplicada), nenhuma conversa é de mandato.
  if (error) return new Set()
  return new Set((data ?? []).map((r) => r.conversa_id as string))
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
