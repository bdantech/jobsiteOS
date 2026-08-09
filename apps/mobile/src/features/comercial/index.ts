import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ESTAGIOS_SDR,
  ESTAGIOS_VENDA,
  ESTAGIO_SDR_LABELS,
  ESTAGIO_VENDA_LABELS,
  type EstagioSdr,
  type EstagioVenda,
} from '@jobsiteos/core'

import { supabase } from '@/lib/supabase'

/**
 * O Comercial no celular. As mesmas RPCs da web — nada de uma segunda leitura só para
 * o mobile, que é como as duas plataformas passam a discordar sobre quantos leads a
 * pessoa tem.
 *
 * O que muda é a INTERAÇÃO: aqui não há kanban. A tela é uma lista com o próximo passo
 * em botão grande, porque o uso real é em pé, entre uma reunião e outra, com uma mão.
 */

export const comercialKeys = {
  resumo: () => ['comercial', 'resumo'] as const,
  leads: () => ['comercial', 'leads'] as const,
  vendas: () => ['comercial', 'vendas'] as const,
}

export interface ResumoMobile {
  tem_acesso: boolean
  sem_vendedor?: boolean
  vendedor?: { id: string; nome: string; tipo: string }
  leads_por_estagio: Record<string, number>
  vendas_por_estagio: Record<string, number>
  nfs_vivas: number
  passivas_geridas: number
  proximas_reunioes: { id: string; titulo: string; inicio_em: string }[]
  comissao_mes: { competencia: string; total: number; por_status: Record<string, number> }
}

export function useResumoComercial() {
  return useQuery({
    queryKey: comercialKeys.resumo(),
    queryFn: async (): Promise<ResumoMobile> => {
      const { data, error } = await supabase.rpc('comercial_resumo_vendedor', {
        p_vendedor_id: undefined,
      })
      if (error) throw new Error(error.message)
      const r = (data ?? {}) as Partial<ResumoMobile>
      return {
        tem_acesso: r.tem_acesso ?? false,
        sem_vendedor: r.sem_vendedor,
        vendedor: r.vendedor,
        leads_por_estagio: r.leads_por_estagio ?? {},
        vendas_por_estagio: r.vendas_por_estagio ?? {},
        nfs_vivas: r.nfs_vivas ?? 0,
        passivas_geridas: r.passivas_geridas ?? 0,
        proximas_reunioes: r.proximas_reunioes ?? [],
        comissao_mes: r.comissao_mes ?? { competencia: '', total: 0, por_status: {} },
      }
    },
  })
}

export interface LeadMobile {
  id: string
  estagio: string
  reuniao_em: string | null
  fit: boolean | null
  encerrado_em: string | null
  empresas: { id: string; razao_social: string | null; uf: string | null } | null
}

export function useLeads() {
  return useQuery({
    queryKey: comercialKeys.leads(),
    queryFn: async (): Promise<LeadMobile[]> => {
      const { data, error } = await supabase
        .from('sdr_leads')
        .select('id, estagio, reuniao_em, fit, encerrado_em, empresas(id, razao_social, uf)')
        // Só o que pede trabalho: no celular ninguém rola cem cards, e lead encerrado
        // não pede nada.
        .is('encerrado_em', null)
        .neq('estagio', 'qualificada')
        .order('distribuido_em', { ascending: false })
        .limit(100)
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as LeadMobile[]
    },
  })
}

export interface VendaMobile {
  id: string
  estagio: string
  empresas: { id: string; razao_social: string | null; uf: string | null } | null
}

export function useVendas() {
  return useQuery({
    queryKey: comercialKeys.vendas(),
    queryFn: async (): Promise<VendaMobile[]> => {
      const { data, error } = await supabase
        .from('vendas')
        .select('id, estagio, empresas(id, razao_social, uf)')
        .not('estagio', 'in', '("ganho","perdido")')
        .order('atualizada_em', { ascending: false })
        .limit(100)
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as VendaMobile[]
    },
  })
}

/**
 * O próximo passo de um lead, e só ele.
 *
 * No celular o avanço é um botão, não um menu: escolher entre seis estágios com o
 * polegar, na rua, é como um card acaba no lugar errado.
 *
 * `em_conversa` não avança daqui: o passo seguinte é AGENDAR, que exige data e closer —
 * e escolher os dois no celular, entre uma reunião e outra, é como se marca reunião no
 * horário errado. Marcar SEM FIT também fica na web, porque exige motivo, e motivo
 * escolhido às pressas vira sempre "Outro".
 */
export function proximoEstagioSdr(atual: string): EstagioSdr | null {
  const fluxo: Partial<Record<EstagioSdr, EstagioSdr>> = {
    a_contatar: 'em_conversa',
    reuniao_agendada: 'reuniao_realizada',
    no_show: 'reuniao_realizada',
    reuniao_realizada: 'qualificada',
  }
  return fluxo[atual as EstagioSdr] ?? null
}

export function proximoEstagioVenda(atual: string): EstagioVenda | null {
  const ordem: readonly EstagioVenda[] = ESTAGIOS_VENDA.filter((e) => e !== 'perdido')
  if (atual === 'em_analise_credito' || atual === 'ganho' || atual === 'perdido') return null
  const i = ordem.indexOf(atual as EstagioVenda)
  return i >= 0 && i < ordem.length - 1 ? (ordem[i + 1] as EstagioVenda) : null
}

export function useMover() {
  const qc = useQueryClient()

  async function moverLead(leadId: string, estagio: EstagioSdr) {
    const { error } = await supabase.rpc('app_mover_lead_sdr', {
      p: { lead_id: leadId, estagio } as never,
    })
    if (error) throw new Error(error.message)
    await qc.invalidateQueries({ queryKey: ['comercial'] })
  }

  /** Só "com fit": sem fit exige motivo, e isso é escolha de lista — fica na web. */
  async function marcarComFit(leadId: string) {
    const { error } = await supabase.rpc('app_mover_lead_sdr', {
      p: { lead_id: leadId, fit: true } as never,
    })
    if (error) throw new Error(error.message)
    await qc.invalidateQueries({ queryKey: ['comercial'] })
  }

  async function moverVenda(vendaId: string, estagio: EstagioVenda) {
    const { error } = await supabase.rpc('app_mover_venda', {
      p: { venda_id: vendaId, estagio } as never,
    })
    if (error) throw new Error(error.message)
    await qc.invalidateQueries({ queryKey: ['comercial'] })
  }

  return { moverLead, marcarComFit, moverVenda }
}

export { ESTAGIOS_SDR, ESTAGIO_SDR_LABELS, ESTAGIO_VENDA_LABELS }
