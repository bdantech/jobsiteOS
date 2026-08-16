import type { EstagioCard } from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'

/**
 * Leitura do funil de certificados (0116).
 *
 * Uma chamada só (`certificado_funil`), como o grid: são 47 cards e 1.017 CNPJs
 * aninhados, e montar isso no cliente seria três leituras mais um join em JavaScript.
 * A RPC é SECURITY DEFINER porque as SPEs vivem em `mercado_universo`, que o módulo
 * comercial não lê — e é ela também que recorta a carteira do originador.
 */

export const funilCertificadosKeys = {
  all: ['certificado-funil'] as const,
  funil: () => [...funilCertificadosKeys.all, 'cards'] as const,
  motivos: () => [...funilCertificadosKeys.all, 'motivos'] as const,
}

export interface CnpjDoCard {
  cnpj: string
  nome: string | null
  e_matriz: boolean
  coberto: boolean
  expires_at: string | null
}

export interface CardCertificado {
  card_id: string
  estagio: EstagioCard
  perdido_motivo: string | null
  perdido_motivo_label: string | null
  perdido_em: string | null
  ganho_em: string | null
  observacao: string | null
  aberto_em: string
  atualizado_em: string
  empresa_id: string
  cnpj: string
  nome: string
  total: number
  cobertos: number
  pendentes: number
  matriz_coberta: boolean
  matriz_expira_em: string | null
  cnpjs: CnpjDoCard[]
}

export interface FunilCertificados {
  tem_acesso: boolean
  eh_gestor: boolean
  cards: CardCertificado[]
  sincronizado_em: string | null
}

export async function buscarFunilCertificados(): Promise<FunilCertificados> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('certificado_funil' as never)
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as Partial<FunilCertificados>
  return {
    tem_acesso: r.tem_acesso ?? false,
    eh_gestor: r.eh_gestor ?? false,
    cards: r.cards ?? [],
    sincronizado_em: r.sincronizado_em ?? null,
  }
}

export interface MotivoCertificado {
  id: string
  motivo: string
}

/** A lista fechada de motivos de perda deste contexto, para o diálogo de perder. */
export async function buscarMotivosCertificado(): Promise<MotivoCertificado[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('motivos_perda')
    .select('id, motivo')
    .eq('contexto', 'certificado')
    .eq('ativo', true)
    .order('ordem', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}
