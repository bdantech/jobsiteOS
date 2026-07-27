import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'

/**
 * Limpeza diária das supressões expiradas (§2).
 *
 * Uma supressão soft ("sem interesse agora") tem prazo: passado ele, o fornecedor
 * volta a ser elegível. Sem este job o "90 dias" seria "para sempre" — e a base
 * encolheria um pouco a cada trimestre sem que ninguém percebesse.
 *
 * As ETERNAS (`expira_em is null`) nunca são tocadas: são LGPD, ou uma
 * multinacional que nunca vai antecipar. Este job não pode ser o caminho por
 * onde um pedido de "não me procure mais" desaparece.
 *
 * O guard `estaSuprimido()` e a view `notas_funil` já ignoram supressão vencida
 * por conta própria — este job apaga a linha para que a tela de Supressão mostre
 * o que de fato vale hoje. A limpeza é conveniência; a correção não depende dela.
 */
export interface ResultadoSupressoes {
  removidas: number
  notas_reelegiveis: number
}

export async function limparSupressoesExpiradas(): Promise<ResultadoSupressoes> {
  const hoje = new Date().toISOString().slice(0, 10)

  const { data: expiradas, error } = await supabaseAdmin
    .from('supressao')
    .delete()
    .not('expira_em', 'is', null)
    .lt('expira_em', hoje)
    .select('escopo, valor')

  if (error) {
    logger.error({ erro: error.message }, 'Falha ao limpar supressões expiradas.')
    return { removidas: 0, notas_reelegiveis: 0 }
  }

  const cnpjs = (expiradas ?? []).filter((s) => s.escopo === 'empresa').map((s) => s.valor)

  // As notas ficaram com faixa = null / motivo 'suprimido'. Zerar o motivo aqui
  // não recoloca a faixa — quem faz isso é a reclassificação, que roda logo em
  // seguida no mesmo job diário. O que importa é não deixar um card explicado
  // como "suprimido" quando a supressão já caiu.
  let reelegiveis = 0
  if (cnpjs.length > 0) {
    const { data } = await supabaseAdmin
      .from('notas_fiscais')
      .update({ faixa_motivo: null })
      .in('fornecedor_cnpj', cnpjs)
      .eq('faixa_motivo', 'suprimido')
      .select('access_key')
    reelegiveis = data?.length ?? 0
  }

  const resultado = { removidas: expiradas?.length ?? 0, notas_reelegiveis: reelegiveis }
  logger.info(resultado, 'Supressões expiradas removidas.')
  return resultado
}
