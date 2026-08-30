import type { Supabase } from '../registry/types.js'
import type { Json } from '../types/database.js'
import {
  aceitarSugestaoSchema,
  atividadeSchema,
  definirModoAgenteSchema,
  enfileirarMensagemSchema,
  enviarApresentacaoSchema,
  idSchema,
  salvarPlaybookSchema,
  salvarTemplateSchema,
  vincularConversaSchema,
} from './schemas.js'

/**
 * As escritas da Comunicação. Todas por RPC, como no resto do sistema, e aqui a
 * razão é a mais forte de todas: um `.insert()` direto em `mensagens_outbox`
 * pularia o portão (§1.4) — a supressão, a base legal e o cooldown vivem DENTRO
 * da função do banco, na mesma transação que enfileira.
 *
 * O client é sempre o do USUÁRIO. As RPCs são SECURITY DEFINER e checam
 * `app_tem_modulo('comunicacao')` por dentro; passar o service role aqui anularia
 * a única autorização que existe.
 */

export async function enfileirarMensagem(supabase: Supabase, input: unknown) {
  const dados = enfileirarMensagemSchema.parse(input)
  const { data, error } = await supabase.rpc('app_comunicacao_enfileirar', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data
}

/**
 * Aprovar é o passo entre a régua e o envio (§5) — e NÃO é enviar: a linha entra
 * na fila e continua passando pelo portão do worker (janela, teto do número,
 * warmup). Aprovar o texto não é aprovar o horário nem a saúde do número.
 */
export async function aprovarMensagens(supabase: Supabase, ids: readonly string[]) {
  const { data, error } = await supabase.rpc('app_aprovar_mensagem', {
    p: { ids } as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function vincularConversa(supabase: Supabase, input: unknown) {
  const dados = vincularConversaSchema.parse(input)
  const { data, error } = await supabase.rpc('app_conversa_vincular', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function ignorarConversa(supabase: Supabase, input: unknown) {
  const dados = idSchema.parse(input)
  const { error } = await supabase.rpc('app_conversa_ignorar', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
}

export async function marcarConversaLida(supabase: Supabase, input: unknown) {
  const dados = idSchema.parse(input)
  const { error } = await supabase.rpc('app_conversa_marcar_lida', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
}

export async function definirModoAgente(supabase: Supabase, input: unknown) {
  const dados = definirModoAgenteSchema.parse(input)
  const { data, error } = await supabase.rpc('app_conversa_definir_modo', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data
}

/**
 * Aceitar uma sugestão ENFILEIRA — não envia. A mensagem aprovada continua
 * passando pelo portão: o humano aprovou o texto, não a legalidade do disparo.
 */
export async function aceitarSugestao(supabase: Supabase, input: unknown) {
  const dados = aceitarSugestaoSchema.parse(input)
  const { data, error } = await supabase.rpc('app_agente_aceitar', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

export async function descartarSugestao(supabase: Supabase, input: unknown) {
  const dados = idSchema.parse(input)
  const { error } = await supabase.rpc('app_agente_descartar', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
}

export async function salvarTemplateMensagem(supabase: Supabase, input: unknown) {
  const dados = salvarTemplateSchema.parse(input)
  const { data, error } = await supabase.rpc('app_salvar_template_mensagem', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function salvarComunicacaoConfig(supabase: Supabase, valores: Record<string, unknown>) {
  const { error } = await supabase.rpc('app_salvar_comunicacao_config', {
    p: valores as unknown as Json,
  })
  if (error) throw new Error(error.message)
}

export async function salvarPlaybook(supabase: Supabase, input: unknown) {
  const dados = salvarPlaybookSchema.parse(input)
  const { data, error } = await supabase.rpc('app_salvar_playbook', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

export async function desconectarGmail(supabase: Supabase) {
  const { error } = await supabase.rpc('app_desconectar_gmail', { p: {} as unknown as Json })
  if (error) throw new Error(error.message)
}

export async function enviarPedidoApresentacao(supabase: Supabase, input: unknown) {
  const dados = enviarApresentacaoSchema.parse(input)
  const { data, error } = await supabase.rpc('app_pedido_apresentacao_enviar', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data
}

export interface LinhaAtividade {
  vendedor_id: string
  vendedor_nome: string
  is_ia: boolean
  canal: string
  enviadas: number
  recebidas: number
  contatos_distintos_dia: number
  empresas_tocadas: number
  taxa_resposta: number
  reunioes_agendadas: number
  nfs_convertidas: number
}

export interface PainelAtividade {
  tem_acesso: boolean
  de?: string
  ate?: string
  linhas: LinhaAtividade[]
}

/**
 * O painel do §8. `tem_acesso: false` NÃO é erro: é a resposta correta para um
 * vendedor perguntando sobre si mesmo, e a tela mostra isso como uma explicação,
 * não como uma falha.
 */
export async function buscarAtividade(supabase: Supabase, input: unknown): Promise<PainelAtividade> {
  const dados = atividadeSchema.parse(input ?? {})
  const { data, error } = await supabase.rpc('app_comunicacao_atividade', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  const corpo = (data ?? {}) as Partial<PainelAtividade>
  return {
    tem_acesso: corpo.tem_acesso ?? false,
    de: corpo.de,
    ate: corpo.ate,
    linhas: corpo.linhas ?? [],
  }
}
