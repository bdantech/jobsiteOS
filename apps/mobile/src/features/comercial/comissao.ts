import { useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  FaseConta,
  PapelComissao,
  StatusCompetencia,
  StatusLancamentoV2,
} from '@jobsiteos/core'

import { supabase } from '@/lib/supabase'

/**
 * A comissão no celular (04k §7, "Mobile").
 *
 * O recorte é deliberado: aqui cabem MÊS CORRENTE, HISTÓRICO e EXTRATO (leitura, com o
 * cálculo por extenso ao tocar), a FILA DE ACEITE e a APROVAÇÃO de competência. Não cabem
 * settings, simulador e reclassificação — as três exigem comparar tabela de taxas ou
 * decidir sobre a comissão de outra pessoa, e nenhuma dessas coisas se faz em pé, com uma
 * mão, entre duas reuniões.
 *
 * As leituras são as MESMAS RPCs e a MESMA tabela da web. Uma segunda leitura só para o
 * mobile é como as duas plataformas passam a discordar sobre quanto alguém ganhou.
 */

export const comissaoKeys = {
  painel: () => ['comercial', 'comissao-v2', 'painel'] as const,
  extrato: (competencia: string) => ['comercial', 'comissao-v2', 'extrato', competencia] as const,
  aceites: () => ['comercial', 'comissao-v2', 'aceites'] as const,
}

export interface PainelComissaoMobile {
  tem_acesso: boolean
  competencia: string
  mes_corrente: {
    total: number
    lancamentos: number
    cessoes: number
    por_papel: Partial<Record<PapelComissao, number>>
  }
  mes_anterior: { competencia: string; total: number }
  historico: {
    competencia: string
    total: number
    lancamentos: number
    status: StatusCompetencia
  }[]
}

const numeros = (o: unknown): Partial<Record<PapelComissao, number>> =>
  Object.fromEntries(
    Object.entries((o ?? {}) as Record<string, unknown>).map(([k, v]) => [k, Number(v) || 0]),
  ) as Partial<Record<PapelComissao, number>>

export function usePainelComissao() {
  return useQuery({
    queryKey: comissaoKeys.painel(),
    queryFn: async (): Promise<PainelComissaoMobile> => {
      const { data, error } = await supabase.rpc('comissao_painel_v2', {
        p_vendedor_id: undefined,
        p_meses: 12,
      })
      if (error) throw new Error(error.message)
      const r = (data ?? {}) as Record<string, unknown>
      const mc = (r.mes_corrente ?? {}) as Record<string, unknown>
      const ma = (r.mes_anterior ?? {}) as Record<string, unknown>
      return {
        tem_acesso: Boolean(r.tem_acesso),
        competencia: String(r.competencia ?? ''),
        mes_corrente: {
          total: Number(mc.total ?? 0),
          lancamentos: Number(mc.lancamentos ?? 0),
          cessoes: Number(mc.cessoes ?? 0),
          por_papel: numeros(mc.por_papel),
        },
        mes_anterior: {
          competencia: String(ma.competencia ?? ''),
          total: Number(ma.total ?? 0),
        },
        historico: ((r.historico ?? []) as Record<string, unknown>[]).map((h) => ({
          competencia: String(h.competencia),
          total: Number(h.total ?? 0),
          lancamentos: Number(h.lancamentos ?? 0),
          status: (h.status as StatusCompetencia) ?? 'aberta',
        })),
      }
    },
  })
}

export interface LinhaExtratoMobile {
  id: string
  papel: PapelComissao
  origem_tipo: string
  evento_em: string
  nf_numero: string | null
  cedente_nome: string | null
  descricao: string | null
  fase: FaseConta | null
  gestao_operacao: string | null
  valor_cedido: number | null
  anticipation_days: number | null
  vop: number | null
  taxa_brl_por_mm: number | null
  share_pct: number
  valor: number
  status: StatusLancamentoV2
  params_snapshot: Record<string, unknown>
  empresas: { razao_social: string | null } | null
}

export function useExtrato(competencia: string) {
  return useQuery({
    queryKey: comissaoKeys.extrato(competencia),
    queryFn: async (): Promise<LinhaExtratoMobile[]> => {
      const { data, error } = await supabase
        .from('comissao_lancamentos_v2')
        .select('id, papel, origem_tipo, evento_em, nf_numero, cedente_nome, descricao, fase, gestao_operacao, valor_cedido, anticipation_days, vop, taxa_brl_por_mm, share_pct, valor, status, params_snapshot, empresas(razao_social)')
        .eq('competencia', competencia)
        .order('evento_em', { ascending: false })
        // No celular ninguém rola trezentas linhas; o extrato completo é da web e do CSV.
        .limit(200)
      if (error) throw new Error(error.message)
      return (data ?? []).map((l) => ({
        ...(l as unknown as LinhaExtratoMobile),
        valor_cedido: l.valor_cedido === null ? null : Number(l.valor_cedido),
        vop: l.vop === null ? null : Number(l.vop),
        taxa_brl_por_mm: l.taxa_brl_por_mm === null ? null : Number(l.taxa_brl_por_mm),
        share_pct: Number(l.share_pct ?? 100),
        valor: Number(l.valor),
        params_snapshot: (l.params_snapshot ?? {}) as Record<string, unknown>,
      }))
    },
  })
}

export interface AceiteMobile {
  id: string
  empresa_id: string
  reuniao_em: string | null
  prazo_em: string
  status: 'pendente' | 'aceita' | 'recusada'
  aceite_automatico: boolean
  empresas: { razao_social: string | null } | null
}

export function useAceites() {
  return useQuery({
    queryKey: comissaoKeys.aceites(),
    queryFn: async (): Promise<AceiteMobile[]> => {
      const { data, error } = await supabase
        .from('sdr_aceites')
        .select('id, empresa_id, reuniao_em, prazo_em, status, aceite_automatico, empresas(razao_social)')
        .eq('status', 'pendente')
        .order('prazo_em')
        .limit(50)
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as AceiteMobile[]
    },
  })
}

/**
 * As duas ações que cabem no celular.
 *
 * Aceitar é um toque; recusar exige motivo e por isso pede uma frase — mas as duas são
 * decisões que a pessoa toma logo depois da reunião, que é exatamente quando ela está com
 * o celular na mão e não com o notebook aberto.
 *
 * O LANÇAMENTO não sai daqui: o RPC grava a decisão e o job horário do worker lança. Um
 * app que tentasse lançar precisaria da tabela de parâmetros e da régua de vigência no
 * bundle — duas respostas para a mesma pergunta, uma delas offline.
 */
export function useComissaoAcoes() {
  const qc = useQueryClient()

  async function decidirAceite(aceiteId: string, decisao: 'aceita' | 'recusada', motivo?: string) {
    const { error } = await supabase.rpc('app_decidir_aceite_sdr', {
      p: { aceite_id: aceiteId, decisao, motivo_recusa: motivo ?? null } as never,
    })
    if (error) throw new Error(error.message)
    await qc.invalidateQueries({ queryKey: ['comercial'] })
  }

  async function mudarCompetencia(competencia: string, status: 'aprovada' | 'paga') {
    const { error } = await supabase.rpc('app_mudar_status_competencia', {
      p: { competencia, status } as never,
    })
    if (error) throw new Error(error.message)
    await qc.invalidateQueries({ queryKey: ['comercial'] })
  }

  return { decidirAceite, mudarCompetencia }
}

/** A competência do mês corrente, no calendário de São Paulo (UTC-3 fixo desde 2019). */
export function competenciaCorrente(): string {
  const sp = new Date(Date.now() - 3 * 3_600_000)
  return `${sp.toISOString().slice(0, 7)}-01`
}
