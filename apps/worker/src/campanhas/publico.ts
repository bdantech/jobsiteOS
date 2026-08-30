import { compileToSql } from '../../../../packages/core/src/mercado/filters.js'
import type { PresetCampanha } from '../../../../packages/core/src/campanhas/schemas.js'
import { pool } from '../db.js'
import { logger } from '../logger.js'

/**
 * O PÚBLICO DE UMA CAMPANHA: de segmento, filtro, lista ou preset para uma lista
 * de `empresa_id`.
 *
 * Vive no worker pela mesma decisão da 0011: `compileToSql()` é o compilador do
 * servidor, e ele só roda onde há conexão direta ao Postgres. O browser usa
 * `compileToPostgrest()` para pré-visualizar contagem; quem constrói o público de
 * verdade é aqui.
 *
 * ─── O QUE UM PRESET É, E O QUE ELE NÃO É ───────────────────────────────────
 * Preset é um atalho de UMA consulta, não um tipo especial de campanha. Depois de
 * criado, tudo o mais — exclusões, ritmo, variantes, aprovação — é idêntico. É
 * por isso que eles moram aqui, num `switch`, e não em quatro caminhos paralelos
 * pelo módulo: um preset que precisasse de tratamento especial no executor seria
 * uma quinta campanha, não um atalho.
 */

export interface DefinicaoDoPublico {
  origem_publico: string
  segmento_id: string | null
  definicao_filtro: unknown
  preset: string | null
  preset_params: Record<string, unknown>
  empresas_manuais: string[]
}

export interface PublicoResolvido {
  empresaIds: string[]
  /** Como o público foi montado, em uma frase — vai para a simulação e para o log. */
  descricao: string
}

/** Teto duro de público. Uma campanha de 200 mil pessoas é um acidente, não um plano. */
const MAX_PUBLICO = 50_000

export async function montarPublico(d: DefinicaoDoPublico): Promise<PublicoResolvido> {
  switch (d.origem_publico) {
    case 'lista_manual':
      return {
        empresaIds: d.empresas_manuais.slice(0, MAX_PUBLICO),
        descricao: `${d.empresas_manuais.length} empresa(s) escolhidas a dedo`,
      }
    case 'segmento':
      return porSegmento(d.segmento_id)
    case 'filtro':
      return porFiltro(d.definicao_filtro, 'filtro montado na hora')
    case 'preset':
      return porPreset(d.preset as PresetCampanha, d.preset_params)
    default:
      return { empresaIds: [], descricao: 'origem de público desconhecida' }
  }
}

async function porSegmento(segmentoId: string | null): Promise<PublicoResolvido> {
  if (!segmentoId) return { empresaIds: [], descricao: 'segmento não informado' }

  const { rows } = await pool.query<{ nome: string; definicao: unknown }>(
    'select nome, definicao from segmentos where id = $1',
    [segmentoId],
  )
  const seg = rows[0]
  if (!seg) return { empresaIds: [], descricao: 'segmento não encontrado' }

  return porFiltro(seg.definicao, `segmento "${seg.nome}"`)
}

async function porFiltro(definicao: unknown, descricao: string): Promise<PublicoResolvido> {
  if (!definicao) return { empresaIds: [], descricao: `${descricao} (sem definição)` }

  let compilado: { text: string; values: unknown[] }
  try {
    compilado = compileToSql(definicao)
  } catch (erro) {
    logger.error({ erro: String(erro) }, 'Filtro de campanha não compila.')
    return { empresaIds: [], descricao: `${descricao} — filtro inválido` }
  }

  /*
   * `empresa_id is not null` é a diferença entre o Universo e a base: o filtro
   * roda sobre `mercado_explorador`, que tem 900 mil linhas, e só as promovidas
   * têm ficha de empresa. Uma campanha só alcança quem tem ficha, porque é a
   * ficha que carrega contato, supressão e histórico.
   */
  const { rows } = await pool.query<{ empresa_id: string }>(
    `select empresa_id from mercado_explorador
     where empresa_id is not null and (${compilado.text})
     limit ${MAX_PUBLICO}`,
    compilado.values,
  )
  return { empresaIds: rows.map((r) => r.empresa_id), descricao }
}

async function porPreset(
  preset: PresetCampanha,
  params: Record<string, unknown>,
): Promise<PublicoResolvido> {
  switch (preset) {
    case 'winback_ex_clientes': {
      /*
       * Ex-clientes, opcionalmente de UM motivo de saída.
       *
       * Quem saiu por "taxa alta" e quem saiu porque "o caixa melhorou" precisam
       * de mensagens diferentes — e é por isso que o schema recusa a campanha que
       * não escolhe. Aqui a escolha vira `where`.
       */
      const motivo = typeof params.motivo_saida === 'string' ? params.motivo_saida : null
      const { rows } = await pool.query<{ empresa_id: string }>(
        `select empresa_id from mercado_explorador
         where empresa_id is not null
           and e_ex_cliente
           and ($1::text is null or ex_cliente_motivo = $1)
         limit ${MAX_PUBLICO}`,
        [motivo],
      )
      return {
        empresaIds: rows.map((r) => r.empresa_id),
        descricao: motivo ? `ex-clientes que saíram por "${motivo}"` : 'ex-clientes (todos os motivos)',
      }
    }

    case 'spes_sem_certificado': {
      /*
       * A cauda de SPEs sem certificado. O destinatário é a MATRIZ, não a SPE:
       * uma SPE quase nunca tem gente própria para responder, e mandar para o
       * CNPJ da obra é mandar para uma caixa que ninguém abre.
       *
       * `certificado_universo` já resolve isso: a linha de uma SPE carrega o
       * `empresa_id` da MATRIZ (o `cnpj` é que é o da SPE). Então `not e_matriz`
       * são as SPEs, e o `empresa_id` delas já é para quem escrever.
       */
      const { rows } = await pool.query<{ empresa_id: string }>(
        `select distinct empresa_id from certificado_universo
         where empresa_id is not null and not e_matriz and not coberto
         limit ${MAX_PUBLICO}`,
      )
      return {
        empresaIds: rows.map((r) => r.empresa_id),
        descricao: 'matrizes com SPEs sem certificado válido',
      }
    }

    case 'docs_pendentes': {
      const dias = Number(params.dias_parado ?? 7)
      const { rows } = await pool.query<{ empresa_id: string }>(
        `select distinct empresa_id from vendas
         where estagio = 'aguardando_documentacao'
           and atualizada_em < now() - ($1 || ' days')::interval
         limit ${MAX_PUBLICO}`,
        [String(Number.isFinite(dias) && dias > 0 ? Math.floor(dias) : 7)],
      )
      return {
        empresaIds: rows.map((r) => r.empresa_id),
        descricao: `vendas paradas em documentação há mais de ${dias} dias`,
      }
    }

    case 'fornecedores_a_cadastrar': {
      const minimo = Number(params.potencial_minimo ?? 0)
      const { rows } = await pool.query<{ empresa_id: string }>(
        `select empresa_id from fornecedores_funil
         where empresa_id is not null
           and estagio not in ('cadastrado', 'sem_interesse')
           and coalesce(potencial_mensal, 0) >= $1
         limit ${MAX_PUBLICO}`,
        [Number.isFinite(minimo) && minimo > 0 ? minimo : 0],
      )
      return {
        empresaIds: rows.map((r) => r.empresa_id),
        descricao:
          minimo > 0
            ? `fornecedores a cadastrar com potencial ≥ ${minimo}`
            : 'fornecedores a cadastrar',
      }
    }

    default:
      return { empresaIds: [], descricao: 'preset desconhecido' }
  }
}
