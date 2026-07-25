import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import type { ProvedorCredito } from '../../../../../packages/core/src/radar/credit.js'
import type { Tables } from '../../../../../packages/core/src/types/database.js'
import { supabaseAdmin } from '../../db.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { lerCustos } from '../../radar/config.js'
import { provedoresDirectD } from '../../radar/directd.js'
import { emitirEvento, notificarPerfis } from '../../radar/eventos.js'
import { executarLote } from './lote.js'
import type { ProcessarItem, ResultadoItem } from './lote.js'

/**
 * Protestos DirectD (§5). Roteamento:
 *   - Clientes (cliente=true no lote, ou e_cliente_onepay): SEMPRE nacional (decisão
 *     de crédito — cobertura parcial é risco, não economia).
 *   - Prospecção: uf=SP → endpoint SP; fora de SP → nacional só se incluir_fora_sp,
 *     senão o item é PULADO (a escolha é explícita, mostrada na estimativa do lote).
 *
 * Sempre INSERE em protestos_consultas (append-only). A derivada é o que importa:
 * mudou de sem→com protesto (ou o valor cresceu além do limiar) → evento.
 */

const LIMIAR_AGRAVAMENTO = 1.2 // valor cresceu >20% → protesto.agravado

export function criarProcessadorProtestos(lote: Tables<'lotes_enriquecimento'>): ProcessarItem {
  const params = (lote.parametros ?? {}) as { incluir_fora_sp?: boolean; cliente?: boolean }

  return async (item: Tables<'lote_itens'>): Promise<ResultadoItem> => {
    if (!env.DIRECTD_API_KEY) {
      return { status: 'erro', fonte: 'directd_nacional', erro: 'DIRECTD_API_KEY não configurada.' }
    }
    const cnpj = item.cnpj
    if (!cnpj) return { status: 'erro', fonte: 'directd_nacional', erro: 'Item sem CNPJ.' }

    const { data: emp } = await supabaseAdmin
      .from('mercado_explorador')
      .select('uf, e_cliente_onepay, empresa_id')
      .eq('cnpj', cnpj)
      .maybeSingle()

    const custos = await lerCustos()
    const { sp, nacional } = provedoresDirectD(custos.protesto_sp, custos.protesto_nacional)

    let prov: ProvedorCredito
    if (params.cliente || emp?.e_cliente_onepay) {
      prov = nacional
    } else if (emp?.uf === 'SP') {
      prov = sp
    } else if (params.incluir_fora_sp) {
      prov = nacional
    } else {
      return { status: 'pulado', fonte: 'directd_sp', erro: 'Fora de SP e incluir_fora_sp=false.' }
    }

    // Estado anterior ANTES de inserir a nova consulta (para a derivada).
    const { data: anterior } = await supabaseAdmin
      .from('protestos_atual')
      .select('tem_protesto, valor_total')
      .eq('cnpj', cnpj)
      .maybeSingle()

    let r
    try {
      r = await prov.consultar(cnpj)
    } catch (e) {
      return { status: 'erro', fonte: prov.fonte, erro: String(e) }
    }

    const empresaId = emp?.empresa_id ?? item.empresa_id ?? null
    await supabaseAdmin.from('protestos_consultas').insert({
      cnpj,
      empresa_id: empresaId,
      fonte: prov.fonte,
      tem_protesto: r.tem_protesto,
      qtd_protestos: r.qtd_protestos,
      valor_total: r.valor_total,
      cartorios: r.cartorios as never,
      payload: r.payload as never,
      custo: r.custo,
    })

    // Derivada: sem→com protesto, ou valor agravou.
    const antesTinha = anterior?.tem_protesto ?? false
    const antesValor = Number(anterior?.valor_total ?? 0)
    if (r.tem_protesto && !antesTinha) {
      const url = empresaId ? `/empresas/${empresaId}` : `/mercado/universo/${cnpj}`
      const resumo = `${cnpj}: ${r.qtd_protestos} protesto(s), R$ ${r.valor_total.toFixed(2)} (${prov.fonte}).`
      await emitirEvento(empresaId, EVENTO_TIPOS.PROTESTO_DETECTADO, { titulo: 'Protesto detectado', resumo, url, cnpj })
      await notificarPerfis(['Admin', 'Crédito'], { titulo: 'Protesto detectado', corpo: resumo, url })
    } else if (r.tem_protesto && antesTinha && antesValor > 0 && r.valor_total > antesValor * LIMIAR_AGRAVAMENTO) {
      await emitirEvento(empresaId, EVENTO_TIPOS.PROTESTO_AGRAVADO, {
        titulo: 'Protesto agravado',
        resumo: `${cnpj}: valor protestado subiu de R$ ${antesValor.toFixed(2)} para R$ ${r.valor_total.toFixed(2)}.`,
        url: empresaId ? `/empresas/${empresaId}` : `/mercado/universo/${cnpj}`,
        cnpj,
      })
    }

    return {
      status: 'sucesso',
      fonte: prov.fonte,
      custo: r.custo,
      resultado: { tem_protesto: r.tem_protesto, qtd: r.qtd_protestos, valor: r.valor_total },
    }
  }
}

/**
 * Rotina mensal de clientes (§5): para cada cliente Onepay, consulta protestos
 * NACIONAL da matriz + SPEs ativas do grupo. Registra tudo como um lote automático
 * (criado_por null, já aprovado — é política, não pedido ad hoc). O teto de orçamento
 * é respeitado pelo próprio harness (interrompe ao estourar).
 */
export async function protestosClientesMensal(): Promise<{ lote_id: string; itens: number; processados: number; custo: number }> {
  if (!env.DIRECTD_API_KEY) throw new Error('DIRECTD_API_KEY não configurada.')

  const { data: lote, error } = await supabaseAdmin
    .from('lotes_enriquecimento')
    .insert({
      tipo: 'protestos',
      nome: 'Protestos — clientes (mensal)',
      definicao_filtro: {} as never,
      parametros: { cliente: true, motivo: 'rotina_mensal' } as never,
      status: 'aprovado',
      criado_por: null,
    })
    .select('id')
    .single()
  if (error || !lote) throw new Error(`Falha ao abrir lote mensal: ${error?.message}`)

  // Monta o conjunto de CNPJs: cada cliente + SPEs ATIVAS do grupo dele.
  const { data: clientes } = await supabaseAdmin.from('clientes_onepay').select('cnpj, empresa_id')
  const porCnpj = new Map<string, { cnpj: string; empresa_id: string | null }>()

  for (const c of clientes ?? []) {
    porCnpj.set(c.cnpj, { cnpj: c.cnpj, empresa_id: c.empresa_id })
    const { data: mu } = await supabaseAdmin
      .from('mercado_universo')
      .select('grupo_id')
      .eq('cnpj', c.cnpj)
      .maybeSingle()
    if (!mu?.grupo_id) continue
    const { data: spes } = await supabaseAdmin
      .from('mercado_universo')
      .select('cnpj, empresa_id')
      .eq('grupo_id', mu.grupo_id)
      .eq('is_spe', true)
      .eq('situacao_cadastral', 'ativa')
    for (const s of spes ?? []) if (!porCnpj.has(s.cnpj)) porCnpj.set(s.cnpj, { cnpj: s.cnpj, empresa_id: s.empresa_id })
  }

  const itens = [...porCnpj.values()].map((v) => ({ lote_id: lote.id, cnpj: v.cnpj, empresa_id: v.empresa_id }))
  if (itens.length > 0) {
    const { error: erroItens } = await supabaseAdmin.from('lote_itens').insert(itens)
    if (erroItens) logger.error({ erro: erroItens.message }, 'Falha ao inserir itens do lote mensal.')
  }

  await supabaseAdmin
    .from('lotes_enriquecimento')
    .update({ total_itens: itens.length })
    .eq('id', lote.id)

  // executarLote pula a materialização porque já há itens; processa em modo cliente.
  // O processador só usa lote.parametros; um objeto mínimo basta.
  const loteMin = { id: lote.id, tipo: 'protestos', parametros: { cliente: true } } as unknown as Tables<'lotes_enriquecimento'>
  const r = await executarLote(lote.id, criarProcessadorProtestos(loteMin))
  return { lote_id: lote.id, itens: itens.length, ...r }
}
