import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'

/**
 * `cobranca/atualizar-titulos` (Prompt 07 §14): a projeção de `titulos` a partir de
 * `antecipacoes`, a quitação vinda da produção e o fechamento das cobranças sem título
 * ativo.
 *
 * Toda a conta mora no SQL (`app__cobranca_projetar_titulos`, 0269c): é um upsert sobre
 * mil e poucas linhas que depende de três funções do banco por CNPJ, e trazê-la para cá
 * seria buscar, chamar e devolver — a mesma conta com três idas e voltas por linha.
 * Este arquivo só a dispara e devolve o placar.
 *
 * Roda ENCADEADO depois de cada sync de antecipações (o de 4h e o diário), e não num
 * cron próprio: a projeção descreve o que acabou de chegar, e num relógio separado a
 * tela de cobrança mostraria títulos "abertos" que a produção já concluiu horas antes.
 */
export async function atualizarTitulosCobranca(): Promise<unknown> {
  const { data, error } = await supabaseAdmin.rpc('app__cobranca_projetar_titulos')
  if (error) throw new Error(`Falha ao projetar os títulos da cobrança: ${error.message}`)
  logger.info({ resultado: data }, 'Títulos da cobrança projetados.')
  return data
}
