import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { criarPacer, HttpError, requisitarJson } from '../../net/http.js'
import { emitirEvento } from '../../radar/eventos.js'
import { lerConfigLookup } from '../../antecipacao/config.js'

/**
 * Enriquecimento cadastral por CASCATA DE APIS PÚBLICAS GRATUITAS (§3.1).
 *
 * O problema que este job resolve: fornecedores chegam pela NF só com nome e
 * CNPJ, e a maioria tem CNAE fora do recorte de construção (comércio de
 * materiais, indústria) — portanto NÃO existe em `mercado_universo`. Sem dado
 * cadastral (capital, Simples, idade, situação), as variáveis de faixa e a
 * Company 360 ficam cegas justamente para o lado do funil que mais cresce.
 *
 * A solução é deliberadamente barata: três provedores gratuitos em cascata, com
 * interface plugável (mesmo padrão dos protestos), e o resultado normalizado
 * entra em `mercado_universo` com `origem_ingestao = 'lookup'`. A partir daí TODO
 * o resto do sistema — filter engine, reconciliação com `empresas`, Company 360 —
 * funciona sem uma linha de código nova.
 *
 * `fora_recorte_cnae = true` quando o CNAE não é 41/42/43: eles existem no
 * staging, mas a regra do TAM os exclui (migration 0049), então não sobem na
 * pirâmide comercial.
 */

/** Divisões CNAE do recorte de construção. Mesma lista das regras seed do Mercado. */
const DIVISOES_CONSTRUCAO = new Set(['41', '42', '43'])

export interface CadastroNormalizado {
  cnpj: string
  razao_social: string | null
  nome_fantasia: string | null
  situacao_cadastral: string | null
  natureza_juridica: string | null
  porte_rfb: string | null
  cnae_principal: string | null
  cnaes_todos: string[]
  capital_social: number | null
  data_inicio_atividade: string | null
  uf: string | null
  municipio: string | null
  opcao_simples: boolean | null
  data_exclusao_simples: string | null
}

export interface ProvedorCadastro {
  nome: string
  /** null = a fonte respondeu, mas não conhece o CNPJ (cache negativo legítimo). */
  buscar: (cnpj: string) => Promise<CadastroNormalizado | null>
  /** Espaçamento mínimo entre chamadas, em ms. 0 = sem throttle. */
  intervaloMs: number
}

// ─── Normalização ───────────────────────────────────────────────────────────

const SITUACOES: Record<string, string> = {
  '01': 'nula',
  '02': 'ativa',
  '03': 'suspensa',
  '04': 'inapta',
  '08': 'baixada',
  ATIVA: 'ativa',
  SUSPENSA: 'suspensa',
  INAPTA: 'inapta',
  BAIXADA: 'baixada',
  NULA: 'nula',
}

function situacao(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null
  const chave = String(valor).trim().toUpperCase()
  return SITUACOES[chave] ?? SITUACOES[chave.padStart(2, '0')] ?? null
}

function digitos(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null
  const d = String(valor).replace(/\D/g, '')
  return d === '' ? null : d
}

function numero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null
  const n = Number(String(valor).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function texto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null
  const s = String(valor).trim()
  return s === '' ? null : s
}

/** dd/mm/aaaa (ReceitaWS) ou aaaa-mm-dd (os outros dois). */
function data(valor: unknown): string | null {
  const s = texto(valor)
  if (!s) return null
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s)
  return iso?.[1] ?? null
}

// ─── Provedores ─────────────────────────────────────────────────────────────

/** (1) minhareceita.org — espelho do dump oficial. É o mais completo e o mais rápido. */
const minhaReceita: ProvedorCadastro = {
  nome: 'minhareceita',
  intervaloMs: 250,
  buscar: async (cnpj) => {
    type Cnae = { codigo?: number | string }
    interface Resp {
      razao_social?: string
      nome_fantasia?: string
      descricao_situacao_cadastral?: string
      codigo_natureza_juridica?: number | string
      porte?: string
      cnae_fiscal?: number | string
      cnaes_secundarios?: Cnae[]
      capital_social?: number | string
      data_inicio_atividade?: string
      uf?: string
      municipio?: string
      opcao_pelo_simples?: boolean | null
      data_exclusao_do_simples?: string | null
    }
    const r = await requisitarJson<Resp>(`https://minhareceita.org/${cnpj}`, {
      tentativas: 2,
      timeoutMs: 20_000,
    })
    const principal = digitos(r.cnae_fiscal)
    const secundarios = (r.cnaes_secundarios ?? [])
      .map((c) => digitos(c.codigo))
      .filter((c): c is string => c !== null)
    return {
      cnpj,
      razao_social: texto(r.razao_social),
      nome_fantasia: texto(r.nome_fantasia),
      situacao_cadastral: situacao(r.descricao_situacao_cadastral),
      natureza_juridica: digitos(r.codigo_natureza_juridica),
      porte_rfb: porte(r.porte),
      cnae_principal: principal,
      cnaes_todos: [principal, ...secundarios].filter((c): c is string => c !== null),
      capital_social: numero(r.capital_social),
      data_inicio_atividade: data(r.data_inicio_atividade),
      uf: texto(r.uf),
      municipio: texto(r.municipio),
      opcao_simples: r.opcao_pelo_simples ?? null,
      data_exclusao_simples: data(r.data_exclusao_do_simples),
    }
  },
}

/** (2) BrasilAPI — mesma origem, outra hospedagem. Cobre a queda da primeira. */
const brasilApi: ProvedorCadastro = {
  nome: 'brasilapi',
  intervaloMs: 400,
  buscar: async (cnpj) => {
    type Cnae = { codigo?: number | string }
    interface Resp {
      razao_social?: string
      nome_fantasia?: string
      descricao_situacao_cadastral?: string
      codigo_natureza_juridica?: number | string
      porte?: string
      cnae_fiscal?: number | string
      cnaes_secundarios?: Cnae[]
      capital_social?: number | string
      data_inicio_atividade?: string
      uf?: string
      municipio?: string
      opcao_pelo_simples?: boolean | null
      data_exclusao_do_simples?: string | null
    }
    const r = await requisitarJson<Resp>(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      tentativas: 2,
      timeoutMs: 20_000,
    })
    const principal = digitos(r.cnae_fiscal)
    const secundarios = (r.cnaes_secundarios ?? [])
      .map((c) => digitos(c.codigo))
      .filter((c): c is string => c !== null)
    return {
      cnpj,
      razao_social: texto(r.razao_social),
      nome_fantasia: texto(r.nome_fantasia),
      situacao_cadastral: situacao(r.descricao_situacao_cadastral),
      natureza_juridica: digitos(r.codigo_natureza_juridica),
      porte_rfb: porte(r.porte),
      cnae_principal: principal,
      cnaes_todos: [principal, ...secundarios].filter((c): c is string => c !== null),
      capital_social: numero(r.capital_social),
      data_inicio_atividade: data(r.data_inicio_atividade),
      uf: texto(r.uf),
      municipio: texto(r.municipio),
      opcao_simples: r.opcao_pelo_simples ?? null,
      data_exclusao_simples: data(r.data_exclusao_do_simples),
    }
  },
}

/**
 * (3) ReceitaWS free — ÚLTIMO RECURSO. 3 requisições por minuto no plano
 * gratuito, então leva throttle rígido (o intervalo vem da config). Usar isto
 * como primeira opção travaria a fila inteira em 180 CNPJs por hora.
 */
function receitaWs(intervaloMs: number): ProvedorCadastro {
  return {
    nome: 'receitaws',
    intervaloMs,
    buscar: async (cnpj) => {
      interface Atividade {
        code?: string
      }
      interface Resp {
        status?: string
        nome?: string
        fantasia?: string
        situacao?: string
        natureza_juridica?: string
        porte?: string
        atividade_principal?: Atividade[]
        atividades_secundarias?: Atividade[]
        capital_social?: string
        abertura?: string
        uf?: string
        municipio?: string
        simples?: { optante?: boolean | null; ultima_atualizacao?: string | null } | null
      }
      const r = await requisitarJson<Resp>(`https://receitaws.com.br/v1/cnpj/${cnpj}`, {
        tentativas: 1,
        timeoutMs: 25_000,
      })
      if (r.status === 'ERROR') return null
      const principal = digitos(r.atividade_principal?.[0]?.code)
      const secundarios = (r.atividades_secundarias ?? [])
        .map((a) => digitos(a.code))
        .filter((c): c is string => c !== null)
      return {
        cnpj,
        razao_social: texto(r.nome),
        nome_fantasia: texto(r.fantasia),
        situacao_cadastral: situacao(r.situacao),
        // A ReceitaWS devolve a natureza por extenso ("206-2 - Sociedade
        // Empresária Limitada"); só o código interessa.
        natureza_juridica: digitos(r.natureza_juridica?.split('-')[0]),
        porte_rfb: porte(r.porte),
        cnae_principal: principal,
        cnaes_todos: [principal, ...secundarios].filter((c): c is string => c !== null),
        capital_social: numero(r.capital_social),
        data_inicio_atividade: data(r.abertura),
        uf: texto(r.uf),
        municipio: texto(r.municipio),
        opcao_simples: r.simples?.optante ?? null,
        data_exclusao_simples: null,
      }
    },
  }
}

function porte(valor: unknown): string | null {
  const s = texto(valor)?.toUpperCase()
  if (!s) return null
  if (s.includes('MICRO')) return 'ME'
  if (s.includes('PEQUENO')) return 'EPP'
  return 'DEMAIS'
}

// ─── O job ──────────────────────────────────────────────────────────────────

export interface ResultadoLookup {
  processados: number
  resolvidos: number
  nao_encontrados: number
  erros: number
  por_provedor: Record<string, number>
}

export async function lookupCadastral(): Promise<ResultadoLookup> {
  const cfg = await lerConfigLookup()
  const provedores: ProvedorCadastro[] = [minhaReceita, brasilApi, receitaWs(cfg.receitaws_intervalo_ms)]
  const pacers = new Map(provedores.map((p) => [p.nome, criarPacer(p.intervaloMs)]))

  // Prioridade para as pendências MAIS RECENTES: um CNPJ que acabou de aparecer
  // numa nota é o que alguém está olhando agora. As antigas são re-tentadas em
  // toda execução mesmo assim — só depois.
  const { data: fila } = await supabaseAdmin
    .from('cnpj_lookup_fila')
    .select('cnpj, tentativas')
    .in('status', ['pendente', 'erro'])
    .lt('tentativas', cfg.max_tentativas)
    .order('criado_em', { ascending: false })
    .limit(cfg.max_por_execucao)

  const acc: ResultadoLookup = {
    processados: 0,
    resolvidos: 0,
    nao_encontrados: 0,
    erros: 0,
    por_provedor: {},
  }
  if (!fila?.length) return acc

  for (const item of fila) {
    acc.processados++
    let resolvido: CadastroNormalizado | null = null
    let provedorUsado: string | null = null
    let ultimoErro: string | null = null
    let respondeuVazio = false

    for (const p of provedores) {
      try {
        await pacers.get(p.nome)?.()
        const r = await p.buscar(item.cnpj)
        provedorUsado = p.nome
        if (r) {
          resolvido = r
          break
        }
        // A fonte respondeu e não conhece o CNPJ. Ainda assim tentamos a próxima:
        // as bases não são idênticas, e um CNPJ novo pode estar só numa delas.
        respondeuVazio = true
      } catch (erro) {
        // 404 é "não existe", não é falha da fonte — e não vale re-tentar amanhã.
        if (erro instanceof HttpError && erro.status === 404) {
          respondeuVazio = true
          provedorUsado = p.nome
          continue
        }
        ultimoErro = erro instanceof Error ? erro.message : String(erro)
        logger.warn({ cnpj: item.cnpj, provedor: p.nome, erro: ultimoErro }, 'Provedor de cadastro falhou.')
      }
    }

    if (resolvido) {
      // A fila só é marcada resolvida se a linha DE FATO entrou no universo.
      // Marcar sobre uma escrita que falhou é o que transforma uma falha
      // transitória em invisibilidade permanente: o CNPJ nunca mais é re-tentado
      // e some de toda tela que dependa do cadastro dele.
      const gravou = await gravarNoUniverso(resolvido)

      await supabaseAdmin
        .from('cnpj_lookup_fila')
        .update(
          gravou
            ? {
                status: 'resolvido_api',
                tentativas: item.tentativas + 1,
                ultimo_provedor: provedorUsado,
                ultimo_erro: null,
                resolvido_em: new Date().toISOString(),
              }
            : {
                status: 'erro',
                tentativas: item.tentativas + 1,
                ultimo_provedor: provedorUsado,
                ultimo_erro: 'Provedor respondeu, mas a gravação em mercado_universo falhou.',
              },
        )
        .eq('cnpj', item.cnpj)

      if (gravou) {
        acc.resolvidos++
        if (provedorUsado) acc.por_provedor[provedorUsado] = (acc.por_provedor[provedorUsado] ?? 0) + 1
      } else {
        acc.erros++
      }
      continue
    }

    const tentativas = item.tentativas + 1
    const esgotou = tentativas >= cfg.max_tentativas

    // Só marca `nao_encontrado` quando ALGUMA fonte respondeu dizendo que não
    // conhece — ou quando as tentativas acabaram. Um dia de rede ruim não pode
    // condenar um CNPJ a nunca mais ser consultado.
    const status = respondeuVazio || esgotou ? 'nao_encontrado' : 'erro'
    await supabaseAdmin
      .from('cnpj_lookup_fila')
      .update({ status, tentativas, ultimo_provedor: provedorUsado, ultimo_erro: ultimoErro })
      .eq('cnpj', item.cnpj)

    if (status === 'nao_encontrado') {
      acc.nao_encontrados++
      if (esgotou) {
        await emitirEvento(null, EVENTO_TIPOS.CNPJ_LOOKUP_NAO_ENCONTRADO, {
          titulo: 'CNPJ sem dado cadastral',
          resumo: `${item.cnpj} não foi encontrado em nenhum provedor após ${tentativas} tentativas. Revisar manualmente.`,
          url: '/antecipacao/config',
          cnpj: item.cnpj,
        })
      }
    } else {
      acc.erros++
    }
  }

  logger.info(acc, 'Lookup cadastral concluído.')
  return acc
}

/**
 * Entra em `mercado_universo` — não numa tabela nova. É isto que faz o resto do
 * sistema (Explorador, filter engine, Company 360) enxergar o fornecedor sem
 * código novo. `fora_recorte_cnae` é o que impede que ele suba na pirâmide.
 *
 * `cnaes_todos` e `cnae_grupos` são colunas GENERATED ALWAYS (migration 0011):
 * escrever nelas faz o Postgres rejeitar a linha inteira com 428C9. Só se grava
 * `cnae_principal` e `cnaes_secundarios`; as derivadas saem sozinhas. A primeira
 * versão escrevia as duas e falhava em 100% dos casos — em silêncio, porque o
 * erro só ia para o log e a fila era marcada como resolvida assim mesmo.
 *
 * Devolve se GRAVOU. Quem chama depende disso: marcar `resolvido_api` sobre uma
 * escrita que falhou é o que transforma uma falha transitória em invisibilidade
 * permanente.
 */
async function gravarNoUniverso(c: CadastroNormalizado): Promise<boolean> {
  const divisoes = [...new Set(c.cnaes_todos.map((x) => x.slice(0, 2)))]
  const foraDoRecorte = !divisoes.some((d) => DIVISOES_CONSTRUCAO.has(d))
  const secundarios = c.cnaes_todos.filter((x) => x !== c.cnae_principal)

  const { error } = await supabaseAdmin.from('mercado_universo').upsert(
    {
      cnpj: c.cnpj,
      // A raiz (8 primeiros dígitos) é o que amarra matriz e filiais e o que o
      // detector de SPE e o montador de grupos agrupam. Não é derivada por
      // trigger — quem insere é responsável por ela.
      cnpj_raiz: c.cnpj.slice(0, 8),
      razao_social: c.razao_social,
      nome_fantasia: c.nome_fantasia,
      situacao_cadastral: c.situacao_cadastral,
      natureza_juridica: c.natureza_juridica,
      porte_rfb: c.porte_rfb,
      cnae_principal: c.cnae_principal,
      cnaes_secundarios: secundarios.length > 0 ? secundarios : null,
      capital_social: c.capital_social,
      data_inicio_atividade: c.data_inicio_atividade,
      uf: c.uf,
      municipio: c.municipio,
      opcao_simples: c.opcao_simples,
      data_exclusao_simples: c.data_exclusao_simples,
      origem_ingestao: 'lookup',
      fora_recorte_cnae: foraDoRecorte,
    },
    { onConflict: 'cnpj' },
  )

  if (error) {
    logger.error({ cnpj: c.cnpj, erro: error.message }, 'Falha ao gravar cadastro no universo.')
    return false
  }
  return true
}
