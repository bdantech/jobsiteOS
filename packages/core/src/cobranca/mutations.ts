import { parseOuFalhar, traduzirErro } from '../db/shared.js'
import type { Supabase } from '../registry/types.js'
import type { Json, Tables } from '../types/database.js'
import {
  aceitarAvisoApoliceSchema,
  arquivarModeloCobrancaSchema,
  anexarAcordoAssinadoSchema,
  anexarArquivoProtestoSchema,
  atualizarCobrancaSchema,
  atualizarDadosMinutaSchema,
  atualizarTituloProtestoSchema,
  cancelarAcordoSchema,
  criarCobrancaSchema,
  criarProcessoCobrancaSchema,
  criarRemessaProtestoSchema,
  criarSinistroSchema,
  custoSinistroSchema,
  definirCobrancaConfigSchema,
  documentoSinistroSchema,
  editarNotificacaoCobrancaSchema,
  enviarNotificacaoCobrancaSchema,
  estimativaSinistroSchema,
  idCobrancaTituloSchema,
  instrucaoCancelamentoSchema,
  marcarRemessaEnviadaSchema,
  moverCobrancaSchema,
  moverSinistroSchema,
  processarRetornoProtestoSchema,
  quitarTituloCobrancaSchema,
  registrarEntregaSchema,
  registrarInsolvenciaSchema,
  registrarInteracaoCobrancaSchema,
  regularizarSacadoSchema,
  salvarAcordoSchema,
  salvarApoliceSchema,
  salvarModeloCobrancaSchema,
  salvarNotificacoesSchema,
  solicitacaoSinistroSchema,
  vincularProcessoCobrancaSchema,
} from './schemas.js'

/**
 * Escritas da Cobrança, todas por RPC SECURITY DEFINER (migração 0269d/0269e). Cada uma
 * grava a linha + o evento + o audit_log na mesma transação, e cada uma começa pela
 * guarda do módulo — a tela é a camada de mensagem, não a de segurança.
 *
 * NENHUMA envia nada por conta própria: `enviarNotificacaoCobranca` põe na fila do 05A,
 * que despacha com o mesmo portão (supressão, limites, janela) de todo o resto.
 */

type Nome = Parameters<Supabase['rpc']>[0]

async function chamar<T>(supabase: Supabase, rpc: string, dados: unknown): Promise<T> {
  const { data, error } = await supabase.rpc(rpc as Nome, { p: dados as Json } as never)
  if (error) throw traduzirErro(error)
  return data as T
}

const rpc =
  <T>(nome: string, schema: Parameters<typeof parseOuFalhar>[0]) =>
  (supabase: Supabase, input: unknown): Promise<T> =>
    chamar<T>(supabase, nome, parseOuFalhar(schema, input))

export const criarCobranca = rpc<Tables<'cobrancas'>>('app_cobranca_criar', criarCobrancaSchema)
export const atualizarCobranca = rpc<Tables<'cobrancas'>>('app_cobranca_atualizar', atualizarCobrancaSchema)
export const salvarNotificacoesCobranca = rpc<Tables<'cobranca_notificacoes'>[]>(
  'app_cobranca_salvar_notificacoes',
  salvarNotificacoesSchema,
)
export const editarNotificacaoCobranca = rpc<Tables<'cobranca_notificacoes'>>(
  'app_cobranca_editar_notificacao',
  editarNotificacaoCobrancaSchema,
)
export const aceitarAvisoApolice = rpc<Tables<'cobrancas'>>('app_cobranca_aceitar_aviso_apolice', aceitarAvisoApoliceSchema)
export const enviarNotificacaoCobranca = rpc<Tables<'cobranca_notificacao_entregas'>[]>(
  'app_cobranca_enviar_notificacao',
  enviarNotificacaoCobrancaSchema,
)
export const registrarEntregaCobranca = rpc<Tables<'cobranca_notificacao_entregas'>>(
  'app_cobranca_registrar_entrega',
  registrarEntregaSchema,
)
export const moverCobranca = rpc<Tables<'cobrancas'>>('app_cobranca_mover_estagio', moverCobrancaSchema)
export const quitarTituloCobranca = rpc<Tables<'cobranca_titulos'>>('app_cobranca_quitar_titulo', quitarTituloCobrancaSchema)
export const retirarTituloCobranca = rpc<Tables<'cobranca_titulos'>>('app_cobranca_retirar_titulo', idCobrancaTituloSchema)
export const registrarInteracaoCobranca = rpc<Tables<'cobranca_interacoes'>>(
  'app_cobranca_registrar_interacao',
  registrarInteracaoCobrancaSchema,
)
export const regularizarSacado = rpc<Json>('app_cobranca_regularizar_sacado', regularizarSacadoSchema)
export const vincularProcessoCobranca = rpc<Tables<'cobrancas'>>(
  'app_cobranca_vincular_processo',
  vincularProcessoCobrancaSchema,
)
export const criarProcessoCobranca = rpc<Tables<'cobrancas'>>('app_cobranca_criar_processo', criarProcessoCobrancaSchema)
export const salvarModeloCobranca = rpc<Tables<'cobranca_modelos'>>('app_cobranca_salvar_modelo', salvarModeloCobrancaSchema)
export const arquivarModeloCobranca = rpc<null>('app_cobranca_arquivar_modelo', arquivarModeloCobrancaSchema)
export const definirCobrancaConfig = rpc<Tables<'cobranca_config'>>('app_cobranca_definir_config', definirCobrancaConfigSchema)
export const salvarApolice = rpc<Tables<'apolices'>>('app_cobranca_salvar_apolice', salvarApoliceSchema)
export const registrarInsolvencia = rpc<Tables<'cobranca_insolvencias'>>(
  'app_cobranca_registrar_insolvencia',
  registrarInsolvenciaSchema,
)

export const salvarAcordo = rpc<Tables<'acordos'>>('app_cobranca_salvar_acordo', salvarAcordoSchema)
export const atualizarDadosMinuta = rpc<Tables<'acordos'>>('app_cobranca_dados_minuta', atualizarDadosMinutaSchema)
export const anexarAcordoAssinado = rpc<Tables<'acordos'>>(
  'app_cobranca_anexar_acordo_assinado',
  anexarAcordoAssinadoSchema,
)
export const cancelarAcordo = rpc<Tables<'acordos'>>('app_cobranca_cancelar_acordo', cancelarAcordoSchema)

export const criarSinistro = rpc<Tables<'sinistros'>>('app_sinistro_criar', criarSinistroSchema)
export const documentoSinistro = rpc<Tables<'sinistro_documentos'>>('app_sinistro_documento', documentoSinistroSchema)
export const moverSinistro = rpc<Tables<'sinistros'>>('app_sinistro_mover', moverSinistroSchema)
export const solicitacaoSinistro = rpc<Tables<'sinistro_solicitacoes'>>('app_sinistro_solicitacao', solicitacaoSinistroSchema)
export const custoSinistro = rpc<Tables<'sinistro_custos'>>('app_sinistro_custo', custoSinistroSchema)
export const estimativaSinistro = rpc<Tables<'sinistros'>>('app_sinistro_estimativa', estimativaSinistroSchema)

export const criarRemessaProtesto = rpc<Tables<'protesto_remessas'>>('app_protesto_criar_remessa', criarRemessaProtestoSchema)
export const anexarArquivoProtesto = rpc<Tables<'protesto_remessas'>>('app_protesto_anexar_arquivo', anexarArquivoProtestoSchema)
export const marcarRemessaEnviada = rpc<Tables<'protesto_remessas'>>('app_protesto_marcar_enviada', marcarRemessaEnviadaSchema)
export const atualizarTituloProtesto = rpc<Tables<'protesto_titulos'>>(
  'app_protesto_atualizar_titulo',
  atualizarTituloProtestoSchema,
)
export const processarRetornoProtesto = rpc<Tables<'protesto_remessas'>>(
  'app_protesto_processar_retorno',
  processarRetornoProtestoSchema,
)
export const instrucaoCancelamentoProtesto = rpc<Tables<'protesto_remessas'> | null>(
  'app_protesto_instrucao_cancelamento',
  instrucaoCancelamentoSchema,
)
