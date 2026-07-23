import type pg from 'pg'
import { env } from '../env.js'
import { logger } from '../logger.js'
import { baixarComRetentativa } from '../net/download.js'
import { atualizarIngestao, anotarMeta } from '../ingestoes.js'
import { copiarLinhas, type ValorCopia } from '../pg/copy.js'
import { lerRegistros } from '../rfb/leitura.js'
import * as L from '../rfb/layout.js'
import { arquivoCnoDeAmostra } from '../sample/fixtures.js'

/**
 * CNO — Cadastro Nacional de Obras (§3.3).
 *
 * The single best "they are building RIGHT NOW" signal we can get for free: an
 * active obra with m² attached. It is what lifts a company from SAM to SOM.
 *
 * The CNO dump, unlike the CNPJ one, DOES carry a header row — and its column
 * names are not stable across releases (and differ again on the mirrors). So the
 * reader normalizes the header and matches on ALIASES rather than on position: a
 * renamed column degrades one field to null instead of shifting every field by one
 * and silently loading garbage.
 */

export interface OpcoesCno {
  sample?: boolean
  fallback?: boolean
}

export interface ResultadoCno {
  linhas_processadas: number
  linhas_novas: number
  linhas_atualizadas: number
  obras_fora_do_universo: number
}

const ALIASES: Record<string, readonly string[]> = {
  cno: ['cno', 'n_inscricao_cno', 'numero_cno', 'codigo_cno', 'ni_cno', 'inscricao_cno'],
  ni_responsavel: [
    'ni_responsavel',
    'ni',
    'cpf_cnpj_responsavel',
    'ni_do_responsavel',
    'cnpj_cpf_responsavel',
    'responsavel',
  ],
  tipo_responsabilidade: [
    'tipo_de_responsabilidade',
    'tipo_responsabilidade',
    'qualificacao_do_responsavel',
    'qualificacao_responsavel',
  ],
  situacao: ['situacao', 'situacao_cno', 'situacao_da_obra'],
  data_situacao: ['data_da_situacao', 'data_situacao'],
  data_inicio_obra: ['data_de_inicio', 'data_inicio', 'data_inicio_obra'],
  uf: ['uf', 'sigla_uf', 'estado'],
  municipio: ['municipio', 'nome_do_municipio', 'nome_municipio', 'cidade'],
  bairro: ['bairro'],
  cep: ['cep'],
  destinacao: ['destinacao', 'destinacao_obra', 'finalidade'],
  categoria: ['categoria', 'categoria_obra'],
  tipo_obra: ['tipo_de_obra', 'tipo_obra'],
  metragem_m2: ['area_total', 'metragem_m2', 'area', 'area_construida', 'metros_quadrados'],
  cno_vinculado: ['cno_vinculado', 'cno_principal', 'vinculado'],
}

function campo(registro: Record<string, string>, chave: string): string | undefined {
  for (const alias of ALIASES[chave] ?? []) {
    const v = registro[alias]
    if (v !== undefined && v.trim() !== '') return v
  }
  return undefined
}

const COLS = [
  'cno',
  'ni_responsavel',
  'tipo_responsabilidade',
  'situacao',
  'data_situacao',
  'data_inicio_obra',
  'uf',
  'municipio',
  'bairro',
  'cep',
  'destinacao',
  'categoria',
  'tipo_obra',
  'metragem_m2',
  'cno_vinculado',
  'raw',
] as const

/**
 * The obras we care about: those whose responsible party shares a CNPJ raiz with
 * something already in the universe or in `empresas`. Everything else is the other
 * 99% of the country's construction — reforms by individuals, mostly — and loading
 * it would grow the table by an order of magnitude for no reachable company.
 */
async function raizesConhecidas(client: pg.Client): Promise<Set<string>> {
  const { rows } = await client.query<{ raiz: string }>(
    `select distinct cnpj_raiz as raiz from mercado_universo
     union
     select distinct left(cnpj, 8) from empresas`,
  )
  return new Set(rows.map((r) => r.raiz))
}

export async function ingerirCno(
  client: pg.Client,
  ingestaoId: string,
  opcoes: OpcoesCno,
): Promise<ResultadoCno> {
  const url = opcoes.fallback
    ? `${env.RECEITA_FALLBACK_URL.replace(/\/+$/, '')}/cno.zip`
    : env.CNO_SOURCE_URL

  const arquivo = opcoes.sample
    ? await arquivoCnoDeAmostra()
    : await baixarComRetentativa(url, 'cno/cno.zip', {
        token: env.CNO_SHARE_TOKEN,
        onTentativa: async (tentativa) => {
          if (tentativa > 1) await atualizarIngestao(ingestaoId, { tentativa })
        },
      })

  if (!opcoes.sample) await anotarMeta(ingestaoId, { fonte_url: url, fallback: !!opcoes.fallback })

  const raizes = await raizesConhecidas(client)
  logger.info({ raizes: raizes.size }, 'Raízes conhecidas para casar com o CNO.')

  await client.query(`
    create temp table stg_obra (
      cno text, ni_responsavel text, tipo_responsabilidade text, situacao text,
      data_situacao date, data_inicio_obra date, uf text, municipio text, bairro text,
      cep text, destinacao text, categoria text, tipo_obra text, metragem_m2 numeric(12,2),
      cno_vinculado text, raw jsonb
    );
  `)

  let lidas = 0
  let fora = 0

  const linhas = (async function* (): AsyncGenerator<readonly ValorCopia[]> {
    for await (const registro of lerRegistros(arquivo, (nome) => nome === 'cno.csv')) {
      lidas++

      const cno = (campo(registro, 'cno') ?? '').replace(/\D/g, '')
      const ni = (campo(registro, 'ni_responsavel') ?? '').replace(/\D/g, '')
      if (!cno || !ni) continue

      // Only CNPJ responsáveis can match a company. A CPF (11 digits) is a person
      // building their own house.
      const raiz = ni.length === 14 ? ni.slice(0, 8) : null
      if (!raiz || !raizes.has(raiz)) {
        fora++
        continue
      }

      yield [
        cno,
        ni,
        L.texto(campo(registro, 'tipo_responsabilidade')),
        L.texto(campo(registro, 'situacao')),
        L.data(campo(registro, 'data_situacao')),
        L.data(campo(registro, 'data_inicio_obra')),
        L.texto(campo(registro, 'uf')),
        L.texto(campo(registro, 'municipio')),
        L.texto(campo(registro, 'bairro')),
        L.texto(campo(registro, 'cep')),
        L.texto(campo(registro, 'destinacao')),
        L.texto(campo(registro, 'categoria')),
        L.texto(campo(registro, 'tipo_obra')),
        L.numeroPonto(campo(registro, 'metragem_m2')),
        L.texto(campo(registro, 'cno_vinculado')),
        // The full source record. When a field we ignored today turns out to
        // matter, it is already here and nobody re-downloads 3 GB.
        JSON.stringify(registro),
      ]
    }
  })()

  const copiadas = await copiarLinhas(client, 'stg_obra', COLS, linhas)
  logger.info({ lidas, copiadas, fora }, 'CNO filtrado para o universo.')

  const { rows } = await client.query<{ novas: number; atualizadas: number }>(
    `with dados as (
       select distinct on (cno) * from stg_obra order by cno, data_situacao desc nulls last
     ),
     up as (
       insert into mercado_obras (
         cno, ni_responsavel, tipo_responsabilidade, situacao, data_situacao, data_inicio_obra,
         uf, municipio, bairro, cep, destinacao, categoria, tipo_obra, metragem_m2,
         cno_vinculado, raw
       )
       select * from dados
       on conflict (cno) do update set
         ni_responsavel        = excluded.ni_responsavel,
         tipo_responsabilidade = excluded.tipo_responsabilidade,
         situacao              = excluded.situacao,
         data_situacao         = excluded.data_situacao,
         data_inicio_obra      = excluded.data_inicio_obra,
         uf                    = excluded.uf,
         municipio             = excluded.municipio,
         bairro                = excluded.bairro,
         cep                   = excluded.cep,
         destinacao            = excluded.destinacao,
         categoria             = excluded.categoria,
         tipo_obra             = excluded.tipo_obra,
         metragem_m2           = excluded.metragem_m2,
         cno_vinculado         = excluded.cno_vinculado,
         raw                   = excluded.raw,
         atualizado_em         = now()
       returning (xmax = 0) as nova
     )
     select
       count(*) filter (where nova)::int     as novas,
       count(*) filter (where not nova)::int as atualizadas
     from up`,
  )

  const contagem = rows[0] ?? { novas: 0, atualizadas: 0 }

  return {
    linhas_processadas: lidas,
    linhas_novas: contagem.novas,
    linhas_atualizadas: contagem.atualizadas,
    obras_fora_do_universo: fora,
  }
}
