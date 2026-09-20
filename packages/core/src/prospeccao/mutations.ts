import type { Json } from '../types/database.js'
import type { Supabase } from '../registry/types.js'
import {
  descartarSacadoProspeccaoSchema,
  moverSacadoProspeccaoSchema,
  pedirApresentacaoSacadoSchema,
  reatribuirSacadoProspeccaoSchema,
  salvarProspeccaoConfigSchema,
  seguirFornecedorSchema,
  solicitarAnaliseProspeccaoSchema,
} from './schemas.js'

/**
 * As escritas do funil de Sacados por NF. Todas por RPC, como no resto do sistema.
 *
 * Aqui a razão é específica: "solicitar análise" grava a linha na esteira de crédito, o
 * estágio do card, o vínculo entre os dois e o evento da timeline. Meia transação é um
 * card dizendo "análise solicitada" sem análise nenhuma do outro lado — e o originador
 * esperando por semanas uma resposta que ninguém vai dar.
 */

export async function moverSacadoProspeccao(supabase: Supabase, input: unknown) {
  const dados = moverSacadoProspeccaoSchema.parse(input)
  const { data, error } = await supabase.rpc('app_prospeccao_mover', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function descartarSacadoProspeccao(supabase: Supabase, input: unknown) {
  const dados = descartarSacadoProspeccaoSchema.parse(input)
  const { data, error } = await supabase.rpc('app_prospeccao_descartar', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function reatribuirSacadoProspeccao(supabase: Supabase, input: unknown) {
  const dados = reatribuirSacadoProspeccaoSchema.parse(input)
  const { data, error } = await supabase.rpc('app_prospeccao_reatribuir', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data
}

/**
 * Abre a análise na esteira (04d) já ligada ao card.
 *
 * O limite vai VAZIO na maioria das vezes: o RPC cai no `limite_potencial` calculado
 * pelo 04c e o arredonda pela mesma régua do resto da esteira. Digitar um número aqui é
 * a exceção — e quando alguém digita, é porque conhece o sacado melhor que a estimativa.
 */
export async function solicitarAnaliseProspeccao(supabase: Supabase, input: unknown) {
  const dados = solicitarAnaliseProspeccaoSchema.parse(input)
  const { data, error } = await supabase.rpc('app_prospeccao_solicitar_analise', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data
}

/**
 * Seguir (ou deixar de seguir) um cedente.
 *
 * É o botão que FAZ O FUNIL EXISTIR para quem não é titular de nada: medido em
 * 20/09/2026, 1 dos 130 cedentes que emitem contra sacados não cadastrados tem titular
 * vigente em `vendedor_carteira`. Sem este clique, quase todo card nasceria órfão e
 * ficaria só com o gestor.
 */
export async function seguirFornecedor(supabase: Supabase, input: unknown) {
  const dados = seguirFornecedorSchema.parse(input)
  const { data, error } = await supabase.rpc('app_prospeccao_seguir', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data
}

/**
 * Pede a ponte AO CEDENTE (§5). A direção é o inverso da do 04l, e a tabela sabe disso
 * desde a 0222d: quem recebe aqui é o fornecedor, não o sacado.
 */
export async function pedirApresentacaoSacado(supabase: Supabase, input: unknown) {
  const dados = pedirApresentacaoSacadoSchema.parse(input)
  const { data, error } = await supabase.rpc('app_prospeccao_pedir_apresentacao', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function salvarProspeccaoConfig(supabase: Supabase, input: unknown) {
  const dados = salvarProspeccaoConfigSchema.parse(input)
  const { data, error } = await supabase.rpc('app_salvar_prospeccao_config', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data
}
