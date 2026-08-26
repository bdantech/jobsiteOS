import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Confianca, EstagioFornecedor } from '@jobsiteos/core'

import { supabase } from '@/lib/supabase'

/**
 * Cadastro de fornecedores no celular (04l §5, "mobile é onde o originador trabalha
 * em campo").
 *
 * Esta é a tela do módulo que MAIS pertence ao celular, e não é força de expressão: o
 * uso real é na obra ou no carro, com a ficha de abordagem na mão e o botão de ligar
 * a um toque. A web ganha na hora de comparar; aqui ganha o toque.
 *
 * O que NÃO vem para cá: settings e o painel de eficácia por fonte. As duas são
 * decisão de política de provedor, se fazem sentadas, e nenhuma tem urgência de campo.
 *
 * As leituras são as MESMAS da web — mesma view, mesmas RPCs. Uma segunda leitura só
 * para o mobile é como as duas plataformas passam a discordar sobre quanto um
 * fornecedor vale.
 */

export const fornecedoresKeys = {
  funil: (estagio: string) => ['fornecedores', 'funil', estagio] as const,
  contatos: (cnpj: string) => ['fornecedores', 'contatos', cnpj] as const,
  painel: () => ['fornecedores', 'painel'] as const,
}

export interface SacadoPrincipal {
  cnpj: string
  nome: string | null
  valor: number
  notas: number
}

export interface FornecedorMobile {
  fornecedor_cnpj: string
  fornecedor_nome: string | null
  municipio: string | null
  uf: string | null
  estagio: EstagioFornecedor
  volume_90d: number | null
  qtd_nfs_90d: number | null
  prazo_medio_dias: number | null
  potencial_mensal: number | null
  ultima_nf_em: string | null
  contatos_encontrados: number
  melhor_confianca: Confianca | null
  originador_nome: string | null
  sacados_principais: SacadoPrincipal[]
  suprimido: boolean
}

export function useFunilFornecedores(estagio: EstagioFornecedor | 'todos') {
  return useQuery({
    queryKey: fornecedoresKeys.funil(estagio),
    queryFn: async (): Promise<FornecedorMobile[]> => {
      let q = supabase
        .from('fornecedores_funil_view')
        .select('fornecedor_cnpj, fornecedor_nome, municipio, uf, estagio, volume_90d, qtd_nfs_90d, prazo_medio_dias, potencial_mensal, ultima_nf_em, contatos_encontrados, melhor_confianca, originador_nome, sacados_principais, suprimido')
        // Do que mais emitiu em VALOR para o que menos emitiu — a mesma chave da web.
        .order('volume_90d', { ascending: false, nullsFirst: false })
        .limit(100)

      q = estagio === 'todos'
        ? q.not('estagio', 'in', '("cadastrado","sem_interesse")')
        : q.eq('estagio', estagio)

      const { data, error } = await q
      if (error) throw new Error(error.message)

      return (data ?? [])
        .filter((r) => typeof r.fornecedor_cnpj === 'string')
        .map((r) => ({
          fornecedor_cnpj: r.fornecedor_cnpj as string,
          fornecedor_nome: r.fornecedor_nome,
          municipio: r.municipio,
          uf: r.uf,
          estagio: (r.estagio ?? 'a_cadastrar') as EstagioFornecedor,
          volume_90d: r.volume_90d === null ? null : Number(r.volume_90d),
          qtd_nfs_90d: r.qtd_nfs_90d,
          prazo_medio_dias: r.prazo_medio_dias,
          potencial_mensal: r.potencial_mensal === null ? null : Number(r.potencial_mensal),
          ultima_nf_em: r.ultima_nf_em,
          contatos_encontrados: r.contatos_encontrados ?? 0,
          melhor_confianca: (r.melhor_confianca as Confianca | null) ?? null,
          originador_nome: r.originador_nome,
          sacados_principais: Array.isArray(r.sacados_principais)
            ? (r.sacados_principais as unknown as SacadoPrincipal[])
            : [],
          suprimido: r.suprimido === true,
        }))
    },
  })
}

export interface ContatoMobile {
  id: string
  tipo: string
  valor: string
  nome_pessoa: string | null
  cargo: string | null
  fonte: string
  confianca: Confianca
  evidencia: string | null
  frequencia: number
  ultima_vez_visto: string | null
  invalido: boolean
  ja_na_ficha: boolean
}

const PESO: Record<string, number> = { alta: 3, media: 2, baixa: 1 }

export function useContatosDoFornecedor(cnpj: string | null) {
  return useQuery({
    queryKey: fornecedoresKeys.contatos(cnpj ?? ''),
    enabled: Boolean(cnpj),
    queryFn: async (): Promise<ContatoMobile[]> => {
      const { data, error } = await supabase
        .from('contatos_descobertos')
        .select('id, tipo, valor, nome_pessoa, cargo, fonte, confianca, evidencia, frequencia, ultima_vez_visto, validado, promovido_contato_id')
        .eq('fornecedor_cnpj', cnpj as string)
      if (error) throw new Error(error.message)

      return (data ?? [])
        .map((c) => ({
          id: c.id,
          tipo: c.tipo,
          valor: c.valor,
          nome_pessoa: c.nome_pessoa,
          cargo: c.cargo,
          fonte: c.fonte,
          confianca: c.confianca as Confianca,
          evidencia: c.evidencia,
          frequencia: c.frequencia,
          ultima_vez_visto: c.ultima_vez_visto,
          invalido:
            typeof c.validado === 'object' &&
            c.validado !== null &&
            (c.validado as Record<string, unknown>).valido === false,
          ja_na_ficha: Boolean(c.promovido_contato_id),
        }))
        // Confiança primeiro, frequência depois. `order()` no PostgREST ordenaria o
        // texto (alta < baixa < media), que não é a ordem que importa.
        .sort((a, b) => (PESO[b.confianca] ?? 0) - (PESO[a.confianca] ?? 0) || b.frequencia - a.frequencia)
    },
  })
}

export interface PainelFornecedoresMobile {
  tem_acesso: boolean
  potencial_total: number
  gasto_mes: number
  teto_mensal: number
  por_estagio: Record<string, number>
}

export function usePainelFornecedores() {
  return useQuery({
    queryKey: fornecedoresKeys.painel(),
    queryFn: async (): Promise<PainelFornecedoresMobile> => {
      const { data, error } = await supabase.rpc('fornecedores_painel', {
        p_originador_id: undefined,
      })
      if (error) throw new Error(error.message)
      const d = (data ?? {}) as Record<string, unknown>
      return {
        tem_acesso: d.tem_acesso === true,
        potencial_total: Number(d.potencial_total) || 0,
        gasto_mes: Number(d.gasto_mes) || 0,
        teto_mensal: Number(d.teto_mensal) || 0,
        por_estagio: (d.por_estagio ?? {}) as Record<string, number>,
      }
    },
  })
}

/**
 * As três escritas que fazem sentido em campo.
 *
 * "Buscar contatos" NÃO está aqui, e a ausência é decisão: o clique custa dinheiro e
 * roda uma cascata de até um minuto e meio. Uma tela de campo, numa rede de obra, é o
 * pior lugar possível para descobrir que a chamada caiu no meio de uma cobrança. Ele
 * fica na web, com o custo na frente da pessoa.
 */
export function useAcoesFornecedor() {
  const qc = useQueryClient()
  const invalidar = (): void => {
    void qc.invalidateQueries({ queryKey: ['fornecedores'] })
  }

  const mover = useMutation({
    mutationFn: async (v: { cnpj: string; estagio: EstagioFornecedor }) => {
      const { error } = await supabase.rpc('app_fornecedor_mover', {
        p: { fornecedor_cnpj: v.cnpj, estagio: v.estagio } as never,
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: invalidar,
  })

  /**
   * O toque registra QUAL contato foi usado — e é isso, e só isso, que permite ao §6
   * responder depois "qual fonte levou ao cadastro". Um toque sem o contato é um
   * telefonema que o sistema viu acontecer e não sabe atribuir a nada.
   */
  const registrarToque = useMutation({
    mutationFn: async (v: {
      cnpj: string
      canal: 'ligacao' | 'whatsapp' | 'email'
      contatoId?: string
    }) => {
      const { error } = await supabase.rpc('app_fornecedor_toque', {
        p: {
          fornecedor_cnpj: v.cnpj,
          canal: v.canal,
          contato_descoberto_id: v.contatoId ?? null,
        } as never,
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: invalidar,
  })

  const promoverPontoFocal = useMutation({
    mutationFn: async (contatoId: string) => {
      const { error } = await supabase.rpc('app_promover_contato_descoberto', {
        p: { contato_descoberto_id: contatoId, ponto_focal: true } as never,
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: invalidar,
  })

  const semInteresse = useMutation({
    mutationFn: async (v: { cnpj: string; motivo: string; observacao?: string; eterna: boolean }) => {
      const { error } = await supabase.rpc('app_fornecedor_sem_interesse', {
        p: {
          fornecedor_cnpj: v.cnpj,
          motivo: v.motivo,
          observacao: v.observacao ?? null,
          dias: v.eterna ? null : 90,
        } as never,
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: invalidar,
  })

  return { mover, registrarToque, promoverPontoFocal, semInteresse }
}
