import type { Json } from '../types/database.js'
import type { Supabase } from '../registry/types.js'
import {
  atribuirLeadSdrSchema,
  criarLeadSdrSchema,
  atribuirNfSchema,
  atribuirVendaSchema,
  salvarAcessoSchema,
  salvarConfigSchema,
  salvarMotivoSchema,
  salvarRegraSchema,
  salvarTerritorioSchema,
  salvarVendedorSchema,
  definirCarteiraPassivaSchema,
  definirCarteiraSchema,
  vincularSacadoSchema,
  definirGestaoSchema,
  moverLeadSchema,
  moverVendaSchema,
  mudarStatusComissaoSchema,
  salvarParametroSchema,
  decidirAceiteSdrSchema,
  mudarStatusCompetenciaSchema,
  ajusteManualComissaoSchema,
} from './schemas.js'

/**
 * As escritas do Comercial. Todas por RPC, e nenhuma tabela do módulo tem grant de
 * insert/update para `authenticated` — a mesma disciplina do resto do sistema.
 *
 * Aqui não é preciosismo de arquitetura: "agendar reunião" grava lead + card do closer +
 * dois eventos de calendário + evento da empresa. Deixar isso a cargo de quem chama é
 * aceitar meia reunião agendada como estado possível do banco.
 */

export async function definirGestaoOperacao(supabase: Supabase, input: unknown) {
  const dados = definirGestaoSchema.parse(input)
  const { data, error } = await supabase.rpc('app_definir_gestao_operacao', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

export async function definirCarteira(supabase: Supabase, input: unknown) {
  const dados = definirCarteiraSchema.parse(input)
  const { data, error } = await supabase.rpc('app_definir_carteira', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

/**
 * O CNPJ que opera por baixo de um cliente.
 *
 * Existe porque as três deduções de `app_holding_do_sacado` — CNPJ, raiz e grupo
 * econômico — não alcançam o caso em que a gestão SABE de quem é a operação e o dado
 * público não diz. Um sacado sem conta não gera comissão para ninguém, e não emite
 * sintoma nenhum ao não gerar.
 */
export async function vincularSacado(supabase: Supabase, input: unknown) {
  const dados = vincularSacadoSchema.parse(input)
  const { data, error } = await supabase.rpc('app_vincular_sacado', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

/**
 * A carteira passiva inteira de um closer, numa chamada.
 *
 * O RPC recusa o lote todo se alguma empresa não puder ser passiva. É o comportamento
 * certo para uma tela que mostra uma lista: gravar as boas e ignorar as ruins deixaria
 * o formulário exibindo um sucesso que não corresponde ao que ficou no banco.
 */
export async function definirCarteiraPassiva(supabase: Supabase, input: unknown) {
  const dados = definirCarteiraPassivaSchema.parse(input)
  const { data, error } = await supabase.rpc('app_definir_carteira_passiva', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function moverLeadSdr(supabase: Supabase, input: unknown) {
  const dados = moverLeadSchema.parse(input)
  const { data, error } = await supabase.rpc('app_mover_lead_sdr', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

export async function moverVenda(supabase: Supabase, input: unknown) {
  const dados = moverVendaSchema.parse(input)
  const { data, error } = await supabase.rpc('app_mover_venda', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

export async function atribuirLeadSdr(supabase: Supabase, input: unknown) {
  const dados = atribuirLeadSdrSchema.parse(input)
  const { data, error } = await supabase.rpc('app_atribuir_lead_sdr', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

export async function criarLeadSdr(supabase: Supabase, input: unknown) {
  const dados = criarLeadSdrSchema.parse(input)
  const { data, error } = await supabase.rpc('app_criar_lead_sdr', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

export async function atribuirVenda(supabase: Supabase, input: unknown) {
  const dados = atribuirVendaSchema.parse(input)
  const { data, error } = await supabase.rpc('app_atribuir_venda', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

export async function atribuirNf(supabase: Supabase, input: unknown) {
  const dados = atribuirNfSchema.parse(input)
  const { error } = await supabase.rpc('app_atribuir_nf', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
}

export async function mudarStatusComissao(supabase: Supabase, input: unknown) {
  const dados = mudarStatusComissaoSchema.parse(input)
  const { data, error } = await supabase.rpc('app_mudar_status_comissao', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data as unknown as number
}

export async function gerarTokenIcs(supabase: Supabase, vendedorId?: string) {
  const { data, error } = await supabase.rpc('app_gerar_token_ics', {
    p: { vendedor_id: vendedorId ?? null } as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data as unknown as string
}

// ─── Cadastro ───────────────────────────────────────────────────────────────

export async function salvarVendedor(supabase: Supabase, input: unknown) {
  const dados = salvarVendedorSchema.parse(input)
  const { data, error } = await supabase.rpc('app_salvar_vendedor', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

export async function salvarTerritorio(supabase: Supabase, input: unknown) {
  const dados = salvarTerritorioSchema.parse(input)
  const { data, error } = await supabase.rpc('app_salvar_territorio', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

export async function salvarComissaoRegra(supabase: Supabase, input: unknown) {
  const dados = salvarRegraSchema.parse(input)
  const { data, error } = await supabase.rpc('app_salvar_comissao_regra', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

export async function salvarAcessoVendedor(supabase: Supabase, input: unknown) {
  const dados = salvarAcessoSchema.parse(input)
  const { error } = await supabase.rpc('app_salvar_acesso_vendedor', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
}

export async function salvarComercialConfig(supabase: Supabase, input: unknown) {
  const dados = salvarConfigSchema.parse(input)
  const { data, error } = await supabase.rpc('app_salvar_comercial_config', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

export async function salvarMotivoPerda(supabase: Supabase, input: unknown) {
  const dados = salvarMotivoSchema.parse(input)
  const { data, error } = await supabase.rpc('app_salvar_motivo_perda', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

// ─── Motor de comissões v2 (04k) ────────────────────────────────────────────

export async function salvarParametroComissao(supabase: Supabase, input: unknown) {
  const dados = salvarParametroSchema.parse(input)
  const { data, error } = await supabase.rpc('app_salvar_commission_param', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function decidirAceiteSdr(supabase: Supabase, input: unknown) {
  const dados = decidirAceiteSdrSchema.parse(input)
  const { data, error } = await supabase.rpc('app_decidir_aceite_sdr', { p: dados as unknown as Json })
  if (error) throw new Error(error.message)
  return data
}

export async function mudarStatusCompetencia(supabase: Supabase, input: unknown) {
  const dados = mudarStatusCompetenciaSchema.parse(input)
  const { data, error } = await supabase.rpc('app_mudar_status_competencia', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data as unknown as number
}

export async function ajusteManualComissao(supabase: Supabase, input: unknown) {
  const dados = ajusteManualComissaoSchema.parse(input)
  const { data, error } = await supabase.rpc('app_ajuste_manual_comissao', {
    p: dados as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return data
}
