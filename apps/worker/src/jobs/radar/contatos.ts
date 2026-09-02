import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { selecionarAlvos, type CargosAlvo } from '../../../../../packages/core/src/radar/cargos.js'
import type { Tables, TablesInsert } from '../../../../../packages/core/src/types/database.js'
import { supabaseAdmin } from '../../db.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { criarPacer, requisitarJson } from '../../net/http.js'
import { lerApolloCfg, lerCargosAlvo, lerCustos, lerTtl } from '../../radar/config.js'
import { emitirEvento } from '../../radar/eventos.js'
import { gravarMetrica, type OrgApollo } from './funcionarios.js'
import { executarLote } from './lote.js'
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

/**
 * Devolve a organização inteira, não só o id.
 *
 * O `estimated_num_employees` sempre esteve nesta resposta — foi pago, guardado no
 * payload e nunca lido. A CARONA (04c §4.2) é isto: o headcount vira snapshot sem
 * uma chamada nem um centavo a mais. Só o id era retornado antes, e por isso o dado
 * ficou dois Prompts invisível dentro do próprio banco.
 */
async function enriquecerOrg(dominio: string): Promise<OrgApollo | null> {
  const resp = await requisitarJson<{ organization?: OrgApollo }>(
    `${APOLLO}/organizations/enrich?domain=${encodeURIComponent(dominio)}`,
    { method: 'POST', headers: cabecalhos(), tentativas: 2 },
  )
  return resp.organization ?? null
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
/**
 * O domínio está dentro do TTL? Devolve QUANDO foi e ATÉ QUANDO vale, e não só um
 * booleano: quem foi barrado precisa dessas duas datas para entender por que o
 * botão não fez nada, e elas já estão na linha que a consulta lê.
 */
async function ttlDoDominio(
  dominio: string,
  ttlDias: number,
): Promise<{ quando: string; ate: string } | null> {
  const desde = new Date(Date.now() - ttlDias * 86_400_000).toISOString()
  const { data } = await supabaseAdmin
    .from('enriquecimentos')
    .select('executado_em')
    .eq('tipo', 'contatos')
    .eq('dominio', dominio)
    .in('status', ['sucesso', 'sem_dados'])
    .gte('executado_em', desde)
    .order('executado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data?.executado_em) return null

  const em = new Date(data.executado_em)
  const dia = (d: Date): string => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  return { quando: dia(em), ate: dia(new Date(em.getTime() + ttlDias * 86_400_000)) }
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
  const params = (lote.parametros ?? {}) as { revelar_telefone?: boolean; forcar?: boolean }
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
    /*
     * O TTL PRECISA DIZER QUE FOI ELE.
     *
     * Isto devolvia `pulado` sem `erro` e sem `resultado` — a tela não mostrava
     * nada, e clicar de novo continuava não mostrando nada. Na MELNICK, uma busca
     * que voltou `sem_dados` às 18h21 trancou o domínio até 01/03/2027, e os
     * cliques seguintes eram engolidos em silêncio. "Não custou nada porque já
     * buscamos" e "buscamos e não achamos" são coisas diferentes, e as duas
     * apareciam como a mesma tela vazia.
     *
     * `forcar` existe porque a régua muda: um `sem_dados` gravado sob a
     * configuração de ontem não deveria trancar por 180 dias uma busca que hoje
     * usaria outros cargos-alvo e leria mais páginas.
     */
    const bloqueio = params.forcar ? null : await ttlDoDominio(dominio, ttl.contatos)
    if (bloqueio) {
      return {
        status: 'pulado',
        fonte: 'apollo',
        erro:
          `Já buscamos contatos deste domínio em ${bloqueio.quando} e o resultado vale até ` +
          `${bloqueio.ate} — não gastamos de novo. Use "Buscar de novo" para ignorar o cache.`,
      }
    }

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

    let org: OrgApollo | null
    try {
      org = await enriquecerOrg(dominio)
    } catch (e) {
      return { status: 'erro', fonte: 'apollo', erro: `enrich: ${String(e)}` }
    }
    if (!org?.id) {
      dominiosFeitos.add(dominio)
      return { status: 'sem_dados', fonte: 'apollo', resultado: { motivo: 'organização não encontrada no Apollo' } }
    }
    const orgId = org.id

    // A carona (04c §4.2): o headcount veio junto, de graça. Gravado ANTES da
    // revelação de propósito — se o bulk_match falhar no meio, o snapshot que já
    // custou zero não é perdido junto.
    const headcount = Number(org.estimated_num_employees ?? 0)
    if (item.cnpj && Number.isFinite(headcount) && headcount > 0) {
      await gravarMetrica({
        cnpj: item.cnpj,
        empresaId,
        metrica: 'funcionarios',
        valor: headcount,
        origem: 'apollo',
        confianca: 'media',
        detalhes: { dominio, carona: 'enriquecimento_contatos' },
      })
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
      // `organizacao` no payload é o que o backfill de headcount lê depois. Guardar a
      // resposta inteira custa bytes; não guardar custou dois Prompts de dado invisível.
      resultado: { creditos, revelados, organizacao: org },
    }
  }
}

/**
 * Contatos sob demanda de UMA empresa, disparado do botão na ficha.
 *
 * Mesma forma do `protestosEmpresa`: abre um lote já `aprovado` (o clique É a
 * aprovação), com um item só, e roda na hora. Passa pelo lote em vez de chamar o
 * processador direto porque é o lote que registra custo, respeita o teto de
 * orçamento e grava `enriquecimentos` — um caminho paralelo gastaria crédito do
 * Apollo sem aparecer em nenhuma dessas contas.
 *
 * O TTL vale aqui também, de propósito: clicar duas vezes no botão não cobra duas
 * vezes pelo mesmo domínio. O retorno diz `pulado` quando foi isso.
 */
export async function contatosEmpresa(opts: {
  empresaId: string
  revelarTelefone?: boolean
  /** Ignora o TTL do domínio. É o "buscar de novo" depois de a régua de cargos mudar. */
  forcar?: boolean
}): Promise<{ lote_id: string; itens: number; processados: number; custo: number }> {
  if (!env.APOLLO_API_KEY) throw new Error('APOLLO_API_KEY não configurada.')

  const { data: emp } = await supabaseAdmin
    .from('empresas')
    .select('cnpj, dominio, razao_social')
    .eq('id', opts.empresaId)
    .maybeSingle()
  if (!emp?.cnpj) throw new Error('Empresa não encontrada ou sem CNPJ.')
  // Sem domínio o Apollo não tem por onde começar (a busca é por organização, e a
  // organização é resolvida pelo domínio). Falha explícita em vez de lote vazio.
  if (!emp.dominio) {
    throw new Error('Esta empresa não tem domínio resolvido — rode a cascata de domínio antes.')
  }

  const parametros = {
    motivo: 'sob_demanda',
    empresa_id: opts.empresaId,
    revelar_telefone: opts.revelarTelefone,
    forcar: opts.forcar ?? false,
  }

  const { data: lote, error } = await supabaseAdmin
    .from('lotes_enriquecimento')
    .insert({
      tipo: 'contatos',
      nome: `Contatos — ${emp.razao_social ?? emp.cnpj}`,
      definicao_filtro: {} as never,
      parametros: parametros as never,
      status: 'aprovado',
      criado_por: null,
    })
    .select('id')
    .single()
  if (error || !lote) throw new Error(`Falha ao abrir lote de contatos: ${error?.message}`)

  const { error: erroItem } = await supabaseAdmin
    .from('lote_itens')
    .insert({ lote_id: lote.id, cnpj: emp.cnpj, empresa_id: opts.empresaId, dominio: emp.dominio })
  if (erroItem) throw new Error(`Falha ao inserir item do lote: ${erroItem.message}`)

  await supabaseAdmin.from('lotes_enriquecimento').update({ total_itens: 1 }).eq('id', lote.id)

  const loteMin = { id: lote.id, tipo: 'contatos', parametros } as unknown as Tables<'lotes_enriquecimento'>
  const r = await executarLote(lote.id, criarProcessadorContatos(loteMin))
  return { lote_id: lote.id, itens: 1, ...r }
}
