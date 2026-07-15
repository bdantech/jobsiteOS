import type pg from 'pg'
import { env, mesCorrente } from '../env.js'
import { logger } from '../logger.js'
import { baixarComRetentativa } from '../net/download.js'
import { atualizarIngestao, anotarMeta } from '../ingestoes.js'
import { copiarLinhas, type ValorCopia } from '../pg/copy.js'
import { lerLinhas } from '../rfb/leitura.js'
import * as L from '../rfb/layout.js'
import { arquivosDeAmostra } from '../sample/fixtures.js'

/**
 * The Receita Federal CNPJ dump (§3.1). ~5 GB zipped, ~40 GB of CSV, published
 * monthly. This is the reason apps/worker exists at all: it cannot run inside a
 * Vercel function, not for lack of skill but for lack of minutes and memory.
 */

export interface OpcoesReceita {
  sample?: boolean
  fallback?: boolean
}

export interface ArquivosReceita {
  empresas: string[]
  estabelecimentos: string[]
  socios: string[]
  simples: string
  municipios: string
  naturezas: string
}

export interface ResultadoReceita {
  linhas_processadas: number
  linhas_novas: number
  linhas_atualizadas: number
  estabelecimentos_no_recorte: number
  raizes_no_recorte: number
  raizes_socias_pj: number
  socios: number
}

// ─── Download ───────────────────────────────────────────────────────────────

async function baixarTudo(ingestaoId: string, fallback: boolean): Promise<ArquivosReceita> {
  const base = fallback ? env.RECEITA_FALLBACK_URL : env.RECEITA_BASE_URL
  const mes = mesCorrente()
  const raiz = `${base.replace(/\/+$/, '')}/${mes}`

  logger.info({ mes, fallback }, 'Baixando o dump da Receita.')
  await anotarMeta(ingestaoId, { mes, fonte_url: raiz, fallback })

  // Every attempt of every file bumps `tentativa`, so the Ingestões page shows
  // how hard this run had to fight for the data.
  const onTentativa = async (tentativa: number): Promise<void> => {
    if (tentativa > 1) await atualizarIngestao(ingestaoId, { tentativa })
  }

  const partes = Array.from({ length: env.RECEITA_PARTES }, (_, i) => i)

  // Sequential, not parallel: the RFB server throttles hard, and ten concurrent
  // 700 MB streams is the fastest way to get every one of them killed.
  const baixar = (nome: string): Promise<string> =>
    baixarComRetentativa(`${raiz}/${nome}`, `${mes}/${nome}`, { onTentativa })

  const empresas: string[] = []
  for (const i of partes) empresas.push(await baixar(`Empresas${i}.zip`))

  const estabelecimentos: string[] = []
  for (const i of partes) estabelecimentos.push(await baixar(`Estabelecimentos${i}.zip`))

  const socios: string[] = []
  for (const i of partes) socios.push(await baixar('Socios' + i + '.zip'))

  return {
    empresas,
    estabelecimentos,
    socios,
    simples: await baixar('Simples.zip'),
    municipios: await baixar('Municipios.zip'),
    naturezas: await baixar('Naturezas.zip'),
  }
}

// ─── Tabelas de domínio ─────────────────────────────────────────────────────

async function carregarDominio(caminho: string): Promise<Map<string, string>> {
  const mapa = new Map<string, string>()
  for await (const linha of lerLinhas(caminho)) {
    const codigo = L.texto(linha[L.DOMINIO.codigo])
    const descricao = L.texto(linha[L.DOMINIO.descricao])
    if (codigo && descricao) mapa.set(codigo.replace(/^0+/, ''), descricao)
  }
  return mapa
}

/** RFB municipality codes are its own, not IBGE's — the name is what a human filters on. */
function municipio(codigo: string | undefined, mapa: Map<string, string>): string | null {
  const c = L.texto(codigo)
  if (!c) return null
  return mapa.get(c.replace(/^0+/, '')) ?? c
}

/** "2062 - SOCIEDADE EMPRESARIA LIMITADA": the code stays greppable, the name readable. */
function naturezaJuridica(codigo: string | undefined, mapa: Map<string, string>): string | null {
  const c = L.texto(codigo)
  if (!c) return null
  const nome = mapa.get(c.replace(/^0+/, ''))
  return nome ? `${c} - ${nome}` : c
}

// ─── Staging ────────────────────────────────────────────────────────────────

const COLS_ESTAB = [
  'cnpj',
  'cnpj_raiz',
  'matriz_filial',
  'nome_fantasia',
  'situacao_cadastral',
  'situacao_data',
  'situacao_motivo',
  'cnae_principal',
  'cnaes_secundarios',
  'data_inicio_atividade',
  'uf',
  'municipio',
  'cep',
  'logradouro',
  'numero',
  'bairro',
  'email_rfb',
  'telefone1_rfb',
  'telefone2_rfb',
] as const

const COLS_EMPRESA = ['cnpj_raiz', 'razao_social', 'natureza_juridica', 'capital_social', 'porte_rfb'] as const
const COLS_SIMPLES = [
  'cnpj_raiz',
  'opcao_simples',
  'data_opcao_simples',
  'data_exclusao_simples',
  'opcao_mei',
] as const
const COLS_SOCIO = [
  'cnpj_raiz',
  'tipo_socio',
  'cpf_cnpj_socio',
  'nome_socio',
  'qualificacao',
  'data_entrada',
  'faixa_etaria',
] as const

async function criarStaging(client: pg.Client): Promise<void> {
  // TEMP, on a dedicated session: they die with the connection, they are invisible
  // to PostgREST, and the `ensure_rls` event trigger skips pg_temp — so there is no
  // window where 2M unprotected rows sit in `public`.
  await client.query(`
    create temp table stg_estab (
      cnpj text, cnpj_raiz text, matriz_filial text, nome_fantasia text,
      situacao_cadastral text, situacao_data date, situacao_motivo text,
      cnae_principal text, cnaes_secundarios text, data_inicio_atividade date,
      uf text, municipio text, cep text, logradouro text, numero text, bairro text,
      email_rfb text, telefone1_rfb text, telefone2_rfb text
    );
    create temp table stg_empresa (
      cnpj_raiz text, razao_social text, natureza_juridica text,
      capital_social numeric(16,2), porte_rfb text
    );
    create temp table stg_simples (
      cnpj_raiz text, opcao_simples boolean, data_opcao_simples date,
      data_exclusao_simples date, opcao_mei boolean
    );
    create temp table stg_socio (
      cnpj_raiz text, tipo_socio text, cpf_cnpj_socio text, nome_socio text,
      qualificacao text, data_entrada date, faixa_etaria text
    );
  `)
}

// ─── As passadas ────────────────────────────────────────────────────────────

/**
 * Pass 1 — Estabelecimentos, filtered to the construction cut: CNAE division
 * 41, 42 or 43 as principal OR secundário. Row-level, as the spec defines it.
 * Collects the raízes it kept, which is what every later pass filters on.
 */
async function passarEstabelecimentos(
  client: pg.Client,
  arquivos: readonly string[],
  municipios: Map<string, string>,
  aceitar: (raiz: string, linha: string[]) => boolean,
  raizesVistas: Set<string>,
): Promise<{ lidas: number; copiadas: number }> {
  let lidas = 0

  const linhas = (async function* (): AsyncGenerator<readonly ValorCopia[]> {
    for (const arquivo of arquivos) {
      for await (const l of lerLinhas(arquivo)) {
        lidas++
        const raiz = L.raizDe(l[L.ESTABELECIMENTOS.cnpj_basico])
        if (!raiz) continue
        if (!aceitar(raiz, l)) continue

        const cnpj = L.montarCnpj(
          l[L.ESTABELECIMENTOS.cnpj_basico],
          l[L.ESTABELECIMENTOS.cnpj_ordem],
          l[L.ESTABELECIMENTOS.cnpj_dv],
        )
        if (!cnpj) continue

        raizesVistas.add(raiz)

        yield [
          cnpj,
          raiz,
          L.matrizOuFilial(l[L.ESTABELECIMENTOS.matriz_filial]),
          L.texto(l[L.ESTABELECIMENTOS.nome_fantasia]),
          L.situacaoCadastral(l[L.ESTABELECIMENTOS.situacao_cadastral]),
          L.data(l[L.ESTABELECIMENTOS.data_situacao]),
          L.texto(l[L.ESTABELECIMENTOS.motivo_situacao]),
          L.texto(l[L.ESTABELECIMENTOS.cnae_principal]),
          L.listaCnaes(l[L.ESTABELECIMENTOS.cnaes_secundarios]).join(','),
          L.data(l[L.ESTABELECIMENTOS.data_inicio_atividade]),
          L.texto(l[L.ESTABELECIMENTOS.uf]),
          municipio(l[L.ESTABELECIMENTOS.municipio], municipios),
          L.texto(l[L.ESTABELECIMENTOS.cep]),
          [L.texto(l[L.ESTABELECIMENTOS.tipo_logradouro]), L.texto(l[L.ESTABELECIMENTOS.logradouro])]
            .filter(Boolean)
            .join(' ') || null,
          L.texto(l[L.ESTABELECIMENTOS.numero]),
          L.texto(l[L.ESTABELECIMENTOS.bairro]),
          L.texto(l[L.ESTABELECIMENTOS.email]),
          telefone(l[L.ESTABELECIMENTOS.ddd1], l[L.ESTABELECIMENTOS.telefone1]),
          telefone(l[L.ESTABELECIMENTOS.ddd2], l[L.ESTABELECIMENTOS.telefone2]),
        ]
      }
    }
  })()

  const copiadas = await copiarLinhas(client, 'stg_estab', COLS_ESTAB, linhas)
  return { lidas, copiadas }
}

function telefone(ddd: string | undefined, numero: string | undefined): string | null {
  const d = L.texto(ddd)
  const n = L.texto(numero)
  if (!n) return null
  return d ? `${d}${n}` : n
}

/** Pass 2 — Sócios of the raízes in the cut. Reports the sócio-PJ raízes it saw. */
async function passarSocios(
  client: pg.Client,
  arquivos: readonly string[],
  interessa: (raiz: string) => boolean,
  onSocioPj: (raiz: string) => void,
): Promise<{ lidas: number; copiadas: number }> {
  let lidas = 0

  const linhas = (async function* (): AsyncGenerator<readonly ValorCopia[]> {
    for (const arquivo of arquivos) {
      for await (const l of lerLinhas(arquivo)) {
        lidas++
        const raiz = L.raizDe(l[L.SOCIOS.cnpj_basico])
        if (!raiz || !interessa(raiz)) continue

        const tipo = L.tipoSocio(l[L.SOCIOS.identificador])
        const documento = (l[L.SOCIOS.cpf_cnpj_socio] ?? '').replace(/\D/g, '')

        if (tipo === 'PJ' && documento.length === 14) {
          const raizSocia = documento.slice(0, 8)
          if (raizSocia !== raiz) onSocioPj(raizSocia)
        }

        yield [
          raiz,
          tipo,
          L.texto(l[L.SOCIOS.cpf_cnpj_socio]),
          L.texto(l[L.SOCIOS.nome_socio]),
          L.texto(l[L.SOCIOS.qualificacao]),
          L.data(l[L.SOCIOS.data_entrada]),
          L.texto(l[L.SOCIOS.faixa_etaria]),
        ]
      }
    }
  })()

  const copiadas = await copiarLinhas(client, 'stg_socio', COLS_SOCIO, linhas)
  return { lidas, copiadas }
}

async function passarEmpresas(
  client: pg.Client,
  arquivos: readonly string[],
  naturezas: Map<string, string>,
  interessa: (raiz: string) => boolean,
): Promise<number> {
  const linhas = (async function* (): AsyncGenerator<readonly ValorCopia[]> {
    for (const arquivo of arquivos) {
      for await (const l of lerLinhas(arquivo)) {
        const raiz = L.raizDe(l[L.EMPRESAS.cnpj_basico])
        if (!raiz || !interessa(raiz)) continue

        yield [
          raiz,
          L.texto(l[L.EMPRESAS.razao_social]),
          naturezaJuridica(l[L.EMPRESAS.natureza_juridica], naturezas),
          L.numero(l[L.EMPRESAS.capital_social]),
          L.porte(l[L.EMPRESAS.porte]),
        ]
      }
    }
  })()

  return copiarLinhas(client, 'stg_empresa', COLS_EMPRESA, linhas)
}

async function passarSimples(
  client: pg.Client,
  arquivo: string,
  interessa: (raiz: string) => boolean,
): Promise<number> {
  const linhas = (async function* (): AsyncGenerator<readonly ValorCopia[]> {
    for await (const l of lerLinhas(arquivo)) {
      const raiz = L.raizDe(l[L.SIMPLES.cnpj_basico])
      if (!raiz || !interessa(raiz)) continue

      yield [
        raiz,
        L.sim(l[L.SIMPLES.opcao_simples]),
        L.data(l[L.SIMPLES.data_opcao_simples]),
        L.data(l[L.SIMPLES.data_exclusao_simples]),
        L.sim(l[L.SIMPLES.opcao_mei]),
      ]
    }
  })()

  return copiarLinhas(client, 'stg_simples', COLS_SIMPLES, linhas)
}

// ─── Upsert ─────────────────────────────────────────────────────────────────

/**
 * `xmax = 0` is Postgres telling us the row was INSERTed rather than UPDATEd by
 * ON CONFLICT — the only way to count new vs. updated without a second pass over
 * 2M rows.
 *
 * The update list deliberately omits camada, camada_regra_versao, grupo_id, is_spe
 * and empresa_id: those belong to the derived jobs and to promotion. An ingestion
 * that reset them would un-promote every company in the base, every month.
 */
async function upsertUniverso(client: pg.Client): Promise<{ novas: number; atualizadas: number }> {
  const { rows } = await client.query<{ novas: number; atualizadas: number }>(
    `with dados as (
       select distinct on (e.cnpj)
         e.cnpj, e.cnpj_raiz, emp.razao_social, e.nome_fantasia, e.matriz_filial,
         emp.natureza_juridica, e.situacao_cadastral, e.situacao_data, e.situacao_motivo,
         e.cnae_principal,
         nullif(string_to_array(nullif(e.cnaes_secundarios, ''), ','), '{}') as cnaes_secundarios,
         e.data_inicio_atividade, emp.capital_social, emp.porte_rfb,
         s.opcao_simples, s.data_opcao_simples, s.data_exclusao_simples, s.opcao_mei,
         e.uf, e.municipio, e.cep, e.logradouro, e.numero, e.bairro,
         e.email_rfb, e.telefone1_rfb, e.telefone2_rfb
       from stg_estab e
       left join stg_empresa emp on emp.cnpj_raiz = e.cnpj_raiz
       left join stg_simples s   on s.cnpj_raiz   = e.cnpj_raiz
       order by e.cnpj
     ),
     up as (
       insert into mercado_universo (
         cnpj, cnpj_raiz, razao_social, nome_fantasia, matriz_filial, natureza_juridica,
         situacao_cadastral, situacao_data, situacao_motivo, cnae_principal, cnaes_secundarios,
         data_inicio_atividade, capital_social, porte_rfb, opcao_simples, data_opcao_simples,
         data_exclusao_simples, opcao_mei, uf, municipio, cep, logradouro, numero, bairro,
         email_rfb, telefone1_rfb, telefone2_rfb
       )
       select * from dados
       on conflict (cnpj) do update set
         cnpj_raiz             = excluded.cnpj_raiz,
         razao_social          = excluded.razao_social,
         nome_fantasia         = excluded.nome_fantasia,
         matriz_filial         = excluded.matriz_filial,
         natureza_juridica     = excluded.natureza_juridica,
         situacao_cadastral    = excluded.situacao_cadastral,
         situacao_data         = excluded.situacao_data,
         situacao_motivo       = excluded.situacao_motivo,
         cnae_principal        = excluded.cnae_principal,
         cnaes_secundarios     = excluded.cnaes_secundarios,
         data_inicio_atividade = excluded.data_inicio_atividade,
         capital_social        = excluded.capital_social,
         porte_rfb             = excluded.porte_rfb,
         opcao_simples         = excluded.opcao_simples,
         data_opcao_simples    = excluded.data_opcao_simples,
         data_exclusao_simples = excluded.data_exclusao_simples,
         opcao_mei             = excluded.opcao_mei,
         uf                    = excluded.uf,
         municipio             = excluded.municipio,
         cep                   = excluded.cep,
         logradouro            = excluded.logradouro,
         numero                = excluded.numero,
         bairro                = excluded.bairro,
         email_rfb             = excluded.email_rfb,
         telefone1_rfb         = excluded.telefone1_rfb,
         telefone2_rfb         = excluded.telefone2_rfb,
         atualizado_em         = now()
       returning (xmax = 0) as nova
     )
     select
       count(*) filter (where nova)::int     as novas,
       count(*) filter (where not nova)::int as atualizadas
     from up`,
  )

  return rows[0] ?? { novas: 0, atualizadas: 0 }
}

/**
 * The QSA is a SNAPSHOT, not a ledger: a sócio who left must disappear, or the
 * grupo assembly keeps an ownership edge that no longer exists. So the sócios of
 * every raiz in this run are deleted and rewritten.
 *
 * mercado_socios.cnpj is a 14-digit CNPJ (FK to mercado_universo), but the RFB
 * publishes the QSA per RAIZ. It is attached to the matriz — or, when the matriz
 * is not in the cut, to the lowest CNPJ of that raiz that is.
 */
async function upsertSocios(client: pg.Client): Promise<number> {
  await client.query(`
    create temp table stg_socio_cnpj as
    select distinct on (cnpj_raiz) cnpj_raiz, cnpj
    from stg_estab
    order by cnpj_raiz, (matriz_filial = 'matriz') desc nulls last, cnpj;

    create unique index on stg_socio_cnpj (cnpj_raiz);
  `)

  await client.query(
    `delete from mercado_socios s
     where exists (select 1 from stg_socio_cnpj c where c.cnpj = s.cnpj)`,
  )

  const { rowCount } = await client.query(
    `insert into mercado_socios (cnpj, tipo_socio, cpf_cnpj_socio, nome_socio, qualificacao, data_entrada, faixa_etaria)
     select c.cnpj, s.tipo_socio, s.cpf_cnpj_socio, s.nome_socio, s.qualificacao, s.data_entrada, s.faixa_etaria
     from stg_socio s
     join stg_socio_cnpj c on c.cnpj_raiz = s.cnpj_raiz`,
  )

  return rowCount ?? 0
}

// ─── O job ──────────────────────────────────────────────────────────────────

export async function ingerirReceita(
  client: pg.Client,
  ingestaoId: string,
  opcoes: OpcoesReceita,
): Promise<ResultadoReceita> {
  const arquivos = opcoes.sample ? await arquivosDeAmostra() : await baixarTudo(ingestaoId, !!opcoes.fallback)

  const municipios = await carregarDominio(arquivos.municipios)
  const naturezas = await carregarDominio(arquivos.naturezas)
  logger.info({ municipios: municipios.size, naturezas: naturezas.size }, 'Tabelas de domínio carregadas.')

  await criarStaging(client)

  // ── Passada 1: o recorte da construção ────────────────────────────────────
  const raizes = new Set<string>()
  const estab1 = await passarEstabelecimentos(
    client,
    arquivos.estabelecimentos,
    municipios,
    (_raiz, l) =>
      L.noRecorteConstrucao(l[L.ESTABELECIMENTOS.cnae_principal], l[L.ESTABELECIMENTOS.cnaes_secundarios]),
    raizes,
  )
  logger.info(
    { lidas: estab1.lidas, copiadas: estab1.copiadas, raizes: raizes.size },
    'Estabelecimentos no recorte da construção.',
  )
  await anotarMeta(ingestaoId, {
    estabelecimentos_lidos: estab1.lidas,
    estabelecimentos_no_recorte: estab1.copiadas,
    raizes_no_recorte: raizes.size,
  })

  // ── Passada 2: sócios do recorte, e quem são os sócios-PJ ─────────────────
  // The holding that owns the SPEs is very often NOT a construction CNAE — it is
  // a 6462 holding. Without this second pass the grupo econômico would be a set of
  // SPEs with no head, and the whole point of §3.2 (an incorporadora is a group,
  // not a CNPJ) would be lost.
  const raizesSocias = new Set<string>()
  const socios1 = await passarSocios(
    client,
    arquivos.socios,
    (raiz) => raizes.has(raiz),
    (raizSocia) => {
      if (!raizes.has(raizSocia)) raizesSocias.add(raizSocia)
    },
  )
  logger.info({ copiadas: socios1.copiadas, raizes_socias: raizesSocias.size }, 'Sócios do recorte.')

  // ── Passada 3: os estabelecimentos dessas sócias-PJ ───────────────────────
  let estab2 = { lidas: 0, copiadas: 0 }
  let socios2 = { lidas: 0, copiadas: 0 }
  if (raizesSocias.size > 0) {
    estab2 = await passarEstabelecimentos(
      client,
      arquivos.estabelecimentos,
      municipios,
      (raiz) => raizesSocias.has(raiz),
      raizes,
    )
    // …and their own QSA, so the TOP of the ownership chain is reachable.
    socios2 = await passarSocios(
      client,
      arquivos.socios,
      (raiz) => raizesSocias.has(raiz),
      () => {},
    )
  }

  const noRecorte = (raiz: string): boolean => raizes.has(raiz) || raizesSocias.has(raiz)

  // ── Cadastro e Simples, só do que ficou ───────────────────────────────────
  const empresas = await passarEmpresas(client, arquivos.empresas, naturezas, noRecorte)
  const simples = await passarSimples(client, arquivos.simples, noRecorte)
  logger.info({ empresas, simples }, 'Cadastro e Simples carregados.')

  await client.query('create index on stg_estab (cnpj_raiz)')
  await client.query('create index on stg_empresa (cnpj_raiz)')
  await client.query('create index on stg_simples (cnpj_raiz)')
  await client.query('create index on stg_socio (cnpj_raiz)')
  await client.query('analyze stg_estab, stg_empresa, stg_simples, stg_socio')

  const { novas, atualizadas } = await upsertUniverso(client)
  const socios = await upsertSocios(client)

  const resultado: ResultadoReceita = {
    linhas_processadas: estab1.lidas + estab2.lidas + socios1.lidas + socios2.lidas,
    linhas_novas: novas,
    linhas_atualizadas: atualizadas,
    estabelecimentos_no_recorte: estab1.copiadas + estab2.copiadas,
    raizes_no_recorte: raizes.size,
    raizes_socias_pj: raizesSocias.size,
    socios,
  }

  logger.info(resultado, 'Universo atualizado.')
  return resultado
}
