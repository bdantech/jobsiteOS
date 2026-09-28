import {
  escolherCloser,
  fimDoExpedienteDaVoz,
  janelasLivres,
  rotuloDaJanela,
  type Intervalo,
} from '../../../../../packages/core/src/agentes/agenda.js'
import type { IdFerramenta } from '../../../../../packages/core/src/agentes/ferramentas.js'
import type { ResultadoFerramenta } from '../../../../../packages/core/src/agentes/loop.js'
import { violaIdentificacao } from '../../../../../packages/core/src/agentes/prompt.js'
import { traduzirPedido, type JanelaOferecida } from '../../../../../packages/core/src/agentes/voz-adapter.js'
import type { ConfigAgentes, ObjetivoLigacao, VersaoVoz } from '../../../../../packages/core/src/agentes/schemas.js'
import { normalizarTelefoneBr } from '../../../../../packages/core/src/fornecedores/telefone.js'
import type { ContatoTentado, AgenteCarregado, EmpresaCarregada, MandatoCarregado } from '../../agentes/contexto.js'
import { ocupadosDoCloser } from '../../agentes/agenda-google.js'
import { pool, supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { lerConfigVoz } from '../../voz/config.js'
import { remontarPedidoDaNota } from '../../voz/pedido-fresco.js'
import { cadastralDoFornecedor } from '../fornecedores/descoberta.js'
import { buscarNaNovaVida } from '../fornecedores/provedores/novavida.js'
import { contatosEmpresa } from '../radar/contatos.js'
import { dominioEmpresa } from '../radar/dominios.js'

/**
 * O EXECUTOR DAS FERRAMENTAS (Prompt 09 §6.1): o efeito REAL de cada uma.
 *
 * Nenhuma é no-op. Cada ferramenta ou faz o que diz, ou devolve `ok: false` com o motivo
 * — e o motivo volta ao modelo, que contorna ou replaneja. "Enviar" não envia: enfileira na
 * `mensagens_outbox`, e a fila do 05A passa pelo portão (supressão, janela, teto, cooldown)
 * como qualquer mensagem da casa. "Ligar" não liga: enfileira na fila da Ana, com o portão
 * de permissão na transação. O agente nunca tem um caminho próprio que pule uma trava.
 *
 * As travas específicas de agente (§6, "guardrails dentro do loop") moram aqui, no ponto
 * mais próximo do efeito: tentativas por contato, cooldown mínimo ao mesmo contato, e a
 * trava de identificação sobre o texto que vai sair.
 */

export interface ContextoExecucao {
  mandato: MandatoCarregado
  agente: AgenteCarregado
  empresa: EmpresaCarregada | null
  cfg: ConfigAgentes
  versaoVoz: VersaoVoz
  /** Os objetivos que a v2 anunciou; `null` = sem restrição além da versão. */
  objetivosVoz: ObjetivoLigacao[] | null
  agora: Date
}

type Args = Record<string, unknown>
const ok = (resultado: unknown, custoRealCentavos?: number): ResultadoFerramenta => ({ ok: true, resultado, custoRealCentavos })
/** Recusa de trava (cooldown, tentativas, identificação): o agente foi contido, não falhou. */
const falha = (erro: string): ResultadoFerramenta => ({ ok: false, erro })
/** Falha de sistema (API fora, gravação que não entrou): conta para o disjuntor. */
const falhaTecnica = (erro: string): ResultadoFerramenta => ({ ok: false, erro, sinal: 'falha_tecnica' })

export async function executarFerramenta(id: IdFerramenta, input: unknown, ctx: ContextoExecucao): Promise<ResultadoFerramenta> {
  const a = (input ?? {}) as Args
  switch (id) {
    case 'consultar_empresa':
      return consultarEmpresa(ctx)
    case 'consultar_historico':
      return consultarHistorico(ctx, a)
    case 'consultar_contatos':
      return consultarContatos(ctx)
    case 'listar_materiais':
      return listarMateriais(a)
    case 'buscar_contatos_apollo':
      return buscarApollo(ctx, a)
    case 'enriquecer_telefone':
      return enriquecerTelefone(ctx)
    case 'buscar_dominio_empresa':
      return buscarDominio(ctx)
    case 'registrar_contato':
      return registrarContato(ctx, a)
    case 'atualizar_contato':
      return atualizarContato(ctx, a)
    case 'enviar_whatsapp':
      return enviarMensagem(ctx, { canal: 'whatsapp', contatoId: String(a.contato_id), texto: String(a.texto) })
    case 'enviar_email':
      return enviarMensagem(ctx, {
        canal: 'email',
        contatoId: String(a.contato_id),
        texto: String(a.texto),
        assunto: String(a.assunto),
      })
    case 'enviar_material':
      return enviarMaterial(ctx, a)
    case 'ligar':
      return ligar(ctx, a)
    case 'agendar_ligacao':
      return agendarLigacao(ctx, a)
    case 'consultar_agenda_closer':
      return consultarAgenda(ctx, a)
    case 'agendar_reuniao':
      return agendarReuniao(ctx, a)
    case 'mover_estagio_funil':
      return moverEstagio(ctx, a)
    case 'propor_mandato':
      return proporMandato(ctx, a)
    case 'escalar_humano':
      return escalar(ctx, a)
    case 'encerrar_mandato':
      return encerrar(ctx, a)
    case 'atualizar_plano':
      return atualizarPlano(ctx, a)
  }
}

// ─── Leitura ────────────────────────────────────────────────────────────────

async function consultarEmpresa(ctx: ContextoExecucao): Promise<ResultadoFerramenta> {
  const e = ctx.empresa
  if (!e) return falha('Empresa do mandato não encontrada.')
  const { data: analise } = await supabaseAdmin
    .from('analises_credito')
    .select('estagio, criada_em')
    .eq('empresa_id', e.id)
    .order('criada_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  return ok({
    razao_social: e.razao_social,
    nome_fantasia: e.nome_fantasia,
    cnpj: e.cnpj,
    cidade: `${e.municipio ?? '—'}/${e.uf ?? '—'}`,
    porte: e.porte,
    estagio: e.estagio,
    dominio: e.dominio,
    score: e.score_faixa,
    tipagem_antecipacao: e.tipagem_antecipacao,
    ex_cliente_desde: e.ex_cliente_desde,
    // O ESTÁGIO da análise, sem limite nem taxa: número de crédito não é assunto do agente.
    ultima_analise_de_credito: analise ? { estagio: analise.estagio, em: analise.criada_em } : null,
  })
}

async function consultarHistorico(ctx: ContextoExecucao, a: Args): Promise<ResultadoFerramenta> {
  const { data: conversas } = await supabaseAdmin.from('mandato_conversas').select('conversa_id').eq('mandato_id', ctx.mandato.id)
  const ids = (conversas ?? []).map((c) => c.conversa_id)
  let q = supabaseAdmin
    .from('comunicacoes')
    .select('direcao, canal, corpo, preview, por_ia, criado_em')
    .order('criado_em', { ascending: false })
    .limit(Number(a.limite ?? 20))
  q = ids.length ? q.in('conversa_id', ids) : q.eq('empresa_id', ctx.mandato.empresa_id)
  if (typeof a.antes_de === 'string') q = q.lt('criado_em', a.antes_de)
  const { data } = await q
  return ok(
    (data ?? []).map((m) => ({
      em: m.criado_em,
      quem: m.direcao === 'entrada' ? 'eles' : m.por_ia ? 'nós (IA)' : 'nós (equipe)',
      canal: m.canal,
      texto: (m.corpo ?? m.preview ?? '').slice(0, 800),
    })),
  )
}

async function consultarContatos(ctx: ContextoExecucao): Promise<ResultadoFerramenta> {
  const { data } = await supabaseAdmin
    .from('contatos')
    .select('id, nome, cargo, telefone, whatsapp, email, base_legal, nao_e_o_decisor, ponto_focal, origem')
    .eq('empresa_id', ctx.mandato.empresa_id)
    .limit(60)
  const tentados = new Map(ctx.mandato.contatos_tentados.map((t) => [t.contato_id, t]))
  return ok(
    (data ?? []).map((c) => ({
      id: c.id,
      nome: c.nome,
      cargo: c.cargo,
      tem_whatsapp: !!c.whatsapp,
      tem_telefone: !!(c.telefone || c.whatsapp),
      tem_email: !!c.email,
      base_legal: c.base_legal,
      nao_e_o_decisor: c.nao_e_o_decisor,
      ponto_focal: c.ponto_focal,
      origem: c.origem,
      tentativas: tentados.get(c.id)?.tentativas ?? 0,
      ultimo_resultado: tentados.get(c.id)?.ultimo_resultado ?? null,
    })),
  )
}

async function listarMateriais(a: Args): Promise<ResultadoFerramenta> {
  let q = supabaseAdmin.from('materiais').select('id, nome, descricao, quando_usar, tipo, canais').eq('ativo', true)
  if (a.canal === 'whatsapp' || a.canal === 'email') q = q.contains('canais', [a.canal])
  const { data } = await q.order('vezes_usado', { ascending: false }).limit(40)
  return ok(data ?? [])
}

// ─── Enriquecimento (pago) ──────────────────────────────────────────────────

async function buscarApollo(ctx: ContextoExecucao, a: Args): Promise<ResultadoFerramenta> {
  if (!ctx.empresa?.dominio) return falha('A empresa não tem domínio resolvido. Use buscar_dominio_empresa antes.')
  const antes = new Date().toISOString()
  try {
    const r = await contatosEmpresa({ empresaId: ctx.mandato.empresa_id, revelarTelefone: true })
    const cargos = (a.cargos as string[]).map((c) => c.toLowerCase())
    const { data } = await supabaseAdmin
      .from('contatos')
      .select('id, nome, cargo, email, telefone, telefone_status')
      .eq('empresa_id', ctx.mandato.empresa_id)
      .eq('origem', 'apollo')
      .gte('enriquecido_em', antes)
    const achados = (data ?? []).filter((c) => !cargos.length || cargos.some((k) => (c.cargo ?? '').toLowerCase().includes(k)))
    await adotarParaAbordagem(achados.map((c) => c.id), ctx, 'Apollo')
    return ok(
      {
        encontrados: achados.map((c) => ({ id: c.id, nome: c.nome, cargo: c.cargo, tem_email: !!c.email, telefone: c.telefone ? 'recebido' : c.telefone_status })),
        observacao: achados.length ? null : 'Nenhuma pessoa com esses cargos. Tente cargos mais amplos ou outro caminho.',
      },
      Math.round((r.custo ?? 0) * 100),
    )
  } catch (erro) {
    return falhaTecnica(`Apollo falhou: ${String(erro instanceof Error ? erro.message : erro)}`)
  }
}

async function enriquecerTelefone(ctx: ContextoExecucao): Promise<ResultadoFerramenta> {
  const cnpj = ctx.empresa?.cnpj
  if (!cnpj) return falha('A empresa não tem CNPJ.')
  const cadastral = await cadastralDoFornecedor(cnpj)
  const r = await buscarNaNovaVida(cadastral)
  if (!r.disponivel) return falhaTecnica(r.erro ?? 'Nova Vida indisponível.')
  if (r.erro) return falhaTecnica(`Nova Vida: ${r.erro}`)

  const criados: Array<{ id: string; nome: string | null; telefone: string; procon: boolean }> = []
  for (const c of r.contatos.filter((x) => x.tipo === 'telefone' || x.tipo === 'whatsapp')) {
    const tel = normalizarTelefoneBr(c.valor)
    if (!tel.valido || !tel.e164) continue
    const procon = (c.evidencia ?? '').toLowerCase().includes('no procon')
    // A marca do Procon fica também em `contatos_descobertos`, que é onde o portão da voz
    // a procura (app__voz_portao) — gravar só em `contatos` perderia a trava.
    await pool.query(
      `insert into contatos_descobertos (fornecedor_cnpj, tipo, valor, valor_original, nome_pessoa, cargo, fonte, confianca, evidencia)
       values ($1, $2, $3, $4, $5, $6, 'novavida', $7, $8)
       on conflict (fornecedor_cnpj, tipo, valor) do nothing`,
      [cnpj, c.tipo, tel.e164, c.original, c.nome_pessoa, c.cargo, c.confianca, c.evidencia],
    )
    const { data: existente } = await supabaseAdmin
      .from('contatos')
      .select('id')
      .eq('empresa_id', ctx.mandato.empresa_id)
      .or(`telefone.eq.${tel.e164},whatsapp.eq.${tel.e164}`)
      .limit(1)
      .maybeSingle()
    if (existente) continue
    const { data: novo } = await supabaseAdmin
      .from('contatos')
      .insert({
        empresa_id: ctx.mandato.empresa_id,
        nome: c.nome_pessoa ?? `${ctx.empresa?.razao_social ?? 'Empresa'} (telefone)`,
        cargo: c.cargo,
        telefone: tel.e164,
        whatsapp: c.tipo === 'whatsapp' || /whatsapp/i.test(c.evidencia ?? '') ? tel.e164 : null,
        origem: 'novavida',
        ...baseLegalDeAdocao(ctx, 'Nova Vida', c.evidencia),
      })
      .select('id, nome')
      .maybeSingle()
    if (novo) criados.push({ id: novo.id, nome: novo.nome, telefone: tel.formatado ?? tel.e164, procon })
  }
  return ok({ contatos_novos: criados, descartados_pela_base: r.descartados ?? 0 })
}

async function buscarDominio(ctx: ContextoExecucao): Promise<ResultadoFerramenta> {
  if (ctx.empresa?.dominio) return ok({ dominio: ctx.empresa.dominio, ja_existia: true }, 0)
  try {
    const r = await dominioEmpresa(ctx.mandato.empresa_id, { incluirClaude: true })
    if (ctx.empresa && r.dominio) ctx.empresa.dominio = r.dominio
    return ok({ dominio: r.dominio, origem: r.origem, confianca: r.confianca, motivo: r.motivo ?? null })
  } catch (erro) {
    return falhaTecnica(`Busca de domínio falhou: ${String(erro instanceof Error ? erro.message : erro)}`)
  }
}

/**
 * A BASE LEGAL de um contato que o AGENTE adota para abordagem (Apollo, Nova Vida).
 *
 * `manual`, com o detalhe dizendo quem adotou, de onde e em qual mandato — a mesma
 * derivação da 0196 (a adoção é o ato), aqui feita por um agente. Sem base, o portão da
 * voz recusa o contato, e "buscou no Apollo e ligou" — o caso que o módulo existe para
 * resolver — nunca aconteceria. ESTA É UMA DECISÃO DE POLÍTICA: a trilha fica na linha
 * para quem precisar defendê-la.
 */
function baseLegalDeAdocao(ctx: ContextoExecucao, fonte: string, evidencia?: string | null) {
  return {
    base_legal: 'manual',
    base_legal_em: new Date().toISOString(),
    base_legal_detalhe: `Adotado pelo agente ${ctx.agente.nome} no mandato ${ctx.mandato.codigo ?? ctx.mandato.id} a partir de ${fonte}${evidencia ? ` — ${evidencia.slice(0, 200)}` : ''}.`,
  }
}

async function adotarParaAbordagem(ids: string[], ctx: ContextoExecucao, fonte: string): Promise<void> {
  if (!ids.length) return
  await supabaseAdmin
    .from('contatos')
    .update(baseLegalDeAdocao(ctx, fonte))
    .in('id', ids)
    .is('base_legal', null)
}

// ─── Contatos ───────────────────────────────────────────────────────────────

async function registrarContato(ctx: ContextoExecucao, a: Args): Promise<ResultadoFerramenta> {
  const tel = a.telefone ? normalizarTelefoneBr(String(a.telefone)) : null
  if (a.telefone && !tel?.valido) return falha('Telefone inválido — confira DDD e número.')
  const e164 = tel?.e164 ?? null
  const email = typeof a.email === 'string' ? a.email.toLowerCase() : null

  // Já existe? Atualiza o que faltava em vez de duplicar a pessoa.
  const filtros = [e164 ? `telefone.eq.${e164}` : null, e164 ? `whatsapp.eq.${e164}` : null, email ? `email.eq.${email}` : null].filter(Boolean)
  const { data: existente } = await supabaseAdmin
    .from('contatos')
    .select('id, nome')
    .eq('empresa_id', ctx.mandato.empresa_id)
    .or(filtros.join(','))
    .limit(1)
    .maybeSingle()
  if (existente) return ok({ contato_id: existente.id, ja_existia: true, nome: existente.nome })

  const { data: novo, error } = await supabaseAdmin
    .from('contatos')
    .insert({
      empresa_id: ctx.mandato.empresa_id,
      nome: String(a.nome),
      cargo: (a.cargo as string | null) ?? null,
      telefone: e164,
      whatsapp: e164,
      email,
      origem: 'indicacao_na_conversa',
      // Indicação é base legal própria (0144): a evidência é o trecho que a justifica.
      base_legal: 'indicacao',
      base_legal_em: new Date().toISOString(),
      base_legal_detalhe: `${String(a.evidencia).slice(0, 400)} (mandato ${ctx.mandato.codigo ?? ctx.mandato.id})`,
    })
    .select('id')
    .maybeSingle()
  if (error || !novo) return falha(`Não foi possível registrar o contato: ${error?.message ?? 'sem retorno'}`)
  return ok({ contato_id: novo.id, ja_existia: false })
}

async function atualizarContato(ctx: ContextoExecucao, a: Args): Promise<ResultadoFerramenta> {
  const c = await contatoDaEmpresa(ctx, String(a.contato_id))
  if (!c) return falha('Contato não é desta empresa.')
  const patch: Record<string, unknown> = {}
  if (typeof a.cargo === 'string') patch.cargo = a.cargo
  if (typeof a.telefone === 'string') {
    const tel = normalizarTelefoneBr(a.telefone)
    if (!tel.valido) return falha('Telefone inválido.')
    patch.telefone = tel.e164
    patch.whatsapp = tel.e164
  }
  if (typeof a.email === 'string') patch.email = a.email.toLowerCase()
  // Nunca suprime: "não é o decisor" diz que ele não decide, não que não possa ser abordado.
  if (typeof a.nao_e_o_decisor === 'boolean') patch.nao_e_o_decisor = a.nao_e_o_decisor
  if (!Object.keys(patch).length) return falha('Nada para atualizar.')
  const { error } = await supabaseAdmin.from('contatos').update(patch).eq('id', c.id)
  if (error) return falha(error.message)
  return ok({ contato_id: c.id, atualizado: Object.keys(patch) })
}

interface ContatoLido {
  id: string
  nome: string | null
  telefone: string | null
  whatsapp: string | null
  email: string | null
  base_legal: string | null
}

async function contatoDaEmpresa(ctx: ContextoExecucao, id: string): Promise<ContatoLido | null> {
  const { data } = await supabaseAdmin
    .from('contatos')
    .select('id, nome, telefone, whatsapp, email, base_legal')
    .eq('id', id)
    .eq('empresa_id', ctx.mandato.empresa_id)
    .maybeSingle()
  return data ?? null
}

// ─── Travas por contato (§6 guardrails) ─────────────────────────────────────

async function travaDoContato(ctx: ContextoExecucao, contatoId: string): Promise<string | null> {
  const t = ctx.mandato.contatos_tentados.find((x) => x.contato_id === contatoId)
  if (t && t.tentativas >= ctx.agente.limites.tentativas_por_contato) {
    return `Este contato já foi tentado ${t.tentativas} vezes (limite ${ctx.agente.limites.tentativas_por_contato}). Tente outro contato ou encerre por contatos esgotados.`
  }
  const minutos = ctx.agente.limites.cooldown_minutos_mesmo_contato
  if (minutos > 0) {
    const { data: ultimaSaida } = await supabaseAdmin
      .from('comunicacoes')
      .select('criado_em')
      .eq('contato_id', contatoId)
      .eq('direcao', 'saida')
      .order('criado_em', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (ultimaSaida) {
      const { data: ultimaEntrada } = await supabaseAdmin
        .from('comunicacoes')
        .select('criado_em')
        .eq('contato_id', contatoId)
        .eq('direcao', 'entrada')
        .gt('criado_em', ultimaSaida.criado_em)
        .limit(1)
        .maybeSingle()
      const decorrido = (ctx.agora.getTime() - new Date(ultimaSaida.criado_em).getTime()) / 60_000
      // Responder a quem acabou de escrever não é insistir.
      if (!ultimaEntrada && decorrido < minutos) {
        return `Falamos com este contato há ${Math.round(decorrido)} min (mínimo ${minutos} min). Espere ou use outro contato.`
      }
    }
  }
  return null
}

async function marcarTentativa(ctx: ContextoExecucao, contato: ContatoLido, canal: string, resultado: string): Promise<void> {
  const lista = [...ctx.mandato.contatos_tentados]
  const i = lista.findIndex((t) => t.contato_id === contato.id)
  const agora = ctx.agora.toISOString()
  const item: ContatoTentado =
    i >= 0
      ? { ...lista[i]!, canal, tentativas: lista[i]!.tentativas + 1, ultimo_resultado: resultado, ultima_em: agora }
      : { contato_id: contato.id, nome: contato.nome, canal, tentativas: 1, ultimo_resultado: resultado, ultima_em: agora }
  if (i >= 0) lista[i] = item
  else lista.push(item)
  ctx.mandato.contatos_tentados = lista
  await supabaseAdmin.from('mandatos').update({ contatos_tentados: lista as never }).eq('id', ctx.mandato.id)
}

// ─── Mensagens ──────────────────────────────────────────────────────────────

async function enviarMensagem(
  ctx: ContextoExecucao,
  m: { canal: 'whatsapp' | 'email'; contatoId: string; texto: string; assunto?: string; anexos?: unknown[] },
): Promise<ResultadoFerramenta> {
  const c = await contatoDaEmpresa(ctx, m.contatoId)
  if (!c) return falha('Contato não é desta empresa.')

  const identidade = violaIdentificacao(`${m.assunto ?? ''}\n${m.texto}`)
  if (identidade) {
    return falha(`Mensagem bloqueada pela regra de identificação (${identidade}). Reescreva sem afirmar ser humano nem inventar vida pessoal.`)
  }

  const trava = await travaDoContato(ctx, c.id)
  if (trava) return falha(trava)

  let destinatario: string | null = null
  if (m.canal === 'whatsapp') {
    const tel = normalizarTelefoneBr(c.whatsapp ?? c.telefone)
    if (!tel.valido || !tel.e164) return falha('Contato sem WhatsApp/telefone válido.')
    destinatario = tel.e164.replace(/^\+/, '')
    if (!ctx.agente.whatsapp_conta_id) return falha('Você não tem linha de WhatsApp própria — use e-mail ou ligação.')
  } else {
    if (!c.email) return falha('Contato sem e-mail.')
    destinatario = c.email
  }

  const corpo =
    m.canal === 'email' && ctx.agente.persona.assinatura_email && !m.texto.includes(ctx.agente.persona.assinatura_email)
      ? `${m.texto}\n\n${ctx.agente.persona.assinatura_email}`
      : m.texto

  const { data, error } = await supabaseAdmin
    .from('mensagens_outbox')
    .insert({
      canal: m.canal,
      destinatario,
      destinatario_contato_id: c.id,
      assunto: m.assunto ?? null,
      corpo,
      status: 'aprovada',
      origem: 'agente',
      por_ia: true,
      empresa_id: ctx.mandato.empresa_id,
      vendedor_id: ctx.agente.id,
      whatsapp_conta_id: m.canal === 'whatsapp' ? ctx.agente.whatsapp_conta_id : null,
      funil: ctx.mandato.tipo === 'originacao_nf' ? 'nfs' : 'sdr',
      funil_card_id: ctx.mandato.nota_access_key,
      access_keys: ctx.mandato.nota_access_key ? [ctx.mandato.nota_access_key] : [],
      mandato_id: ctx.mandato.id,
      ...(m.anexos?.length ? { anexos: m.anexos as never } : {}),
    })
    .select('id')
    .maybeSingle()
  if (error || !data) return falhaTecnica(`Não foi possível enfileirar: ${error?.message ?? 'sem retorno'}`)

  await marcarTentativa(ctx, c, m.canal, 'mensagem enfileirada')
  return {
    ok: true,
    sinal: 'ok',
    resultado: {
      outbox_id: data.id,
      status: 'na fila de envio — sai pela fila da comunicação (supressão, janela e cooldown valem). Se for recusada, você verá no próximo ciclo.',
    },
  }
}

async function enviarMaterial(ctx: ContextoExecucao, a: Args): Promise<ResultadoFerramenta> {
  const { data: mat } = await supabaseAdmin
    .from('materiais')
    .select('id, nome, tipo, arquivo_path, url, corpo, canais, ativo')
    .eq('id', String(a.material_id))
    .maybeSingle()
  if (!mat || !mat.ativo) return falha('Material não encontrado ou aposentado.')
  const canal = a.canal as 'whatsapp' | 'email'
  if (!(mat.canais ?? []).includes(canal)) return falha(`Este material não é para ${canal}.`)

  const frase = typeof a.texto === 'string' && a.texto.trim() ? a.texto.trim() : ''
  let texto = frase
  let anexos: unknown[] = []
  if (mat.tipo === 'texto') texto = [frase, mat.corpo ?? ''].filter(Boolean).join('\n\n')
  else if (mat.tipo === 'link') texto = [frase, mat.url ?? ''].filter(Boolean).join('\n')
  else if (mat.arquivo_path) {
    anexos = [{ nome: mat.nome, bucket: 'agentes-materiais', caminho: mat.arquivo_path, mime: mimeDoTipo(mat.tipo, mat.arquivo_path) }]
    texto = frase || mat.nome
  } else if (mat.url) texto = [frase, mat.url].filter(Boolean).join('\n')

  const r = await enviarMensagem(ctx, {
    canal,
    contatoId: String(a.contato_id),
    texto,
    assunto: canal === 'email' ? mat.nome : undefined,
    anexos,
  })
  if (r.ok) {
    await pool.query('update materiais set vezes_usado = vezes_usado + 1 where id = $1', [mat.id])
    return ok({ ...(r.resultado as object), material: mat.nome })
  }
  return r
}

function mimeDoTipo(tipo: string, caminho: string): string {
  const ext = caminho.split('.').pop()?.toLowerCase() ?? ''
  if (tipo === 'pdf' || ext === 'pdf') return 'application/pdf'
  if (tipo === 'imagem') return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
  if (tipo === 'video') return 'video/mp4'
  return 'application/octet-stream'
}

// ─── Voz ────────────────────────────────────────────────────────────────────

async function ligar(ctx: ContextoExecucao, a: Args): Promise<ResultadoFerramenta> {
  const c = await contatoDaEmpresa(ctx, String(a.contato_id))
  if (!c) return falha('Contato não é desta empresa.')
  const tel = normalizarTelefoneBr(c.whatsapp ?? c.telefone)
  if (!tel.valido || !tel.e164) return falha('Contato sem telefone válido.')
  const trava = await travaDoContato(ctx, c.id)
  if (trava) return falha(trava)

  const objetivo = a.objetivo as ObjetivoLigacao
  const cfgVoz = await lerConfigVoz()
  if (!cfgVoz.ligada) return falha('A voz está desligada na configuração — use WhatsApp ou e-mail.')

  // Checagem ANTECIPADA do adapter, com a oferta montada agora: o agente descobre neste
  // passo, e não daqui a meia hora, que a v1 não liga para agendar reunião.
  let pedidoV1 = null
  if (objetivo === 'ofertar_antecipacao') {
    if (!ctx.mandato.nota_access_key) return falha('Ofertar antecipação exige a NF do mandato.')
    const fresco = await remontarPedidoDaNota({ accessKey: ctx.mandato.nota_access_key, contatoId: c.id, telefone: tel.e164, cfg: cfgVoz })
    if (!fresco.ok) return falha(`A oferta não pode ser dita ao telefone agora: ${fresco.motivo}.`)
    pedidoV1 = fresco.pedido
  }

  /*
   * ── AGENDAR POR TELEFONE: AS JANELAS SÃO NOSSAS, NÃO DO MODELO ──────────────
   * A v2 da Ana só liga para agendar com um conjunto FECHADO de janelas: ela oferece uma
   * delas ou devolve `agendar_retorno`. O modelo não passa janela nenhuma (o schema de
   * `ligar` nem tem o campo) — elas saem daqui, da mesma conta de
   * `consultar_agenda_closer` (closer, substituto, horário, buffer, reservas vivas), e
   * ficam RESERVADAS para esta ligação. Sem isto toda ligação de agendamento morria em
   * `falta_janelas` no adapter.
   *
   * A reserva dura até o FIM DO EXPEDIENTE DA ANA em que ela deve discar
   * (`fimDoExpedienteDaVoz`). A fila dela é uma ligação por vez, só das 9h às 18h em dia
   * útil, e ela confere o `expira_em` de cada janela na hora de oferecer: uma reserva de
   * uma hora morria antes da discagem sempre que a fila passava de vinte ligações ou virava
   * a noite. Pelo mesmo motivo as janelas começam DEPOIS desse instante — uma janela de
   * hoje às 16h, oferecida numa ligação discada às 17h, já seria passado.
   *
   * Quando o resultado volta, as não escolhidas são devolvidas e a escolhida é reconferida
   * antes de virar reunião (voz-mandato.ts). Ligação não discada até o fim do expediente é
   * cancelada na Ana pela varredura (varrer-orfas.ts), e as reservas vencem junto.
   *
   * Na v1 nada é reservado: o adapter recusa o objetivo logo abaixo, com o erro dele.
   */
  let janelas: JanelaOferecida[] | undefined
  let rotulos: string[] = []
  let closerDaLigacao: string | null = null
  if (objetivo === 'agendar_reuniao' && ctx.versaoVoz === 'v2') {
    const g = ctx.cfg.geral
    const limite = fimDoExpedienteDaVoz(ctx.agora)
    const minutos = Math.ceil((limite.getTime() - ctx.agora.getTime()) / 60_000)
    // Antecedência = até o limite, mais o buffer de reunião: a janela começa depois dele.
    const r = await reservarJanelasDoCloser(ctx, 3, minutos, minutos + g.reuniao_buffer_min)
    if (!r.ok) return falha(`Não dá para ligar para agendar: ${r.erro}`)
    janelas = r.janelas.map((j) => ({ id: j.reserva_id, inicio: j.inicio, fim: j.fim, expira_em: limite.toISOString() }))
    rotulos = r.janelas.map((j) => j.rotulo)
    closerDaLigacao = r.closerNome
  }
  const devolverJanelas = async () => {
    if (!janelas?.length) return
    await supabaseAdmin
      .from('agenda_reservas')
      .update({ expira_em: new Date().toISOString() })
      .in('id', janelas.map((j) => j.id))
      .is('confirmada_em', null)
  }

  const contexto = {
    objetivo,
    contato: { id: c.id, nome: c.nome ?? 'responsável', telefone_e164: tel.e164, email: c.email },
    empresa: { razao_social: ctx.empresa?.razao_social ?? '—', cnpj: ctx.empresa?.cnpj ?? null },
    persona: { nome: ctx.agente.persona.nome_exibicao, voz_conta_id: ctx.agente.voz_conta_id },
    motivo: String(a.motivo),
    identificacao: ctx.cfg.geral.identificacao,
    ...(janelas ? { janelas } : {}),
  }
  const previa = traduzirPedido(ctx.versaoVoz, { ...contexto, id_externo: 'previa', pedido_v1: pedidoV1 }, ctx.objetivosVoz)
  if (!previa.ok) {
    await devolverJanelas()
    return falha(previa.erro)
  }

  const { data, error } = await supabaseAdmin.rpc('app__voz_enfileirar_mandato', {
    p: {
      mandato_id: ctx.mandato.id,
      contato_id: c.id,
      telefone: tel.e164,
      objetivo,
      contexto,
    } as never,
  })
  if (error) {
    await devolverJanelas()
    return { ok: false, erro: error.message, sinal: /suprim|procurado/i.test(error.message) ? 'supressao' : 'neutro' }
  }
  await marcarTentativa(ctx, c, 'ligacao', 'ligação na fila da Ana')
  const linha = data as { id: string; id_externo: string }
  return ok({
    voz_ligacao_id: linha.id,
    id_externo: linha.id_externo,
    status: 'na fila da Ana — ela liga em horário comercial e o resultado volta sozinho, acordando o mandato.',
    ...(janelas
      ? {
          closer: closerDaLigacao,
          janelas_oferecidas: rotulos,
          observacao:
            'A Ana oferece SOMENTE estas janelas. Se a pessoa aceitar uma, a reunião é marcada sozinha quando o resultado voltar — não chame agendar_reuniao para esta ligação.',
        }
      : {}),
  })
}

async function agendarLigacao(ctx: ContextoExecucao, a: Args): Promise<ResultadoFerramenta> {
  const c = await contatoDaEmpresa(ctx, String(a.contato_id))
  if (!c) return falha('Contato não é desta empresa.')
  const quando = new Date(String(a.quando))
  if (Number.isNaN(quando.getTime()) || quando.getTime() <= ctx.agora.getTime()) {
    return falha('Horário inválido ou no passado.')
  }
  // O mandato acorda na hora combinada; a decisão de LIGAR é tomada então, com o portão
  // e a oferta de naquele momento. O plano precisa refletir isso (próxima ação).
  await supabaseAdmin.from('mandatos').update({ proxima_acao_em: quando.toISOString(), estado: 'aguardando_externo' }).eq('id', ctx.mandato.id)
  return ok({ agendado_para: quando.toISOString(), contato: c.nome, motivo: a.motivo })
}

// ─── Agenda e reunião (§7) ──────────────────────────────────────────────────

async function consultarAgenda(ctx: ContextoExecucao, a: Args): Promise<ResultadoFerramenta> {
  const g = ctx.cfg.geral
  const r = await reservarJanelasDoCloser(ctx, Number(a.quantas ?? 3), g.reserva_janela_min)
  if (!r.ok) return falha(r.erro)
  return ok({
    closer: r.closerNome,
    substituto: r.substituto,
    janelas: r.janelas,
    reservadas_por_minutos: g.reserva_janela_min,
    instrucao: 'Ofereça SOMENTE estas janelas. Para marcar, use agendar_reuniao com o reserva_id da escolhida.',
  })
}

type JanelaReservada = { reserva_id: string; inicio: string; fim: string; rotulo: string }
type JanelasDoCloser =
  | { ok: true; closerNome: string | null; substituto: boolean; janelas: JanelaReservada[] }
  | { ok: false; erro: string }

/**
 * As janelas livres do closer designado (ou do substituto), já RESERVADAS para este
 * mandato por `minutos`. É a mesma conta para quem oferece no chat
 * (`consultar_agenda_closer`) e para quem oferece por telefone (`ligar` com
 * `agendar_reuniao`): duas contas para "quando o closer está livre" divergiriam no
 * primeiro buffer que alguém mudasse.
 */
async function reservarJanelasDoCloser(
  ctx: ContextoExecucao,
  quantas: number,
  minutos: number,
  /** Nenhuma janela começa antes disto (a partir de agora). Omitido: o padrão do core, 2 h. */
  antecedenciaMin?: number,
): Promise<JanelasDoCloser> {
  const g = ctx.cfg.geral
  const candidatos = [ctx.agente.closer_id, ctx.agente.closer_substituto_id].filter((x): x is string => !!x)
  if (!candidatos.length) return { ok: false, erro: 'O agente não tem closer designado.' }

  const { data: closers } = await supabaseAdmin
    .from('vendedores')
    .select('id, nome, ausente_ate, settings')
    .in('id', candidatos)
  const porId = new Map((closers ?? []).map((c) => [c.id, c]))

  const calcular = async (id: string | null) => {
    if (!id || !porId.has(id)) return null
    const c = porId.get(id)!
    const ocupados = await ocupadosDoCloser(id, ctx.agora, g.horizonte_agendamento_dias_uteis + 7)
    const { data: reservas } = await supabaseAdmin
      .from('agenda_reservas')
      .select('inicio, fim, expira_em, mandato_id')
      .eq('closer_id', id)
      .is('confirmada_em', null)
      .gt('expira_em', ctx.agora.toISOString())
    const horario = horarioDoCloser(c.settings, ctx.cfg)
    const janelas = janelasLivres({
      agora: ctx.agora,
      horario,
      horizonteDiasUteis: g.horizonte_agendamento_dias_uteis,
      duracaoMin: g.reuniao_duracao_min,
      bufferMin: g.reuniao_buffer_min,
      ocupados,
      reservas: (reservas ?? []).map((r) => ({ inicio: new Date(r.inicio), fim: new Date(r.fim), expiraEm: new Date(r.expira_em), mandatoId: r.mandato_id })),
      mandatoId: ctx.mandato.id,
      quantas,
      antecedenciaMinimaMin: antecedenciaMin,
    })
    return { id, ausenteAte: c.ausente_ate, janelas }
  }

  const escolha = escolherCloser(await calcular(ctx.agente.closer_id), await calcular(ctx.agente.closer_substituto_id), ctx.agora)
  if (!escolha.ok && escolha.motivo === 'sem_janela') {
    // §7: interesse com pendência — o gestor precisa saber que a agenda é o gargalo.
    await supabaseAdmin.from('empresa_eventos').insert({
      empresa_id: ctx.mandato.empresa_id,
      tipo: 'agentes.sem_janela',
      payload: {
        titulo: `Sem janela de closer para ${ctx.empresa?.razao_social ?? 'uma empresa'}`,
        resumo: `${ctx.agente.nome} tem interesse em reunião e nem o closer nem o substituto têm horário nos próximos ${ctx.cfg.geral.horizonte_agendamento_dias_uteis} dias úteis.`,
        url: `/agentes/mandatos?m=${ctx.mandato.id}`,
        mandato_id: ctx.mandato.id,
      } as never,
    })
  }
  if (!escolha.ok) {
    return {
      ok: false,
      erro:
        escolha.motivo === 'sem_janela'
          ? 'Nem o closer nem o substituto têm janela no horizonte. Registre o interesse no plano como pendência e escale para o gestor.'
          : 'O agente não tem closer designado.',
    }
  }

  const reservadas: JanelaReservada[] = []
  for (const j of escolha.janelas as Intervalo[]) {
    const { data } = await supabaseAdmin.rpc('app__agenda_reservar', {
      p: {
        closer_id: escolha.closerId,
        mandato_id: ctx.mandato.id,
        inicio: j.inicio.toISOString(),
        fim: j.fim.toISOString(),
        minutos,
      } as never,
    })
    const r = data as { ok: boolean; reserva_id?: string } | null
    if (r?.ok && r.reserva_id) {
      reservadas.push({ reserva_id: r.reserva_id, inicio: j.inicio.toISOString(), fim: j.fim.toISOString(), rotulo: rotuloDaJanela(j, ctx.cfg.janela.timezone) })
    }
  }
  if (!reservadas.length) return { ok: false, erro: 'As janelas acabaram de ser tomadas por outra conversa. Consulte de novo.' }
  return { ok: true, closerNome: porId.get(escolha.closerId)?.nome ?? null, substituto: escolha.substituto, janelas: reservadas }
}

function horarioDoCloser(settings: unknown, cfg: ConfigAgentes) {
  const ag = (settings && typeof settings === 'object' ? (settings as { agenda?: Record<string, unknown> }).agenda : null) ?? {}
  return {
    hora_inicio: typeof ag.hora_inicio === 'number' ? ag.hora_inicio : cfg.janela.hora_inicio,
    hora_fim: typeof ag.hora_fim === 'number' ? ag.hora_fim : cfg.janela.hora_fim,
    dias_semana: Array.isArray(ag.dias_semana) ? (ag.dias_semana as number[]) : cfg.janela.dias_semana,
    timezone: cfg.janela.timezone,
  }
}

async function agendarReuniao(ctx: ContextoExecucao, a: Args): Promise<ResultadoFerramenta> {
  const c = await contatoDaEmpresa(ctx, String(a.contato_id))
  if (!c) return falha('Contato não é desta empresa.')
  const { data: reserva } = await supabaseAdmin
    .from('agenda_reservas')
    .select('id, closer_id, inicio, fim, expira_em, mandato_id, confirmada_em')
    .eq('id', String(a.reserva_id))
    .maybeSingle()
  if (!reserva || reserva.mandato_id !== ctx.mandato.id) return falha('Reserva desconhecida para este mandato. Consulte a agenda de novo.')
  if (reserva.confirmada_em) return falha('Esta janela já foi confirmada.')
  if (new Date(reserva.expira_em).getTime() < ctx.agora.getTime()) {
    return falha('A reserva desta janela expirou. Consulte a agenda de novo antes de confirmar.')
  }

  const duracao = Math.round((new Date(reserva.fim).getTime() - new Date(reserva.inicio).getTime()) / 60_000)
  const resumoPlano = ctx.mandato.plano?.hipotese ? `\nContexto: ${ctx.mandato.plano.hipotese}` : ''
  const { data, error } = await supabaseAdmin.rpc('app__agente_agendar_reuniao', {
    p: {
      mandato_id: ctx.mandato.id,
      closer_id: reserva.closer_id,
      inicio: reserva.inicio,
      duracao_min: duracao,
      modalidade: a.modalidade ?? 'meet',
      local: a.local ?? null,
      reserva_id: reserva.id,
      participantes: [{ nome: c.nome, email: c.email, contato_id: c.id }],
      descricao:
        `Reunião marcada pelo agente ${ctx.agente.nome} (${ctx.mandato.codigo ?? ''}).\n` +
        `Objetivo do mandato: ${ctx.mandato.objetivo}${resumoPlano}\n` +
        `Contato: ${c.nome ?? '—'}${c.email ? ` <${c.email}>` : ''}`,
    } as never,
  })
  if (error) return falha(error.message)
  await marcarTentativa(ctx, c, 'reuniao', 'reunião marcada')
  return ok({
    ...(data as object),
    quando: rotuloDaJanela({ inicio: new Date(reserva.inicio), fim: new Date(reserva.fim) }, ctx.cfg.janela.timezone),
    observacao: c.email
      ? 'O convite sai pelo Google Agenda do closer.'
      : 'O contato não tem e-mail: confirme a reunião com ele por WhatsApp (o convite do Google vai só para o closer).',
  })
}

// ─── Funil, propostas, saída ────────────────────────────────────────────────

async function moverEstagio(ctx: ContextoExecucao, a: Args): Promise<ResultadoFerramenta> {
  const { data, error } = await supabaseAdmin.rpc('app__agente_mover_estagio', {
    p: { mandato_id: ctx.mandato.id, estagio: a.estagio } as never,
  })
  if (error) return falha(error.message)
  const r = data as { movido: boolean; motivo?: string }
  return r.movido ? ok(r) : falha(`Não movido: ${r.motivo ?? 'estágio atual não permite'}.`)
}

async function proporMandato(ctx: ContextoExecucao, a: Args): Promise<ResultadoFerramenta> {
  const { data, error } = await supabaseAdmin
    .from('mandato_propostas')
    .insert({
      mandato_origem_id: ctx.mandato.id,
      tipo: String(a.tipo),
      objetivo: String(a.objetivo),
      justificativa: String(a.justificativa),
      empresa_id: ctx.mandato.empresa_id,
      agente_id: ctx.agente.id,
    })
    .select('id')
    .maybeSingle()
  if (error || !data) return falha(error?.message ?? 'Falha ao registrar a proposta.')
  await pool.query(
    `insert into empresa_eventos (empresa_id, tipo, payload) values ($1, 'agentes.proposta_pendente', $2::jsonb)`,
    [
      ctx.mandato.empresa_id,
      JSON.stringify({
        titulo: 'Proposta de mandato aguardando aprovação',
        resumo: `${ctx.agente.nome} propôs: ${String(a.objetivo)}`,
        url: `/agentes/mandatos?proposta=${data.id}`,
        proposta_id: data.id,
      }),
    ],
  )
  return ok({ proposta_id: data.id, status: 'aguardando aprovação humana — siga o mandato atual.' })
}

async function escalar(ctx: ContextoExecucao, a: Args): Promise<ResultadoFerramenta> {
  const motivo = String(a.motivo)
  await supabaseAdmin
    .from('mandatos')
    .update({ estado: 'escalado', motivo_encerramento: 'escalado_humano', resultado: motivo, encerrado_em: ctx.agora.toISOString(), proxima_acao_em: null })
    .eq('id', ctx.mandato.id)
  // As conversas do mandato viram de uma pessoa (§1.4): saem de toda varredura automática.
  await pool.query(
    `update conversas c set status = 'aguardando_humano', modo_agente = 'sugestao'
       from mandato_conversas mc where mc.mandato_id = $1 and mc.conversa_id = c.id and c.status <> 'encerrada'`,
    [ctx.mandato.id],
  )
  await emitirMandato(ctx, 'mandato.escalado', `Escalado para uma pessoa: ${motivo}`)
  return { ok: true, resultado: { escalado: true }, sinal: 'escalacao' }
}

async function encerrar(ctx: ContextoExecucao, a: Args): Promise<ResultadoFerramenta> {
  const sucesso = Boolean(a.sucesso)
  await supabaseAdmin
    .from('mandatos')
    .update({
      estado: sucesso ? 'concluido' : 'encerrado_sem_sucesso',
      motivo_encerramento: String(a.motivo),
      resultado: String(a.resultado),
      encerrado_em: ctx.agora.toISOString(),
      proxima_acao_em: null,
    })
    .eq('id', ctx.mandato.id)
  await emitirMandato(ctx, sucesso ? 'mandato.concluido' : 'mandato.encerrado', String(a.resultado))
  const motivo = String(a.motivo)
  return {
    ok: true,
    resultado: { encerrado: true, sucesso },
    sinal: motivo === 'pediu_nao_contatar' ? 'supressao' : motivo === 'sem_interesse' ? 'sem_interesse' : 'ok',
  }
}

async function atualizarPlano(ctx: ContextoExecucao, a: Args): Promise<ResultadoFerramenta> {
  const plano = a.plano as MandatoCarregado['plano']
  const versao = ctx.mandato.plano_versao + 1
  const { error } = await supabaseAdmin.from('mandato_plano_versoes').insert({
    mandato_id: ctx.mandato.id,
    versao,
    plano: plano as never,
    motivo: String(a.motivo),
  })
  if (error) return falha(`Não foi possível gravar o plano: ${error.message}`)
  await supabaseAdmin.from('mandatos').update({ plano: plano as never, plano_versao: versao }).eq('id', ctx.mandato.id)
  ctx.mandato.plano = plano
  ctx.mandato.plano_versao = versao
  return ok({ versao, proxima: plano?.proximas_acoes[0]?.quando ?? null })
}

async function emitirMandato(ctx: ContextoExecucao, tipo: string, resumo: string): Promise<void> {
  const { data: closer } = ctx.agente.closer_id
    ? await supabaseAdmin.from('vendedores').select('usuario_id').eq('id', ctx.agente.closer_id).maybeSingle()
    : { data: null }
  const { error } = await supabaseAdmin.from('empresa_eventos').insert({
    empresa_id: ctx.mandato.empresa_id,
    tipo,
    payload: {
      titulo: `${ctx.agente.nome}: ${ctx.mandato.codigo ?? 'mandato'}`,
      resumo,
      url: `/agentes/mandatos?m=${ctx.mandato.id}`,
      mandato_id: ctx.mandato.id,
      agente_id: ctx.agente.id,
      destinatarios: closer?.usuario_id ? [closer.usuario_id] : [],
    } as never,
  })
  if (error) logger.error({ tipo, erro: error.message }, 'Falha ao emitir evento do mandato.')
}
