import {
  COBRANCA_ESTAGIOS_ENCERRADOS,
  registrarInteracaoCobranca,
  type RegistrarInteracaoCobrancaInput,
  type Tables,
  type Views,
} from '@jobsiteos/core'

import { supabase } from '@/lib/supabase'

/**
 * Leituras da Cobrança no celular (07 §12 Mobile). Todas sob RLS — o app nunca vê
 * service role. A única escrita é registrar contato, e ela passa pelo wrapper do core
 * (RPC que grava a interação, o evento e o audit_log na mesma transação).
 */

export const cobrancaKeys = {
  all: ['cobranca'] as const,
  cards: () => [...cobrancaKeys.all, 'cards'] as const,
  card: (id: string) => [...cobrancaKeys.all, 'card', id] as const,
  titulos: (id: string) => [...cobrancaKeys.all, 'titulos', id] as const,
  notificacoes: (id: string) => [...cobrancaKeys.all, 'notificacoes', id] as const,
  historico: (id: string) => [...cobrancaKeys.all, 'historico', id] as const,
  relogio: () => [...cobrancaKeys.all, 'relogio'] as const,
}

export type CardCobranca = Views<'cobranca_cards'>
export type PrazoApolice = Views<'apolice_relogio'>

/**
 * As cobranças VIVAS. Encerrada, quitada e cancelada ficam na web: no celular a
 * pergunta é "o que eu tenho de acompanhar hoje", e o arquivo morto só a esconde.
 */
export async function buscarCardsCobranca(): Promise<CardCobranca[]> {
  const { data, error } = await supabase
    .from('cobranca_cards')
    .select('*')
    .not('estagio', 'in', `(${COBRANCA_ESTAGIOS_ENCERRADOS.join(',')})`)
    .order('dias_restantes', { ascending: true, nullsFirst: false })
    .limit(300)
  if (error) throw new Error(error.message)
  return (data ?? []) as CardCobranca[]
}

export async function buscarCardCobranca(id: string): Promise<CardCobranca | null> {
  const { data, error } = await supabase.from('cobranca_cards').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as CardCobranca | null) ?? null
}

export type TituloDaCobranca = Tables<'cobranca_titulos'> & {
  titulos: Pick<Tables<'titulos'>, 'numero' | 'sacado_nome' | 'cedente_nome' | 'status'> | null
}

/** Os títulos com o snapshot da inclusão — o valor que a notificação citou. */
export async function buscarTitulosDaCobranca(id: string): Promise<TituloDaCobranca[]> {
  const { data, error } = await supabase
    .from('cobranca_titulos')
    .select('*, titulos(numero, sacado_nome, cedente_nome, status)')
    .eq('cobranca_id', id)
    .order('vencimento_snapshot', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as TituloDaCobranca[]
}

export type NotificacaoComEntregas = Pick<
  Tables<'cobranca_notificacoes'>,
  | 'id'
  | 'papel'
  | 'destinatario_cnpj'
  | 'destinatario_razao_social'
  | 'rodada'
  | 'status'
  | 'qtd_titulos'
  | 'valor_total'
  | 'valor_total_atualizado'
  | 'prazo_expira_em'
  | 'enviada_em'
> & {
  cobranca_notificacao_entregas: Pick<
    Tables<'cobranca_notificacao_entregas'>,
    'id' | 'canal' | 'destino' | 'status' | 'codigo_rastreio' | 'enviado_em' | 'confirmado_em'
  >[]
}

/**
 * As notificações com as entregas de cada uma. Sem `memoria_calculo` nem o documento:
 * a memória é um jsonb por título e o PDF se abre na web — no celular a pergunta é
 * "chegou?", e é a entrega que responde.
 */
export async function buscarNotificacoesDaCobranca(id: string): Promise<NotificacaoComEntregas[]> {
  const { data, error } = await supabase
    .from('cobranca_notificacoes')
    .select(
      'id, papel, destinatario_cnpj, destinatario_razao_social, rodada, status, qtd_titulos, valor_total, valor_total_atualizado, prazo_expira_em, enviada_em, cobranca_notificacao_entregas(id, canal, destino, status, codigo_rastreio, enviado_em, confirmado_em)',
    )
    .eq('cobranca_id', id)
    .order('rodada', { ascending: false })
    .order('papel', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as NotificacaoComEntregas[]
}

/** Uma linha do histórico: o que alguém registrou OU o que o sistema gravou. */
export interface ItemHistorico {
  id: string
  origem: 'interacao' | 'evento'
  tipo: string
  em: string
  texto: string
}

/**
 * O histórico junta as duas fontes numa linha do tempo só: as interações (ligação,
 * visita — o que a pessoa conta) e os eventos da cobrança na timeline da empresa (o
 * que o sistema fez: notificação enviada, título quitado). Separadas, a pergunta
 * "o que aconteceu desde a notificação?" teria duas respostas parciais.
 *
 * Os eventos vêm por `payload.cobranca_id`: é a chave que as RPCs da 0269d gravam.
 */
export async function buscarHistoricoDaCobranca(id: string): Promise<ItemHistorico[]> {
  const [interacoes, eventos] = await Promise.all([
    supabase
      .from('cobranca_interacoes')
      .select('id, tipo, resumo, ocorrida_em')
      .eq('cobranca_id', id)
      .order('ocorrida_em', { ascending: false })
      .limit(100),
    supabase
      .from('empresa_eventos')
      .select('id, tipo, payload, criado_em')
      .eq('payload->>cobranca_id', id)
      .order('criado_em', { ascending: false })
      .limit(100),
  ])
  if (interacoes.error) throw new Error(interacoes.error.message)
  if (eventos.error) throw new Error(eventos.error.message)

  const itens: ItemHistorico[] = [
    ...(interacoes.data ?? []).map((i) => ({
      id: `i-${i.id}`,
      origem: 'interacao' as const,
      tipo: i.tipo,
      em: i.ocorrida_em,
      texto: i.resumo,
    })),
    ...(eventos.data ?? []).map((e) => {
      const p = (e.payload ?? {}) as { resumo?: string; titulo?: string }
      return {
        id: `e-${e.id}`,
        origem: 'evento' as const,
        tipo: e.tipo,
        em: e.criado_em,
        texto: p.resumo ?? p.titulo ?? '',
      }
    }),
  ]
  return itens.sort((a, b) => Date.parse(b.em) - Date.parse(a.em))
}

/**
 * Os prazos da apólice que vencem em até 30 dias, do mais apertado para o mais folgado.
 * Os já vencidos (dias negativos) vêm primeiro de propósito: prazo perdido que ninguém
 * tratou é o que mais precisa ser visto.
 */
export async function buscarRelogio(): Promise<PrazoApolice[]> {
  const { data, error } = await supabase
    .from('apolice_relogio')
    .select('*')
    .lte('dias_restantes', 30)
    .order('dias_restantes', { ascending: true })
    .limit(300)
  if (error) throw new Error(error.message)
  return (data ?? []) as PrazoApolice[]
}

export function registrarContato(input: RegistrarInteracaoCobrancaInput) {
  return registrarInteracaoCobranca(supabase, input)
}
