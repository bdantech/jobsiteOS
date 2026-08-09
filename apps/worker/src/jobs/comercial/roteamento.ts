import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { rotearNota, type OriginadorRoteavel } from '../../../../../packages/core/src/comercial/roteamento.js'
import { pool, supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { emitirEvento, notificarPerfis } from '../../radar/eventos.js'
import { lerPainel } from '../../comercial/config.js'

/**
 * Aplica o roteamento (04g §3) às NFs vivas sem dono definido à mão.
 *
 * Roda depois da reclassificação do funil, na mesma corrida do diário da Antecipação:
 * a faixa muda com o calendário, e uma nota que entrou em faixa hoje precisa de dono
 * hoje — não na segunda-feira.
 *
 * A decisão em si mora no core, com testes. Aqui só se carrega o estado e se grava o
 * resultado, porque a pergunta "por que esta nota é minha" tem de ter a mesma resposta
 * na gravação e na tela.
 */

export interface ResultadoRoteamento {
  avaliadas: number
  atribuidas: number
  sem_dono: number
  por_origem: Record<string, number>
}

async function originadores(): Promise<OriginadorRoteavel[]> {
  const { data } = await supabaseAdmin
    .from('vendedores')
    .select('id, settings')
    .eq('tipo', 'originador')
    .eq('ativo', true)
  if (!data?.length) return []

  const ids = data.map((v) => v.id)
  const { data: terrs } = await supabaseAdmin
    .from('vendedor_territorios')
    .select('vendedor_id, ufs, faturamento_min, faturamento_max')
    .in('vendedor_id', ids)
  const porVendedor = new Map((terrs ?? []).map((t) => [t.vendedor_id, t]))

  const { rows } = await pool.query<{ vendedor_id: string; n: string }>(
    `select vendedor_id, count(*) as n from notas_fiscais
     where vendedor_id is not null and estagio_funil not in ('convertida', 'perdida')
     group by vendedor_id`,
  )
  const carga = new Map(rows.map((r) => [r.vendedor_id, Number(r.n)]))

  return data.map((v) => {
    const s = (v.settings ?? {}) as { empresas_escolhidas?: string[] }
    const t = porVendedor.get(v.id)
    return {
      vendedor_id: v.id,
      empresas_escolhidas: s.empresas_escolhidas ?? [],
      territorio: t
        ? {
            ufs: (t.ufs ?? []) as string[],
            faturamento_min: t.faturamento_min === null || t.faturamento_min === undefined ? null : Number(t.faturamento_min),
            faturamento_max: t.faturamento_max === null || t.faturamento_max === undefined ? null : Number(t.faturamento_max),
          }
        : null,
      nfs_vivas: carga.get(v.id) ?? 0,
    }
  })
}

interface LinhaNf {
  access_key: string
  sacado_empresa_id: string | null
  fornecedor_empresa_id: string | null
  sacado_uf: string | null
  sacado_faturamento: string | null
  sacado_gestao: string | null
  vendedor_id: string | null
  vendedor_origem: string | null
}

export async function rotearNotasJob(): Promise<ResultadoRoteamento> {
  const lista = await originadores()
  const acc: ResultadoRoteamento = { avaliadas: 0, atribuidas: 0, sem_dono: 0, por_origem: {} }

  const { rows } = await pool.query<LinhaNf>(`
    select nf.access_key, nf.sacado_empresa_id, nf.fornecedor_empresa_id,
           u.uf as sacado_uf, sac.faturamento_anual as sacado_faturamento,
           sac.gestao_operacao as sacado_gestao,
           nf.vendedor_id, nf.vendedor_origem
    from notas_fiscais nf
    left join empresas sac on sac.id = nf.sacado_empresa_id
    left join mercado_universo u on u.cnpj = nf.sacado_cnpj
    where nf.estagio_funil not in ('convertida', 'perdida')
      and nf.operavel is not false
      and coalesce(nf.vendedor_origem, '') <> 'manual'
  `)

  for (const nf of rows) {
    acc.avaliadas++
    const r = rotearNota(
      {
        sacado_empresa_id: nf.sacado_empresa_id,
        fornecedor_empresa_id: nf.fornecedor_empresa_id,
        sacado_uf: nf.sacado_uf,
        sacado_faturamento: nf.sacado_faturamento === null ? null : Number(nf.sacado_faturamento),
        sacado_gestao: nf.sacado_gestao,
        vendedor_id_atual: nf.vendedor_id,
        vendedor_origem_atual: nf.vendedor_origem,
      },
      lista,
    )

    // Só grava o que MUDA. Sem isto o job reescreve dezenas de milhares de linhas por
    // dia e o `atualizada_em` da nota deixa de significar qualquer coisa.
    if (r.vendedor_id === nf.vendedor_id) {
      if (r.vendedor_id === null) acc.sem_dono++
      continue
    }

    await supabaseAdmin
      .from('notas_fiscais')
      .update({
        vendedor_id: r.vendedor_id,
        vendedor_origem: r.origem,
        vendedor_definido_em: new Date().toISOString(),
      })
      .eq('access_key', nf.access_key)

    if (r.vendedor_id) {
      acc.atribuidas++
      acc.por_origem[r.origem ?? '—'] = (acc.por_origem[r.origem ?? '—'] ?? 0) + 1
    } else {
      acc.sem_dono++
    }
  }

  if (acc.sem_dono > 0) {
    // A fila sem dono é trabalho do gestor, e trabalho que ninguém vê não é feito.
    await notificarPerfis(['Admin', 'Comercial'], {
      titulo: 'NFs sem originador',
      corpo: `${acc.sem_dono} nota(s) viva(s) sem dono — nenhum território ou carteira as cobre.`,
      url: '/comercial/fila',
    })
  }

  logger.info(acc, 'Roteamento de NFs concluído.')
  return acc
}

/**
 * Vendedor sem nenhum movimento em Z dias ÚTEIS (04g §7).
 *
 * Dias úteis, e não corridos: um alerta que dispara na terça porque o vendedor não
 * trabalhou no fim de semana é um alerta que as pessoas aprendem a ignorar — e o
 * próximo, que importa, some junto.
 */
export async function vendedoresSemAtividadeJob(): Promise<{ avisados: number }> {
  const cfg = await lerPainel()

  const { rows } = await pool.query<{ id: string; nome: string; ultimo: string | null }>(
    `
    with movimentos as (
      select sdr_id as vendedor_id, max(atualizado_em) as ultimo from sdr_leads group by 1
      union all
      select vendedor_id, max(atualizada_em) from vendas group by 1
      union all
      select vendedor_id, max(vendedor_definido_em) from notas_fiscais where vendedor_id is not null group by 1
    ),
    ultimo_por_vendedor as (
      select vendedor_id, max(ultimo) as ultimo from movimentos group by 1
    )
    select v.id, v.nome, u.ultimo
    from vendedores v
    left join ultimo_por_vendedor u on u.vendedor_id = v.id
    where v.ativo and not v.is_ia
      and (
        u.ultimo is null
        -- Conta só dias úteis entre o último movimento e hoje.
        or (select count(*) from generate_series(u.ultimo::date, current_date - 1, '1 day') d
            where extract(isodow from d) < 6) >= $1
      )
  `,
    [cfg.sem_atividade_dias_uteis],
  )

  for (const v of rows) {
    await emitirEvento(null, EVENTO_TIPOS.VENDEDOR_SEM_ATIVIDADE, {
      titulo: 'Vendedor sem atividade',
      resumo: v.ultimo
        ? `${v.nome} não move nada desde ${new Date(v.ultimo).toLocaleDateString('pt-BR')}.`
        : `${v.nome} ainda não registrou nenhum movimento.`,
      url: '/comercial',
      vendedor_id: v.id,
    })
  }

  if (rows.length > 0) {
    await notificarPerfis(['Admin', 'Comercial'], {
      titulo: 'Vendedores sem atividade',
      corpo: `${rows.length} vendedor(es) sem movimento há ${cfg.sem_atividade_dias_uteis} dias úteis.`,
      url: '/comercial',
    })
  }

  return { avisados: rows.length }
}
