import {
  enfileirarMensagemSchema,
  vincularConversaSchema,
  type Json,
  type Tables,
  type Views,
} from '@jobsiteos/core'
import { supabase } from '@/lib/supabase'

/**
 * Leituras e escritas da Comunicação no celular. Todas sob RLS — o app nunca vê
 * service role, e as escritas passam pelas MESMAS RPCs da web, que é onde o
 * portão mora.
 */

export const comunicacaoKeys = {
  all: ['comunicacao'] as const,
  inbox: (aba: string) => [...comunicacaoKeys.all, 'inbox', aba] as const,
  thread: (id: string) => [...comunicacaoKeys.all, 'thread', id] as const,
  /**
   * O vendedor entra na chave: o gestor troca de pessoa no seletor, e sem isto
   * a fila do anterior voltaria do cache sob o nome novo.
   */
  naoVinculadas: (vendedorId?: string | null) =>
    [...comunicacaoKeys.all, 'nao-vinculadas', vendedorId ?? null] as const,
  meuVendedor: () => [...comunicacaoKeys.all, 'meu-vendedor'] as const,
  templates: (canal: string) => [...comunicacaoKeys.all, 'templates', canal] as const,
  contatos: (empresaId: string) => [...comunicacaoKeys.all, 'contatos', empresaId] as const,
}

export type ConversaInbox = Views<'inbox_conversas'>
export type MensagemThread = Views<'comunicacoes_thread'>
export type NaoVinculada = Tables<'conversas_nao_vinculadas'>

const COLUNAS_INBOX =
  'id, canal, identificador_externo, conta_remetente, conta_rotulo, empresa_id, contato_id, objetivo, modo_agente, status, ultima_mensagem_em, ultima_direcao, nao_lidas, empresa_nome, contato_nome, contato_cargo, responsavel_nome, responsavel_is_ia, ultima_preview, ultima_por_ia, ultima_triagem, sugestao_id, sugestao_acao, sugestao_conteudo, sugestao_justificativa, sugestao_confianca'

export type AbaMobile = 'nao_lidas' | 'todas'

export async function buscarConversas(aba: AbaMobile): Promise<ConversaInbox[]> {
  let q = supabase
    .from('inbox_conversas')
    .select(COLUNAS_INBOX)
    .order('ultima_mensagem_em', { ascending: false, nullsFirst: false })
    .limit(100)
  if (aba === 'nao_lidas') q = q.gt('nao_lidas', 0)

  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as ConversaInbox[]
}

export async function buscarThread(conversaId: string): Promise<MensagemThread[]> {
  const { data, error } = await supabase
    .from('comunicacoes_thread')
    .select('id, conversa_id, empresa_id, contato_id, canal, direcao, por_ia, assunto, corpo, preview, status_envio, erro, origem, triagem, criado_em, contato_nome, vendedor_nome, usuario_nome')
    .eq('conversa_id', conversaId)
    .order('criado_em', { ascending: true })
    .limit(200)
  if (error) throw new Error(error.message)
  return (data ?? []) as MensagemThread[]
}

/**
 * O vendedor do usuário atual, ou null se ele não tem cadastro (gestor puro).
 *
 * `app_vendedor_atual()` é SECURITY DEFINER e resolve por `auth.uid()` — é a
 * mesma função que as RPCs do Comercial usam como padrão, então "meu" significa
 * a mesma coisa nos dois módulos.
 */
export async function meuVendedorId(): Promise<string | null> {
  const { data, error } = await supabase.rpc('app_vendedor_atual')
  if (error) throw new Error(error.message)
  return (data as string | null) ?? null
}

/**
 * A fila de identificação DE UMA PESSOA.
 *
 * ── O que "minha" quer dizer aqui ───────────────────────────────────────────
 * Estas conversas são mensagens que CHEGARAM de um número desconhecido; ninguém
 * as iniciou do nosso lado, e não existe coluna de autor. O que existe é
 * `vendedor_sugerido_id`, que o worker preenche com o DONO DO NÚMERO QUE ATENDEU
 * (`apps/worker/src/jobs/comunicacao/webhooks.ts`) — e é essa a noção honesta de
 * "é minha para resolver".
 *
 * ── Isto é um filtro de VISÃO, não uma fronteira de segurança ───────────────
 * A policy da tabela é `app_tem_modulo('comunicacao')`: quem tem o módulo pode
 * ler a fila inteira, e continua podendo — pelo PostgREST, por exemplo. O filtro
 * aqui existe para a tela não despejar a fila da empresa sobre quem só precisa
 * da própria. Se um dia isso precisar ser IMPEDIDO, e não só escondido, o lugar
 * é a policy, não este arquivo.
 */
export async function buscarNaoVinculadas(vendedorId: string | null): Promise<NaoVinculada[]> {
  // Sem vendedor não há fila própria: um gestor sem cadastro escolhe de quem ver
  // antes de haver o que listar. Devolver a fila inteira aqui seria voltar ao
  // comportamento que o filtro veio corrigir.
  if (!vendedorId) return []

  const { data, error } = await supabase
    .from('conversas_nao_vinculadas')
    .select('*')
    .eq('status', 'pendente')
    .eq('vendedor_sugerido_id', vendedorId)
    .order('ultima_mensagem_em', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarTemplates(canal: 'whatsapp' | 'email') {
  const { data, error } = await supabase
    .from('templates_mensagem')
    .select('id, nome, canal, assunto, corpo')
    .eq('ativo', true)
    .eq('canal', canal)
    .order('nome')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarContatos(empresaId: string) {
  const { data, error } = await supabase
    .from('contatos')
    .select('id, nome, cargo, email, telefone, whatsapp, ponto_focal, base_legal')
    .eq('empresa_id', empresaId)
    .order('ponto_focal', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarEmpresas(termo: string) {
  const t = termo.trim()
  if (t.length < 3) return []
  const digitos = t.replace(/\D/g, '')
  const q =
    digitos.length >= 8
      ? supabase.from('empresas').select('id, cnpj, razao_social, nome_fantasia').ilike('cnpj', `${digitos}%`)
      : supabase
          .from('empresas')
          .select('id, cnpj, razao_social, nome_fantasia')
          .or(`razao_social.ilike.%${t}%,nome_fantasia.ilike.%${t}%`)
  const { data, error } = await q.limit(8)
  if (error) throw new Error(error.message)
  return data ?? []
}

// ─── Escritas ───────────────────────────────────────────────────────────────

export async function enviarMensagem(input: unknown): Promise<void> {
  const dados = enfileirarMensagemSchema.parse(input)
  const { error } = await supabase.rpc('app_comunicacao_enfileirar', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
}

export async function vincular(input: unknown): Promise<void> {
  const dados = vincularConversaSchema.parse(input)
  const { error } = await supabase.rpc('app_conversa_vincular', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
}

export async function ignorar(id: string): Promise<void> {
  const { error } = await supabase.rpc('app_conversa_ignorar', { p: { id } as unknown as Json })
  if (error) throw new Error(error.message)
}

export async function marcarLida(id: string): Promise<void> {
  const { error } = await supabase.rpc('app_conversa_marcar_lida', { p: { id } as unknown as Json })
  if (error) throw new Error(error.message)
}

export async function aceitarSugestao(id: string, corpo?: string | null): Promise<void> {
  const { error } = await supabase.rpc('app_agente_aceitar', {
    p: { id, corpo: corpo ?? null } as unknown as Json,
  })
  if (error) throw new Error(error.message)
}

export async function descartarSugestao(id: string): Promise<void> {
  const { error } = await supabase.rpc('app_agente_descartar', { p: { id } as unknown as Json })
  if (error) throw new Error(error.message)
}
