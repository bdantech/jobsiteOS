import type { Json } from '../types/database.js'
import type { Supabase } from '../registry/types.js'
import {
  contatoManualFornecedorSchema,
  descartarFornecedorSchema,
  moverFornecedorSchema,
  pedirApresentacaoSchema,
  promoverContatoSchema,
  reatribuirFornecedorSchema,
  salvarConfigFornecedoresSchema,
  statusPedidoSchema,
} from './schemas.js'

/**
 * As escritas do funil de fornecedores. Todas por RPC, como no resto do sistema.
 *
 * Aqui a razão é específica: "sem interesse" grava estágio, motivo, uma linha de
 * supressão com validade e um evento — e a supressão é a que importa, porque é ela que
 * impede o próximo job de reabrir o lead. Meia transação aqui é um fornecedor marcado
 * como sem interesse que volta ao topo da lista na madrugada seguinte.
 */

export async function moverFornecedor(supabase: Supabase, input: unknown) {
  const dados = moverFornecedorSchema.parse(input)
  const { data, error } = await supabase.rpc('app_fornecedor_mover', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

export async function descartarFornecedor(supabase: Supabase, input: unknown) {
  const dados = descartarFornecedorSchema.parse(input)
  const { data, error } = await supabase.rpc('app_fornecedor_sem_interesse', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function reatribuirFornecedor(supabase: Supabase, input: unknown) {
  const dados = reatribuirFornecedorSchema.parse(input)
  const { data, error } = await supabase.rpc('app_fornecedor_reatribuir', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data
}

/**
 * Promove um contato descoberto a `contatos` oficial da empresa (§5).
 *
 * O RPC cria a ficha da empresa se ela ainda não existir: um fornecedor do funil não
 * é cliente, então na maioria dos casos não há `empresas.id` para pendurar o contato.
 * Exigir que alguém crie a empresa antes tornaria o "um clique" um formulário.
 */
export async function promoverContatoDescoberto(supabase: Supabase, input: unknown) {
  const dados = promoverContatoSchema.parse(input)
  const { data, error } = await supabase.rpc('app_promover_contato_descoberto', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data
}

/**
 * O contato escrito à mão, a partir do card da NF.
 *
 * A RPC cria a ficha da EMPRESA se ela não existir — é o passo que faltava para o
 * funil de NFs, onde 3.542 dos 3.705 fornecedores com nota viva não têm ficha
 * nenhuma e a aba "Mensagens" era um beco sem saída.
 */
export async function criarContatoManualFornecedor(supabase: Supabase, input: unknown) {
  const dados = contatoManualFornecedorSchema.parse(input)
  const { data, error } = await supabase.rpc('app_fornecedor_contato_manual', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function pedirApresentacao(supabase: Supabase, input: unknown) {
  const dados = pedirApresentacaoSchema.parse(input)
  const { data, error } = await supabase.rpc('app_pedir_apresentacao', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function mudarStatusPedido(supabase: Supabase, input: unknown) {
  const dados = statusPedidoSchema.parse(input)
  const { data, error } = await supabase.rpc('app_pedido_apresentacao_status', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function salvarConfigFornecedores(supabase: Supabase, input: unknown) {
  const dados = salvarConfigFornecedoresSchema.parse(input)
  const { data, error } = await supabase.rpc('app_salvar_fornecedores_config', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data
}
