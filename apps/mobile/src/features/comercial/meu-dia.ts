import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { resolverConfig, type MeuDia, type OverrideBloco } from '@jobsiteos/core'

import { supabase } from '@/lib/supabase'

/**
 * O Meu Dia no celular.
 *
 * As MESMAS funções da web — `app_meu_dia_cargo`, `resolverConfig` do core e o RPC
 * `meu_dia`. Nada de uma segunda leitura só para o mobile, que é como as duas
 * plataformas passam a discordar sobre quantos itens a pessoa tem hoje.
 *
 * O que muda é a INTERAÇÃO, e é onde esta tela mais importa: ela é a primeira coisa
 * aberta no café. Timeline no topo, indicadores em carrossel, e o adiar/descartar no
 * swipe — porque a mão que segura o telefone é a mesma que trabalha o item.
 *
 * A comissão projetada NÃO vem para cá. Ela exige rodar o motor do 04k sobre os
 * parâmetros vigentes, e o celular é onde se decide o que fazer agora, não onde se
 * confere quanto o dia vale — esse número tem tela própria em Comissão.
 */

export const meuDiaKeys = {
  dia: () => ['comercial', 'meu-dia'] as const,
}

export function useMeuDia() {
  return useQuery({
    queryKey: meuDiaKeys.dia(),
    queryFn: async (): Promise<MeuDia> => {
      /*
       * As duas leituras baratas vão juntas: o cargo (que decide QUAIS blocos existem) e
       * as três linhas de configuração. Encadeá-las custaria uma viagem a mais numa rede
       * de celular, que é onde a viagem a mais se nota.
       */
      const [cargoRes, cfgRes] = await Promise.all([
        supabase.rpc('app_meu_dia_cargo' as never, { p_vendedor_id: null } as never),
        supabase.from('meu_dia_config').select('tipo_vendedor, blocos'),
      ])
      if (cargoRes.error) throw new Error(cargoRes.error.message)

      const cargo = (cargoRes.data as string | null) ?? null
      const linha = (cfgRes.data ?? []).find((c) => c.tipo_vendedor === cargo)
      const config = resolverConfig(cargo, (linha?.blocos ?? {}) as Record<string, OverrideBloco>)

      const { data, error } = await supabase.rpc('meu_dia' as never, {
        p_vendedor_id: null,
        p_config: config,
      } as never)
      if (error) throw new Error(error.message)

      const r = (data ?? {}) as Partial<MeuDia>
      return {
        tem_acesso: r.tem_acesso ?? false,
        vendedor_id: r.vendedor_id ?? null,
        vendedor_nome: r.vendedor_nome ?? null,
        tipo: r.tipo ?? null,
        espelhado: r.espelhado ?? false,
        gerado_em: r.gerado_em ?? new Date().toISOString(),
        blocos: r.blocos ?? [],
        mapa_carteira: r.mapa_carteira ?? [],
        evolucao: r.evolucao ?? [],
        funil_semana: r.funil_semana ?? [],
      }
    },
  })
}

export interface OcultarInput {
  tipoItem: string
  referenciaId: string
  acao: 'adiado' | 'irrelevante'
  adiadoAte?: string | null
  motivo?: string | null
  empresaId?: string | null
  rotulo?: string
}

/**
 * Adiar e descartar passam pelo RPC, e não por um insert daqui.
 *
 * É lá que mora quem é o vendedor-alvo, a recusa de adiar sem data e o evento que
 * alimenta a calibragem dos limiares. Escrever na tabela direto faria o celular gravar
 * o adiamento sem o evento — e a régua do bloco ficaria sem o único sinal que diz que
 * ela está errada.
 */
export function useOcultarItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: OcultarInput) => {
      const { error } = await supabase.rpc('app_meu_dia_ocultar' as never, {
        p: {
          tipo_item: input.tipoItem,
          referencia_id: input.referenciaId,
          acao: input.acao,
          adiado_ate: input.adiadoAte ?? null,
          motivo: input.motivo ?? null,
          empresa_id: input.empresaId ?? null,
          rotulo: input.rotulo ?? null,
        },
      } as never)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: meuDiaKeys.dia() }),
  })
}

export function useConcluirTarefa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('app_meu_dia_concluir_tarefa' as never, { p_id: id } as never)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: meuDiaKeys.dia() }),
  })
}
