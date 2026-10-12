'use client'

import { createClient } from '@/lib/supabase/client'

/**
 * O report "Documentos sem dono e carteiras" — uma leitura só, `app_report_documentos`.
 *
 * A função agrega no banco e recusa quem não é gestor (0294). Nada é recalculado aqui:
 * a pergunta "por que está sem dono" repete a régua do roteamento, e uma segunda
 * implementação dela no cliente daria um motivo na tela e outro no job.
 */

export const documentosKeys = {
  report: () => ['relatorios', 'documentos-sem-dono'] as const,
}

/** As três origens do funil, sempre na mesma ordem. */
export interface PorTipo {
  docs_nf: number
  docs_pa: number
  docs_ti: number
  valor_nf?: number
  valor_pa?: number
  valor_ti?: number
}

export type MotivoSemDono = 'fora_de_carteira' | 'sacado_sem_cadastro' | 'passivo' | 'em_carteira'

export interface TotaisSemDono extends PorTipo {
  docs: number
  valor: number
  receita: number
  sacados: number
  cedentes: number
}

export interface LinhaMotivo extends PorTipo {
  motivo: MotivoSemDono
  docs: number
  valor: number
  sacados: number
  cedentes: number
}

export interface LinhaContraparte extends PorTipo {
  raiz: string
  nome: string | null
  empresa_id: string | null
  cnpjs: number
  docs: number
  valor: number
  pct: number | null
  receita: number
  /** Cedentes distintos (na lista de sacados) ou sacados distintos (na de cedentes). */
  contrapartes: number
  vence_30d: number
  alta_boa: number
  estagio: string | null
  cadastrado: boolean
  motivo: MotivoSemDono
  // Só na lista de sacados.
  gestao?: string | null
  credito?: string | null
  // Só na lista de cedentes.
  maior_sacado?: string | null
  maior_sacado_valor?: number | null
  sem_interesse?: boolean
  cliente_onepay?: boolean
  protesto?: boolean
}

export interface LinhaConta extends PorTipo {
  empresa_id: string
  nome: string | null
  cnpj: string | null
  estagio: string | null
  gestao: string | null
  cnpjs: number
  docs: number
  valor: number
  receita: number
  cedentes: number
  alta_boa: number
  credito: string | null
  carteira: string | null
}

export type StatusDocumento =
  | 'no_funil'
  | 'sem_interesse'
  | 'suprimido'
  | 'substituido'
  | 'prazo_longo'
  | 'nao_operavel'
  | 'convertida'
  | 'perdida'
  | 'expirada'

export interface LinhaStatus extends PorTipo {
  status: StatusDocumento
  docs: number
  valor: number
}

export interface MotivoSemInteresseLinha {
  motivo: string
  fornecedores: number
  docs: number
  valor: number
}

export interface LinhaOriginador {
  vendedor_id: string
  nome: string
  tipo: string | null
  ativo: boolean
  status: LinhaStatus[]
  sem_interesse_motivos: MotivoSemInteresseLinha[]
}

export interface ReportDocumentos {
  gerado_em: string
  totais: TotaisSemDono
  motivos: LinhaMotivo[]
  sacados: LinhaContraparte[]
  cedentes: LinhaContraparte[]
  contas: LinhaConta[]
  originadores: LinhaOriginador[]
}

export async function buscarReportDocumentos(): Promise<ReportDocumentos> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('app_report_documentos' as never)
  if (error) throw new Error(error.message)
  return data as unknown as ReportDocumentos
}
