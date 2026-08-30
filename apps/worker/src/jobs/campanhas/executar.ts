import {
  escolherVariante,
  planejarDia,
  type ContaDisponivel,
  type Variante,
} from '../../../../../packages/core/src/campanhas/index.js'
import {
  primeiroNome,
  renderizarMensagem,
  tetoDiarioDaConta,
  type BaseLegal,
} from '../../../../../packages/core/src/comunicacao/index.js'
import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { formatCnpj } from '../../../../../packages/core/src/schemas/cnpj.js'
import { avaliarPublico, type CampanhaParaAvaliar } from '../../campanhas/avaliar.js'
import { lerLimitesCampanhas } from '../../campanhas/config.js'
import { lerConfigComunicacao } from '../../comunicacao/config.js'
import { enviadasPelaContaHoje } from '../../comunicacao/ledger.js'
import { pool, supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { emitirEvento } from '../../radar/eventos.js'

/**
 * O EXECUTOR (§4). Roda continuamente e faz três coisas, nesta ordem:
 *
 *   1. MATERIALIZA. Uma campanha recém-aprovada ainda não tem destinatários. A
 *      primeira execução roda a MESMA avaliação da simulação e grava a lista.
 *      Depois disso o público está congelado — quem entrou entrou, e uma empresa
 *      que passaria a casar o filtro amanhã não entra numa campanha aprovada
 *      ontem. Público que muda depois de aprovado é público que ninguém aprovou.
 *
 *   2. ENFILEIRA a leva do dia, no ritmo e com os horários do plano.
 *
 *   3. CONCLUI quando não sobrou ninguém.
 *
 * ─── O QUE ELE NÃO FAZ: ENVIAR ──────────────────────────────────────────────
 * Nenhuma linha deste arquivo fala com Wasender, Gmail ou Resend. Ele escreve em
 * `mensagens_outbox` e o job de comunicação envia — que é o que garante que cada
 * mensagem passe pelo portão `podeEnviar()` no INSTANTE do envio, e não só na
 * simulação. Quem virou suprimido no meio do caminho é barrado lá, com o motivo
 * voltando para cá pelo trigger.
 */

export interface ResultadoExecucao {
  campanhas: number
  materializadas: number
  enfileiradas: number
  concluidas: number
}

interface LinhaCampanha extends CampanhaParaAvaliar {
  nome: string
  objetivo: string | null
  variantes: Variante[]
  contas_remetentes: string[]
  ritmo_por_dia: number
  respeitar_janela: boolean
  vendedor_id: string | null
  status: string
}

const COLUNAS =
  'id, nome, tipo, canal, objetivo, origem_publico, segmento_id, definicao_filtro, preset, ' +
  'preset_params, empresas_manuais, variantes, contas_remetentes, ritmo_por_dia, respeitar_janela, ' +
  'excluir_contatados_dias, excluir_conversa_aberta, vendedor_id, status'

export async function executarCampanhas(): Promise<ResultadoExecucao> {
  const { data, error } = await supabaseAdmin
    .from('campanhas')
    .select(COLUNAS)
    .in('status', ['agendada', 'executando'])
    .or(`inicio_em.is.null,inicio_em.lte.${new Date().toISOString()}`)
    .order('aprovada_em', { ascending: true })

  if (error) {
    logger.error({ erro: error.message }, 'Falha ao listar campanhas ativas.')
    return { campanhas: 0, materializadas: 0, enfileiradas: 0, concluidas: 0 }
  }

  const campanhas = (data ?? []) as unknown as LinhaCampanha[]
  const acc: ResultadoExecucao = {
    campanhas: campanhas.length,
    materializadas: 0,
    enfileiradas: 0,
    concluidas: 0,
  }

  for (const c of campanhas) {
    try {
      const r = await executarUma(c)
      acc.materializadas += r.materializados
      acc.enfileiradas += r.enfileiradas
      if (r.concluida) acc.concluidas += 1
    } catch (erro) {
      logger.error({ campanha: c.nome, erro: String(erro) }, 'Falha ao executar campanha.')
    }
  }

  logger.info(acc, 'Ciclo de campanhas concluído.')
  return acc
}

async function executarUma(
  c: LinhaCampanha,
): Promise<{ materializados: number; enfileiradas: number; concluida: boolean }> {
  const limites = await lerLimitesCampanhas()

  // ── 1. Materializar, uma vez só ──────────────────────────────────────────
  const { count } = await supabaseAdmin
    .from('campanha_destinatarios')
    .select('id', { count: 'exact', head: true })
    .eq('campanha_id', c.id!)

  let materializados = 0
  if ((count ?? 0) === 0) {
    materializados = await materializar(c, limites)
    await supabaseAdmin.rpc('app_campanha_definir_status', {
      p: { campanha_id: c.id, status: 'executando' } as never,
    })
    await emitirEvento(null, EVENTO_TIPOS.CAMPANHA_INICIADA, {
      campanha_id: c.id,
      nome: c.nome,
      destinatarios: materializados,
      url: `/comercial/campanhas/${c.id}`,
    })
  }

  // ── 2. Enfileirar a leva do dia ──────────────────────────────────────────
  const enfileiradas = await enfileirarLevaDoDia(c)

  // ── 3. Concluir quando não sobra ninguém ─────────────────────────────────
  const { count: restantes } = await supabaseAdmin
    .from('campanha_destinatarios')
    .select('id', { count: 'exact', head: true })
    .eq('campanha_id', c.id!)
    .in('status', ['pendente', 'agendada'])

  const concluida = (restantes ?? 0) === 0 && (count ?? 0) + materializados > 0
  if (concluida) {
    await supabaseAdmin.rpc('app_campanha_definir_status', {
      p: { campanha_id: c.id, status: 'concluida' } as never,
    })
    await emitirEvento(null, EVENTO_TIPOS.CAMPANHA_CONCLUIDA, {
      campanha_id: c.id,
      nome: c.nome,
      url: `/comercial/campanhas/${c.id}`,
    })
  }

  return { materializados, enfileiradas, concluida }
}

/**
 * Grava a lista de destinatários — elegíveis E excluídos.
 *
 * Os excluídos entram na tabela de propósito. A alternativa (guardar só quem
 * recebeu) faria a tela responder "1.200 empresas viraram 340" sem poder dizer
 * QUAIS 860 sobraram e por quê — e esse "quais" é o que transforma o painel de
 * exclusões numa lista de trabalho para o enriquecimento.
 */
async function materializar(
  c: LinhaCampanha,
  limites: { max_campanhas_por_contato_90d: number },
): Promise<number> {
  const avaliado = await avaliarPublico(
    { ...c, preset_params: (c.preset_params ?? {}) as Record<string, unknown> },
    limites,
  )

  const linhas = [
    ...avaliado.elegiveis.map((e) => ({
      campanha_id: c.id!,
      empresa_id: e.empresaId,
      contato_id: e.destinatario.contato.id,
      variante_id: escolherVariante(c.variantes, 1, e.destinatario.contato.id)?.id ?? null,
      passo: 1,
      status: 'pendente' as const,
    })),
    ...avaliado.excluidas.map((x) => ({
      campanha_id: c.id!,
      empresa_id: x.empresaId,
      contato_id: x.contatoId,
      variante_id: null,
      passo: 1,
      status: 'excluida' as const,
      motivo_exclusao: x.motivo,
    })),
  ]

  // Lotes de 500: um insert de 5.000 linhas estoura o limite de payload do
  // PostgREST, e descobrir isso só na campanha grande seria descobrir tarde.
  let gravados = 0
  for (let i = 0; i < linhas.length; i += 500) {
    const lote = linhas.slice(i, i + 500)
    const { error } = await supabaseAdmin
      .from('campanha_destinatarios')
      // `contato_id` nulo (os `sem_contato`) não colide com o unique parcial, e
      // `ignoreDuplicates` cobre a reexecução depois de uma falha no meio.
      .upsert(lote as never, { onConflict: 'campanha_id,contato_id', ignoreDuplicates: true })
    if (error) {
      logger.error({ erro: error.message, campanha: c.nome }, 'Falha ao materializar lote.')
      break
    }
    gravados += lote.length
  }

  logger.info(
    { campanha: c.nome, elegiveis: avaliado.elegiveis.length, excluidos: avaliado.excluidas.length },
    'Campanha materializada.',
  )
  return gravados
}

async function enfileirarLevaDoDia(c: LinhaCampanha): Promise<number> {
  const cfg = await lerConfigComunicacao()
  const agora = new Date()

  const contas = await contasDisponiveis(c, cfg, agora)

  // Quantos já foram enfileirados HOJE por esta campanha. Sem isso, um executor
  // que roda de 15 em 15 minutos enfileiraria o ritmo inteiro quatro vezes por
  // hora — o portão seguraria o excesso, mas a fila viraria um pântano.
  const inicioDoDia = new Date(agora)
  inicioDoDia.setUTCHours(0, 0, 0, 0)
  const { count: jaHoje } = await supabaseAdmin
    .from('mensagens_outbox')
    .select('id', { count: 'exact', head: true })
    .eq('campanha_id', c.id!)
    .gte('criada_em', inicioDoDia.toISOString())

  const saldo = Math.max(0, c.ritmo_por_dia - (jaHoje ?? 0))
  if (saldo === 0) return 0

  const { data: pendentes } = await supabaseAdmin
    .from('campanha_destinatarios')
    .select('id, empresa_id, contato_id, variante_id, passo')
    .eq('campanha_id', c.id!)
    .eq('status', 'pendente')
    .or(`agendada_para.is.null,agendada_para.lte.${agora.toISOString()}`)
    .order('criado_em', { ascending: true })
    .limit(saldo)

  const fila = pendentes ?? []
  if (fila.length === 0) return 0

  const plano = planejarDia({
    quantidade: Math.min(saldo, fila.length),
    contas,
    janela: cfg.janela,
    respeitarJanela: c.respeitar_janela,
    agora,
  })
  if (plano.slots.length === 0) return 0

  const contexto = await contextoDeRender(c, fila)

  let enfileiradas = 0
  for (const slot of plano.slots) {
    const d = fila[slot.indice]
    if (!d) continue

    const variante =
      c.variantes.find((v) => v.id === d.variante_id && v.passo === d.passo) ??
      escolherVariante(c.variantes, d.passo, d.contato_id ?? d.id)
    if (!variante) continue

    const template = contexto.templates.get(variante.template_id)
    if (!template) continue

    const destino = contexto.identificadores.get(d.contato_id ?? '')
    if (!destino) continue

    const empresa = contexto.empresas.get(d.empresa_id ?? '')
    const corpo = renderizarMensagem(
      template.corpo,
      {
        contato_nome: primeiroNome(contexto.nomes.get(d.contato_id ?? '') ?? null),
        empresa_nome: empresa?.razao_social ?? empresa?.nome_fantasia ?? '',
        empresa_cnpj: empresa?.cnpj ? formatCnpj(empresa.cnpj) : '',
        remetente_nome: contexto.remetente,
      },
      {
        canal: c.canal,
        baseLegal: (contexto.basesLegais.get(d.contato_id ?? '') ?? null) as BaseLegal | null,
        // O link real é anexado pelo job de envio, que conhece o token do
        // destinatário. Aqui ele fica de fora: um link fixo no corpo
        // descadastraria a pessoa errada.
        linkDescadastro: null,
      },
    )

    const { error } = await supabaseAdmin.from('mensagens_outbox').insert({
      canal: c.canal,
      destinatario: destino,
      destinatario_contato_id: d.contato_id,
      empresa_id: d.empresa_id,
      vendedor_id: c.vendedor_id,
      whatsapp_conta_id: slot.contaId,
      assunto: template.assunto,
      corpo,
      template_id: variante.template_id,
      origem: 'campanha',
      // `aprovada` porque a APROVAÇÃO já aconteceu — na campanha, por uma pessoa
      // com nome. Passar por `pendente_envio` pediria uma segunda aprovação, uma
      // por mensagem, o que é o oposto do que uma campanha é.
      status: 'aprovada',
      agendada_para: slot.quando.toISOString(),
      campanha_id: c.id,
      campanha_destinatario_id: d.id,
      por_ia: c.vendedor_id === null,
    } as never)

    if (error) {
      logger.error({ erro: error.message, destinatario: d.id }, 'Falha ao enfileirar de campanha.')
      continue
    }

    await supabaseAdmin
      .from('campanha_destinatarios')
      .update({ status: 'agendada', agendada_para: slot.quando.toISOString() })
      .eq('id', d.id)
    enfileiradas += 1
  }

  return enfileiradas
}

/**
 * As contas que esta campanha pode usar hoje, com o teto já descontado do que
 * elas mandaram — somando TODAS as origens, não só campanha. O teto do número é
 * do número, e o vendedor que mandou 30 mensagens hoje já gastou 30.
 */
async function contasDisponiveis(
  c: LinhaCampanha,
  cfg: Awaited<ReturnType<typeof lerConfigComunicacao>>,
  agora: Date,
): Promise<ContaDisponivel[]> {
  if (c.canal !== 'whatsapp') return []

  const { data } = await supabaseAdmin
    .from('whatsapp_contas')
    .select('id, numero, tipo, mensagens_por_dia, warmup_iniciado_em, intervalo_min_seg, intervalo_max_seg, ativo')
    .eq('ativo', true)
    .in('tipo', c.vendedor_id ? ['relacionamento'] : ['ia'])

  const todas = (data ?? []).filter(
    (x) => c.contas_remetentes.length === 0 || c.contas_remetentes.includes(x.id),
  )

  return Promise.all(
    todas.map(async (conta) => ({
      id: conta.id,
      numero: conta.numero,
      tetoHoje: tetoDiarioDaConta(conta as never, cfg, agora),
      enviadasHoje: await enviadasPelaContaHoje(conta.numero, agora),
    })),
  )
}

async function contextoDeRender(
  c: LinhaCampanha,
  fila: readonly { contato_id: string | null; empresa_id: string | null }[],
): Promise<{
  templates: Map<string, { assunto: string | null; corpo: string }>
  empresas: Map<string, { razao_social: string | null; nome_fantasia: string | null; cnpj: string }>
  identificadores: Map<string, string>
  nomes: Map<string, string | null>
  basesLegais: Map<string, string | null>
  remetente: string
}> {
  const templateIds = [...new Set(c.variantes.map((v) => v.template_id))]
  const contatoIds = fila.map((d) => d.contato_id).filter((x): x is string => !!x)
  const empresaIds = fila.map((d) => d.empresa_id).filter((x): x is string => !!x)

  const [templates, empresas, contatos, vendedor] = await Promise.all([
    supabaseAdmin.from('templates_mensagem').select('id, assunto, corpo').in('id', templateIds),
    supabaseAdmin
      .from('empresas')
      .select('id, razao_social, nome_fantasia, cnpj')
      .in('id', [...new Set(empresaIds)]),
    pool.query<{
      id: string
      nome: string | null
      email: string | null
      telefone: string | null
      whatsapp: string | null
      base_legal: string | null
    }>(
      'select id, nome, email, telefone, whatsapp, base_legal from contatos where id = any($1)',
      [contatoIds],
    ),
    c.vendedor_id
      ? supabaseAdmin.from('vendedores').select('nome').eq('id', c.vendedor_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const identificadores = new Map<string, string>()
  const nomes = new Map<string, string | null>()
  const basesLegais = new Map<string, string | null>()
  for (const ct of contatos.rows) {
    const ident =
      c.canal === 'email' ? ct.email : (ct.whatsapp ?? ct.telefone)
    if (ident) identificadores.set(ct.id, ident)
    nomes.set(ct.id, ct.nome)
    basesLegais.set(ct.id, ct.base_legal)
  }

  return {
    templates: new Map((templates.data ?? []).map((t) => [t.id, { assunto: t.assunto, corpo: t.corpo }])),
    empresas: new Map((empresas.data ?? []).map((e) => [e.id, e])),
    identificadores,
    nomes,
    basesLegais,
    remetente: (vendedor.data as { nome?: string } | null)?.nome ?? 'ONE OS',
  }
}
