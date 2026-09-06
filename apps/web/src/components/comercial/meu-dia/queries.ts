import 'server-only'

import { resolverConfig, type MeuDia, type OverrideBloco } from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/server'

/**
 * A carga do Meu Dia, do lado do servidor.
 *
 * UMA ida ao banco para os blocos (o RPC `meu_dia`), mais uma leitura minúscula: os
 * overrides de configuração do cargo. Não há N+1 em lugar nenhum — e não há um segundo
 * agregador escrito aqui que pudesse discordar do primeiro.
 *
 * A COMISSÃO PROJETADA saiu da tela, e com ela saiu daqui o cálculo que só a alimentava:
 * a leitura inteira de `commission_params`, a das contas dos itens projetáveis e a corrida
 * do motor do 04k a cada carregamento. Um número que ninguém lê não deixa de custar as
 * consultas que o produzem. O motor em si (`projetarComissao`, no core) continua de pé e
 * testado — quem sai é a chamada, não a régua.
 */

export interface MeuDiaCarregado extends MeuDia {
  /** Overrides vigentes, para a tela poder explicar de onde vem cada limiar. */
  config: Record<string, { ativo: boolean; max_itens: number; limiares: Record<string, number> }>
}

const VAZIO: MeuDia = {
  tem_acesso: false,
  vendedor_id: null,
  vendedor_nome: null,
  tipo: null,
  espelhado: false,
  gerado_em: new Date().toISOString(),
  blocos: [],
  mapa_carteira: [],
  evolucao: [],
  funil_semana: [],
}

export async function carregarMeuDia(vendedorId?: string | null): Promise<MeuDiaCarregado> {
  const supabase = await createClient()

  /*
   * O CARGO PRECEDE A CONFIG, e a config precede os blocos — é o cargo que decide quais
   * blocos existem. Por isso a primeira ida ao banco descobre de quem é o dia.
   *
   * `app_meu_dia_cargo` resolve as três hipóteses num lugar só (alvo explícito do gestor,
   * closer de quem é auxiliar, ou eu mesmo) e devolve o mesmo cargo que o agregador vai
   * usar. Repetir a regra aqui em TypeScript seria a segunda régua que a 04p inteira
   * existe para não ter.
   */
  const alvo = vendedorId ?? null
  const { data: cargoAlvo } = await supabase.rpc('app_meu_dia_cargo' as never, {
    p_vendedor_id: alvo,
  } as never)
  const tipo = (cargoAlvo as string | null) ?? null

  const { data: cfgRow } = tipo
    ? await supabase.from('meu_dia_config').select('blocos').eq('tipo_vendedor', tipo).maybeSingle()
    : { data: null }

  const overrides = (cfgRow?.blocos ?? {}) as Record<string, OverrideBloco>
  const config = resolverConfig(tipo, overrides)

  const { data, error } = await supabase.rpc('meu_dia' as never, {
    p_vendedor_id: alvo,
    p_config: config,
  } as never)
  if (error) throw new Error(error.message)

  const dia = { ...VAZIO, ...((data ?? {}) as Partial<MeuDia>) } as MeuDia
  return { ...dia, config }
}
