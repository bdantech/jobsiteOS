import { supabaseAdmin } from '../../db.js'
import { lerAlertaPercentual, lerOrcamentoAutomatico, lerTetoPorOriginador } from './config.js'

/**
 * O orçamento da descoberta (04l §4.2).
 *
 * A verdade do gasto é a SOMA de `descoberta_execucoes.custo` no mês corrente — não
 * um contador à parte. É a mesma decisão do Radar (`radar/orcamento.ts`) e pelo mesmo
 * motivo: um contador incrementado em paralelo diverge do que aconteceu na primeira
 * vez que um job morrer no meio, e a divergência é invisível, porque o número
 * continua parecendo um número.
 *
 * DOIS ORÇAMENTOS SEPARADOS, de propósito:
 *
 *   - por ORIGINADOR, para os cliques (camada sob demanda). É a autorização dele
 *     para gastar sozinho, sem pedir a ninguém.
 *   - AUTOMÁTICO da casa, para o que o job roda sem clique (o Google Places na
 *     camada 0+1). Ninguém autorizou individualmente essas consultas, então elas não
 *     podem sair do teto de ninguém.
 *
 * Somar os dois faria a varredura noturna comer o saldo de um originador que não
 * pediu nada — e ele descobriria no dia em que precisasse clicar.
 */

function inicioDoMesUtc(): string {
  const h = new Date()
  return new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth(), 1)).toISOString()
}

function somarCustos(linhas: { custo: number | string }[] | null): number {
  return (linhas ?? []).reduce((s, r) => s + (Number(r.custo) || 0), 0)
}

export interface EstadoTeto {
  gasto: number
  teto: number
  saldo: number
  cabe: boolean
  alerta: boolean
}

/** O teto do originador. `null` de originador é o fornecedor sem dono: usa o mesmo teto. */
export async function tetoDoOriginador(
  originadorId: string | null,
  custoDoClique: number,
): Promise<EstadoTeto> {
  const [teto, pct] = await Promise.all([lerTetoPorOriginador(), lerAlertaPercentual()])

  const base = supabaseAdmin
    .from('descoberta_execucoes')
    .select('custo')
    .eq('camada', 'sob_demanda')
    .gte('executado_em', inicioDoMesUtc())
  const { data, error } = await (originadorId
    ? base.eq('originador_id', originadorId)
    : base.is('originador_id', null))
  if (error) throw new Error(`Falha ao apurar gasto de descoberta: ${error.message}`)

  const gasto = somarCustos(data)
  const projetado = gasto + custoDoClique
  return {
    gasto,
    teto,
    saldo: Math.max(0, teto - gasto),
    cabe: projetado <= teto,
    alerta: teto > 0 && projetado >= teto * pct,
  }
}

/** O teto da casa para o que roda sem clique. */
export async function tetoAutomatico(custoAdicional = 0): Promise<EstadoTeto> {
  const [teto, pct] = await Promise.all([lerOrcamentoAutomatico(), lerAlertaPercentual()])
  const { data, error } = await supabaseAdmin
    .from('descoberta_execucoes')
    .select('custo')
    .eq('camada', 'automatica')
    .gte('executado_em', inicioDoMesUtc())
  if (error) throw new Error(`Falha ao apurar gasto automático: ${error.message}`)

  const gasto = somarCustos(data)
  const projetado = gasto + custoAdicional
  return {
    gasto,
    teto,
    saldo: Math.max(0, teto - gasto),
    cabe: projetado <= teto,
    alerta: teto > 0 && projetado >= teto * pct,
  }
}
