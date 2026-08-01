import {
  calibrarCarteira,
  desvioRelativo,
  type AmostraCarteira,
  type CalibracaoCarteira,
} from '../../../../../packages/core/src/antecipacao/calibracao.js'
import { lerConfigConversao, lerConfigEconomia } from '../../antecipacao/config.js'
import { lerConfigCredito } from '../../credito/config.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'

/**
 * Calibração com a carteira real (04e §5), mensal.
 *
 * `taxa_padrao_am`, `prazo_medio_dias` e `valor_medio_nf` são as três constantes
 * que a receita esperada do funil e o valor esperado do Crédito multiplicam.
 * Hoje elas são digitadas — alguém achou 2,6% / 45 dias / R$ 25 mil razoáveis um
 * dia. As antecipações CONCLUÍDAS dizem quais elas realmente são.
 *
 * O job só MEDE e grava o resultado onde a tela de settings lê. Aplicar é um
 * botão, não um efeito colateral: trocar sozinha a constante que define a
 * receita esperada de todo o funil, em cima de um mês atípico, é o tipo de
 * automação que ninguém pede e todo mundo descobre tarde.
 */

export interface ResultadoCalibracaoEconomia {
  janela_dias: number
  amostras: number
  calibracao: CalibracaoCarteira
  configurado: {
    taxa_mensal_padrao: number
    taxa_padrao_am: number
    prazo_medio_dias: number
    valor_medio_nf: number
  }
  desvios: {
    taxa_funil_pct: number | null
    taxa_credito_pct: number | null
    prazo_pct: number | null
    valor_medio_nf_pct: number | null
  }
}

export async function calibrarEconomiaCarteira(): Promise<ResultadoCalibracaoEconomia> {
  const [cfgConversao, cfgEconomia, cfgCredito] = await Promise.all([
    lerConfigConversao(),
    lerConfigEconomia(),
    lerConfigCredito(),
  ])
  const dias = cfgConversao.calibracao_dias
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString()

  // `CONCLUDED` e não "qualquer status conversor": uma antecipação aprovada mas
  // não concluída ainda pode ser cancelada, e a taxa dela não é dinheiro que
  // aconteceu. A janela olha a conclusão quando existe e a criação quando não.
  const { data, error } = await supabaseAdmin
    .from('antecipacoes')
    .select('monthly_interest_rate, anticipation_days, gross_value, completion_date, created_at_plataforma')
    .eq('status', 'CONCLUDED')
    .limit(20_000)
  if (error) throw new Error(`Falha ao ler a carteira de antecipações: ${error.message}`)

  const amostras: AmostraCarteira[] = (data ?? [])
    .filter((a) => (a.completion_date ?? a.created_at_plataforma ?? '') >= desde)
    .map((a) => ({
      monthly_interest_rate: a.monthly_interest_rate,
      anticipation_days: a.anticipation_days,
      gross_value: a.gross_value,
    }))

  const calibracao = calibrarCarteira(amostras)

  const resultado: ResultadoCalibracaoEconomia = {
    janela_dias: dias,
    amostras: amostras.length,
    calibracao,
    configurado: {
      // A taxa aparece DUAS vezes na casa: `antecipacao.economia.taxa_mensal_padrao`
      // precifica a receita esperada de cada NF, e `credito.economia.taxa_padrao_am`
      // precifica o potencial do sacado. Elas podem divergir — e a tela precisa
      // mostrar as duas, senão aplicar uma corrige metade do problema em silêncio.
      taxa_mensal_padrao: cfgEconomia.taxa_mensal_padrao,
      taxa_padrao_am: cfgCredito.taxa_padrao_am,
      prazo_medio_dias: cfgCredito.prazo_medio_dias,
      valor_medio_nf: cfgCredito.valor_medio_nf,
    },
    desvios: {
      taxa_funil_pct: desvioRelativo(cfgEconomia.taxa_mensal_padrao, calibracao.taxa_am.valor),
      taxa_credito_pct: desvioRelativo(cfgCredito.taxa_padrao_am, calibracao.taxa_am.valor),
      prazo_pct: desvioRelativo(cfgCredito.prazo_medio_dias, calibracao.prazo_dias.valor),
      valor_medio_nf_pct: desvioRelativo(
        cfgCredito.valor_medio_nf,
        calibracao.valor_medio_nf.valor,
      ),
    },
  }

  // Gravado em `antecipacao_config.calibracao_carteira` para que a tela de
  // settings mostre o número sem refazer a conta — e para que a data do último
  // cálculo apareça ao lado dele. Um número sem data é um número que ninguém
  // sabe se pode usar.
  const { error: erroGravar } = await supabaseAdmin.from('antecipacao_config').upsert(
    {
      chave: 'calibracao_carteira',
      valor: { ...resultado, calculado_em: new Date().toISOString() } as never,
    },
    { onConflict: 'chave' },
  )
  if (erroGravar) {
    logger.error({ erro: erroGravar.message }, 'Falha ao gravar a calibração da carteira.')
  }

  logger.info(
    { amostras: resultado.amostras, taxa: calibracao.taxa_am.valor, prazo: calibracao.prazo_dias.valor },
    'Calibração da carteira concluída.',
  )
  return resultado
}
