import { arvoreEfetiva, populacaoDoTipo, whereDaArvore } from '../../../../../packages/core/src/agentes/escopo.js'
import {
  escopoSchema,
  lerLimitesAgente,
  objetivoDoTemplate,
  type ModoRodagem,
  type TipoMandato,
} from '../../../../../packages/core/src/agentes/schemas.js'
import { pool, supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'

/**
 * A CRIAÇÃO DE MANDATOS POR REGRA (Prompt 09 §2.3) — diária.
 *
 * Cada regra ATIVA é avaliada com o motor de filtros do Prompt 02, EM E com o escopo do
 * agente (e o piloto por cima, em modo piloto): a regra diz "o que", o escopo diz "onde
 * este agente pode trabalhar". Só nasce mandato para o que cai nos dois.
 *
 * Três tetos, e o menor manda: o `teto_mandatos_ativos` da regra, a cota de mandatos
 * ativos do agente, e o índice único do banco (um mandato ativo por empresa e tipo —
 * não duas IAs perseguindo a mesma coisa). Empresa em cobrança ou suprimida NUNCA entra,
 * seja qual for o filtro: isso não é critério de regra, é lei da casa.
 */

export interface ResultadoCriarMandatos {
  regras: number
  criados: number
  ignorados: number
  erros: number
}

export async function criarMandatosPorRegra(): Promise<ResultadoCriarMandatos> {
  const acc: ResultadoCriarMandatos = { regras: 0, criados: 0, ignorados: 0, erros: 0 }
  const { data: regras } = await supabaseAdmin
    .from('mandato_regras')
    .select('*')
    .eq('ativa', true)
    .order('prioridade', { ascending: false })
  acc.regras = regras?.length ?? 0

  for (const regra of regras ?? []) {
    try {
      const r = await avaliarRegra(regra)
      acc.criados += r.criados
      acc.ignorados += r.ignorados
    } catch (erro) {
      acc.erros++
      logger.error({ regra: regra.id, erro: String(erro) }, 'Falha ao avaliar regra de mandato.')
    }
    await supabaseAdmin.from('mandato_regras').update({ ultima_avaliacao_em: new Date().toISOString() }).eq('id', regra.id)
  }
  logger.info(acc, 'Regras de mandato avaliadas.')
  return acc
}

interface Regra {
  id: string
  nome: string
  tipo_mandato: string
  agente_id: string | null
  playbook_id: string | null
  filtro: unknown
  objetivo_template: string
  orcamento_centavos: number
  max_acoes: number
  prazo_dias: number
  teto_mandatos_ativos: number | null
  prioridade: number
}

interface Candidato {
  empresa_id: string | null
  fornecedor_cnpj?: string | null
  access_key?: string | null
  nome: string | null
  nf_numero?: string | null
  nf_valor?: number | null
  sacado?: string | null
}

async function avaliarRegra(regra: Regra): Promise<{ criados: number; ignorados: number }> {
  if (!regra.agente_id) return { criados: 0, ignorados: 0 }
  const { data: agente } = await supabaseAdmin
    .from('vendedores')
    .select('id, nome, is_ia, ativo, escopo, limites, modo_rodagem')
    .eq('id', regra.agente_id)
    .maybeSingle()
  if (!agente?.is_ia || !agente.ativo) return { criados: 0, ignorados: 0 }

  const tipo = regra.tipo_mandato as TipoMandato
  const escopo = escopoSchema.safeParse(agente.escopo ?? {})
  const populacao = populacaoDoTipo(tipo)
  const arvore = arvoreEfetiva(escopo.success ? escopo.data : null, agente.modo_rodagem as ModoRodagem, populacao, regra.filtro)
  // Regra sem filtro nenhum (nem do escopo) pegaria a base inteira: recusa em vez de adivinhar.
  if (!arvore) {
    logger.warn({ regra: regra.id }, 'Regra sem filtro efetivo; nada é criado.')
    return { criados: 0, ignorados: 0 }
  }

  const ativosDoAgente = await contar(`select count(*)::int as n from mandatos where agente_id = $1 and estado in ('aberto','em_andamento','aguardando_externo')`, [agente.id])
  const ativosDaRegra = await contar(`select count(*)::int as n from mandatos where regra_id = $1 and estado in ('aberto','em_andamento','aguardando_externo','pausado')`, [regra.id])
  const cotaAgente = lerLimitesAgente(agente.limites).mandatos_ativos - ativosDoAgente
  const cotaRegra = (regra.teto_mandatos_ativos ?? Number.POSITIVE_INFINITY) - ativosDaRegra
  const vagas = Math.max(0, Math.min(cotaAgente, cotaRegra, 200))
  if (vagas === 0) return { criados: 0, ignorados: 0 }

  const where = whereDaArvore(populacao, arvore)
  const n = where.values.length
  const candidatos: Candidato[] =
    populacao === 'notas'
      ? (
          await pool.query<Candidato>(
            `select nf.fornecedor_empresa_id as empresa_id, nf.fornecedor_cnpj, nf.access_key, nf.fornecedor_nome as nome,
                    nf.numero as nf_numero, nf.valor::float as nf_valor, coalesce(nf.sacado_razao_social, nf.sacado_nome) as sacado
               from notas_funil nf
              where (${where.text})
                and nf.estagio_funil in ('a_prospectar', 'em_prospeccao')
                and not exists (select 1 from mandatos m where m.nota_access_key = nf.access_key)
                and not coalesce(public.app_cobranca_sacado_bloqueado(nf.fornecedor_cnpj), false)
                and not exists (select 1 from supressao s where s.escopo = 'empresa' and s.valor = nf.fornecedor_cnpj
                                and (s.expira_em is null or s.expira_em >= current_date))
              order by nf.receita_esperada desc nulls last
              limit $${n + 1}`,
            [...where.values, vagas * 3],
          )
        ).rows
      : (
          await pool.query<Candidato>(
            `select a.empresa_id, a.razao_social as nome
               from agentes_empresas_alvo a
              where (${where.text})
                and not a.em_cobranca and not a.suprimida
                and not exists (select 1 from mandatos m where m.empresa_id = a.empresa_id and m.tipo = $${n + 1}
                                and m.estado in ('aberto','em_andamento','aguardando_externo','pausado'))
              order by a.limite_potencial desc nulls last, a.score_credito desc nulls last
              limit $${n + 2}`,
            [...where.values, tipo, vagas * 3],
          )
        ).rows

  let criados = 0
  let ignorados = 0
  for (const c of candidatos) {
    if (criados >= vagas) break
    const empresaId = c.empresa_id ?? (c.fornecedor_cnpj ? await promover(c.fornecedor_cnpj) : null)
    if (!empresaId) {
      ignorados++
      continue
    }
    const valor = c.nf_valor != null ? c.nf_valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null
    const { error } = await supabaseAdmin.rpc('app__agentes_criar_mandato', {
      p: {
        tipo,
        objetivo: objetivoDoTemplate(regra.objetivo_template, { empresa: c.nome, nf_numero: c.nf_numero, nf_valor: valor, sacado: c.sacado }),
        empresa_id: empresaId,
        nota_access_key: c.access_key ?? null,
        agente_id: agente.id,
        playbook_id: regra.playbook_id,
        orcamento_centavos: regra.orcamento_centavos,
        max_acoes: regra.max_acoes,
        prazo_dias: regra.prazo_dias,
        prioridade: regra.prioridade,
        origem: 'regra',
        regra_id: regra.id,
      } as never,
    })
    if (error) {
      // Mandato ativo já existente, cota que acabou no meio: não é erro da regra.
      ignorados++
      if (!/mandato ativo|cota|cobrança|suprimida/i.test(error.message)) {
        logger.warn({ regra: regra.id, empresa: empresaId, erro: error.message }, 'Mandato não criado.')
      }
      continue
    }
    criados++
  }
  return { criados, ignorados }
}

async function contar(sql: string, params: unknown[]): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(sql, params)
  return rows[0]?.n ?? 0
}

/** Fornecedor de NF quase nunca tem ficha; a promoção é o mesmo núcleo da ligação (0225). */
async function promover(cnpj: string): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ id: string }>(
      `select (public.app__promover_fornecedor_para_empresa($1, null, 'antecipacao')).id as id`,
      [cnpj],
    )
    return rows[0]?.id ?? null
  } catch {
    return null
  }
}
