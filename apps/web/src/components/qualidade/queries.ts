'use client'

import {
  lerAnalise,
  lerFeedback,
  lerReuniaoCaptura,
  lerSelo,
  lerSugestoesCadastro,
  type Supabase,
} from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'

/**
 * Leituras da Inteligência de Conversas do lado de QUEM FOI ANALISADO (05C §6, §7, §11):
 * a captura na aba Reunião, o detalhe de uma análise, o selo de nota, a aba Feedback e as
 * sugestões de cadastro.
 *
 * Todas passam pelas leituras do core com o client do USUÁRIO. Quem vê o quê — a análise
 * em sombra, o item em sombra, a nota de outro vendedor — é regra das RPCs (0283c), e
 * repetir o filtro aqui só criaria uma segunda regra para divergir da primeira.
 *
 * As chaves ficam sob `['qualidade', ...]`, o mesmo prefixo da tela do gestor (que usa
 * `['qualidade', 'gestao', ...]`): uma contestação ou uma pendência resolvida invalida
 * tudo com um só `invalidateQueries({ queryKey: ['qualidade'] })`.
 */

export type AlvoSelo = { empresa_id: string } | { conversa_id: string } | { evento_id: string }

export const qualidadeKeys = {
  all: ['qualidade'] as const,
  ehGestor: () => [...qualidadeKeys.all, 'eh-gestor'] as const,
  captura: (eventoId: string) => [...qualidadeKeys.all, 'captura', eventoId] as const,
  analise: (id: string) => [...qualidadeKeys.all, 'analise', id] as const,
  feedback: (vendedorId: string | null) => [...qualidadeKeys.all, 'feedback', vendedorId ?? 'eu'] as const,
  selo: (alvo: AlvoSelo) => [...qualidadeKeys.all, 'selo', ...Object.entries(alvo).flat()] as const,
  sugestoes: (empresaId: string) => [...qualidadeKeys.all, 'sugestoes', empresaId] as const,
  vendedores: () => [...qualidadeKeys.all, 'vendedores'] as const,
}

const cliente = () => createClient() as unknown as Supabase

export const buscarCaptura = (eventoId: string) => lerReuniaoCaptura(cliente(), eventoId)

/** Sempre com o texto: o modal mostra a interação junto da análise. */
export const buscarAnalise = (id: string) => lerAnalise(cliente(), id, true)

export const buscarFeedback = (vendedorId: string | null) =>
  lerFeedback(cliente(), vendedorId ? { vendedor_id: vendedorId } : {})

export const buscarSelo = (alvo: AlvoSelo) => lerSelo(cliente(), alvo)

export const buscarSugestoesCadastro = (empresaId: string) => lerSugestoesCadastro(cliente(), empresaId)

/**
 * Se quem está logado é gestor comercial. Decide só o que se DESENHA (provedor, banda
 * cinzenta, aviso de sombra): o que chega já foi recortado pela RPC.
 */
export async function buscarEhGestor(): Promise<boolean> {
  const { data } = await createClient().rpc('app_gestor_comercial')
  return data === true
}

export interface VendedorFeedback {
  id: string
  nome: string
  tipo: string
  is_ia: boolean
}

/**
 * O seletor da aba Feedback: as pessoas cujo trabalho quem abre a tela já pode ver hoje
 * (`app_vendedores_visiveis` — o gestor vê todos; os demais, a si, quem está marcado em
 * `vendedor_acessos` e o closer de quem é auxiliar). Inclui os agentes de IA de propósito:
 * a aba deles é a mesma régua, e é ela que permite comparar IA e humano (05C §7).
 */
export async function buscarVendedoresFeedback(): Promise<VendedorFeedback[]> {
  const supabase = createClient()
  const { data: ids, error: e1 } = await supabase.rpc('app_vendedores_visiveis')
  if (e1) throw new Error(e1.message)
  if (!ids?.length) return []
  const { data, error } = await supabase
    .from('vendedores')
    .select('id, nome, tipo, is_ia')
    .in('id', ids)
    .eq('ativo', true)
    .order('is_ia')
    .order('nome')
  if (error) throw new Error(error.message)
  return data ?? []
}
