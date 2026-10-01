import type { BlocoContexto } from '../../../../packages/core/src/agentes/loop.js'
import {
  lerLimitesAgente,
  personaSchema,
  TIPO_MANDATO_LABELS,
  type ConfigAgentes,
  type LimitesAgente,
  type Persona,
  type PlanoMandato,
  type TipoMandato,
} from '../../../../packages/core/src/agentes/schemas.js'
import { supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'

/**
 * O QUE O AGENTE SABE A CADA CICLO (Prompt 09 §6, passo 3).
 *
 * Mandato e plano atual, playbook, as últimas 30 mensagens de TODAS as conversas do
 * mandato, os desfechos das ligações, os contatos conhecidos e os já tentados (com o
 * resultado), a empresa, o catálogo de materiais, o orçamento e as cotas que restam.
 *
 * ─── O QUE NÃO ENTRA ────────────────────────────────────────────────────────
 * Taxa e líquido da operação não entram como texto livre: quem fala números é a ligação
 * (a Ana, com o pedido montado pelo portão de conteúdo) ou a proposta da plataforma. O que
 * o modelo não sabe, ele não cita — e a regra "nunca fale de valores que não vieram no
 * contexto" só é verificável se o contexto for este, e não "tudo que está no banco".
 */

export interface MandatoCarregado {
  id: string
  codigo: string | null
  tipo: TipoMandato
  objetivo: string
  estado: string
  empresa_id: string
  nota_access_key: string | null
  agente_id: string
  playbook_id: string | null
  prioridade: number
  orcamento_centavos: number
  gasto_centavos: number
  max_acoes: number
  acoes_executadas: number
  expira_em: string
  plano: PlanoMandato | null
  plano_versao: number
  contatos_tentados: ContatoTentado[]
  proxima_acao_em: string | null
  criado_em: string
}

export interface ContatoTentado {
  contato_id: string
  nome: string | null
  canal: string
  tentativas: number
  ultimo_resultado: string | null
  ultima_em: string
}

export interface AgenteCarregado {
  id: string
  nome: string
  tipo: string
  persona: Persona
  whatsapp_conta_id: string | null
  email_caixa_id: string | null
  email_remetente: string | null
  voz_conta_id: string | null
  closer_id: string | null
  closer_substituto_id: string | null
  limites: LimitesAgente
  autonomo: boolean
  ativo: boolean
  pausado_em: string | null
}

export interface EmpresaCarregada {
  id: string
  cnpj: string | null
  razao_social: string | null
  nome_fantasia: string | null
  uf: string | null
  municipio: string | null
  porte: string | null
  estagio: string | null
  dominio: string | null
  score_faixa: string | null
  tipagem_antecipacao: string | null
  ex_cliente_desde: string | null
  bloqueio_cobranca: boolean | null
}

// prettier-ignore
const COLUNAS_MANDATO = 'id, codigo, tipo, objetivo, estado, empresa_id, nota_access_key, agente_id, playbook_id, prioridade, orcamento_centavos, gasto_centavos, max_acoes, acoes_executadas, expira_em, plano, plano_versao, contatos_tentados, proxima_acao_em, criado_em'
// prettier-ignore
const COLUNAS_AGENTE = 'id, nome, tipo, persona, whatsapp_conta_id, email_caixa_id, email_remetente, voz_conta_id, closer_id, closer_substituto_id, limites, autonomo, ativo, pausado_em'
// prettier-ignore
const COLUNAS_EMPRESA = 'id, cnpj, razao_social, nome_fantasia, uf, municipio, porte, estagio, dominio, score_faixa, tipagem_antecipacao, ex_cliente_desde, bloqueio_cobranca'

export async function carregarMandato(id: string): Promise<MandatoCarregado | null> {
  const { data } = await supabaseAdmin.from('mandatos').select(COLUNAS_MANDATO).eq('id', id).maybeSingle()
  if (!data) return null
  return {
    ...(data as unknown as MandatoCarregado),
    contatos_tentados: Array.isArray(data.contatos_tentados) ? (data.contatos_tentados as unknown as ContatoTentado[]) : [],
    plano: (data.plano as unknown as PlanoMandato | null) ?? null,
  }
}

export async function carregarAgente(id: string): Promise<AgenteCarregado | null> {
  const { data } = await supabaseAdmin.from('vendedores').select(COLUNAS_AGENTE).eq('id', id).maybeSingle()
  if (!data) return null
  const persona = personaSchema.safeParse(data.persona ?? { nome_exibicao: data.nome })
  return {
    ...(data as unknown as AgenteCarregado),
    persona: persona.success ? persona.data : { nome_exibicao: data.nome, genero_gramatical: 'feminino' },
    limites: lerLimitesAgente(data.limites),
  }
}

export async function carregarEmpresa(id: string): Promise<EmpresaCarregada | null> {
  const { data } = await supabaseAdmin.from('empresas').select(COLUNAS_EMPRESA).eq('id', id).maybeSingle()
  return (data as EmpresaCarregada | null) ?? null
}

/** O playbook do mandato: o dele, ou o ativo de maior versão para o tipo. */
export async function carregarPlaybook(
  m: Pick<MandatoCarregado, 'playbook_id' | 'tipo'>,
): Promise<{ id: string; nome: string; instrucoes: string; acoes_permitidas: string[] } | null> {
  const q = supabaseAdmin.from('agente_playbooks').select('id, nome, instrucoes, acoes_permitidas')
  if (m.playbook_id) {
    const { data } = await q.eq('id', m.playbook_id).maybeSingle()
    if (data) return data
  }
  const { data } = await supabaseAdmin
    .from('agente_playbooks')
    .select('id, nome, instrucoes, acoes_permitidas')
    .eq('tipo_mandato', m.tipo)
    .eq('ativo', true)
    .order('versao', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ?? null
}

export interface CotasUsadas {
  ligacoes: number
  mensagens: number
  emails: number
}

const inicioDoDiaSp = (): string => {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  return new Date(`${hoje}T00:00:00-03:00`).toISOString()
}

/** O que o agente já gastou das cotas diárias (§9.1), contado pelas ações bem-sucedidas de hoje. */
export async function cotasUsadasHoje(agenteId: string): Promise<CotasUsadas> {
  const { data } = await supabaseAdmin
    .from('mandato_acoes')
    .select('ferramenta, argumentos')
    .eq('agente_id', agenteId)
    .eq('sucesso', true)
    .in('ferramenta', ['ligar', 'enviar_whatsapp', 'enviar_email', 'enviar_material'])
    .gte('executada_em', inicioDoDiaSp())
  const acc: CotasUsadas = { ligacoes: 0, mensagens: 0, emails: 0 }
  for (const a of data ?? []) {
    const canal = (a.argumentos as { canal?: string } | null)?.canal
    if (a.ferramenta === 'ligar') acc.ligacoes++
    else if (a.ferramenta === 'enviar_whatsapp' || (a.ferramenta === 'enviar_material' && canal === 'whatsapp')) acc.mensagens++
    else acc.emails++
  }
  return acc
}

/** Ações EXTERNAS deste mandato hoje — o que `acoes_por_mandato_por_dia` limita. */
export async function acoesDoMandatoHoje(mandatoId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('mandato_acoes')
    .select('id', { count: 'exact', head: true })
    .eq('mandato_id', mandatoId)
    .eq('sucesso', true)
    .in('ferramenta', ['ligar', 'enviar_whatsapp', 'enviar_email', 'enviar_material'])
    .gte('executada_em', inicioDoDiaSp())
  return count ?? 0
}

export async function conversasDoMandato(mandatoId: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from('mandato_conversas').select('conversa_id').eq('mandato_id', mandatoId)
  return (data ?? []).map((r) => r.conversa_id)
}

interface MensagemCtx {
  id: string
  direcao: string
  canal: string
  corpo: string | null
  preview: string | null
  por_ia: boolean
  triagem: unknown
  anexos: unknown
  contato_id: string | null
  conversa_id: string | null
  criado_em: string
}

const LIMITE_MIDIA_BYTES = 4 * 1024 * 1024

export interface EntradaContexto {
  mandato: MandatoCarregado
  agente: AgenteCarregado
  empresa: EmpresaCarregada | null
  cfg: ConfigAgentes
  saldoCentavos: number
  cotasRestantes: CotasUsadas
  ocultas: Array<{ id: string; motivo: string }>
  versaoVoz: string
  agora: Date
  /** Quando este ciclo foi acordado por uma resposta — o gatilho diz ao modelo o que mudou. */
  gatilho: string
}

export async function montarContexto(e: EntradaContexto): Promise<BlocoContexto[]> {
  const { mandato: m, agente, empresa, cfg } = e
  const conversas = await conversasDoMandato(m.id)

  // Últimas 30 mensagens de TODAS as conversas do mandato; sem conversa ainda, as da empresa.
  const base = supabaseAdmin
    .from('comunicacoes')
    .select('id, direcao, canal, corpo, preview, por_ia, triagem, anexos, contato_id, conversa_id, criado_em')
    .order('criado_em', { ascending: false })
    .limit(30)
  const { data: msgs } = conversas.length
    ? await base.in('conversa_id', conversas)
    : await base.eq('empresa_id', m.empresa_id)
  const mensagens = ((msgs ?? []) as MensagemCtx[]).reverse()

  const { data: contatos } = await supabaseAdmin
    .from('contatos')
    .select('id, nome, cargo, telefone, whatsapp, email, base_legal, nao_e_o_decisor, ponto_focal')
    .eq('empresa_id', m.empresa_id)
    .order('ponto_focal', { ascending: false })
    .limit(40)

  const { data: ligacoes } = await supabaseAdmin
    .from('voz_ligacoes')
    .select('id_externo, status, outcome, resumo, motivo_recusa, erro, objetivo, contato_id, criada_em, encerrada_em')
    .eq('mandato_id', m.id)
    .order('criada_em', { ascending: false })
    .limit(10)

  const { data: acoes } = await supabaseAdmin
    .from('mandato_acoes')
    .select('ferramenta, intencao, sucesso, erro, resultado, executada_em')
    .eq('mandato_id', m.id)
    .order('executada_em', { ascending: false })
    .limit(15)

  const { data: materiais } = await supabaseAdmin
    .from('materiais')
    .select('id, nome, descricao, quando_usar, tipo, canais')
    .eq('ativo', true)
    .order('vezes_usado', { ascending: false })
    .limit(30)

  let nota: Record<string, unknown> | null = null
  if (m.nota_access_key) {
    const { data } = await supabaseAdmin
      .from('notas_funil')
      .select('numero, valor, vencimento, estagio_funil, sacado_nome, sacado_razao_social, fornecedor_nome')
      .eq('access_key', m.nota_access_key)
      .maybeSingle()
    nota = data as Record<string, unknown> | null
  }

  const tz = cfg.janela.timezone
  const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' })
  const tentativas = new Map(m.contatos_tentados.map((t) => [t.contato_id, t]))

  const linhas: string[] = []
  // `dateStyle: 'full'` já traz o dia da semana ("quinta-feira, 1 de outubro de 2026"). Somar
  // `weekday` a ele lança "Invalid option" no Intl, e era o que derrubava todo ciclo.
  linhas.push(`Agora: ${e.agora.toLocaleString('pt-BR', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' })} (${tz}).`)
  linhas.push(`O que acordou este ciclo: ${e.gatilho}.`)
  linhas.push('')
  linhas.push(`── Mandato ${m.codigo ?? m.id} — ${TIPO_MANDATO_LABELS[m.tipo]}`)
  linhas.push(`Objetivo: ${m.objetivo}`)
  linhas.push(`Estado: ${m.estado}. Prazo: ${hora(m.expira_em)}. Ações: ${m.acoes_executadas}/${m.max_acoes}.`)
  linhas.push(`Orçamento restante que este ciclo pode gastar: R$ ${(e.saldoCentavos / 100).toFixed(2)}.`)
  linhas.push(
    `Cotas de hoje que ainda restam ao agente: ${e.cotasRestantes.ligacoes} ligações, ${e.cotasRestantes.mensagens} WhatsApp, ${e.cotasRestantes.emails} e-mails. ` +
      `Máximo de ${agente.limites.tentativas_por_contato} tentativas por contato; ${agente.limites.cooldown_minutos_mesmo_contato} min entre mensagens ao mesmo contato.`,
  )
  linhas.push(`Ana (voz): contrato ${e.versaoVoz}${e.versaoVoz === 'v2' ? '' : ' — só `ofertar_antecipacao` com NF é aceito por telefone'}.`)
  if (e.ocultas.length) {
    linhas.push(`Ferramentas indisponíveis neste ciclo: ${e.ocultas.map((o) => `${o.id} (${o.motivo})`).join(', ')}.`)
  }

  linhas.push('')
  linhas.push('── Plano atual')
  linhas.push(m.plano ? JSON.stringify(m.plano, null, 2) : '(nenhum ainda — este é o primeiro ciclo: monte o plano.)')

  linhas.push('')
  linhas.push('── Empresa')
  if (empresa) {
    linhas.push(`${empresa.razao_social ?? empresa.nome_fantasia ?? '—'} · CNPJ ${empresa.cnpj ?? '—'} · ${empresa.municipio ?? '—'}/${empresa.uf ?? '—'}`)
    linhas.push(`Porte ${empresa.porte ?? '—'} · estágio ${empresa.estagio ?? '—'} · domínio ${empresa.dominio ?? 'não resolvido'} · score ${empresa.score_faixa ?? '—'} · tipagem ${empresa.tipagem_antecipacao ?? '—'}${empresa.ex_cliente_desde ? ` · ex-cliente desde ${empresa.ex_cliente_desde}` : ''}`)
  }
  if (nota) {
    linhas.push(
      `NF do mandato: nº ${String(nota.numero ?? '—')}, valor de face R$ ${Number(nota.valor ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}, ` +
        `vencimento ${String(nota.vencimento ?? '—')}, sacado ${String(nota.sacado_razao_social ?? nota.sacado_nome ?? '—')}, estágio ${String(nota.estagio_funil ?? '—')}. ` +
        'Taxa e líquido NÃO estão aqui de propósito: quem diz números é a ligação da Ana ou a proposta da plataforma.',
    )
  }

  linhas.push('')
  linhas.push('── Contatos conhecidos')
  for (const c of contatos ?? []) {
    const t = tentativas.get(c.id)
    const meios = [c.whatsapp ? 'whatsapp' : null, c.telefone && !c.whatsapp ? 'telefone' : null, c.email ? 'email' : null].filter(Boolean).join('/')
    linhas.push(
      `- ${c.id} · ${c.nome ?? '—'}${c.cargo ? ` (${c.cargo})` : ''} · ${meios || 'sem meio de contato'}` +
        `${c.base_legal ? '' : ' · SEM BASE LEGAL'}${c.nao_e_o_decisor ? ' · não é o decisor' : ''}${c.ponto_focal ? ' · ponto focal' : ''}` +
        `${t ? ` · tentado ${t.tentativas}x, último: ${t.ultimo_resultado ?? '—'} em ${hora(t.ultima_em)}` : ''}`,
    )
  }
  if (!contatos?.length) linhas.push('(nenhum — busque o domínio e os contatos, ou enriqueça o telefone.)')

  linhas.push('')
  linhas.push('── Ligações deste mandato')
  for (const l of ligacoes ?? []) {
    linhas.push(`- ${hora(l.criada_em)} · ${l.objetivo} · ${l.status}${l.outcome ? ` · ${l.outcome}` : ''}${l.motivo_recusa ? ` · recusada: ${l.motivo_recusa}` : ''}${l.resumo ? ` — ${l.resumo}` : ''}`)
  }
  if (!ligacoes?.length) linhas.push('(nenhuma)')

  linhas.push('')
  linhas.push('── Suas últimas ações (mais recente primeiro)')
  for (const a of acoes ?? []) {
    linhas.push(`- ${hora(a.executada_em)} · ${a.ferramenta} · ${a.sucesso === false ? `FALHOU: ${a.erro ?? '—'}` : 'ok'} — ${a.intencao}`)
  }
  if (!acoes?.length) linhas.push('(nenhuma)')

  linhas.push('')
  linhas.push('── Conversa (todas as threads do mandato, mais antiga primeiro)')
  for (const msg of mensagens) {
    const quem = msg.direcao === 'entrada' ? 'ELES' : msg.por_ia ? 'NÓS (IA)' : 'NÓS (equipe)'
    const t = msg.triagem as { intencao?: string } | null
    linhas.push(`${hora(msg.criado_em)} ${quem} [${msg.canal}]${t?.intencao ? ` [${t.intencao}]` : ''}: ${(msg.corpo ?? msg.preview ?? '(sem texto)').slice(0, 600)}`)
  }
  if (!mensagens.length) linhas.push('(nenhuma mensagem ainda)')

  linhas.push('')
  linhas.push('── Biblioteca de materiais')
  for (const mat of materiais ?? []) {
    linhas.push(`- ${mat.id} · ${mat.nome} (${mat.tipo}; ${(mat.canais ?? []).join('/')}) — ${mat.descricao} QUANDO USAR: ${mat.quando_usar}`)
  }
  if (!materiais?.length) linhas.push('(vazia)')

  linhas.push('')
  linhas.push('Decida o próximo passo. Chame as ferramentas necessárias e termine com "atualizar_plano".')

  const blocos: BlocoContexto[] = [{ type: 'text', text: linhas.join('\n') }]
  blocos.push(...(await midiasRecebidas(mensagens)))
  return blocos
}

/**
 * §4.1: PDF e imagem que o cliente mandou nos últimos dias vão ao modelo como documento e
 * imagem — ele "lê" o que foi enviado. No máximo três, os mais recentes, até 4 MB cada.
 */
async function midiasRecebidas(mensagens: MensagemCtx[]): Promise<BlocoContexto[]> {
  const limite = Date.now() - 3 * 86_400_000
  const candidatas: Array<{ bucket: string; caminho: string; mime: string; nome: string }> = []
  for (const msg of [...mensagens].reverse()) {
    if (msg.direcao !== 'entrada' || new Date(msg.criado_em).getTime() < limite) continue
    for (const a of Array.isArray(msg.anexos) ? (msg.anexos as Array<Record<string, unknown>>) : []) {
      const mime = String(a.mimetype ?? a.mime ?? '')
      const caminho = typeof a.caminho === 'string' ? a.caminho : typeof a.path === 'string' ? a.path : null
      const bucket = typeof a.bucket === 'string' ? a.bucket : 'comunicacao-midia'
      if (!caminho) continue
      if (mime === 'application/pdf' || /^image\/(jpeg|png|webp|gif)$/.test(mime)) {
        candidatas.push({ bucket, caminho, mime, nome: String(a.nome ?? a.filename ?? 'anexo') })
      }
    }
    if (candidatas.length >= 3) break
  }

  const blocos: BlocoContexto[] = []
  for (const c of candidatas.slice(0, 3)) {
    try {
      const { data, error } = await supabaseAdmin.storage.from(c.bucket).download(c.caminho)
      if (error || !data || data.size > LIMITE_MIDIA_BYTES) continue
      const b64 = Buffer.from(await data.arrayBuffer()).toString('base64')
      blocos.push({ type: 'text', text: `Anexo recebido do cliente: ${c.nome}` })
      blocos.push(
        c.mime === 'application/pdf'
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 }, title: c.nome }
          : { type: 'image', source: { type: 'base64', media_type: c.mime, data: b64 } },
      )
    } catch (erro) {
      logger.warn({ caminho: c.caminho, erro: String(erro) }, 'Não foi possível anexar a mídia ao contexto do agente.')
    }
  }
  return blocos
}
