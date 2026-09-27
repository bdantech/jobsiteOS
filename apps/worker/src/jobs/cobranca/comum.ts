import { createHash } from 'node:crypto'
import { lerCobrancaConfig, type CobrancaConfig } from '../../../../../packages/core/src/cobranca/schemas.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'

/**
 * O que os jobs da Cobrança compartilham: a config, o bucket e o registro de fato.
 *
 * O bucket `cobrancas` é privado e não tem UPDATE/DELETE para ninguém da web (0269b):
 * o PDF enviado é imutável (§5). O worker escreve com service role e, por isso mesmo,
 * escreve SEM `upsert` tudo o que pode ter sido enviado — um caminho novo por geração.
 */

export const BUCKET_COBRANCAS = 'cobrancas'

export async function lerConfigCobranca(): Promise<CobrancaConfig> {
  const { data, error } = await supabaseAdmin.from('cobranca_config').select('chave, valor')
  if (error) throw new Error(`Falha ao ler cobranca_config: ${error.message}`)
  return lerCobrancaConfig(data ?? [])
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function subirArquivo(
  caminho: string,
  bytes: Uint8Array,
  mime: string,
  opcoes: { substituir?: boolean } = {},
): Promise<void> {
  const { error } = await supabaseAdmin.storage.from(BUCKET_COBRANCAS).upload(caminho, bytes, {
    contentType: mime,
    upsert: opcoes.substituir ?? false,
  })
  if (error) throw new Error(`Falha ao guardar ${caminho}: ${error.message}`)
}

/** Os bytes de um arquivo do bucket, ou `null` (e o motivo no log). */
export async function baixarArquivo(caminho: string, bucket = BUCKET_COBRANCAS): Promise<Uint8Array | null> {
  const { data, error } = await supabaseAdmin.storage.from(bucket).download(caminho)
  if (error || !data) {
    logger.warn({ bucket, caminho, erro: error?.message }, 'Arquivo da cobrança não pôde ser lido.')
    return null
  }
  return new Uint8Array(await data.arrayBuffer())
}

/**
 * Um FATO na timeline da empresa (e, pelo trigger, no motor de avisos 0262).
 *
 * `emitirEvento` do Radar tipa o `tipo` pelo catálogo de `EVENTO_TIPOS`, que não conhece
 * os eventos da Cobrança; a coluna é texto e os tipos estão em `notificacao_tipos`
 * (0269g). Mesma escrita, sem o tipo estreito.
 */
export async function registrarEvento(
  empresaId: string | null,
  tipo: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('empresa_eventos')
    .insert({ empresa_id: empresaId, tipo, payload: payload as never, ator_usuario_id: null })
  if (error) logger.error({ tipo, erro: error.message }, 'Falha ao registrar evento da Cobrança.')
}

/** A data (SP) de um timestamptz. */
export function dataSp(ts: string | null | undefined): string | null {
  if (!ts) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(ts))
}

export function lotes<T>(lista: readonly T[], tamanho: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < lista.length; i += tamanho) out.push(lista.slice(i, i + tamanho))
  return out
}
