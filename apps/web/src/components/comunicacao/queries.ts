import type { Tables, Views } from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'

/**
 * Leituras da Comunicação. RLS aplicada — o client é o do usuário.
 *
 * As duas views (`inbox_conversas` e `comunicacoes_thread`) existem para que a
 * lista e a thread não façam três joins por linha no cliente. O inbox mostra
 * dezenas de conversas por tela; um join por bolha seria uma consulta por bolha.
 */

export type ConversaInbox = Views<'inbox_conversas'>
export type MensagemThread = Views<'comunicacoes_thread'>
export type NaoVinculada = Tables<'conversas_nao_vinculadas'>
export type TemplateMensagem = Tables<'templates_mensagem'>
export type Playbook = Tables<'agente_playbooks'>

export type AbaInbox = 'nao_lidas' | 'minhas' | 'nao_vinculadas' | 'todas'

export interface FiltrosInbox {
  aba: AbaInbox
  canal?: 'whatsapp' | 'email'
  empresaId?: string
  vendedorId?: string
  busca?: string
}

const COLUNAS_INBOX =
  'id, canal, identificador_externo, empresa_id, contato_id, objetivo, playbook_id, responsavel_vendedor_id, modo_agente, status, ultima_mensagem_em, ultima_direcao, proxima_acao_em, nao_lidas, empresa_cnpj, empresa_nome, contato_nome, contato_cargo, contato_base_legal, contato_nao_e_o_decisor, responsavel_nome, responsavel_is_ia, ultima_preview, ultima_por_ia, ultima_triagem, sugestao_id, sugestao_acao, sugestao_conteudo, sugestao_justificativa, sugestao_confianca'

export async function buscarConversas(
  filtros: FiltrosInbox,
  meuVendedorId: string | null,
): Promise<ConversaInbox[]> {
  const supabase = createClient()
  let q = supabase
    .from('inbox_conversas')
    .select(COLUNAS_INBOX)
    .order('ultima_mensagem_em', { ascending: false, nullsFirst: false })
    .limit(200)

  if (filtros.aba === 'nao_lidas') q = q.gt('nao_lidas', 0)
  // "Minhas" com vendedor nulo devolveria a lista inteira: quem não é vendedor
  // não tem "minhas" conversas, e a tela precisa dizer isso em vez de mostrar
  // tudo como se fosse dele.
  if (filtros.aba === 'minhas') q = q.eq('responsavel_vendedor_id', meuVendedorId ?? '00000000-0000-0000-0000-000000000000')

  if (filtros.canal) q = q.eq('canal', filtros.canal)
  if (filtros.empresaId) q = q.eq('empresa_id', filtros.empresaId)
  if (filtros.vendedorId) q = q.eq('responsavel_vendedor_id', filtros.vendedorId)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  const linhas = (data ?? []) as ConversaInbox[]
  if (!filtros.busca?.trim()) return linhas

  const t = filtros.busca.trim().toLowerCase()
  return linhas.filter((c) =>
    [c.empresa_nome, c.contato_nome, c.identificador_externo, c.ultima_preview]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(t)),
  )
}

const COLUNAS_THREAD =
  'id, conversa_id, empresa_id, contato_id, canal, direcao, por_ia, assunto, corpo, preview, anexos, provedor, conta_remetente, status_envio, erro, origem, funil, funil_card_id, triagem, criado_em, enviado_em, empresa_cnpj, empresa_nome, contato_nome, contato_cargo, usuario_nome, vendedor_nome, vendedor_is_ia'

export async function buscarThread(conversaId: string): Promise<MensagemThread[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('comunicacoes_thread')
    .select(COLUNAS_THREAD)
    .eq('conversa_id', conversaId)
    .order('criado_em', { ascending: true })
    .limit(300)
  if (error) throw new Error(error.message)
  return (data ?? []) as MensagemThread[]
}

/**
 * A thread da EMPRESA, que é o que a aba "Mensagens" do card mostra.
 *
 * Filtra pela empresa e não pelo card: a mesma pessoa fala com o SDR, com o
 * originador e com o closer, e o card serve para destacar o que partiu dali —
 * nunca para esconder o resto da conversa (§1).
 */
export async function buscarThreadDaEmpresa(empresaId: string): Promise<MensagemThread[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('comunicacoes_thread')
    .select(COLUNAS_THREAD)
    .eq('empresa_id', empresaId)
    .order('criado_em', { ascending: true })
    .limit(300)
  if (error) throw new Error(error.message)
  return (data ?? []) as MensagemThread[]
}

export async function buscarNaoVinculadas(): Promise<NaoVinculada[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('conversas_nao_vinculadas')
    .select('*')
    .eq('status', 'pendente')
    .order('ultima_mensagem_em', { ascending: false })
    .limit(100)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function contarNaoVinculadas(): Promise<number> {
  const supabase = createClient()
  const { count, error } = await supabase
    .from('conversas_nao_vinculadas')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pendente')
  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function buscarTemplates(
  canal?: 'whatsapp' | 'email',
  funil?: string | null,
): Promise<TemplateMensagem[]> {
  const supabase = createClient()
  let q = supabase.from('templates_mensagem').select('*').eq('ativo', true).order('nome')
  if (canal) q = q.eq('canal', canal)
  if (funil) q = q.or(`funil.eq.${funil},funil.is.null`)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarTodosTemplates(): Promise<TemplateMensagem[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('templates_mensagem')
    .select('*')
    .order('funil', { nullsFirst: true })
    .order('nome')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarPlaybooks(): Promise<Playbook[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('agente_playbooks')
    .select('*')
    .order('ativo', { ascending: false })
    .order('funil')
    .order('versao', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export interface ContatoDaEmpresa {
  id: string
  nome: string | null
  cargo: string | null
  email: string | null
  telefone: string | null
  whatsapp: string | null
  ponto_focal: boolean
  base_legal: string | null
  nao_e_o_decisor: boolean
}

/** Ponto focal primeiro — a mesma hierarquia de todo o sistema. */
export async function buscarContatos(empresaId: string): Promise<ContatoDaEmpresa[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('contatos')
    .select('id, nome, cargo, email, telefone, whatsapp, ponto_focal, base_legal, nao_e_o_decisor')
    .eq('empresa_id', empresaId)
    .order('ponto_focal', { ascending: false })
    .order('nome')
  if (error) throw new Error(error.message)
  return (data ?? []) as ContatoDaEmpresa[]
}

export interface ConfigComunicacaoLida {
  chave: string
  valor: unknown
}

export async function buscarConfig(): Promise<Record<string, unknown>> {
  const supabase = createClient()
  const { data, error } = await supabase.from('comunicacao_config').select('chave, valor')
  if (error) throw new Error(error.message)
  return Object.fromEntries((data ?? []).map((l) => [l.chave, l.valor]))
}

export interface ContaWhatsappLida {
  id: string
  apelido: string
  numero: string
  tipo: string
  ativo: boolean
  mensagens_por_dia: number
  warmup_iniciado_em: string | null
  intervalo_min_seg: number
  intervalo_max_seg: number
  token_definido_em: string | null
}

export async function buscarContasWhatsapp(): Promise<ContaWhatsappLida[]> {
  const supabase = createClient()
  // Colunas explícitas: `token_secret_id` não tem grant de select (0052), e um
  // `select *` aqui falharia — que é exatamente o comportamento desejado.
  const { data, error } = await supabase
    .from('whatsapp_contas')
    .select('id, apelido, numero, tipo, ativo, mensagens_por_dia, warmup_iniciado_em, intervalo_min_seg, intervalo_max_seg, token_definido_em')
    .order('tipo')
    .order('apelido')
  if (error) throw new Error(error.message)
  return (data ?? []) as ContaWhatsappLida[]
}

export interface GmailConectado {
  endereco: string
  ultimo_sync_em: string | null
  ultimo_erro: string | null
  watch_expira_em: string | null
  ativo: boolean
}

export async function buscarMeuGmail(): Promise<GmailConectado | null> {
  const supabase = createClient()
  // A policy só devolve a própria linha; não há filtro por usuário aqui de
  // propósito — quem decide é a RLS, e um filtro no cliente daria a impressão
  // errada de que ele é o que protege.
  const { data, error } = await supabase
    .from('gmail_contas')
    .select('endereco, ultimo_sync_em, ultimo_erro, watch_expira_em, ativo')
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as GmailConectado | null) ?? null
}
