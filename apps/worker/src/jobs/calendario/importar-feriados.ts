import {
  anosParaImportar,
  importarFeriadosNacionais,
  type ResultadoImportacaoFeriados,
} from '../../../../../packages/core/src/funil/novidades-dados.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'

/**
 * Feriados nacionais da BrasilAPI → `dias_nao_uteis` (04t §3).
 *
 * Anual, e sob demanda pelo botão de Configurações. Popula o ano corrente e o
 * seguinte: assim a virada de ano nunca pega a janela de novidades sem calendário, e
 * uma BrasilAPI fora do ar no dia do cron custa só a antecedência — o ano que entra já
 * foi importado no anterior.
 *
 * O que o gestor cadastrou à mão não é tocado (`ignoreDuplicates`). Falha aqui não
 * quebra o filtro: a janela segue com o que o banco tem e a tela avisa quando o ano
 * não está coberto. Por isso um ano com erro não derruba o job — ele LEVANTA só quando
 * nenhum ano entrou, que é o caso em que alguém precisa ser avisado.
 */
export async function importarFeriadosJob(): Promise<ResultadoImportacaoFeriados> {
  const anos = anosParaImportar()
  const resultado = await importarFeriadosNacionais(supabaseAdmin as never, anos)

  if (resultado.anos.every((a) => a.erro)) {
    throw new Error(
      `Nenhum ano de feriados importado: ${resultado.anos.map((a) => `${a.ano} (${a.erro})`).join('; ')}`,
    )
  }

  logger.info(resultado, 'Feriados nacionais importados.')
  return resultado
}
