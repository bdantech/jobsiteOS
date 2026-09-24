import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ESTAGIOS_SDR,
  ESTAGIOS_VENDA,
  ESTAGIO_SDR_LABELS,
  ESTAGIO_VENDA_LABELS,
  rotuloOrigemLead,
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
  /**
   * O vendedor entra NA CHAVE, e não é detalhe: sem ele, o gestor que trocasse de
   * pessoa no seletor leria o painel do anterior servido do cache — com o nome
   * novo no cabeçalho e os números velhos embaixo. `null` é "eu mesmo".
   */
  resumo: (vendedorId?: string | null) => ['comercial', 'resumo', vendedorId ?? null] as const,
  vendedores: () => ['comercial', 'vendedores'] as const,
  leads: () => ['comercial', 'leads'] as const,
  vendas: () => ['comercial', 'vendas'] as const,
}

/** Uma pessoa que o usuário atual tem permissão de enxergar no módulo. */
export interface VendedorVisivel {
  id: string
  nome: string
  tipo: string
  is_ia: boolean | null
}

/**
 * Quem o usuário atual pode ver.
 *
 * A RPC já resolve a autorização inteira: filtra por `app_tem_modulo('comercial')`,
 * por `app_pode_ver_vendedor` linha a linha, e só devolve os ativos. Um vendedor
 * comum recebe uma lista de um — ele mesmo —, e o seletor nem aparece. Não há
 * decisão de permissão do lado do cliente aqui, e não pode haver.
 */
export function useVendedoresVisiveis() {
  return useQuery({
    queryKey: comercialKeys.vendedores(),
    queryFn: async (): Promise<VendedorVisivel[]> => {
      const { data, error } = await supabase.rpc('comercial_vendedores_visiveis')
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as VendedorVisivel[]
    },
    // A lista de vendedores muda quando alguém entra ou sai da equipe, não durante
    // uma sessão de consulta.
    staleTime: 5 * 60 * 1000,
  })
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
  /**
   * `null` quando quem pede não pode ver a FOLHA desta pessoa (0215) — o auxiliar
   * abrindo o painel do closer. Nulo, e não zero: zero afirmaria que a comissão dele é
   * zero. O trabalho dele continua todo aqui.
   */
  comissao_mes: {
    competencia: string
    total: number
    cessoes?: number
    por_status: Record<string, number>
    por_papel?: Record<string, number>
  } | null
  /** Reuniões esperando o aceite DESTA pessoa. A única pendência do módulo com prazo. */
  aceites_pendentes: number
}

/**
 * O painel de uma pessoa. Sem argumento, a do próprio usuário.
 *
 * `vendedorId` é o que permite ao gestor abrir o painel de quem ele escolher no
 * seletor. Passá-lo NÃO é uma decisão de permissão do app: a RPC chama
 * `app_pode_ver_vendedor(id)` e devolve `tem_acesso: false` para quem não pode —
 * um id forjado aqui não vira leitura no banco.
 *
 * O bloco `comissao_mes` tem régua própria e mais curta (`app_pode_ver_folha`, 0215):
 * vê-se o TRABALHO de quem se ajuda, não a remuneração dele. Por isso ele pode vir
 * `null` num painel que, no resto, veio inteiro.
 */
export function useResumoComercial(vendedorId?: string | null) {
  return useQuery({
    queryKey: comercialKeys.resumo(vendedorId),
    queryFn: async (): Promise<ResumoMobile> => {
      const { data, error } = await supabase.rpc('comercial_resumo_vendedor', {
        p_vendedor_id: vendedorId ?? undefined,
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
        comissao_mes: r.comissao_mes ?? null,
        aceites_pendentes: r.aceites_pendentes ?? 0,
      }
    },
  })
}

/** O que o card do funil mostra da empresa — o mesmo recorte do card da web. */
interface EmpresaDoCard {
  id: string
  razao_social: string | null
  uf: string | null
  valor_esperado_mensal: number | null
  score_faixa: string | null
}

export interface LeadMobile {
  id: string
  estagio: string
  reuniao_em: string | null
  fit: boolean | null
  encerrado_em: string | null
  /** Por qual porta o lead entrou: 'distribuicao' | 'inbound' | 'manual'. */
  origem: string
  /** O dono do card. Vira nome só quando a pessoa enxerga mais alguém além de si. */
  sdr_id: string | null
  empresas: EmpresaDoCard | null
}

/**
 * O funil de reuniões inteiro que a RLS devolve — as SEIS colunas, como na web.
 *
 * `qualificada` estava fora ("não pede trabalho"), e com ela a tela deixava de ser
 * o funil: o SDR não tinha como conferir o que já entregou ao closer, e a contagem
 * por estágio mentia. Encerrado continua fora, como é o padrão da web — lá ele só
 * volta com um interruptor, que é conferência de escritório.
 */
export function useLeads() {
  return useQuery({
    queryKey: comercialKeys.leads(),
    queryFn: async (): Promise<LeadMobile[]> => {
      const { data, error } = await supabase
        .from('sdr_leads')
        .select(
          'id, estagio, reuniao_em, fit, encerrado_em, origem, sdr_id, empresas(id, razao_social, uf, valor_esperado_mensal, score_faixa)',
        )
        .is('encerrado_em', null)
        .order('distribuido_em', { ascending: false })
        .limit(500)
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as LeadMobile[]
    },
  })
}

export interface VendaMobile {
  id: string
  estagio: string
  situacao: string
  primeira_operacao_em: string | null
  vendedor_id: string | null
  empresas: EmpresaDoCard | null
  /** Nula também quando a RLS esconde a análise de quem abriu. */
  analises_credito: {
    estagio: string
    limite_aprovado: number | null
    motivo: string | null
  } | null
}

export function useVendas() {
  return useQuery({
    queryKey: comercialKeys.vendas(),
    queryFn: async (): Promise<VendaMobile[]> => {
      const { data, error } = await supabase
        .from('vendas')
        .select(
          'id, estagio, situacao, primeira_operacao_em, vendedor_id, empresas(id, razao_social, uf, valor_esperado_mensal, score_faixa), analises_credito(estagio, limite_aprovado, motivo)',
        )
        // O que ainda é assunto — a mesma régua do `vendaNoFunil` da web: em
        // andamento, ou ganho que ainda não operou.
        .neq('situacao', 'perdido')
        .is('primeira_operacao_em', null)
        .order('atualizada_em', { ascending: false })
        .limit(500)
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
  if (atual === 'em_analise_credito') return null
  const i = ESTAGIOS_VENDA.indexOf(atual as EstagioVenda)
  return i >= 0 && i < ESTAGIOS_VENDA.length - 1 ? (ESTAGIOS_VENDA[i + 1] as EstagioVenda) : null
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

export { ESTAGIOS_SDR, ESTAGIO_SDR_LABELS, ESTAGIO_VENDA_LABELS, rotuloOrigemLead }
