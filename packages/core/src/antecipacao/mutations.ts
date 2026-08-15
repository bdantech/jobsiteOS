import type { Supabase } from '../registry/types.js'
import { parseOuFalhar, traduzirErro } from '../db/shared.js'
import { normalizeCnpj } from '../schemas/cnpj.js'
import type { Json, Tables } from '../types/database.js'
import {
  ativarFaixaRegraSchema,
  casarAntecipacaoSchema,
  descartarMensagemSchema,
  definirPontoFocalSchema,
  marcarFornecedorSemInteresseSchema,
  marcarSemInteresseSchema,
  moverEstagioSchema,
  reverterFornecedorSemInteresseSchema,
  promoverFornecedorSchema,
  registrarToqueManualSchema,
  salvarAntecipacaoConfigSchema,
  salvarFaixaDisparoSchema,
  salvarFaixaRegraSchema,
  salvarWhatsappContaSchema,
  type AtivarFaixaRegraInput,
  type CasarAntecipacaoInput,
  type DefinirPontoFocalInput,
  type DescartarMensagemInput,
  type MarcarFornecedorSemInteresseInput,
  type MarcarSemInteresseInput,
  type MoverEstagioInput,
  type ReverterFornecedorSemInteresseInput,
  type PromoverFornecedorInput,
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

/**
 * Promove o fornecedor a partir do funil.
 *
 * RPC próprio, e não `promoverEmpresa` de Mercado: aquele é SECURITY INVOKER e
 * esbarra em três policies de módulos que o público do funil não tem (ver 0068).
 * O CNPJ é normalizado antes porque o RPC exige 14 dígitos.
 */
export async function promoverFornecedor(
  supabase: Supabase,
  input: PromoverFornecedorInput | unknown,
): Promise<Tables<'empresas'>> {
  const dados = parseOuFalhar(promoverFornecedorSchema, input)
  const p = { cnpj: normalizeCnpj(dados.cnpj) }
  const { data, error } = await supabase.rpc('app_promover_fornecedor', { p: p as unknown as Json })
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

/**
 * Marca um fornecedor da lista a prospectar como sem interesse em se CADASTRAR.
 *
 * Não confundir com `marcarSemInteresse`: aquele suprime canal (`supressao`, peso de
 * LGPD, validade), este qualifica o lead — tira o CNPJ da lista a prospectar e as
 * notas dele dos funis, e se desfaz num clique. Ver a nota longa em schemas.ts.
 */
export async function marcarFornecedorSemInteresse(
  supabase: Supabase,
  input: MarcarFornecedorSemInteresseInput | unknown,
): Promise<Tables<'antecipacao_fornecedor_sem_interesse'>> {
  const dados = parseOuFalhar(marcarFornecedorSemInteresseSchema, input)
  const p = { ...dados, cnpj: normalizeCnpj(dados.cnpj) }
  const { data, error } = await supabase.rpc('app_marcar_fornecedor_sem_interesse', {
    p: p as unknown as Json,
  })
  if (error) throw traduzirErro(error)
  return data
}

/** Devolve o fornecedor à lista a prospectar (e as notas dele aos funis). */
export async function reverterFornecedorSemInteresse(
  supabase: Supabase,
  input: ReverterFornecedorSemInteresseInput | unknown,
): Promise<boolean> {
  const dados = parseOuFalhar(reverterFornecedorSemInteresseSchema, input)
  const p = { cnpj: normalizeCnpj(dados.cnpj) }
  const { data, error } = await supabase.rpc('app_reverter_fornecedor_sem_interesse', {
    p: p as unknown as Json,
  })
  if (error) throw traduzirErro(error)
  return data ?? false
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

/**
 * A fila de revisão em uma chamada: casar a antecipação com a NF escolhida, ou
 * tirá-la da fila com motivo.
 *
 * O RPC faz a conversão da nota, o evento e o audit na MESMA transação — é o
 * mesmo caminho que o job automático usa, e não uma segunda implementação
 * "manual". Duas formas de converter uma nota é como uma delas passa a esquecer
 * de recalcular a tipagem do fornecedor.
 */
export async function casarAntecipacaoManual(
  supabase: Supabase,
  input: CasarAntecipacaoInput | unknown,
): Promise<Tables<'antecipacoes'>> {
  const dados = parseOuFalhar(casarAntecipacaoSchema, input)
  const { data, error } = await supabase.rpc('app_casar_antecipacao', {
    p: dados as unknown as Json,
  })
  if (error) throw traduzirErro(error)
  return data
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
