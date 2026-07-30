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

const LIMIAR_AGRAVAMENTO = 1.2 // por empresa: valor cresceu >20% → protesto.agravado
const LIMIAR_GRUPO = 1.1 // por grupo (rotina mensal): total cresceu >10% vs. mês anterior

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
 * Protestos sob demanda de UMA empresa (+ opcionalmente as SPEs ativas do grupo dela,
 * criadas a partir de um ano). Disparado da aba Análise financeira da ficha, com custo
 * estimado mostrado e confirmado ANTES (radar_protestos_empresa_previa resolve o mesmo
 * conjunto). Sempre NACIONAL (cliente=true): o usuário pediu explicitamente, cobertura
 * parcial não serve para decisão. Lote já aprovado (a confirmação no clique é a aprovação).
 */
export async function protestosEmpresa(opts: {
  empresaId: string
  incluirSpes: boolean
  anoMin: number | null
}): Promise<{ lote_id: string; itens: number; processados: number; custo: number }> {
  if (!env.DIRECTD_API_KEY) throw new Error('DIRECTD_API_KEY não configurada.')

  const { data: emp } = await supabaseAdmin
    .from('empresas')
    .select('cnpj, grupo_id, razao_social')
    .eq('id', opts.empresaId)
    .maybeSingle()
  if (!emp?.cnpj) throw new Error('Empresa não encontrada ou sem CNPJ.')

  const porCnpj = new Map<string, { cnpj: string; empresa_id: string | null }>()
  porCnpj.set(emp.cnpj, { cnpj: emp.cnpj, empresa_id: opts.empresaId })

  if (opts.incluirSpes && emp.grupo_id) {
    let q = supabaseAdmin
      .from('mercado_universo')
      .select('cnpj, empresa_id')
      .eq('grupo_id', emp.grupo_id)
      .eq('is_spe', true)
      .eq('situacao_cadastral', 'ativa')
    // year >= anoMin ⇔ data >= 1º de janeiro do ano (nulas ficam de fora, como na prévia).
    if (opts.anoMin != null) q = q.gte('data_inicio_atividade', `${opts.anoMin}-01-01`)
    const { data: spes } = await q
    for (const s of spes ?? []) if (!porCnpj.has(s.cnpj)) porCnpj.set(s.cnpj, { cnpj: s.cnpj, empresa_id: s.empresa_id })
  }

  const { data: lote, error } = await supabaseAdmin
    .from('lotes_enriquecimento')
    .insert({
      tipo: 'protestos',
      nome: `Protestos — ${emp.razao_social ?? emp.cnpj}${opts.incluirSpes ? ' + SPEs' : ''}`,
      definicao_filtro: {} as never,
      parametros: { cliente: true, motivo: 'sob_demanda', empresa_id: opts.empresaId } as never,
      status: 'aprovado',
      criado_por: null,
    })
    .select('id')
    .single()
  if (error || !lote) throw new Error(`Falha ao abrir lote de protestos: ${error?.message}`)

  const itens = [...porCnpj.values()].map((v) => ({ lote_id: lote.id, cnpj: v.cnpj, empresa_id: v.empresa_id }))
  if (itens.length > 0) {
    const { error: erroItens } = await supabaseAdmin.from('lote_itens').insert(itens)
    if (erroItens) logger.error({ erro: erroItens.message }, 'Falha ao inserir itens do lote sob demanda.')
  }
  await supabaseAdmin.from('lotes_enriquecimento').update({ total_itens: itens.length }).eq('id', lote.id)

  const loteMin = { id: lote.id, tipo: 'protestos', parametros: { cliente: true } } as unknown as Tables<'lotes_enriquecimento'>
  const r = await executarLote(lote.id, criarProcessadorProtestos(loteMin))
  return { lote_id: lote.id, itens: itens.length, ...r }
}

/**
 * Protesto de UM fornecedor do funil, por CNPJ — sem exigir que ele exista em
 * `empresas`.
 *
 * O `protestosEmpresa` acima parte de `empresas.id`, e fornecedor de aquisição não é
 * promovido no sync. Exigir a promoção antes da consulta inverteria a ordem da
 * decisão: promove-se quem interessa, e é justamente o protesto que ajuda a dizer
 * quem interessa. `protestos_consultas.cnpj` é NOT NULL e `empresa_id` é nullable —
 * o modelo sempre permitiu isto.
 *
 * `incluir_fora_sp: true` de propósito. O roteamento manda para o endpoint SP quando
 * a UF é SP e PULA o item quando é fora, a menos que este parâmetro esteja ligado.
 * Num clique deliberado sobre um fornecedor específico, voltar "pulado" sem consultar
 * nada seria o pior resultado — e a tela mostra o custo antes de o clique acontecer.
 */
export async function protestoFornecedor(opts: {
  cnpj: string
}): Promise<{ lote_id: string; processados: number; custo: number }> {
  if (!env.DIRECTD_API_KEY) throw new Error('DIRECTD_API_KEY não configurada.')

  // O nome sai da nota, que é o que sempre existe. `mercado_universo` pode ainda não
  // ter respondido o lookup, e `empresas` pode nem existir para este CNPJ.
  const { data: nota } = await supabaseAdmin
    .from('notas_fiscais')
    .select('fornecedor_nome, fornecedor_empresa_id')
    .eq('fornecedor_cnpj', opts.cnpj)
    .limit(1)
    .maybeSingle()

  const { data: lote, error } = await supabaseAdmin
    .from('lotes_enriquecimento')
    .insert({
      tipo: 'protestos',
      nome: `Protesto — ${nota?.fornecedor_nome ?? opts.cnpj} (funil)`,
      definicao_filtro: {} as never,
      parametros: {
        cliente: false,
        incluir_fora_sp: true,
        motivo: 'antecipacao_fornecedor',
        cnpj: opts.cnpj,
      } as never,
      status: 'aprovado',
      criado_por: null,
    })
    .select('id')
    .single()
  if (error || !lote) throw new Error(`Falha ao abrir lote de protesto: ${error?.message}`)

  const { error: erroItem } = await supabaseAdmin
    .from('lote_itens')
    .insert({ lote_id: lote.id, cnpj: opts.cnpj, empresa_id: nota?.fornecedor_empresa_id ?? null })
  if (erroItem) throw new Error(`Falha ao inserir o item do lote: ${erroItem.message}`)

  await supabaseAdmin.from('lotes_enriquecimento').update({ total_itens: 1 }).eq('id', lote.id)

  const loteMin = {
    id: lote.id,
    tipo: 'protestos',
    parametros: { cliente: false, incluir_fora_sp: true },
  } as unknown as Tables<'lotes_enriquecimento'>
  const r = await executarLote(lote.id, criarProcessadorProtestos(loteMin))
  return { lote_id: lote.id, ...r }
}

/**
 * Rotina mensal (§5): consulta protestos NACIONAL dos clientes Onepay (matriz) + das
 * SPEs marcadas para monitoramento (protesto_monitoramento — as "afiançadas", curadas
 * na aba Grupo econômico). Antes pegava TODAS as SPEs ativas do grupo de cada cliente;
 * agora as SPEs são opt-in, para não gastar consulta paga em obra que não interessa.
 * Lote automático já aprovado (é política, não pedido ad hoc); o teto de orçamento é
 * respeitado pelo harness (interrompe ao estourar).
 */
export async function protestosClientesMensal(): Promise<{ lote_id: string; itens: number; processados: number; custo: number }> {
  if (!env.DIRECTD_API_KEY) throw new Error('DIRECTD_API_KEY não configurada.')

  const { data: lote, error } = await supabaseAdmin
    .from('lotes_enriquecimento')
    .insert({
      tipo: 'protestos',
      nome: 'Protestos — clientes + monitoradas (mensal)',
      definicao_filtro: {} as never,
      parametros: { cliente: true, motivo: 'rotina_mensal' } as never,
      status: 'aprovado',
      criado_por: null,
    })
    .select('id')
    .single()
  if (error || !lote) throw new Error(`Falha ao abrir lote mensal: ${error?.message}`)

  // Conjunto de CNPJs: cada cliente Onepay (matriz, sempre) + SPEs marcadas (opt-in).
  const porCnpj = new Map<string, { cnpj: string; empresa_id: string | null }>()

  const { data: clientes } = await supabaseAdmin.from('clientes_onepay').select('cnpj, empresa_id')
  for (const c of clientes ?? []) porCnpj.set(c.cnpj, { cnpj: c.cnpj, empresa_id: c.empresa_id })

  // protesto_monitoramento é nova (0043) e ainda não está nos tipos gerados; cast
  // localizado (mesmo padrão de radar_cobertura) para não regenerar o database.ts.
  const { data: monitoradas } = await supabaseAdmin
    .from('protesto_monitoramento' as never)
    .select('cnpj, empresa_id')
  for (const m of (monitoradas ?? []) as unknown as { cnpj: string; empresa_id: string | null }[])
    if (!porCnpj.has(m.cnpj)) porCnpj.set(m.cnpj, { cnpj: m.cnpj, empresa_id: m.empresa_id })

  // Mapa cnpj→grupo (+ um nome por grupo) para comparar o TOTAL do grupo mês a mês.
  const cnpjs = [...porCnpj.keys()]
  const grupoDeCnpj = new Map<string, string | null>()
  const nomeGrupo = new Map<string, string>()
  const { data: muRows } = await supabaseAdmin
    .from('mercado_universo')
    .select('cnpj, grupo_id, razao_social')
    .in('cnpj', cnpjs)
  for (const m of muRows ?? []) {
    grupoDeCnpj.set(m.cnpj, m.grupo_id ?? null)
    if (m.grupo_id && m.razao_social && !nomeGrupo.has(m.grupo_id)) nomeGrupo.set(m.grupo_id, m.razao_social)
  }

  // Total protestado por grupo, somando o último snapshot de cada CNPJ monitorado.
  async function totaisPorGrupo(): Promise<Map<string, number>> {
    const tot = new Map<string, number>()
    const { data } = await supabaseAdmin.from('protestos_atual').select('cnpj, valor_total').in('cnpj', cnpjs)
    for (const p of data ?? []) {
      if (!p.cnpj) continue
      const g = grupoDeCnpj.get(p.cnpj)
      if (!g) continue
      tot.set(g, (tot.get(g) ?? 0) + (Number(p.valor_total) || 0))
    }
    return tot
  }

  // Baseline ANTES do lote: protestos_atual ainda reflete o mês anterior.
  const antes = await totaisPorGrupo()

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

  // Regra do grupo: total protestado subiu > +10% vs. o mês anterior → notifica.
  // Vale por GRUPO (a derivada por empresa já cobre empresa nova/agravada a +20%).
  const depois = await totaisPorGrupo()
  for (const [g, novo] of depois) {
    const velho = antes.get(g) ?? 0
    if (velho > 0 && novo > velho * LIMIAR_GRUPO) {
      const nome = nomeGrupo.get(g) ?? 'Grupo econômico'
      const pct = Math.round(((novo - velho) / velho) * 100)
      const corpo = `${nome}: protestos do grupo subiram de R$ ${velho.toFixed(2)} para R$ ${novo.toFixed(2)} (+${pct}%).`
      const url = `/mercado/grupos/${g}`
      await emitirEvento(null, EVENTO_TIPOS.GRUPO_PROTESTO_AGRAVADO, {
        titulo: 'Protesto do grupo agravado',
        resumo: corpo,
        url,
        grupo_id: g,
      })
      await notificarPerfis(['Admin', 'Crédito'], { titulo: 'Protesto do grupo agravado', corpo, url })
    }
  }

  return { lote_id: lote.id, itens: itens.length, ...r }
}
