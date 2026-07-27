import type { Supabase } from '../registry/types.js'
import { parseOuFalhar, traduzirErro } from '../db/shared.js'
import { normalizeCnpj } from '../schemas/cnpj.js'
import type { Json, Tables } from '../types/database.js'
import {
  ativarFaixaRegraSchema,
  descartarMensagemSchema,
  definirPontoFocalSchema,
  marcarSemInteresseSchema,
  moverEstagioSchema,
  registrarToqueManualSchema,
  salvarAntecipacaoConfigSchema,
  salvarFaixaDisparoSchema,
  salvarFaixaRegraSchema,
  salvarWhatsappContaSchema,
  type AtivarFaixaRegraInput,
  type DefinirPontoFocalInput,
  type DescartarMensagemInput,
  type MarcarSemInteresseInput,
  type MoverEstagioInput,
  type RegistrarToqueManualInput,
  type SalvarAntecipacaoConfigInput,
  type SalvarFaixaDisparoInput,
  type SalvarFaixaRegraInput,
  type SalvarWhatsappContaInput,
} from './schemas.js'

/**
 * Write helpers da Antecipação. Mesmo contrato do resto do core: zod valida, o
 * RPC (migration 0047) faz escrita + evento + audit_log em UMA transação, e o
 * client passado DEVE ser o do usuário.
 *
 * `notas_fiscais` e `mensagens_outbox` não têm grant de UPDATE para
 * `authenticated`: estes RPCs são o ÚNICO caminho de escrita, o que torna "mover
 * um card sem registrar o evento" inexprimível — não apenas desencorajado.
 */

export async function moverEstagio(
  supabase: Supabase,
  input: MoverEstagioInput | unknown,
): Promise<Tables<'notas_fiscais'>> {
  const dados = parseOuFalhar(moverEstagioSchema, input)
  const { data, error } = await supabase.rpc('app_mover_estagio_nf', { p: dados as unknown as Json })
  if (error) throw traduzirErro(error)
  return data
}

export async function marcarSemInteresse(
  supabase: Supabase,
  input: MarcarSemInteresseInput | unknown,
): Promise<Tables<'supressao'>> {
  const dados = parseOuFalhar(marcarSemInteresseSchema, input)
  // O CNPJ é normalizado com a MESMA função de estaSuprimido — senão o guard não casa.
  const p = { ...dados, fornecedor_cnpj: normalizeCnpj(dados.fornecedor_cnpj) }
  const { data, error } = await supabase.rpc('app_marcar_sem_interesse', { p: p as unknown as Json })
  if (error) throw traduzirErro(error)
  return data
}

export async function salvarFaixaRegra(
  supabase: Supabase,
  input: SalvarFaixaRegraInput | unknown,
): Promise<Tables<'faixa_regras'>> {
  const dados = parseOuFalhar(salvarFaixaRegraSchema, input)
  const { data, error } = await supabase.rpc('app_salvar_faixa_regra', { p: dados as unknown as Json })
  if (error) throw traduzirErro(error)
  return data
}

export async function ativarFaixaRegra(
  supabase: Supabase,
  input: AtivarFaixaRegraInput | unknown,
): Promise<Tables<'faixa_regras'>> {
  const dados = parseOuFalhar(ativarFaixaRegraSchema, input)
  const { data, error } = await supabase.rpc('app_ativar_faixa_regra', { p: dados as unknown as Json })
  if (error) throw traduzirErro(error)
  return data
}

export async function salvarFaixaDisparo(
  supabase: Supabase,
  input: SalvarFaixaDisparoInput | unknown,
): Promise<Tables<'faixa_disparos'>> {
  const dados = parseOuFalhar(salvarFaixaDisparoSchema, input)
  const { data, error } = await supabase.rpc('app_salvar_faixa_disparo', { p: dados as unknown as Json })
  if (error) throw traduzirErro(error)
  return data
}

export async function salvarWhatsappConta(
  supabase: Supabase,
  input: SalvarWhatsappContaInput | unknown,
): Promise<Tables<'whatsapp_contas'>> {
  const dados = parseOuFalhar(salvarWhatsappContaSchema, input)
  const { data, error } = await supabase.rpc('app_salvar_whatsapp_conta', { p: dados as unknown as Json })
  if (error) throw traduzirErro(error)
  return data
}

export async function descartarMensagem(
  supabase: Supabase,
  input: DescartarMensagemInput | unknown,
): Promise<Tables<'mensagens_outbox'>> {
  const dados = parseOuFalhar(descartarMensagemSchema, input)
  const { data, error } = await supabase.rpc('app_descartar_mensagem', { p: dados as unknown as Json })
  if (error) throw traduzirErro(error)
  return data
}

export async function definirPontoFocal(
  supabase: Supabase,
  input: DefinirPontoFocalInput | unknown,
): Promise<Tables<'contatos'>> {
  const dados = parseOuFalhar(definirPontoFocalSchema, input)
  const { data, error } = await supabase.rpc('app_definir_ponto_focal', { p: dados as unknown as Json })
  if (error) throw traduzirErro(error)
  return data
}

/**
 * O vendedor ligou / abriu o WhatsApp / mandou e-mail pelo app. Vira evento —
 * e é o evento que o cooldown da outbox lê, para que a régua automática não
 * atropele quem acabou de falar com o fornecedor.
 */
export async function registrarToqueManual(
  supabase: Supabase,
  input: RegistrarToqueManualInput | unknown,
): Promise<void> {
  const dados = parseOuFalhar(registrarToqueManualSchema, input)
  const p = { ...dados, fornecedor_cnpj: normalizeCnpj(dados.fornecedor_cnpj) }
  const { error } = await supabase.rpc('app_registrar_toque_manual', { p: p as unknown as Json })
  if (error) throw traduzirErro(error)
}

export async function salvarAntecipacaoConfig(
  supabase: Supabase,
  input: SalvarAntecipacaoConfigInput | unknown,
): Promise<Tables<'antecipacao_config'>> {
  const dados = parseOuFalhar(salvarAntecipacaoConfigSchema, input)
  const { data, error } = await supabase.rpc('app_salvar_antecipacao_config', {
    p: dados as unknown as Json,
  })
  if (error) throw traduzirErro(error)
  return data
}
