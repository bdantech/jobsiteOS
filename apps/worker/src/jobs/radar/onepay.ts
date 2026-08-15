import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { normalizeCnpj } from '../../../../../packages/core/src/schemas/cnpj.js'
import type { TablesInsert } from '../../../../../packages/core/src/types/database.js'
import { supabaseAdmin } from '../../db.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { requisitarJson } from '../../net/http.js'
import { lerLimiarDormente } from '../../radar/config.js'
import { emitirEvento } from '../../radar/eventos.js'

/**
 * Sync diário dos clientes Onepay (§7). Puxa o temperature-report paginado, faz
 * upsert em clientes_onepay + snapshot diário, casa com empresas (criando/promovendo
 * quando preciso) e emite os eventos de tendência comparando com o estado anterior.
 */

interface ItemOnepay {
  companyId: number
  name?: string
  taxId?: string
  creditLimit?: number
  availableLimit?: number
  consumedLimit?: number
  lastAnticipation?: string | null
  anticipationsLast2Months?: number
  grossValueLast2Months?: number
  status?: string
  daysWithoutAnticipation?: number
  consumedPct?: number
  consumedPct2m?: number
  operationStatus?: string
}

interface RespostaOnepay {
  data?: ItemOnepay[]
  items?: ItemOnepay[]
  page?: number
  pageSize?: number
  totalPages?: number
}

export interface ResultadoOnepay {
  paginas: number
  itens: number
  novos_clientes: number
  promovidos: number
  eventos: number
}

const PAGE_SIZE = 200

function autorizacao(): Record<string, string> {
  return env.ONEPAY_BI_TOKEN ? { authorization: `Bearer ${env.ONEPAY_BI_TOKEN}` } : {}
}

function extrair(resp: RespostaOnepay): ItemOnepay[] {
  if (Array.isArray(resp.data)) return resp.data
  if (Array.isArray(resp.items)) return resp.items
  if (Array.isArray(resp)) return resp as ItemOnepay[]
  return []
}

export async function sincronizarOnepay(): Promise<ResultadoOnepay> {
  if (!env.ONEPAY_BI_URL) {
    throw new Error('ONEPAY_BI_URL não configurado — configure o secret no worker antes de rodar.')
  }
  // ONEPAY_BI_URL é só o host — o caminho é reanexado aqui, reutilizando a base.
  const base = env.ONEPAY_BI_URL.replace(/\/+$/, '')
  const limiar = await lerLimiarDormente()
  const hoje = new Date().toISOString().slice(0, 10)

  let page = 1
  let totalPages = 1
  const acc: ResultadoOnepay = { paginas: 0, itens: 0, novos_clientes: 0, promovidos: 0, eventos: 0 }

  do {
    const url = `${base}/api/v1/temperature-report?page=${page}&pageSize=${PAGE_SIZE}`
    const resp = await requisitarJson<RespostaOnepay>(url, { headers: autorizacao(), timeoutMs: 60_000 })
    totalPages = Math.max(1, resp.totalPages ?? 1)

    for (const item of extrair(resp)) {
      const r = await processarItem(item, hoje, limiar)
      acc.itens++
      if (r.novo) acc.novos_clientes++
      if (r.promovido) acc.promovidos++
      acc.eventos += r.eventos
    }
    page++
  } while (page <= totalPages)

  acc.paginas = totalPages
  logger.info(acc, 'Sync Onepay concluído.')
  return acc
}

async function processarItem(
  item: ItemOnepay,
  hoje: string,
  limiar: number,
): Promise<{ novo: boolean; promovido: boolean; eventos: number }> {
  const cnpj = normalizeCnpj(item.taxId ?? '')
  if (cnpj.length !== 14) return { novo: false, promovido: false, eventos: 0 }

  // Estado anterior (para os eventos de tendência).
  const { data: anterior } = await supabaseAdmin
    .from('clientes_onepay')
    .select('*')
    .eq('cnpj', cnpj)
    .maybeSingle()

  // Resolve/cria a empresa e devolve o id + se foi novo/promovido.
  const emp = await resolverEmpresa(cnpj, item)

  // Upsert do estado atual. primeira_vez_visto fica de fora → preservado no update.
  const row: TablesInsert<'clientes_onepay'> = {
    cnpj,
    onepay_company_id: item.companyId,
    empresa_id: emp.empresaId,
    nome: item.name ?? null,
    status: item.status ?? null,
    operation_status: item.operationStatus ?? null,
    credit_limit: item.creditLimit ?? null,
    available_limit: item.availableLimit ?? null,
    consumed_limit: item.consumedLimit ?? null,
    consumed_pct: item.consumedPct ?? null,
    consumed_pct_2m: item.consumedPct2m ?? null,
    last_anticipation: item.lastAnticipation ?? null,
    days_without_anticipation: item.daysWithoutAnticipation ?? null,
    anticipations_last_2m: item.anticipationsLast2Months ?? null,
    gross_value_last_2m: item.grossValueLast2Months ?? null,
  }
  const { error: erroUpsert } = await supabaseAdmin
    .from('clientes_onepay')
    .upsert(row, { onConflict: 'cnpj' })
  if (erroUpsert) logger.error({ cnpj, erro: erroUpsert.message }, 'Falha no upsert de cliente Onepay.')

  // Snapshot diário (um por dia; re-rodar no mesmo dia não duplica).
  await supabaseAdmin
    .from('clientes_onepay_snapshots')
    .upsert({ cnpj, capturado_em: hoje, dados: item as never }, { onConflict: 'cnpj,capturado_em', ignoreDuplicates: true })

  let eventos = emp.eventos

  const dias = item.daysWithoutAnticipation ?? 0
  const diasAntes = anterior?.days_without_anticipation ?? 0
  const pct = item.consumedPct ?? 0
  const pctAntes = anterior?.consumed_pct ?? 0

  // Dormente: cruzou o limiar (de aquém para além).
  if (dias >= limiar && diasAntes < limiar) {
    await emitirEvento(emp.empresaId, EVENTO_TIPOS.CLIENTE_DORMENTE, {
      titulo: 'Cliente dormente', resumo: `${item.name ?? cnpj}: ${dias} dias sem antecipar.`,
      url: rota(emp.empresaId), cnpj, dias,
    })
    eventos++
  }
  // Reativado: estava dormente e voltou a antecipar.
  if (anterior && diasAntes >= limiar && dias < limiar) {
    await emitirEvento(emp.empresaId, EVENTO_TIPOS.CLIENTE_REATIVADO, {
      titulo: 'Cliente reativado', resumo: `${item.name ?? cnpj} voltou a antecipar.`,
      url: rota(emp.empresaId), cnpj,
    })
    eventos++
  }
  // Limite quase esgotado: cruzou 90%.
  if (pct >= 0.9 && pctAntes < 0.9) {
    await emitirEvento(emp.empresaId, EVENTO_TIPOS.CLIENTE_LIMITE_QUASE_ESGOTADO, {
      titulo: 'Limite quase esgotado', resumo: `${item.name ?? cnpj}: ${(pct * 100).toFixed(0)}% do limite consumido.`,
      url: rota(emp.empresaId), cnpj, consumed_pct: pct,
    })
    eventos++
  }
  // Status operacional mudou.
  if (anterior && (anterior.operation_status ?? null) !== (item.operationStatus ?? null)) {
    await emitirEvento(emp.empresaId, EVENTO_TIPOS.CLIENTE_STATUS_OPERACIONAL_ALTERADO, {
      titulo: 'Status operacional alterado',
      resumo: `${item.name ?? cnpj}: ${anterior.operation_status ?? '—'} → ${item.operationStatus ?? '—'}.`,
      url: rota(emp.empresaId), cnpj, de: anterior.operation_status, para: item.operationStatus,
    })
    eventos++
  }

  return { novo: emp.novo, promovido: emp.promovido, eventos }
}

function rota(empresaId: string | null): string {
  return empresaId ? `/empresas/${empresaId}` : '/radar/clientes'
}

/** Casa o CNPJ com empresas; cria (cliente) se não existe, promove se existe fora de cliente. */
async function resolverEmpresa(
  cnpj: string,
  item: ItemOnepay,
): Promise<{ empresaId: string | null; novo: boolean; promovido: boolean; eventos: number }> {
  const { data: existente } = await supabaseAdmin
    .from('empresas')
    .select('id, estagio, ex_cliente_desde')
    .eq('cnpj', cnpj)
    .maybeSingle()

  if (existente) {
    if (existente.estagio !== 'cliente') {
      /*
       * A REATIVAÇÃO (04h §3.3). Voltar de `ex_cliente` para `cliente` não é a mesma
       * promoção que sair de `prospect`: é uma volta, e ela precisa limpar
       * `ex_cliente_desde` — senão a empresa continua na lista de ex-clientes,
       * carregando uma data de saída que já não vale, e alguém liga para reativar
       * quem já voltou.
       *
       * `ex_cliente_motivo` é limpo junto: o motivo descreve UMA saída. Mantê-lo
       * depois da volta faria o gráfico de churn contar de novo, no mês seguinte, um
       * cliente que está operando. O histórico não se perde — os eventos
       * `cliente.tornou_ex` e `cliente.reativado` ficam na timeline, que é onde a
       * história pertence.
       */
      const voltou = existente.estagio === 'ex_cliente'
      await supabaseAdmin
        .from('empresas')
        .update({
          estagio: 'cliente',
          ...(voltou ? { ex_cliente_desde: null, ex_cliente_motivo: null, ex_cliente_motivo_obs: null } : {}),
        })
        .eq('id', existente.id)

      if (voltou) {
        await emitirEvento(existente.id, EVENTO_TIPOS.CLIENTE_REATIVADO, {
          titulo: 'Ex-cliente reativado',
          resumo: `${item.name ?? cnpj} voltou a aparecer no temperature report e é cliente de novo.`,
          url: `/empresas/${existente.id}`,
          cnpj,
          ex_cliente_desde: existente.ex_cliente_desde,
        })
      } else {
        await emitirEvento(existente.id, EVENTO_TIPOS.ESTAGIO_ALTERADO, {
          titulo: 'Promovido a cliente', resumo: `${item.name ?? cnpj} detectado como cliente Onepay.`,
          url: `/empresas/${existente.id}`, de: existente.estagio, para: 'cliente',
        })
      }
      return { empresaId: existente.id, novo: false, promovido: true, eventos: 1 }
    }
    return { empresaId: existente.id, novo: false, promovido: false, eventos: 0 }
  }

  // Não existe: cria já como cliente, enriquecendo do universo quando houver.
  //
  // As DERIVADAS (camada, grupo_id, is_spe, grafo_sefaz) vêm junto, e não é detalhe: são
  // cópias denormalizadas do universo, e a ficha só mostra a aba "Grupo econômico" quando
  // `empresas.grupo_id` existe. Sem elas o cliente Onepay nascia sem grupo e sem camada —
  // justamente quem mais tem SPEs para agrupar. Reparado pela migração 0072.
  const { data: mu } = await supabaseAdmin
    .from('mercado_universo')
    .select(
      'razao_social, nome_fantasia, uf, municipio, cnae_principal, porte_rfb, empresa_id, camada, grupo_id, is_spe, grafo_sefaz',
    )
    .eq('cnpj', cnpj)
    .maybeSingle()

  const { data: nova, error } = await supabaseAdmin
    .from('empresas')
    .insert({
      cnpj,
      razao_social: mu?.razao_social ?? item.name ?? null,
      nome_fantasia: mu?.nome_fantasia ?? null,
      uf: mu?.uf ?? null,
      municipio: mu?.municipio ?? null,
      cnae_principal: mu?.cnae_principal ?? null,
      porte: mu?.porte_rfb ?? null,
      camada: mu?.camada ?? null,
      grupo_id: mu?.grupo_id ?? null,
      is_spe: mu?.is_spe ?? false,
      grafo_sefaz: mu?.grafo_sefaz ?? false,
      tipo: 'construtora',
      estagio: 'cliente',
      origem: 'onepay',
    })
    .select('id')
    .single()

  if (error || !nova) {
    logger.error({ cnpj, erro: error?.message }, 'Falha ao criar empresa do cliente Onepay.')
    return { empresaId: null, novo: false, promovido: false, eventos: 0 }
  }

  // Liga o universo à empresa recém-criada (espelha a promoção do Mercado).
  await supabaseAdmin.from('mercado_universo').update({ empresa_id: nova.id }).eq('cnpj', cnpj)

  await emitirEvento(nova.id, EVENTO_TIPOS.CLIENTE_NOVO_DETECTADO, {
    titulo: 'Novo cliente detectado', resumo: `${item.name ?? cnpj} entrou na base de clientes Onepay.`,
    url: `/empresas/${nova.id}`, cnpj,
  })

  return { empresaId: nova.id, novo: true, promovido: false, eventos: 1 }
}
