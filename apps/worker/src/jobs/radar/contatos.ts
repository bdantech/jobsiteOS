import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { selecionarAlvos, type CargosAlvo } from '../../../../../packages/core/src/radar/cargos.js'
import type { Tables, TablesInsert } from '../../../../../packages/core/src/types/database.js'
import { supabaseAdmin } from '../../db.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { criarPacer, requisitarJson } from '../../net/http.js'
import { lerApolloCfg, lerCargosAlvo, lerCustos, lerTtl } from '../../radar/config.js'
import { emitirEvento } from '../../radar/eventos.js'
import type { ProcessarItem, ResultadoItem } from './lote.js'

/**
 * Enriquecimento de contatos via Apollo (§4).
 *
 * A UNIDADE DE COBRANÇA É O DOMÍNIO, não o CNPJ: SPEs e filiais de um grupo
 * compartilham domínio, e enriquecer por CNPJ pagaria N vezes pela mesma empresa.
 * Então o processador deduplica por domínio (nesta corrida e por TTL) e vincula os
 * contatos à empresa do item; os CNPJs-irmãos que compartilham o domínio herdam os
 * contatos pela relação de grupo/domínio (sem duplicar linhas — apollo_person_id é
 * único). Sequência: organizations/enrich → mixed_people/api_search (filtra por
 * título e senioridade, de graça) → ordena por senioridade e corta em
 * `max_contatos_por_empresa` → people/bulk_match (blocos de 10), que cobra e revela
 * o e-mail na hora. O TELEFONE NÃO VEM AQUI: o Apollo o entrega minutos depois, no
 * webhook (`radar/apollo-webhook.ts`), que casa a linha por apollo_person_id. Por
 * isso o contato nasce com telefone_status 'pendente' e o telefone fica fora do
 * upsert — um reprocessamento não pode apagar o que o webhook trouxe.
 */

const APOLLO = 'https://api.apollo.io/api/v1'

interface PessoaApollo {
  id?: string
  name?: string
  first_name?: string
  last_name?: string
  title?: string
  seniority?: string
  departments?: string[]
  email?: string
  email_status?: string
  linkedin_url?: string
  /** Raro no bulk_match (o telefone é assíncrono), mas o Apollo às vezes já traz um. */
  phone_numbers?: Array<{ raw_number?: string; sanitized_number?: string }>
}

function cabecalhos(): Record<string, string> {
  return { 'x-api-key': env.APOLLO_API_KEY ?? '', 'cache-control': 'no-cache' }
}

async function enriquecerOrg(dominio: string): Promise<string | null> {
  const resp = await requisitarJson<{ organization?: { id?: string } }>(
    `${APOLLO}/organizations/enrich?domain=${encodeURIComponent(dominio)}`,
    { method: 'POST', headers: cabecalhos(), tentativas: 2 },
  )
  return resp.organization?.id ?? null
}

const POR_PAGINA = 100 // teto da API

/**
 * Varre a empresa inteira — sem filtro de cargo e sem gastar crédito: esta busca é
 * gratuita, só o bulk_match cobra. Filtrar aqui era o erro: `person_titles` e
 * `person_seniorities` se combinam por OR no Apollo, então a lista de cargos-alvo
 * não restringia nada, só deixava entrar qualquer 'manager'. A seleção passou a ser
 * local, em `selecionarAlvos`, onde a regra é nossa e testada.
 */
async function buscarPessoas(orgId: string, cargos: CargosAlvo): Promise<PessoaApollo[]> {
  const maxPaginas = Math.max(1, cargos.max_paginas_busca || 3)
  const pace = criarPacer(300) // a busca não custa crédito, mas custa rate limit
  const todas: PessoaApollo[] = []

  for (let page = 1; page <= maxPaginas; page++) {
    await pace()
    const resp = await requisitarJson<{
      people?: PessoaApollo[]
      pagination?: { total_pages?: number; total_entries?: number }
    }>(`${APOLLO}/mixed_people/api_search`, {
      method: 'POST',
      headers: cabecalhos(),
      body: { organization_ids: [orgId], per_page: POR_PAGINA, page },
      tentativas: 2,
    })

    const pagina = resp.people ?? []
    todas.push(...pagina)

    const totalPaginas = resp.pagination?.total_pages ?? 0
    if (pagina.length < POR_PAGINA || (totalPaginas > 0 && page >= totalPaginas)) break
    if (page === maxPaginas && totalPaginas > maxPaginas) {
      // Silêncio aqui viraria "a empresa só tem 300 pessoas" na análise de custo.
      logger.warn({ orgId, paginas_lidas: page, total_paginas: totalPaginas }, 'Busca do Apollo truncada pelo teto.')
    }
  }
  return todas
}

async function revelar(
  ids: string[],
  revelarTelefone: boolean,
  webhookUrl: string | null,
): Promise<{ matches: PessoaApollo[]; creditos: number }> {
  // Os `reveal_*` e o `webhook_url` são QUERY PARAMS — no corpo o Apollo os descarta
  // sem erro, e o pedido vira um match comum: e-mail vem (é o padrão do endpoint) e o
  // telefone nunca é pedido, então o webhook nunca toca. Foi exatamente esse silêncio
  // que queimou dois lotes. Só o `details` vai no corpo.
  const query = new URLSearchParams({ reveal_personal_emails: 'true' })
  if (revelarTelefone && webhookUrl) {
    query.set('reveal_phone_number', 'true')
    query.set('webhook_url', webhookUrl)
  }
  const resp = await requisitarJson<{ matches?: PessoaApollo[]; credits_consumed?: number }>(
    `${APOLLO}/people/bulk_match?${query.toString()}`,
    {
      method: 'POST',
      headers: cabecalhos(),
      body: { details: ids.map((id) => ({ id })) },
      tentativas: 2,
    },
  )
  return { matches: resp.matches ?? [], creditos: resp.credits_consumed ?? 0 }
}

/** Já há enriquecimento de contatos para este domínio dentro do TTL? (cobrança por domínio) */
async function dominioNoTtl(dominio: string, ttlDias: number): Promise<boolean> {
  const desde = new Date(Date.now() - ttlDias * 86_400_000).toISOString()
  const { count } = await supabaseAdmin
    .from('enriquecimentos')
    .select('id', { count: 'exact', head: true })
    .eq('tipo', 'contatos')
    .eq('dominio', dominio)
    .in('status', ['sucesso', 'sem_dados'])
    .gte('executado_em', desde)
  return (count ?? 0) > 0
}

async function gravarContato(empresaId: string, p: PessoaApollo, pediuTelefone: boolean): Promise<void> {
  if (!p.id) {
    // Sem person_id o webhook não teria como casar a linha depois (é a chave do
    // update), e o upsert duplicaria — `unique(apollo_person_id)` não pega nulls.
    logger.warn({ nome: p.name }, 'Match do Apollo sem person_id; contato ignorado.')
    return
  }

  // Telefone fica FORA do upsert de propósito: ele chega depois, pelo webhook, e
  // um reprocessamento (TTL vencido) reescreveria com null o número já recebido.
  const row: TablesInsert<'contatos'> = {
    empresa_id: empresaId,
    apollo_person_id: p.id,
    nome: p.name ?? ([p.first_name, p.last_name].filter(Boolean).join(' ') || null),
    cargo: p.title ?? null,
    email: p.email ?? null,
    email_status: normalizarEmailStatus(p.email_status),
    senioridade: p.seniority ?? null,
    departamento: p.departments?.[0] ?? null,
    linkedin_url: p.linkedin_url ?? null,
    origem: 'apollo',
    enriquecido_em: new Date().toISOString(),
  }
  const { error } = await supabaseAdmin.from('contatos').upsert(row, { onConflict: 'apollo_person_id' })
  if (error) {
    logger.error({ apollo: p.id, erro: error.message }, 'Falha ao gravar contato Apollo.')
    return
  }

  // Estado do telefone à parte, para nunca rebaixar o que o webhook já trouxe.
  const tel = p.phone_numbers?.find((n) => n.sanitized_number || n.raw_number)
  const numero = tel?.sanitized_number ?? tel?.raw_number ?? null
  const patch = numero
    ? { telefone: numero, telefone_status: 'recebido' as const }
    : pediuTelefone
      ? { telefone_status: 'pendente' as const }
      : null
  if (!patch) return

  let q = supabaseAdmin.from('contatos').update(patch).eq('apollo_person_id', p.id)
  if (!numero) q = q.is('telefone', null) // 'pendente' não sobrescreve número já recebido
  const { error: erroTel } = await q
  if (erroTel) logger.error({ apollo: p.id, erro: erroTel.message }, 'Falha ao marcar estado do telefone.')
}

function normalizarEmailStatus(s: string | undefined): string | null {
  if (s === 'verified' || s === 'guessed' || s === 'unavailable') return s
  if (s === 'valid') return 'verified'
  return s ? 'guessed' : null
}

/** Empresa à qual vincular os contatos: a do item, ou uma promovida que compartilhe o domínio. */
async function empresaMae(item: Tables<'lote_itens'>, dominio: string): Promise<string | null> {
  if (item.empresa_id) return item.empresa_id
  const { data } = await supabaseAdmin
    .from('empresas')
    .select('id')
    .eq('dominio', dominio)
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

export function criarProcessadorContatos(lote: Tables<'lotes_enriquecimento'>): ProcessarItem {
  const params = (lote.parametros ?? {}) as { revelar_telefone?: boolean }
  const dominiosFeitos = new Set<string>()

  return async (item: Tables<'lote_itens'>): Promise<ResultadoItem> => {
    if (!env.APOLLO_API_KEY) return { status: 'erro', fonte: 'apollo', erro: 'APOLLO_API_KEY não configurada.' }

    const dominio = item.dominio
    if (!dominio) return { status: 'pulado', fonte: 'apollo', erro: 'Sem domínio — rode a cascata de domínio antes.' }

    // Dedup por domínio: nesta corrida e por TTL (a cobrança é por domínio).
    if (dominiosFeitos.has(dominio)) return { status: 'pulado', fonte: 'apollo' }
    const cfgCargos = await lerCargosAlvo()
    const cfgApollo = await lerApolloCfg()
    const { contato_apollo } = await lerCustos()
    const ttl = await lerTtl()
    if (await dominioNoTtl(dominio, ttl.contatos)) return { status: 'pulado', fonte: 'apollo' }

    const empresaId = await empresaMae(item, dominio)
    if (!empresaId) {
      return { status: 'pulado', fonte: 'apollo', erro: 'Nenhuma empresa promovida com este domínio para vincular.' }
    }

    // Telefone é assíncrono: o Apollo só o entrega no webhook. Sem URL configurada
    // o pedido seria pago e nunca respondido — falha ANTES de gastar crédito, em vez
    // de rebaixar para "só e-mail" em silêncio (o modo antigo, que escondia o problema).
    const querTelefone = params.revelar_telefone ?? cfgApollo.revelar_telefone_em_lote
    const webhookUrl = env.APOLLO_WEBHOOK_URL ?? null
    if (querTelefone && !webhookUrl) {
      return {
        status: 'erro',
        fonte: 'apollo',
        erro: 'Telefone pedido, mas APOLLO_WEBHOOK_URL não está configurada — o Apollo não teria para onde entregar.',
      }
    }
    const revelarTelefone = querTelefone && !!webhookUrl

    let orgId: string | null
    try {
      orgId = await enriquecerOrg(dominio)
    } catch (e) {
      return { status: 'erro', fonte: 'apollo', erro: `enrich: ${String(e)}` }
    }
    if (!orgId) {
      dominiosFeitos.add(dominio)
      return { status: 'sem_dados', fonte: 'apollo', resultado: { motivo: 'organização não encontrada no Apollo' } }
    }

    // Busca todo mundo (grátis) → seleciona pelos cargos-alvo (local) → corta no
    // limite por empresa. Só o que sobra do corte é revelado, e revelar é o que custa.
    const encontradas = (await buscarPessoas(orgId, cfgCargos)).filter((p) => p.id)
    const pessoas = selecionarAlvos(encontradas, cfgCargos).slice(0, cfgCargos.max_contatos_por_empresa || 8)
    logger.info(
      { dominio, encontradas: encontradas.length, elegiveis: pessoas.length },
      'Seleção de contatos do Apollo.',
    )

    if (pessoas.length === 0) {
      dominiosFeitos.add(dominio)
      return {
        status: 'sem_dados',
        fonte: 'apollo',
        resultado: { motivo: 'nenhuma pessoa nos cargos-alvo', encontradas: encontradas.length },
      }
    }

    // Revela em blocos (bulk_size, default 10).
    const bloco = Math.max(1, cfgApollo.bulk_size || 10)
    let revelados = 0
    let creditos = 0
    for (let i = 0; i < pessoas.length; i += bloco) {
      const ids = pessoas.slice(i, i + bloco).map((p) => p.id as string)
      let r: { matches: PessoaApollo[]; creditos: number }
      try {
        r = await revelar(ids, revelarTelefone, webhookUrl)
      } catch (e) {
        logger.error({ dominio, erro: String(e) }, 'bulk_match falhou.')
        continue
      }
      creditos += r.creditos
      for (const m of r.matches) {
        await gravarContato(empresaId, m, revelarTelefone)
        if (m.email) revelados++
      }
    }

    dominiosFeitos.add(dominio)

    if (revelados === 0) {
      return { status: 'sem_dados', fonte: 'apollo', resultado: { creditos }, unidades: 0 }
    }

    await emitirEvento(empresaId, EVENTO_TIPOS.CONTATOS_ENRIQUECIDOS, {
      titulo: 'Contatos enriquecidos',
      resumo: `${revelados} contato(s) revelado(s) via Apollo (${dominio}).`,
      url: `/empresas/${empresaId}`,
      dominio,
    })

    return {
      status: 'sucesso',
      fonte: 'apollo',
      custo: revelados * contato_apollo,
      unidades: revelados,
      resultado: { creditos, revelados },
    }
  }
}
