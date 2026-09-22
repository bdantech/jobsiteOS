import { normalizeCnpj } from '../../../../packages/core/src/schemas/cnpj.js'
import type { ConfigEconomia } from '../../../../packages/core/src/antecipacao/schemas.js'
import { supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'

/**
 * O QUE O SACADO CUSTA, e quem é a empresa por trás de um CNPJ.
 *
 * Saiu de `jobs/antecipacao/sync-nfs.ts` quando o funil ganhou uma segunda e uma
 * terceira fonte (04s). O motivo não é organização de arquivo: é que uma
 * pré-autorização e uma NF contra o MESMO sacado precisam chegar ao mesmo número.
 *
 * Duas implementações "equivalentes" da régua de TAC divergiriam no primeiro
 * sacado com análise da plataforma e condição publicada ao mesmo tempo — e a
 * divergência aqui não sai como um erro na tela. Sai como dois cards do mesmo
 * fornecedor prometendo líquidos diferentes para o mesmo dinheiro, e o originador
 * descobre isso na frente do cliente.
 *
 * Os caches por CNPJ moram aqui e são compartilhados pelas três fontes: num ciclo
 * em que o sync de NFs roda antes do de pré-autorizações, o segundo aproveita o
 * que o primeiro já resolveu.
 */

function textoOuNulo(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/** A taxa do snapshot mais recente do sacado, quando o payload não trouxe uma. */
export async function taxaDoUltimoSnapshot(cnpj: string): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from('credito_snapshots')
    .select('monthly_rate_d0')
    .eq('cnpj', cnpj)
    .order('capturado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.monthly_rate_d0 ?? null
}


/**
 * A régua da TAC deste sacado: `[max, min, limiar, piso]`, na ordem de `calcularTac`.
 *
 * ── DO SACADO, COMO A TAXA ──────────────────────────────────────────────────
 * É o risco dele que precifica a nota, então é a tarifa DELE que diz quanto custa a
 * operação. Sem tarifa conhecida, a régua padrão da config — que nasce com os números
 * da matriz semente.
 *
 * ── A ANÁLISE DA PLATAFORMA VEM ANTES DA CONDIÇÃO PUBLICADA ─────────────────
 * A tentação é ler `condicoes_comerciais`: é a nossa tabela, é o que o Crédito
 * publicou. Mas publicada só existe para as empresas NOVAS que estamos mandando
 * agora — a base inteira, que já operava antes desta tela existir, não tem nenhuma.
 * A tarifa real dessas empresas chega pelo sync da análise de crédito
 * (`analises_plataforma.fee_d0` / `min_fee_d0`), e é ela que a plataforma vai
 * debitar de fato: 245 CNPJs contra 1. Estimar o líquido com a régua padrão quando
 * existe a tarifa verdadeira é errar por preguiça de procurar na tabela certa.
 *
 * A ordem também resolve o desempate: quando as duas existem, vale a da plataforma,
 * porque quem cobra é ela. Uma condição recém-publicada que ela ainda não ingeriu
 * fica atrás por uma janela de sync — e é melhor errar para o que SERÁ cobrado hoje
 * do que para o que passará a valer quando o outro lado processar.
 *
 * ── O LIMIAR E O PISO VÊM DA MATRIZ QUE PRECIFICOU AQUELA RÉGUA ─────────────
 * Para a condição publicada, a matriz é a `matriz_versao` que ela guarda, e não a de
 * hoje: a proporcionalidade faz parte da mesma tabela de preços que gerou o fee, e
 * misturar o fee de uma versão com o limiar de outra inventa um terceiro preço que
 * ninguém aprovou. Para a análise da plataforma, que não guarda versão, vale a matriz
 * ATIVA — é o que sabemos hoje sobre o formato da rampa.
 *
 * ── CACHE POR CNPJ ──────────────────────────────────────────────────────────
 * Um sync varre milhares de notas e um punhado de sacados se repete em quase
 * todas. Sem o cache seriam duas consultas por nota para ler um número que não
 * muda no meio da execução.
 */
export type ReguaTac = [max: number, min: number, limiar: number, piso: number]

const cacheTac = new Map<string, ReguaTac>()
const cacheMatriz = new Map<number | 'ativa', [number, number]>()
const cacheTaxaAnalise = new Map<string, { taxa: number | null; origem: string | null }>()

/** `[limiar, piso]` da versão pedida; `'ativa'` lê a matriz em vigor. */
export async function rampaDaMatriz(
  versao: number | 'ativa',
  cfg: ConfigEconomia,
): Promise<[number, number]> {
  const guardado = cacheMatriz.get(versao)
  if (guardado) return guardado

  const consulta = supabaseAdmin.from('precificacao_matriz').select('definicao')
  const { data } =
    versao === 'ativa'
      ? await consulta.eq('ativa', true).limit(1).maybeSingle()
      : await consulta.eq('versao', versao).maybeSingle()

  const def = data?.definicao as {
    faixas?: { limiar_proporcionalidade_tac?: number; piso_proporcionalidade_tac?: number }
  } | null

  const bruto = (valor: unknown, padrao: number): number => {
    const n = Number(valor ?? padrao)
    return Number.isFinite(n) && n > 0 ? n : padrao
  }
  const rampa: [number, number] = [
    bruto(def?.faixas?.limiar_proporcionalidade_tac, cfg.tac_limiar_padrao),
    bruto(def?.faixas?.piso_proporcionalidade_tac, cfg.tac_piso_padrao),
  ]

  cacheMatriz.set(versao, rampa)
  return rampa
}

/**
 * A taxa da análise de crédito deste sacado — e da empresa-mãe quando ele não tem
 * uma própria.
 *
 * SPE e filial não são analisadas: quem é analisada é a construtora dona delas, e
 * é a condição dela que a plataforma aplica. `app__taxa_da_analise` (0225) é a
 * mesma escada que o backfill percorreu, chamada aqui para que a nota que chega
 * amanhã nasça com o mesmo número que a de ontem.
 */
export async function taxaDaAnalise(
  cnpj: string,
): Promise<{ taxa: number | null; origem: string | null }> {
  const guardado = cacheTaxaAnalise.get(cnpj)
  if (guardado) return guardado

  /*
   * `.bind` e não `supabaseAdmin.rpc` solto — e o cast é justamente o que escondia
   * isso. `rpc()` do supabase-js faz `return this.rest.rpc(...)`; arrancado do
   * objeto, `this` é undefined (módulo ES é strict) e a chamada estoura com
   * "Cannot read properties of undefined (reading 'rest')" na PRIMEIRA nota do
   * sync, antes do upsert — ou seja, a corrida inteira morre.
   *
   * O `as unknown as` some com o erro em typecheck porque promete uma função
   * livre, que é o que ela deixou de ser ao ser destacada. Continua necessário
   * (a função nasceu na 0225 e `database.ts` é gerado do banco), mas agora sobre
   * algo que já está amarrado ao receptor.
   */
  const rpc = supabaseAdmin.rpc.bind(supabaseAdmin) as unknown as (
    nome: string,
    args: Record<string, unknown>,
  ) => Promise<{
    data: { taxa: number | null; origem: string | null }[] | null
    error: { message: string } | null
  }>
  const { data, error } = await rpc('app__taxa_da_analise', { p_sacado_cnpj: cnpj })
  if (error) {
    logger.warn({ cnpj, erro: error.message }, 'Falha ao resolver a taxa da análise.')
    return { taxa: null, origem: null }
  }
  const linha = Array.isArray(data) ? data[0] : null
  const taxa = Number(linha?.taxa ?? Number.NaN)
  const resolvido = {
    taxa: Number.isFinite(taxa) ? taxa : null,
    origem: (linha?.origem as string | null) ?? null,
  }
  cacheTaxaAnalise.set(cnpj, resolvido)
  return resolvido
}

export async function tacDoSacado(cnpj: string, cfg: ConfigEconomia): Promise<ReguaTac> {
  const guardado = cacheTac.get(cnpj)
  if (guardado) return guardado

  // D0, e não D1, porque é a `monthlyRateD0` que precifica o juros desta nota —
  // as duas parcelas têm de falar do mesmo produto.
  const daPlataforma = await supabaseAdmin
    .from('analises_plataforma')
    .select('fee_d0, min_fee_d0')
    .eq('cnpj', cnpj)
    .not('fee_d0', 'is', null)
    .order('sincronizada_em', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  let regua: ReguaTac | null = null

  const feeP = Number(daPlataforma.data?.fee_d0 ?? Number.NaN)
  const feeMinP = Number(daPlataforma.data?.min_fee_d0 ?? Number.NaN)
  if (Number.isFinite(feeP) && Number.isFinite(feeMinP)) {
    regua = [feeP, feeMinP, ...(await rampaDaMatriz('ativa', cfg))]
  }

  if (!regua) {
    const { data } = await supabaseAdmin
      .from('condicoes_comerciais')
      .select('fee_d0, fee_min_d0, matriz_versao')
      .eq('cnpj', cnpj)
      .eq('status', 'publicada')
      .order('publicada_em', { ascending: false })
      .limit(1)
      .maybeSingle()

    const fee = Number(data?.fee_d0 ?? Number.NaN)
    const feeMin = Number(data?.fee_min_d0 ?? Number.NaN)
    if (Number.isFinite(fee) && Number.isFinite(feeMin)) {
      regua = [fee, feeMin, ...(await rampaDaMatriz(Number(data?.matriz_versao ?? 0), cfg))]
    }
  }

  regua ??= [cfg.tac_max_padrao, cfg.tac_min_padrao, cfg.tac_limiar_padrao, cfg.tac_piso_padrao]

  cacheTac.set(cnpj, regua)
  return regua
}

/** O que uma ponta da operação traz sobre si mesma, nas TRÊS fontes. */
export interface ParticipanteCadastral {
  name?: string | null
  registered?: boolean | null
}

export interface EmpresaResolvida {
  empresaId: string | null
  /** Já temos dado cadastral dele (empresas ou mercado_universo)? */
  conhecido: boolean
}

/**
 * Liga o CNPJ a `empresas` quando ele JÁ existe, e cria a empresa quando o
 * participante está cadastrado na plataforma (espelha o sync de clientes). Um
 * CNPJ que só apareceu numa nota e não é cliente NÃO vira `empresas`: seria
 * inflar o CRM com dezenas de milhares de fornecedores que ninguém trabalha.
 * Ele vai para a fila de lookup e passa a existir em `mercado_universo`.
 */
export async function resolverEmpresa(
  cnpj: string,
  participante: ParticipanteCadastral | null,
): Promise<EmpresaResolvida> {
  const { data: existente } = await supabaseAdmin
    .from('empresas')
    .select('id')
    .eq('cnpj', cnpj)
    .maybeSingle()
  if (existente) return { empresaId: existente.id, conhecido: true }

  // As DERIVADAS (camada, grupo_id, is_spe, grafo_sefaz) vêm junto, e não é detalhe: são
  // cópias denormalizadas do universo, e a ficha só mostra a aba "Grupo econômico" quando
  // `empresas.grupo_id` existe. Sem elas o universo sabia o grupo e a empresa não — a aba
  // nunca aparecia, a camada sumia da leitura de pirâmide e a SPE não entrava na análise
  // financeira do grupo. Foi o que a migração 0072 teve de reparar.
  const { data: universo } = await supabaseAdmin
    .from('mercado_universo')
    .select(
      'cnpj, empresa_id, razao_social, nome_fantasia, uf, municipio, cnae_principal, porte_rfb, camada, grupo_id, is_spe, grafo_sefaz',
    )
    .eq('cnpj', cnpj)
    .maybeSingle()

  if (!participante?.registered) {
    return { empresaId: universo?.empresa_id ?? null, conhecido: universo !== null }
  }

  const { data: nova, error } = await supabaseAdmin
    .from('empresas')
    .insert({
      cnpj,
      razao_social: universo?.razao_social ?? textoOuNulo(participante.name),
      nome_fantasia: universo?.nome_fantasia ?? null,
      uf: universo?.uf ?? null,
      municipio: universo?.municipio ?? null,
      cnae_principal: universo?.cnae_principal ?? null,
      porte: universo?.porte_rfb ?? null,
      camada: universo?.camada ?? null,
      grupo_id: universo?.grupo_id ?? null,
      is_spe: universo?.is_spe ?? false,
      grafo_sefaz: universo?.grafo_sefaz ?? false,
      tipo: 'fornecedor',
      estagio: 'mercado',
      origem: 'antecipacao',
    })
    .select('id')
    .single()

  if (error || !nova) {
    logger.error({ cnpj, erro: error?.message }, 'Falha ao criar empresa a partir da NF.')
    return { empresaId: universo?.empresa_id ?? null, conhecido: universo !== null }
  }

  if (universo) {
    await supabaseAdmin.from('mercado_universo').update({ empresa_id: nova.id }).eq('cnpj', cnpj)
  }
  return { empresaId: nova.id, conhecido: true }
}

/** Fila de enriquecimento cadastral (§3.1). Só para quem não tem dado nenhum. */
export async function enfileirarLookup(
  cnpj: string,
  motivo: 'fornecedor_nf' | 'sacado_nf',
  conhecido: boolean,
): Promise<number> {
  if (conhecido) return 0
  const { error } = await supabaseAdmin
    .from('cnpj_lookup_fila')
    .upsert({ cnpj, motivo }, { onConflict: 'cnpj', ignoreDuplicates: true })
  if (error) {
    logger.error({ cnpj, erro: error.message }, 'Falha ao enfileirar CNPJ para lookup.')
    return 0
  }
  return 1
}
