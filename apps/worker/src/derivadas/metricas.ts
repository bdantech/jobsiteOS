import type pg from 'pg'
import { logger } from '../logger.js'

/**
 * Refreshes `mercado_metricas` — the table the worker OWNS (§2). One row per
 * CNPJ, and it is the only place these numbers live: duplicating them onto both
 * `mercado_universo` and `empresas` would mean keeping two copies in step, which
 * eventually means not keeping them in step.
 *
 * It runs BEFORE reclassification, always: the SAM rule reads qtd_filiais and
 * grupo_spes_total, and SOM reads obras_ativas. Reclassifying against last
 * month's metrics is worse than not reclassifying.
 *
 * One statement. Every metric is an aggregate over an indexed column, and the
 * whole thing is an INSERT … SELECT … ON CONFLICT — 2M rows in one round trip
 * instead of 2M round trips.
 */
export async function atualizarMetricas(client: pg.ClientBase): Promise<number> {
  const { rowCount } = await client.query(
    `with base as (
       -- Every CNPJ the Explorador can show: staging + companies that never passed
       -- through it (list imports, §5.5).
       select u.cnpj, u.cnpj_raiz, u.grupo_id from mercado_universo u
       union all
       select e.cnpj, left(e.cnpj, 8), e.grupo_id
       from empresas e
       where not exists (select 1 from mercado_universo u where u.cnpj = e.cnpj)
     ),
     filiais as (
       select cnpj_raiz, count(*) filter (where matriz_filial = 'filial')::int as qtd
       from mercado_universo
       group by cnpj_raiz
     ),
     grupo as (
       select
         grupo_id,
         count(*) filter (where is_spe)::int as spes_total,
         count(*) filter (
           where is_spe and data_inicio_atividade >= (current_date - interval '24 months')
         )::int as spes_24m,
         coalesce(array_agg(distinct uf) filter (where uf is not null), '{}') as ufs,
         sum(capital_social) as capital
       from mercado_universo
       where grupo_id is not null
       group by grupo_id
     ),
     obras as (
       select
         ni_responsavel as cnpj,
         count(*) filter (where lower(situacao) = 'ativa')::int as ativas,
         count(*) filter (
           where data_inicio_obra >= (current_date - interval '24 months')
         )::int as iniciadas_24m,
         coalesce(sum(metragem_m2) filter (where lower(situacao) = 'ativa'), 0) as m2
       from mercado_obras
       group by ni_responsavel
     ),
     contato as (
       select distinct e.cnpj
       from empresas e
       join contatos c on c.empresa_id = e.id
     )
     insert into mercado_metricas (
       cnpj, qtd_filiais, grupo_spes_total, grupo_spes_24m, grupo_ufs,
       grupo_capital_agregado, obras_ativas, obras_iniciadas_24m, m2_em_execucao,
       tem_contato, atualizado_em
     )
     select
       b.cnpj,
       coalesce(f.qtd, 0),
       coalesce(g.spes_total, 0),
       coalesce(g.spes_24m, 0),
       coalesce(g.ufs, '{}'),
       g.capital,
       coalesce(o.ativas, 0),
       coalesce(o.iniciadas_24m, 0),
       coalesce(o.m2, 0),
       exists (select 1 from contato ct where ct.cnpj = b.cnpj),
       now()
     from base b
     left join filiais f on f.cnpj_raiz = b.cnpj_raiz
     left join grupo   g on g.grupo_id  = b.grupo_id
     left join obras   o on o.cnpj      = b.cnpj
     on conflict (cnpj) do update set
       qtd_filiais            = excluded.qtd_filiais,
       grupo_spes_total       = excluded.grupo_spes_total,
       grupo_spes_24m         = excluded.grupo_spes_24m,
       grupo_ufs              = excluded.grupo_ufs,
       grupo_capital_agregado = excluded.grupo_capital_agregado,
       obras_ativas           = excluded.obras_ativas,
       obras_iniciadas_24m    = excluded.obras_iniciadas_24m,
       m2_em_execucao         = excluded.m2_em_execucao,
       tem_contato            = excluded.tem_contato,
       atualizado_em          = now()`,
  )

  const total = rowCount ?? 0
  logger.info({ cnpjs: total }, 'Métricas atualizadas.')
  return total
}
