import { moverOportunidadeSchema, type MoverOportunidadeInput } from './schemas.js'
import { parseOuFalhar, traduzirErro } from '../db/shared.js'
import type { Json } from '../types/database.js'
import type { Supabase } from '../registry/types.js'

/**
 * Mover uma pré-autorização ou uma parcela no funil.
 *
 * A NF continua sendo movida por `moverEstagio` (04). São duas funções porque são
 * duas RPCs — e são duas RPCs porque a da NF devolve `notas_fiscais`, um tipo que
 * as fontes novas não têm e não deveriam fingir ter. O que é UM só é a regra, e
 * ela vive no banco: mesmos sete estágios, motivo obrigatório na perda, e "em
 * prospecção" recusado à mão porque ele é FATO (uma mensagem saiu), não opinião.
 */
export async function moverOportunidade(
  supabase: Supabase,
  input: MoverOportunidadeInput | unknown,
): Promise<{ tipo: string; id: string; de: string; para: string }> {
  const dados = parseOuFalhar(moverOportunidadeSchema, input)
  const { data, error } = await supabase.rpc('app_mover_oportunidade', {
    p: dados as unknown as Json,
  })
  if (error) throw traduzirErro(error)
  return data as unknown as { tipo: string; id: string; de: string; para: string }
}
