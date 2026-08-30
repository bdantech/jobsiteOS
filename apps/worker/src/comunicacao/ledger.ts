import {
  identificadorCanonico,
  previewDe,
  type CanalComunicacao,
  type CanalThread,
  type Direcao,
  type OrigemComunicacao,
  type Provedor,
  type StatusEnvio,
} from '../../../../packages/core/src/comunicacao/index.js'
import type { TablesInsert } from '../../../../packages/core/src/types/database.js'
import { supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'

/**
 * A ÚNICA porta de escrita do ledger no worker.
 *
 * Todo job — envio, webhook, triagem, agente — grava por aqui. A regra do §2 ("a
 * partir daqui todo módulo escreve comunicação apenas no ledger") só vale se
 * existir um lugar onde a escrita acontece; espalhá-la em seis `.insert()`
 * espalha também o `preview`, o `unique (provedor, id_externo)` e a atualização
 * da `conversas`, e é assim que uma delas fica para trás.
 */

export interface EscreverNoLedger {
  conversaId: string | null
  empresaId: string | null
  contatoId: string | null
  canal: CanalComunicacao
  direcao: Direcao
  usuarioId?: string | null
  vendedorId?: string | null
  porIa?: boolean
  assunto?: string | null
  corpo: string | null
  anexos?: unknown[]
  provedor: Provedor
  idExterno?: string | null
  threadExterna?: string | null
  contaRemetente?: string | null
  statusEnvio: StatusEnvio
  erro?: string | null
  tentativas?: number
  origem: OrigemComunicacao
  templateId?: string | null
  funil?: string | null
  funilCardId?: string | null
  enviadoEm?: Date | null
  criadoEm?: Date | null
}

/**
 * Devolve o id da linha — e o id da linha JÁ EXISTENTE quando o
 * `(provedor, id_externo)` bate.
 *
 * A idempotência é a razão de esta função existir: o webhook do Wasender reentrega
 * o mesmo evento quando não recebe 200 rápido, e o do Resend reentrega por
 * política. Sem o upsert, cada reentrega vira uma bolha duplicada na conversa e
 * uma linha a mais no painel de atividade.
 */
export async function escreverNoLedger(m: EscreverNoLedger): Promise<string | null> {
  const linha: TablesInsert<'comunicacoes'> = {
    conversa_id: m.conversaId,
    empresa_id: m.empresaId,
    contato_id: m.contatoId,
    canal: m.canal,
    direcao: m.direcao,
    usuario_id: m.usuarioId ?? null,
    vendedor_id: m.vendedorId ?? null,
    por_ia: m.porIa ?? false,
    assunto: m.assunto ?? null,
    corpo: m.corpo,
    preview: previewDe(m.corpo),
    anexos: (m.anexos ?? []) as never,
    provedor: m.provedor,
    id_externo: m.idExterno ?? null,
    thread_externa: m.threadExterna ?? null,
    conta_remetente: m.contaRemetente ?? null,
    status_envio: m.statusEnvio,
    erro: m.erro ?? null,
    tentativas: m.tentativas ?? 0,
    origem: m.origem,
    template_id: m.templateId ?? null,
    funil: m.funil ?? null,
    funil_card_id: m.funilCardId ?? null,
    enviado_em: m.enviadoEm?.toISOString() ?? null,
    criado_em: m.criadoEm?.toISOString() ?? undefined,
  }

  if (m.idExterno) {
    const { data, error } = await supabaseAdmin
      .from('comunicacoes')
      .upsert(linha, { onConflict: 'provedor,id_externo', ignoreDuplicates: false })
      .select('id')
      .maybeSingle()
    if (error) {
      logger.error({ erro: error.message, id_externo: m.idExterno }, 'Falha ao gravar no ledger.')
      return null
    }
    return data?.id ?? null
  }

  const { data, error } = await supabaseAdmin.from('comunicacoes').insert(linha).select('id').maybeSingle()
  if (error) {
    logger.error({ erro: error.message }, 'Falha ao gravar no ledger.')
    return null
  }
  return data?.id ?? null
}

/**
 * A thread da pessoa. Chama a MESMA função do banco que as RPCs usam
 * (`app__conversa_para`) em vez de reimplementar o upsert aqui — duas definições
 * de "a mesma conversa" produzem duas conversas com a mesma pessoa, e é
 * exatamente o defeito que a 0144 existe para não ter.
 */
export async function conversaPara(args: {
  canal: CanalThread
  identificador: string
  empresaId?: string | null
  contatoId?: string | null
  vendedorId?: string | null
}): Promise<string | null> {
  const ident = identificadorCanonico(args.canal, args.identificador)
  if (!ident) return null

  const { data, error } = await supabaseAdmin.rpc('app__conversa_para', {
    p_canal: args.canal,
    p_identificador: ident,
    p_empresa: args.empresaId ?? null,
    p_contato: args.contatoId ?? null,
    p_vendedor: args.vendedorId ?? null,
  })
  if (error) {
    logger.error({ erro: error.message, canal: args.canal }, 'Falha ao resolver a conversa.')
    return null
  }
  return (data as string | null) ?? null
}

/**
 * O estado da thread depois de uma mensagem.
 *
 * `nao_lidas` só sobe na ENTRADA, e zera na saída: responder é ler. A alternativa
 * (zerar só quando alguém abre a tela) deixaria o contador aceso depois de o
 * vendedor já ter respondido pelo card, e o inbox mentiria sobre o que falta.
 */
export async function tocarConversa(args: {
  conversaId: string
  direcao: Direcao
  em: Date
  /** Entrada reabre a conversa; saída a põe à espera. */
  novoStatus?: 'ativa' | 'aguardando_resposta' | null
}): Promise<void> {
  const patch: Record<string, unknown> = {
    ultima_mensagem_em: args.em.toISOString(),
    ultima_direcao: args.direcao,
  }
  if (args.novoStatus) patch.status = args.novoStatus

  if (args.direcao === 'entrada') {
    const { data } = await supabaseAdmin
      .from('conversas')
      .select('nao_lidas')
      .eq('id', args.conversaId)
      .maybeSingle()
    patch.nao_lidas = (data?.nao_lidas ?? 0) + 1
  } else {
    patch.nao_lidas = 0
  }

  const { error } = await supabaseAdmin.from('conversas').update(patch).eq('id', args.conversaId)
  if (error) logger.error({ erro: error.message }, 'Falha ao atualizar a conversa.')
}

/** Saídas para uma thread hoje. Insumo do teto por thread (§7.5). */
export async function enviadasNaThreadHoje(conversaId: string, agora: Date): Promise<number> {
  const inicio = new Date(agora)
  inicio.setUTCHours(0, 0, 0, 0)
  const { count } = await supabaseAdmin
    .from('comunicacoes')
    .select('id', { count: 'exact', head: true })
    .eq('conversa_id', conversaId)
    .eq('direcao', 'saida')
    .gte('criado_em', inicio.toISOString())
  return count ?? 0
}

/** Saídas por uma conta de WhatsApp hoje. Insumo do teto/warmup (§3.1). */
export async function enviadasPelaContaHoje(numero: string, agora: Date): Promise<number> {
  const inicio = new Date(agora)
  inicio.setUTCHours(0, 0, 0, 0)
  const { count } = await supabaseAdmin
    .from('comunicacoes')
    .select('id', { count: 'exact', head: true })
    .eq('conta_remetente', numero)
    .eq('direcao', 'saida')
    .gte('criado_em', inicio.toISOString())
  return count ?? 0
}

/** O último toque de saída num contato. Insumo do cooldown. */
export async function ultimoToqueEm(contatoId: string | null): Promise<Date | null> {
  if (!contatoId) return null
  const { data } = await supabaseAdmin
    .from('comunicacoes')
    .select('criado_em')
    .eq('contato_id', contatoId)
    .eq('direcao', 'saida')
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.criado_em ? new Date(data.criado_em) : null
}
